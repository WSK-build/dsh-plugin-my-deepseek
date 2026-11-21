/**
 * 把原生账号桥接到 web/src/shared/account.ts，供两个移动壳使用：
 *  - Capacitor 插件 `DeepSeekAccount`（Android）；
 *  - ArkWeb javaScriptProxy `window.__DSH_ACCOUNT_HARMONY__`（鸿蒙）。
 *
 * 插件产物不会导入本模块，因此插件里 `hasAccountBridge()` 恒为 false，
 * 账号登录行保持隐藏。
 */
import { publishAccountPhase, type AccountBridge } from './account.js'

/* ------------------------------------------------------------------ *
 * Capacitor（Android）：fetchStream 与监听事件
 * ------------------------------------------------------------------ */

interface CapacitorFetchStreamPlugin {
  startLogin(options: { locale: string }): Promise<{ token: string; obtainedAt: string } | null>
  openAuthorizeUrl(): Promise<void>
  cancel(): Promise<void>
  getToken(): Promise<{ token: string; obtainedAt: string } | null>
  signOut(): Promise<void>
  reportRejectedToken(): Promise<void>
  fetch(options: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; contentType: string; body: string }>
  fetchStream(options: { url: string; method: string; headers: Record<string, string>; body?: string; callId: string }): Promise<void>
  cancelStream(options: { callId: string }): Promise<void>
  saveFile(options: { filename: string; base64: string; mimeType: string }): Promise<{ filename: string }>
  addListener(eventName: string, listener: (data: unknown) => void): Promise<{ remove: () => void }>
}

const capacitorBridge = (): AccountBridge | undefined => {
  const capacitor = (globalThis as unknown as {
    Capacitor?: { isPluginAvailable: (name: string) => boolean; Plugins: Record<string, unknown> }
  }).Capacitor
  if (!capacitor?.isPluginAvailable?.('DeepSeekAccount')) return undefined
  const plugin = capacitor.Plugins.DeepSeekAccount as CapacitorFetchStreamPlugin

  let streamSeq = 0
  const chunkWaiters = new Map<string, { push: (text: string) => void; close: () => void }>()
  const openWaiters = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void }>()

  /**
   * 全局注册一次四个流事件，按 callId 分发。
   * 某些 Capacitor 与平台的组合下，addListener 返回 Promise，另一些返回同步句柄，
   * 因此这里检查返回值，而不是直接假定它是 thenable。
   */
  let streamListenersReady = false
  const ensureStreamListeners = () => {
    if (streamListenersReady) return
    streamListenersReady = true
    const safeOn = (name: string, handler: (data: unknown) => void) => {
      try {
        const registration = plugin.addListener(name, handler)
        if (registration && typeof registration.then === 'function') {
          registration.catch(() => undefined)
        }
      } catch {
        // 监听注册尽力而为，失败不影响其他能力
      }
    }
    safeOn('streamOpen', (data) => {
      const event = data as { callId: string; status: number; contentType: string }
      const waiter = openWaiters.get(event.callId)
      if (!waiter) return
      openWaiters.delete(event.callId)
      waiter.resolve(
        new Response(pendingStreamFor(event.callId), {
          status: event.status,
          statusText: '',
          headers: { 'content-type': event.contentType || 'application/octet-stream' },
        })
      )
    })
    safeOn('streamChunk', (data) => {
      const event = data as { callId: string; text: string }
      chunkWaiters.get(event.callId)?.push(event.text)
    })
    safeOn('streamClose', (data) => {
      const event = data as { callId: string }
      const waiter = openWaiters.get(event.callId)
      if (waiter) {
        openWaiters.delete(event.callId)
        waiter.reject(new Error('stream closed before opening'))
      }
      chunkWaiters.get(event.callId)?.close()
    })
    safeOn('streamError', (data) => {
      const event = data as { callId: string; error: string }
      const waiter = openWaiters.get(event.callId)
      if (waiter) {
        openWaiters.delete(event.callId)
        waiter.reject(new Error(event.error))
      }
      chunkWaiters.get(event.callId)?.close()
    })
  }

  /** 某个 callId 对应的 ReadableStream 响应体，在 streamOpen 之前创建。 */
  const pendingStreams = new Map<string, ReadableStream<Uint8Array>>()
  const pendingStreamFor = (callId: string): ReadableStream<Uint8Array> =>
    pendingStreams.get(callId) ?? new ReadableStream<Uint8Array>()

  // 授权流程会把本 WebView 导航到授权页：页面全程处于前台，
  // 阶段事件既承载页面内的进度，也承载重载之后的登录完成。
  const ensurePhaseListener = (() => {
    let started = false
    return () => {
      if (started) return
      started = true
      void plugin.addListener('accountPhase', (data) => {
        const event = data as { phase: string }
        publishAccountPhase(event.phase)
      })
    }
  })()

  return {
    startLogin: async (locale) => {
      ensurePhaseListener()
      // 插件以授权页地址兑现；导航过去后整个授权过程都在应用的 WebView 内完成。
      // 回环重定向由原生侧拦截，令牌存储随后恢复登录状态。
      const result = (await plugin.startLogin({ locale: locale === 'zh_CN' ? 'zh_CN' : 'en_US' })) as
        | { authorizeUrl?: string }
        | null
      if (result?.authorizeUrl) {
        window.location.href = result.authorizeUrl
      }
      return null
    },
    openAuthorizeUrl: async () => void (await plugin.openAuthorizeUrl()),
    cancel: async () => void (await plugin.cancel()),
    getToken: async () => plugin.getToken(),
    signOut: async () => void (await plugin.signOut()),
    reportRejectedToken: async () => void (await plugin.reportRejectedToken()),
    saveFile: async (payload) => void (await plugin.saveFile(payload)),
    fetch: async (input, signal) => {
      // SSE 等流式请求走 fetchStream，输出可以逐段渲染；
      // 其余请求走一次性的 fetch。
      const wantsStream = (input.headers['accept'] ?? '').includes('text/event-stream')
      if (!wantsStream) {
        const result = await plugin.fetch(input)
        return new Response(result.body, {
          status: result.status,
          statusText: '',
          headers: { 'content-type': result.contentType },
        })
      }
      ensureStreamListeners()
      const callId = `s${++streamSeq}`
      const waiters = { push: (_text: string) => undefined, close: () => undefined }
      // 响应头到达时 streamOpen 就兑现，页面可以在流仍然打开时消费 SSE 分块。
      const opened = new Promise<Response>((resolve, reject) => {
        openWaiters.set(callId, { resolve, reject })
      })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          waiters.push = (text) => {
            try {
              controller.enqueue(encoder.encode(text))
            } catch {
              // 消费方已取消
            }
          }
          waiters.close = () => {
            chunkWaiters.delete(callId)
            pendingStreams.delete(callId)
            try {
              controller.close()
            } catch {
              // 已经关闭
            }
          }
          chunkWaiters.set(callId, waiters)
          signal?.addEventListener(
            'abort',
            () => {
              void plugin.cancelStream({ callId })
              waiters.close()
            },
            { once: true }
          )
        },
      })
      // `stream` 必须在构造完成之后再放入映射：start() 同步执行，
      // 在暂时性死区里读取 `stream` 会直接报错。
      pendingStreams.set(callId, stream)
      void plugin.fetchStream({ ...input, callId }).catch((error: unknown) => {
        const waiter = openWaiters.get(callId)
        if (waiter) {
          openWaiters.delete(callId)
          waiter.reject(error instanceof Error ? error : new Error(String(error)))
        }
        waiters.close()
      })
      return opened
    },
  }
}

/* ------------------------------------------------------------------ *
 * ArkWeb javaScriptProxy（鸿蒙）
 * ------------------------------------------------------------------ */

const harmonyProxy = (): AccountBridge | undefined => {
  const proxy = (globalThis as unknown as { __DSH_ACCOUNT_HARMONY__?: Record<string, unknown> }).__DSH_ACCOUNT_HARMONY__
  if (!proxy || typeof proxy.startLogin !== 'function') return undefined
  return {
    startLogin: async (locale) => {
      // ArkTS 无法直接传递对象，因此代理返回 JSON 字符串。
      const result = await (proxy.startLogin as (locale: string) => Promise<string | null>)(locale)
      return result ? (JSON.parse(result) as { token: string; obtainedAt: string }) : null
    },
    openAuthorizeUrl: async () => void (await (proxy.openAuthorizeUrl as () => Promise<void>)()),
    cancel: async () => void (await (proxy.cancel as () => Promise<void>)()),
    getToken: async () => {
      const result = (proxy.getToken as () => string | null)()
      return result ? (JSON.parse(result) as { token: string; obtainedAt: string }) : null
    },
    signOut: async () => void (await (proxy.signOut as () => Promise<void>)()),
    reportRejectedToken: async () => void (await (proxy.reportRejectedToken as () => Promise<void>)()),
    fetch: async (input) => {
      // ArkTS 代理把整份响应用一个 JSON 信封转交。
      const result = await (proxy.fetch as (
        url: string,
        method: string,
        headers: string,
        body?: string
      ) => Promise<string>)(input.url, input.method, JSON.stringify(input.headers), input.body)
      const parsed = JSON.parse(result) as { status: number; contentType: string; body: string }
      return new Response(parsed.body, {
        status: parsed.status,
        statusText: '',
        headers: { 'content-type': parsed.contentType },
      })
    },
  }
}

/* ------------------------------------------------------------------ */

let cached: AccountBridge | undefined | null = null

const resolve = (): AccountBridge | undefined => {
  if (cached === null) cached = capacitorBridge() ?? harmonyProxy()
  return cached ?? undefined
}

// 注册为 web/src/shared/account.ts 的桥来源。
// 对 window.Capacitor 的探测只留在本模块内，插件产物不会导入这里。
;(globalThis as { __DSH_ACCOUNT_CAPACITOR__?: () => AccountBridge | undefined }).__DSH_ACCOUNT_CAPACITOR__ = resolve
