/**
 * Harness adapter for the official chat-demo.
 *
 * The demo itself is vendored unmodified apart from token renaming: this file
 * only mounts its `<App />` in the Harness `main` panel and mirrors the Harness
 * theme onto the demo's private `data-dsc-dark` flag.
 */
import { useEffect } from 'react'
import { App } from '../vendor/chat-demo-src/app/App.js'
import '../vendor/chat-demo-src/app/theme.css'
import '../vendor/chat-demo-src/app/global.css'
import './root.css'

/** Sidebar entry id; the matching `main` panel is keyed by it. */
const PANEL_ID = 'my-deepseek'
const DARK_ATTRIBUTE = 'data-dsc-dark'

const setDark = (dark: boolean) => {
  const body = document.body
  if (dark) body.setAttribute(DARK_ATTRIBUTE, '')
  else body.removeAttribute(DARK_ATTRIBUTE)
}

const isDarkTheme = (theme: any): boolean => theme?.active?.colorScheme === 'dark'

/** The page: the demo fills the panel it is dropped into. */
const DeepSeekChatPage = () => {
  useEffect(() => {
    // The demo's own document-level listeners assume it owns the page; keep the
    // attribute in sync when the panel remounts after a theme switch.
    return () => setDark(document.body.hasAttribute(DARK_ATTRIBUTE))
  }, [])
  return (
    <div className="dsc-root">
      <App />
    </div>
  )
}

/** Sidebar glyph: a chat bubble with the spark of a reply in flight. */
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

  const updateTheme = (theme?: any) => {
    const active = theme ?? ctx.get('theme')?.getTheme?.()
    setDark(isDarkTheme(active))
  }

  ctx.effect(() => {
    updateTheme()
    const off = ctx.get('theme')?.on?.('theme/change', (theme: any) => updateTheme(theme))
    return () => {
      off?.()
      document.body.removeAttribute(DARK_ATTRIBUTE)
    }
  }, 'my-deepseek: theme')

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
