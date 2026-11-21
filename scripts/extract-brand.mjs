/**
 * 从已安装的 Harness 前端产物中提取官方字标（鲸鱼图标 + `deepseek` 字形），
 * 复制进本项目的源码树。
 *
 * 插件无法导入 Harness 的客户端包，因此图形按原样复制后再提交；
 * Harness 升级后重新执行即可刷新。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets =
  process.env.DSH_FRONTEND_ASSETS ??
  path.join(
    process.env.APPDATA ?? '',
    'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets'
  )

const readBundle = () => {
  const name = readdirSync(assets).find(
    (file) => file.endsWith('.js') && readFileSync(path.join(assets, file), 'utf8').includes('BrandWordmark')
  )
  if (!name) throw new Error(`no frontend bundle with BrandWordmark under ${assets}`)
  return readFileSync(path.join(assets, name), 'utf8')
}

const bundle = readBundle()

/** 匹配单个 `name="..."` 或 `name={...}` 常量。 */
const constant = (source, name) => {
  const match = new RegExp(`(?:^|[,;{ ])${name}=("(?:[^"\\\\]|\\\\.)*"|\\{[^}]*\\})`).exec(source)
  if (!match) throw new Error(`constant not found: ${name}`)
  return match[1]
}

/** 第一处 `<id>({...}){...}` 形式、不含箭头函数的函数体。 */
const functionBody = (source, id) => {
  const start = source.indexOf(`${id}({`)
  if (start < 0) throw new Error(`component not found: ${id}`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced body for ${id}`)
}

const fishPath = constant(bundle, 'xy')
const viewBox = constant(bundle, 'Bs')

/** 移除一处 `jsx(...)`/`jsxs(...)` 调用及分隔它的逗号。 */
const removeCall = (source, needle) => {
  const at = source.indexOf(needle)
  if (at < 0) throw new Error(`call not found: ${needle.slice(0, 40)}`)
  let depth = 0
  for (let i = at; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        let start = at
        let end = i + 1
        if (source[end] === ',') end += 1
        else if (source[start - 1] === ',') start -= 1
        return source.slice(0, start) + source.slice(end)
      }
    }
  }
  throw new Error(`unbalanced call: ${needle.slice(0, 40)}`)
}

let body = functionBody(bundle, 'pR')
  // 产物里 jsx-runtime 的别名是单个压缩后的标识符 `p`。
  .replace(/\bp\.jsxs\(/g, 'jsxs(')
  .replace(/\bp\.jsx\(/g, 'jsx(')
  .replace(/\bxy\b/g, 'FISH_LOGO_PATH')
  .replace(/\bBs\b/g, 'FISH_LOGO_VIEWBOX')

// Harness 的字标带一枚 "HARNESS" 徽标；官方站点没有，因此去掉徽标，
// 只保留图标与字形。
body = removeCall(body, 'jsxs("g",{clipPath:"url(#dsh-wordmark-badge-clip)"')
body = removeCall(body, 'jsx("rect",{x:"129.348"')
body = body
  .replace('viewBox:r?"0 0 182 24":"26 0 156 24"', 'viewBox:"0 0 128 24"')
  .replace('width:e*(r?182:156)/24', 'width:(e*128)/24')

if (/[^.\w]p\./.test(body)) throw new Error('unexpected minified reference left in the copied body')

const file = `/* eslint-disable */
// 由 scripts/extract-brand.mjs 从已安装的 Harness 前端生成。
// 官方 DeepSeek 字标（鲸鱼图标 + 字形），按原样复制。
import { jsx, jsxs } from 'react/jsx-runtime'

const FISH_LOGO_PATH = ${fishPath}

const FISH_LOGO_VIEWBOX = ${viewBox}

/** 官方鲸鱼图标与 `deepseek` 字标。 */
export const BrandWordmark = ({ size: e = 24, className: t, includeMark: r = true }: {
  size?: number
  className?: string
  includeMark?: boolean
}) => { ${body.trim()} }
`

writeFileSync(path.join(root, 'web', 'src', 'shared', 'brand-wordmark.tsx'), file)
console.log(`wrote web/src/shared/brand-wordmark.tsx (${(file.length / 1024).toFixed(1)} KiB)`)

// 包图标：只取官方鲸鱼图标，缩放并居中于 64×64 画布。
const geometry = Function(`return (${viewBox})`)()
const canvas = 64
const content = 52
const scale = Math.min(content / geometry.width, content / geometry.height)
const offsetX = (canvas - geometry.width * scale) / 2
const offsetY = (canvas - geometry.height * scale) / 2
const round = (value) => Number(value.toFixed(3))
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}" role="img" aria-label="DeepSeek">
  <g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale)})">
    <path d=${fishPath} fill="#4D6BFE"/>
  </g>
</svg>
`
writeFileSync(path.join(root, 'icon.svg'), icon)
console.log(`wrote icon.svg (whale mark ${geometry.width}×${geometry.height} → ${canvas}×${canvas})`)
