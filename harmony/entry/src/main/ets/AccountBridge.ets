/**
 * DeepSeek 账号登录桥。
 *
 * 采用 PKCE S256 授权码流程，回调地址为回环 HTTP 地址；
 * 通过 Web 组件的 javaScriptProxy 暴露给页面。令牌存应用沙箱首选项。
 */
import { webview } from '@kit.ArkWeb'
import { BusinessError } from '@kit.BasicServicesKit'
import { http } from '@kit.NetworkKit'
import { socket } from '@kit.NetworkKit'
import { util } from '@kit.ArkTS'
import { preferences } from '@kit.ArkData'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import type { common } from '@kit.AbilityKit'

const PLATFORM_ORIGIN = 'https://platform.deepseek.com'
const CLIENT_VERSION = '0.2.2-rc.3'

export interface AccountToken {
  token: string
  obtainedAt: string
}

interface AuthResponse {
  code: number
  data: {
    biz_code: number
    biz_data: {
      authorize_url?: string
      token?: string
    }
  }
}

/** 登录阶段回调，转发给页面（publishAccountPhase）。 */
export type PhaseListener = (phase: string, error?: string) => void

export class AccountService {
  private token: string | null = null
  private obtainedAt: string | null = null
  private store: preferences.Preferences | null = null

  constructor(private readonly onPhase: PhaseListener) {}

  /** 页面加载时恢复已存令牌。 */
  init(context: common.UIAbilityContext): void {
    this.store = preferences.getPreferencesSync(context, { name: 'dsh_account' })
    const saved = this.store.getSync('token', '') as string
    if (saved) {
      this.token = saved
      this.obtainedAt = this.store.getSync('obtained_at', '') as string
    }
  }

  getToken(): string | null {
    if (!this.token) {
      return null
    }
    return JSON.stringify({ token: this.token, obtainedAt: this.obtainedAt })
  }

  isSignedIn(): boolean {
    return this.token !== null
  }

  signOut(): void {
    this.token = null
    this.obtainedAt = null
    this.store?.deleteSync('token')
    this.store?.deleteSync('obtained_at')
    this.store?.flush()
  }

  reportRejectedToken(): void {
    this.signOut()
    this.onPhase('expired')
  }

  /**
   * 完整登录流程：auth_init -> 系统浏览器 -> loopback 回调 -> auth_exchange。
   * 成功返回令牌 JSON，取消返回 null，失败抛错。
   */
  async startLogin(locale: string, openBrowser: (url: string) => void): Promise<string | null> {
    if (this.token) {
      return this.getToken()
    }
    this.onPhase('initializing')
    const verifier = base64Url(cryptoFramework.createRandom().generateRandomSync(32).data)
    const state = base64Url(cryptoFramework.createRandom().generateRandomSync(32).data)
    const challenge = base64Url(sha256(verifier))
    const server = new LoopbackServer(state)
    const port = await server.listen()
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`
    try {
      const init = await this.postPlatform('auth_init', {
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state,
        redirect_uri: redirectUri,
        locale: locale === 'en_US' ? 'en_US' : 'zh_CN',
        login_source: 'web',
      })
      const authorizeUrl = init.data.biz_data.authorize_url
      if (!authorizeUrl) {
        throw new Error('auth_init returned no authorize_url')
      }
      this.onPhase('waiting-browser')
      openBrowser(authorizeUrl)
      const code = await server.waitForCode(600)
      if (!code) {
        return null
      }
      this.onPhase('exchanging')
      const exchange = await this.postPlatform('auth_exchange', {
        code: code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        device_id: this.deviceId(),
        device_model: 'HarmonyOS phone',
        os_version: 'HarmonyOS',
      })
      const token = exchange.data.biz_data.token
      if (!token) {
        throw new Error('auth_exchange returned no token')
      }
      this.token = token
      this.obtainedAt = new Date().toISOString()
      this.store?.putSync('token', token)
      this.store?.putSync('obtained_at', this.obtainedAt)
      this.store?.flush()
      this.onPhase('signed-in')
      return this.getToken()
    } finally {
      server.close()
    }
  }

  /** 账号模式下的 API 请求：携带 x-dsh-auth-token 原生发起，无 CORS。
   * 返回 {status, contentType, body} JSON 信封（与 Android 版一致）。 */
  async fetch(url: string, method: string, headersJson: string, body?: string): Promise<string> {
    if (!this.token) {
      throw new Error('not signed in')
    }
    const client = http.createHttp()
    try {
      const headers: Record<string, string> = JSON.parse(headersJson)
      headers['x-dsh-auth-token'] = this.token
      const response = await client.request(url, {
        method: method.toUpperCase() as http.RequestMethod,
        header: headers,
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 30000,
        readTimeout: 0,
      })
      const text = typeof response.result === 'string' ? response.result : String(response.result)
      const contentType = (response.header as Record<string, string>)['content-type']
        ?? (response.header as Record<string, string>)['Content-Type'] ?? 'application/octet-stream'
      return JSON.stringify({ status: response.responseCode, contentType: contentType, body: text })
    } finally {
      client.destroy()
    }
  }

  private async postPlatform(method: string, body: Record<string, string>): Promise<AuthResponse> {
    const locale = body.locale === 'en_US' ? 'en_US' : 'zh_CN'
    const text = await this.fetchWithoutToken(
      `${PLATFORM_ORIGIN}/auth-api/v0/dsh/${method}`,
      JSON.stringify({
        'content-type': 'application/json',
        'user-agent': 'node',
        'x-client-bundle-id': '',
        'x-client-platform': 'web',
        'x-client-version': CLIENT_VERSION,
        'x-client-locale': locale,
        'x-client-timezone-offset': String(-new Date().getTimezoneOffset()),
      }),
      JSON.stringify(body),
    )
    const parsed = JSON.parse(text) as AuthResponse
    if (parsed.code !== 0 || parsed.data.biz_code !== 0) {
      throw new Error(`platform ${method} rejected: code ${parsed.code} biz ${parsed.data.biz_code}`)
    }
    return parsed
  }

  private async fetchWithoutToken(url: string, headersJson: string, body: string): Promise<string> {
    const client = http.createHttp()
    try {
      const response = await client.request(url, {
        method: http.RequestMethod.POST,
        header: JSON.parse(headersJson) as Record<string, string>,
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 30000,
        readTimeout: 60000,
      })
      const text = typeof response.result === 'string' ? response.result : String(response.result)
      if (response.responseCode >= 400) {
        throw new Error(`HTTP ${response.responseCode}: ${text.slice(0, 120)}`)
      }
      return text
    } finally {
      client.destroy()
    }
  }

  private deviceId(): string {
    const stored = this.store?.getSync('device_id', '') as string
    if (stored) {
      return stored
    }
    const id = util.generateRandomBinaryUUID()
    this.store?.putSync('device_id', id)
    this.store?.flush()
    return id
  }
}

/* ------------------------------------------------------------------ *
 * 回环 OAuth 回调服务（127.0.0.1）
 * ------------------------------------------------------------------ */

class LoopbackServer {
  private server: socket.TCPSocketServer | null = null
  private port = 0
  private codeResolve: ((code: string | null) => void) | null = null
  private readonly expectedState: string

  constructor(expectedState: string) {
    this.expectedState = expectedState
  }

  /**
   * 绑定回环端口并返回端口号，失败抛出。
   *
   * bind 是异步的：必须等回调成功后才能读取系统分配的端口，
   * 否则会读到 0 并把端口 0 写进 redirect_uri。
   */
  async listen(): Promise<number> {
    this.server = socket.constructTCPSocketServerInstance()
    const server = this.server
    await new Promise<void>((resolve, reject) => {
      server.bind({ address: '127.0.0.1', port: 0, family: 1 }, (err: BusinessError) => {
        if (err) {
          console.error(`[account] bind failed: ${err.message}`)
          reject(new Error(err.message))
          return
        }
        resolve()
      })
    })
    const local = server.getLocalAddress()
    this.port = local?.port ?? 0
    if (this.port <= 0) {
      throw new Error('loopback server bound without a port')
    }
      this.server.on('connect', (client: socket.TCPSocketConnection) => {
        client.on('message', (value: socket.SocketMessageInfo) => {
          const text = util.TextDecoder.create('utf-8').decodeToString(value.message)
          const firstLine = (text.split('\r\n')[0]) ?? ''
          const path = (firstLine.split(' ')[1]) ?? '/'
          const queryIndex = path.indexOf('?')
          const pathOnly = queryIndex >= 0 ? path.slice(0, queryIndex) : path
          const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : ''
          const params = parseQuery(query)
          const state = params.get('state') ?? ''
          const code = params.get('code')
          if (pathOnly === '/oauth/callback' && state === this.expectedState && code) {
            const body = '<!doctype html><meta charset="utf-8"><p>登录成功，请返回 My DeepSeek 应用。</p>'
            // content-length 必须是字节数：响应体含中文，按字符数会少算导致截断。
            const length = new util.TextEncoder().encodeInto(body).length
            client.send({
              data: `HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: ${length}\r\nconnection: close\r\n\r\n${body}`,
            })
            this.codeResolve?.(code)
          } else {
            const body = '<p>invalid callback</p>'
            const length = new util.TextEncoder().encodeInto(body).length
            client.send({
              data: `HTTP/1.1 400 Bad Request\r\ncontent-type: text/html\r\ncontent-length: ${length}\r\nconnection: close\r\n\r\n${body}`,
            })
          }
          client.close()
        })
      })
    return this.port
  }

  async waitForCode(timeoutSeconds: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutSeconds * 1000)
      this.codeResolve = (code: string | null) => {
        clearTimeout(timer)
        resolve(code)
      }
    })
  }

  close(): void {
    try {
      this.server?.close()
    } catch {
      // 已经关闭
    }
    this.server = null
  }
}

function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>()
  for (const pair of query.split('&')) {
    if (!pair) {
      continue
    }
    const eq = pair.indexOf('=')
    const key = eq >= 0 ? pair.slice(0, eq) : pair
    const value = eq >= 0 ? pair.slice(eq + 1) : ''
    params.set(decodePercent(key), decodePercent(value))
  }
  return params
}

function decodePercent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/* ------------------------------------------------------------------ *
 * PKCE 辅助函数
 * ------------------------------------------------------------------ */

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function sha256(text: string): Uint8Array {
  const md = cryptoFramework.createMd('SHA256')
  md.update({ data: stringToBytes(text) })
  return md.digest().data
}

function stringToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff
  }
  return bytes
}
