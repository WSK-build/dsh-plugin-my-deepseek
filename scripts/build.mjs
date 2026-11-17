/**
 * Bundles the vendored official chat-demo into one CommonJS module that
 * externalizes React, so the Harness page's own React instance renders it.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']

/** @type {import('@rspack/core').Configuration} */
const config = {
  mode: 'production',
  target: 'web',
  devtool: false,
  entry: path.join(root, 'src', 'entry.tsx'),
  output: {
    path: path.join(root, 'build', 'out'),
    filename: 'client.js',
    cssFilename: 'client.css',
    library: { type: 'commonjs2' },
    publicPath: 'auto',
    clean: true,
  },
  // The page supplies React; a second copy would not be renderable inside the
  // Harness tree.
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
      // KaTeX ships fonts; inline them so the single-file bundle needs no
      // package asset route.
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
    }),
    // The Harness module loader knows one bundle, not code-split chunks.
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
  console.log('bundled src/entry.tsx -> build/out/client.js')
})
