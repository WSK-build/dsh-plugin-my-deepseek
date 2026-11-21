/**
 * 独立整页入口（Capacitor WebView 与 ArkWeb）：把官方 chat-demo 铺满全屏渲染，
 * 不接入任何 DSH 面板。
 *
 * 与插件入口（web/src/entries/dsh.tsx）的差异：
 *  - 不注册侧边栏与插槽，页面完全由 demo 拥有；
 *  - 这里调用 `setupTheme`，页面级主题（`body` 上的 `data-dsc-dark` 与页面背景）
 *    由主题设置驱动；插件入口只拥有一个面板，不能改动宿主页面，因此不做这一步；
 *  - `App` 自身已绑定会话持久化并执行 `initChat`，因此本入口保持最小。
 */
import { createRoot } from 'react-dom/client'
import { App } from '../../../vendor/chat-demo-src/app/App.js'
import { setupTheme } from '../../../vendor/chat-demo-src/app/theme.js'
import { ensureKatex } from '../../../vendor/chat-demo-src/services/markdown/katex.js'
// 注册账号桥的来源，供 web/src/shared/account.ts 读取。
// 没有 Capacitor 或 ArkWeb 代理的环境下保持不生效。
import '../shared/account-bridge.js'
import { ExperienceNotice } from '../components/ExperienceNotice.js'
import '../../../vendor/chat-demo-src/app/theme.css'
import '../../../vendor/chat-demo-src/app/global.css'
import '../styles/mobile.css'

ensureKatex()
setupTheme()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  // 提示条占顶部一行、应用占其余高度。应用根节点用绝对定位铺满父元素，
  // 父元素必须是定位容器，否则它会从视口顶部起算并盖住提示条。
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {__CHAT_MEMORY_ONLY__ ? <ExperienceNotice /> : null}
    <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
      <App />
    </div>
  </div>
)
