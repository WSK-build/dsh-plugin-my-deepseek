declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 scripts/build.mjs 与 scripts/build-mobile.mjs 的 DefinePlugin */
declare const __API_ORIGIN__: string

/** 构建期为 true 时会话只保存在内存中，刷新即清空 */
declare const __CHAT_MEMORY_ONLY__: boolean

/** 构建期写入的版本号，取自 package.json，与 npm 包和 git tag 一致 */
declare const __APP_VERSION__: string

/** 构建期写入的运行形态：DSH 插件面板、原生壳、网页体验站 */
declare const __APP_TARGET__: 'plugin' | 'native' | 'web'

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
