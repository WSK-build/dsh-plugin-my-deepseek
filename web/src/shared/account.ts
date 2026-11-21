/**
 * DeepSeek 账号登录：PKCE S256 加回环重定向，用浏览器返回的授权码换取长期令牌，
 * 请求 api.deepseek.com 时以 `x-dsh-auth-token` 携带。
 *
 * 网页自身做不到的部分由原生壳提供：
 *  - `startLogin` 向 platform.deepseek.com 发出两次 POST（原生代码不受 CORS 限制），
 *    并把授权页地址交给页面打开；
 *  - 回环 HTTP 监听接收 /oauth/callback 回调；
 *  - 令牌存于 Android Keystore 加密的首选项。
 *
 * 没有原生桥时，登录行根本不渲染。
 */

export type AccountPhase =
  | 'idle'
  | 'initializing'
  | 'waiting-browser'
  | 'exchanging'
  | 'signed-in'
  | 'failed'
  | 'expired'

export type AccountState = {
  phase: AccountPhase
  /** 面向用户的失败原因，已由壳完成本地化。 */
  error?: string
}

export type AccountToken = {
  token: string
  /** 完成交换的 ISO 时间戳；令牌本身不带过期时间。 */
  obtainedAt: string
}

/** 原生壳实现的桥，注入为 window.__DSH_ACCOUNT_BRIDGE__。 */
export type AccountBridge = {
  /**
   * 发起浏览器授权流程。进度经 `onPhase` 上报；若交换在同一次页面加载内完成，
   * 该 Promise 以令牌兑现；若壳先把页面导航走，则以 null 兑现。
   */
  startLogin: (locale: 'zh_CN' | 'en_US', onPhase?: (phase: AccountPhase) => void) => Promise<AccountToken | null>
  /** 用系统浏览器打开当前的授权页地址。 */
  openAuthorizeUrl: () => void
  /** 取消进行中的登录尝试。 */
  cancel: () => void
  /** 读取已保存的令牌，不发起登录。 */
  getToken: () => Promise<AccountToken | null>
  /** 清除已保存的令牌。 */
  signOut: () => Promise<void>
  /** 通知壳某次请求被拒绝（401 / 40003），不等待结果。 */
  reportRejectedToken: () => void
  /**
   * 把二进制内容写入用户可访问的位置（下载目录）。
   *
   * WebView 不响应 blob: 下载链接，导出必须经由壳完成；
   * 未提供该能力时调用方回退到浏览器式下载。
   */
  saveFile?: (payload: { filename: string; base64: string; mimeType: string }) => Promise<void>
  /**
   * 由原生侧携带账号令牌发出请求（不受 CORS 限制）。
   * 返回可用的 Response：流式响应（SSE）以分块的 ReadableStream 到达，
   * 对话输出因此可以逐段渲染。
   */
  fetch: (input: { url: string; method: string; headers: Record<string, string>; body?: string }, signal?: AbortSignal) => Promise<Response>
}

declare global {
  interface Window {
    __DSH_ACCOUNT_BRIDGE__?: AccountBridge
  }
}

export const accountBridge = (): AccountBridge | undefined => {
  if (typeof window === 'undefined') return undefined
  if (window.__DSH_ACCOUNT_BRIDGE__) return window.__DSH_ACCOUNT_BRIDGE__
  // 通过全局钩子取得，插件构建产物因此不静态依赖 Capacitor 运行时。
  const capacitor = (globalThis as { __DSH_ACCOUNT_CAPACITOR__?: () => AccountBridge | undefined }).__DSH_ACCOUNT_CAPACITOR__
  return capacitor?.()
}

export const hasAccountBridge = (): boolean => accountBridge() !== undefined

/* ------------------------------------------------------------------ *
 * 登录状态（面向界面）
 * ------------------------------------------------------------------ */

type Listener = (state: AccountState) => void

const listeners = new Set<Listener>()
let current: AccountState = { phase: 'idle' }
let loginTask: Promise<void> | null = null

export const accountState = (): AccountState => current

export const onAccountState = (listener: Listener): (() => void) => {
  listeners.add(listener)
  listener(current)
  return () => listeners.delete(listener)
}

const setState = (state: AccountState) => {
  current = state
  for (const listener of listeners) listener(state)
}

/* ------------------------------------------------------------------ *
 * 登录与登出
 * ------------------------------------------------------------------ */

export const startAccountLogin = (locale: 'zh_CN' | 'en_US'): void => {
  const bridge = accountBridge()
  if (!bridge || loginTask) return
  loginTask = (async () => {
    setState({ phase: 'initializing' })
    try {
      // 主要路径：回环回调完成后，该 Promise 以令牌兑现。
      // accountPhase 事件既驱动进度显示，也覆盖跨页面导航仍然完成的流程。
      const token = await bridge.startLogin(locale, (phase) => {
        if (phase === 'signed-in') {
          setState({ phase: 'signed-in' })
        } else if (phase === 'failed') {
          setState({ phase: 'failed', error: locale === 'zh_CN' ? '平台拒绝了登录请求' : 'the platform rejected the sign-in' })
        } else if (phase === 'expired') {
          setState({ phase: 'expired' })
        } else {
          setState({ phase })
        }
      })
      if (token) {
        setState({ phase: 'signed-in' })
      }
    } catch (error) {
      setState({ phase: 'failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      loginTask = null
    }
  })()
}

export const restoreAccountSession = async (): Promise<void> => {
  const bridge = accountBridge()
  if (!bridge) return
  // 原生交换尚未返回时页面就可能重载，因此先短暂轮询令牌存储，
  // 再让状态停留在未登录。
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const token = await bridge.getToken()
      if (token) {
        setState({ phase: 'signed-in' })
        return
      }
    } catch {
      // 桥调用偶发失败，留待下一次尝试重试。
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  setState({ phase: 'idle' })
}

export const signOutAccount = async (): Promise<void> => {
  const bridge = accountBridge()
  if (!bridge) return
  await bridge.signOut()
  setState({ phase: 'idle' })
}

/** 由壳调用，用于上报阶段变化（等待浏览器、交换中……）。 */
export const publishAccountPhase = (phase: AccountPhase, error?: string): void => {
  setState({ phase, error })
}

/** 壳上报已保存的令牌被拒绝（HTTP 401 / 业务码 40003）。 */
export const reportAccountTokenRejected = (): void => {
  void signOutAccount().then(() => setState({ phase: 'expired' }))
}

/* ------------------------------------------------------------------ *
 * 请求头层
 * ------------------------------------------------------------------ */

/**
 * 承载账号请求的请求头标记；null 表示不走账号模式。
 *
 * 页面侧不持有令牌：原生壳在发出请求时自行加上鉴权头，
 * 这里只用于判断本次请求是否应由壳代发。请求归属的完整判定见 account-routing.ts。
 */
export const accountHeaderFor = (apiKey: string | null): string | null => {
  if (current.phase !== 'signed-in') return null
  return accountBridge() ? 'x-dsh-auth-token' : null
}

/**
 * 账号模式下的原生请求：由壳携带令牌发出，并返回可用的 Response（SSE 为流式）。
 * 账号模式未启用时返回 null，调用方据此回退到普通 fetch。
 */
export const nativeFetch = (
  input: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  },
  signal?: AbortSignal
): Promise<Response | null> => {
  const bridge = accountBridge()
  if (current.phase !== 'signed-in' || !bridge?.fetch) return Promise.resolve(null)
  return bridge.fetch(input, signal)
}
