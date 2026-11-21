/**
 * 发布前的隐私扫描。
 * 用法：node scripts/privacy-scan.mjs <目录>
 *
 * 检测用户主目录绝对路径、明文凭据与本机专有名称。
 * 额外词表可通过环境变量临时追加，不必写进仓库：
 *   PRIVACY_DENY="词一,词二" node scripts/privacy-scan.mjs .
 *
 * 跳过 node_modules、build、.git、工具缓存与 *.tgz；命中时只输出文件:行号与
 * 片段，不打印完整敏感内容。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
// 构建缓存里记录的是本机绝对路径，不是仓库内容；扫描它们只会产生噪声。
const skipDirs = new Set([
  'node_modules',
  'build',
  '.git',
  '.dist-test',
  '.gradle',
  '.hvigor',
  'oh_modules',
  '.idea',
])
const skipExt = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.zip', '.gz', '.tgz',
  '.mp3', '.mp4', '.pdf',
  '.bin', '.dex', '.apk', '.hap', '.class', '.jar', '.keystore', '.jks',
])

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const denyTerms = (process.env.PRIVACY_DENY ?? '')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean)

const patterns = [
  ['windows home path', /[A-Za-z]:\\+Users\\+[^\\/\s"']+/],
  ['posix home path', /\/(?:Users|home)\/[^/\s"']+/],
  ['appdata path', /AppData[\\/]+(?:Roaming|Local)/i],
  ['dsh data dir', /\.dsh[\\/]+(?:profiles|plugin-data|sessions)/i],
  ['api key literal', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['bearer token', /Bearer\s+[A-Za-z0-9._-]{20,}/],
  ['email address', /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ...denyTerms.map((term) => ['deny list', new RegExp(escape(term), 'i')]),
]

const files = []
// 机器相关配置按约定不入库，内容必然带本机绝对路径；扫描它们没有意义。
const skipNames = new Set(['local.properties'])
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name) || skipNames.has(name) || skipExt.has(path.extname(name).toLowerCase())) continue
    const full = path.join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) walk(full)
    else if (info.size < 8 * 1024 * 1024) files.push(full)
  }
}
walk(root)

let hits = 0
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = text.split('\n')
  for (const [label, pattern] of patterns) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index])
      if (!match) continue
      hits += 1
      console.log(`${path.relative(root, file)}:${index + 1}  [${label}]  ${match[0].slice(0, 16)}…`)
      if (hits >= 40) {
        console.log('… more hits suppressed')
        process.exitCode = 1
        process.exit()
      }
    }
  }
}

console.log(hits === 0 ? `clean: ${files.length} files scanned` : `${hits} hit(s) across ${files.length} files`)
process.exitCode = hits === 0 ? 0 : 1
