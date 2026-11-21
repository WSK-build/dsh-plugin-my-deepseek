import { webview } from '@kit.ArkWeb'
import { BusinessError } from '@kit.BasicServicesKit'
import { common } from '@kit.AbilityKit'
import { AccountService } from '../AccountBridge'

/**
 * My DeepSeek 主页：ArkWeb 加载 rawfile 里的整页构建产物。
 *
 * 页面通过 javaScriptProxy 拿到账号桥（window.__DSH_ACCOUNT_HARMONY__），
 * web/src/shared/account-bridge.ts 探测这个对象。
 */
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController()
  @State accountPhase: string = 'idle'
  private account: AccountService = new AccountService((phase: string) => {
    this.accountPhase = phase
    this.publishPhase(phase)
  })

  aboutToAppear(): void {
    // 远程调试会让任意调试工具读取页面内容与凭据，因此不随包开启。
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext | undefined
    if (context) {
      this.account.init(context)
    }
  }

  private publishPhase(phase: string): void {
    const script = `window.__DSH_ACCOUNT_PHASE__ && window.__DSH_ACCOUNT_PHASE__(${JSON.stringify(phase)})`
    try {
      this.controller.runJavaScript(script)
    } catch (error) {
      console.error(`[account] publish phase failed: ${(error as BusinessError).message}`)
    }
  }

  /** 暴露给页面的账号桥：名称与 Android 版一致，account-bridge.ts 统一探测。 */
  accountProxy = {
    /** Promise 形式：成功返回 {token, obtainedAt}，取消返回 null。 */
    startLogin: (locale: string): Promise<string | null> => {
      return this.account.startLogin(locale, (url: string) => this.openInBrowser(url))
        .then((result: string | null) => result)
        .catch((error: BusinessError) => {
          this.accountPhase = 'failed'
          throw new Error(error.message ?? 'sign-in failed')
        })
    },
    openAuthorizeUrl: (): void => {
      // 授权页由 startLogin 内部直接拉起；此入口保留给需要重新打开授权页的调用方。
    },
    cancel: (): void => {
      // 登录由等待超时与页面关闭覆盖；页面侧目前不提供主动取消入口。
    },
    getToken: (): string | null => this.account.getToken(),
    signOut: (): void => this.account.signOut(),
    reportRejectedToken: (): void => this.account.reportRejectedToken(),
    /** 账号模式 API 请求（原生 fetch，带令牌头，无 CORS）。 */
    fetch: (url: string, method: string, headers: string, body?: string): Promise<string> => {
      return this.account.fetch(url, method, headers, body)
    },
  }

  /**
   * 用系统浏览器打开授权页。
   *
   * 授权流程依赖本机回环服务器接收回调，页面必须在应用之外完成；
   * ArkWeb 已关闭多窗口，window.open 不会生效，因此交由系统浏览器处理。
   */
  private openInBrowser(url: string): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext | undefined
    if (!context) {
      console.error('[account] open browser failed: no host context')
      return
    }
    // startAbility 是异步的：无匹配应用等失败只在 Promise 里体现，必须显式处理。
    context
      .startAbility({
        action: 'ohos.want.action.viewData',
        uri: url,
      })
      .catch((error: BusinessError) => {
        console.error(`[account] open browser failed: ${error.message}`)
      })
  }

  build() {
    Column() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.None)
        .onlineImageAccess(true)
        .zoomAccess(false)
        .multiWindowAccess(false)
        .javaScriptProxy({
          object: this.accountProxy,
          name: '__DSH_ACCOUNT_HARMONY__',
          methodList: ['startLogin', 'openAuthorizeUrl', 'cancel', 'getToken', 'signOut', 'reportRejectedToken', 'fetch'],
          controller: this.controller,
        })
        .onMultiWindowClose(() => undefined)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
