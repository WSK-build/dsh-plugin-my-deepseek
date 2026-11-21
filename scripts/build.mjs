/**
 * 把 vendored 的官方 chat-demo 打成单个 CommonJS 模块，并把 React 作为外部依赖，
 * 由 Harness 页面自带的 React 实例渲染。
 */
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const targets = ['chrome >= 110', 'edge >= 110', 'safari >= 16', 'firefox >= 110']

/** @type {import('@rspack/core').Configuration} */
const config = {
  mode: 'production',
  target: 'web',
  devtool: false,
  entry: path.join(root, 'web', 'src', 'entries', 'dsh.tsx'),
  output: {
    path: path.join(root, 'build', 'out'),
    filename: 'client.js',
    cssFilename: 'client.css',
    library: { type: 'commonjs2' },
    publicPath: 'auto',
    clean: true,
  },
  // React 由页面提供：再打一份进去会与 Harness 树里的实例互不兼容。
  externals: {
    react: 'commonjs react',
    'react/jsx-runtime': 'commonjs react/jsx-runtime',
    'react-dom': 'commonjs react-dom',
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
      // KaTeX 自带字体，内联进产物后单文件包不再需要包内资源路由。
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
      // 会话由插件宿主自己保存，因此页面不会进入仅内存模式。
      __CHAT_MEMORY_ONLY__: JSON.stringify(false),
      // 版本号与目标形态在构建期写死：设置页显示版本、决定「检查更新」查哪个源。
      __APP_VERSION__: JSON.stringify(packageVersion),
      __APP_TARGET__: JSON.stringify('plugin'),
    }),
    // Harness 的模块加载器只认单个 bundle，不支持分包。
    new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
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
  console.log('bundled web/src/entries/dsh.tsx -> build/out/client.js')
})
