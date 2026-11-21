import type { AccountToken } from './account.js'

/**
 * 原生账号桥的 Capacitor 插件声明（Android 侧为 DeepSeekAccountPlugin.java）。
 *
 * 页面通过 `window.Capacitor.Plugins.DeepSeekAccount` 访问，
 * 具体接线见 web/src/shared/account-bridge.ts。
 */
export interface DeepSeekAccountPlugin {
  startLogin(options: { locale: string }): Promise<AccountToken | null>
  openAuthorizeUrl(): Promise<void>
  cancel(): Promise<void>
  getToken(): Promise<AccountToken | null>
  signOut(): Promise<void>
  reportRejectedToken(): Promise<void>
}
