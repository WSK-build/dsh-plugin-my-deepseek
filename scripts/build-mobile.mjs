/**
 * 构建供 Capacitor 与 ArkWeb 壳渲染的独立整页：输出目录下得到一个自包含页面，
 * React 一并打进产物。
 *
 * 参数：
 *   --out <dir>        输出目录，默认 build/mobile/www
 *   --memory-only      会话与凭据只留在内存（网页体验站）
 *
 * 与 scripts/build.mjs（DSH 插件客户端构建）的差异：
 *  - 入口是 `web/src/entries/mobile.tsx`，HTML 取自 `web/src/entries/mobile.html`；
 *  - 宿主页面不提供 React，因此把 React 打进产物；
 *  - 资源用相对路径（`publicPath: './'`），页面在 `https://localhost/`（Capacitor）
 *    与 `resource://rawfile/`（ArkWeb）下都能加载；
 *  - 产物是普通网页，不做 DSH 模块加载器的包装。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const targets = ['chrome >= 110', 'edge >= 110', 'safari >= 16', 'firefox >= 110']

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? path.resolve(root, args[outIndex + 1]) : path.join(root, 'build', 'mobile', 'www')
const memoryOnly = args.includes('--memory-only')

// 同一条构建产出两种形态：原生壳内运行，或作为网页体验站部署。
// 两者的「检查更新」来源与后续动作不同，因此在构建期区分。
const appTarget = memoryOnly ? 'web' : 'native'

/** @type {import('@rspack/core').Configuration} */
const config = {
  mode: 'production',
  target: 'web',
  devtool: false,
  entry: path.join(root, 'web', 'src', 'entries', 'mobile.tsx'),
  output: {
    path: outDir,
    filename: 'app.js',
    cssFilename: 'app.css',
    publicPath: './',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      {
        test: /\.module\.css$/,
        type: 'css/module',
        use: [{ loader: 'builtin:lightningcss-loader', options: { targets } }],
      },
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        type: 'css',
        use: [{ loader: 'builtin:lightningcss-loader', options: { targets } }],
      },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      // KaTeX 自带字体，内联后 WebView 不需要再发起资源请求。
      { test: /\.(woff2?|ttf|otf|eot)$/, type: 'asset/inline' },
    ],
  },
  optimization: {
    minimize: true,
    splitChunks: false,
  },
  plugins: [
    new rspack.DefinePlugin({
      __API_ORIGIN__: JSON.stringify(process.env.DSH_CHAT_API_ORIGIN ?? 'https://api.deepseek.com'),
      __CHAT_MEMORY_ONLY__: JSON.stringify(memoryOnly),
      // 版本号与目标形态在构建期写死：设置页显示版本、决定「检查更新」查哪个源。
      __APP_VERSION__: JSON.stringify(packageVersion),
      __APP_TARGET__: JSON.stringify(appTarget),
    }),
    // 一个页面一个 bundle：WebView 里不必再拉取分包。
    new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new rspack.HtmlRspackPlugin({
      template: path.join(root, 'web', 'src', 'entries', 'mobile.html'),
      filename: 'index.html',
      inject: true,
      scriptLoading: 'defer',
    }),
  ],
  performance: { hints: false },
  stats: 'errors-warnings',
}

rspack(config, (error, stats) => {
  if (error) {
    console.error(error)
    process.exitCode = 1
    return
  }
  const info = stats?.toJson({ all: false, errors: true, warnings: true })
  for (const warning of info?.warnings ?? []) console.warn(warning.message ?? warning)
  const errors = info?.errors ?? []
  for (const failure of errors) console.error(failure.message ?? failure)
  if (errors.length > 0 || stats?.hasErrors()) {
    process.exitCode = 1
    return
  }
  const KiB = (file) => {
    const bytes = readFileSync(path.join(outDir, file)).length
    return `${(bytes / 1024).toFixed(0)} KiB`
  }
  console.log(
    `bundled web/src/entries/mobile.tsx -> ${path.relative(root, outDir)} (index.html ${KiB('index.html')}, app.js ${KiB('app.js')}, app.css ${KiB('app.css')})`
  )
})
