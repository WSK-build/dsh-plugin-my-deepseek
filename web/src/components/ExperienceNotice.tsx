import { useEffect, useRef, useState } from 'react'

/** 窄屏布局下应用根节点读取的视口变量，见 vendor/chat-demo-src/app/App.module.css。 */
const VIEWPORT_TOP_VAR = '--app-viewport-top'
const VIEWPORT_HEIGHT_VAR = '--app-viewport-height'

/**
 * 体验模式提示条。
 *
 * 仅在会话与凭据都不落盘时渲染，用于说明数据不会被保留；
 * 用户可以关闭，关闭状态只存在于本次页面生命周期内。
 *
 * 提示条占据布局顶部一行，应用根节点从它下面开始，因此不会盖住顶栏。
 * 宽度小于 768px 时应用根节点固定在视口中，需要把这一行的高度交给它定位；
 * 宽屏由布局流承担，这两个变量对应用没有影响。
 */
export const ExperienceNotice = () => {
  const [closed, setClosed] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = noticeRef.current
    if (closed || !element) {
      return
    }
    const root = document.documentElement
    const publish = () => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      root.style.setProperty(VIEWPORT_TOP_VAR, `${height}px`)
      root.style.setProperty(VIEWPORT_HEIGHT_VAR, `calc(100dvh - ${height}px)`)
    }
    publish()
    // 文案换行与安全区都会改变条高，尺寸变化后重新交出去。
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty(VIEWPORT_TOP_VAR)
      root.style.removeProperty(VIEWPORT_HEIGHT_VAR)
    }
  }, [closed])

  if (closed) {
    return null
  }

  return (
    <div
      ref={noticeRef}
      role="status"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        // 顶部安全区由提示条自己让出，应用顶栏才能从它下方开始。
        padding: '10px 16px',
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
        background: 'rgba(94, 170, 231, 0.14)',
        borderBottom: '1px solid rgba(94, 170, 231, 0.35)',
        // 文字颜色跟随主题设置写在 body 上，不另取静态色，深浅色下都保持可读。
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      <span style={{ flex: 1 }}>
        仅供体验 · 请使用你自己的 API Key · 对话不保存，刷新即清空
      </span>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => setClosed(true)}
        style={{
          flex: '0 0 auto',
          width: '24px',
          height: '24px',
          padding: 0,
          border: 'none',
          borderRadius: '6px',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
