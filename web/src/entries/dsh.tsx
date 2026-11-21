/**
 * 官方 chat-demo 的 Harness 适配层。
 *
 * demo 本体除令牌改名外未作改动：本文件只把它的 `<App />` 挂进 Harness 的 `main`
 * 面板，并让 demo 私有的 `data-dsc-dark` 标记与面板自身的主题设置保持一致。
 */
import { useEffect } from 'react'
import { App } from '../../../vendor/chat-demo-src/app/App.js'
import { useTheme } from '../../../vendor/chat-demo-src/app/theme.js'
import '../../../vendor/chat-demo-src/app/theme.css'
import '../../../vendor/chat-demo-src/app/global.css'
import '../styles/root.css'

/** 侧边栏入口 id；对应的 `main` 面板以它作为 key。 */
const PANEL_ID = 'my-deepseek'
const DARK_ATTRIBUTE = 'data-dsc-dark'

/**
 * 样式表按 `body` 上的属性判定深色，但面板不能改变宿主页面的外观，
 * 因此这里只切换该标记；demo 自带的页面级背景同步不进入 Harness 文档。
 */
const applyPanelTheme = (dark: boolean) => {
  const body = document.body
  if (dark) body.setAttribute(DARK_ATTRIBUTE, '')
  else body.removeAttribute(DARK_ATTRIBUTE)
}

/** 页面本体：demo 铺满它被挂载到的面板。 */
const DeepSeekChatPage = () => {
  const theme = useTheme()

  useEffect(() => {
    applyPanelTheme(theme === 'dark')
  }, [theme])

  useEffect(() => () => applyPanelTheme(false), [])

  return (
    <div className="dsc-root">
      <App />
    </div>
  )
}

/** 侧边栏图标：对话气泡加一枚应答的星芒。 */
const ChatPanelIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style={{ display: 'block' }}
  >
    <path
      d="M4.5 5.5h11a2.5 2.5 0 0 1 2.5 2.5v5.2a2.5 2.5 0 0 1-2.5 2.5H9.2l-3.4 2.6a.6.6 0 0 1-1-.5v-2.4a2.5 2.5 0 0 1-1.8-2.4V8a2.5 2.5 0 0 1 2.5-2.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M19 4.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"
      fill="currentColor"
    />
  </svg>
)

export const name = 'my-deepseek'

export const inject = ['slots']

export function apply(ctx: any) {
  const cssText: string = (globalThis as any).__DSH_DEEPSEEK_CHAT_CSS__ ?? ''

  ctx.effect(() => {
    if (!cssText) return
    const style = document.createElement('style')
    style.setAttribute('data-my-deepseek', '')
    style.textContent = cssText
    document.head.appendChild(style)
    return () => style.remove()
  }, 'my-deepseek: styles')

  ctx.effect(() => () => document.body.removeAttribute(DARK_ATTRIBUTE), 'my-deepseek: theme cleanup')

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: () => 'My DeepSeek',
          },
          ChatPanelIcon
        )
      ),
    'my-deepseek: sidebar entry'
  )

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID }, DeepSeekChatPage)
      ),
    'my-deepseek: page'
  )
}
