/**
 * 按 WebView 门槛校验 JavaScript 运行时 API 的可用性。
 *
 * 存在理由：构建期只做语法转译（语法面由 es-check 负责），不会为任何内置
 * API 注入垫片，因此「代码里调用了哪个 API」必须由独立清单逐个核对，
 * 否则 Chrome 110 这个门槛没有任何机器校验支撑。
 *
 * 清单与门槛都放在 compat/ 下，与代码分离：门槛变更时只改配置，不改脚本。
 *
 * 用法：
 *   node compat/scan-api-floor.mjs --sources   只扫源码（web/src、vendor/chat-demo-src）
 *   node compat/scan-api-floor.mjs --bundles   只扫构建产物
 *   node compat/scan-api-floor.mjs             两者都扫
 *
 * 退出码 1 表示存在门槛之上的 API 使用且未登记为已知项，或声明的产物不存在。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetsPath = path.join(root, 'compat', 'targets.json')
const apisPath = path.join(root, 'compat', 'api-floor.json')

const args = new Set(process.argv.slice(2))
const scanSources = args.has('--sources') || args.size === 0
const scanBundles = args.has('--bundles') || args.size === 0

if (args.has('--help') || args.has('-h')) {
  console.log('用法: node compat/scan-api-floor.mjs [--sources] [--bundles]')
  process.exit(0)
}

const targets = JSON.parse(readFileSync(targetsPath, 'utf8'))
const apiFloor = JSON.parse(readFileSync(apisPath, 'utf8'))
const floor = `chrome ${targets.webviewFloor.version}`

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 把清单条目转成正则：原型方法按任意接收者匹配，静态调用按命名空间匹配。 */
function patternFor(api) {
  const parts = api.split('.')
  const method = escapeRegExp(parts[parts.length - 1])
  if (api.includes('.prototype.')) return new RegExp(`\\.${method}\\s*\\(`, 'g')
  const owner = parts.slice(0, -1).map(escapeRegExp).join('\\.')
  return new RegExp(`\\b${owner}\\.${method}\\s*\\(`, 'g')
}

/**
 * 注释里的 API 名字不参与判定：清单自身会在注释里描述被禁用的 API，
 * 误报会让清单无法自我说明。替换为等长空白以保持行号不变。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(?<!:)\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
}

const aboveFloor = apiFloor.aboveFloor.map((entry) => ({ ...entry, pattern: patternFor(entry.api) }))
const atFloor = apiFloor.atFloor.map((entry) => ({ ...entry, pattern: patternFor(entry.api) }))
// 产物经过压缩，原型方法名与任意对象的同名方法无法区分，因此产物只校验静态调用。
const bundleEntries = aboveFloor.filter((entry) => !entry.api.includes('.prototype.'))
const knownFindings = new Map(
  (apiFloor.knownFindings ?? []).map((finding) => [`${finding.path}:${finding.api}`, finding.reason])
)
const skipDirectories = new Set(targets.skipDirectories)
const sourceExtensions = new Set(targets.sourceExtensions)

/** 递归收集源码目录下需要扫描的文件，顺序固定以便输出可对比。 */
function collectSources(directory, collected) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!skipDirectories.has(entry.name)) collectSources(absolute, collected)
      continue
    }
    if (!entry.isFile()) continue
    if (targets.skipFileSuffixes.some((suffix) => entry.name.endsWith(suffix))) continue
    if (!sourceExtensions.has(path.extname(entry.name))) continue
    collected.push(absolute)
  }
  return collected
}

/** 在给定文件里查找清单条目，返回每一处使用及其位置。 */
function findUsages(files, entries) {
  const hits = []
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/)
    for (const entry of entries) {
      for (let index = 0; index < lines.length; index += 1) {
        entry.pattern.lastIndex = 0
        if (!entry.pattern.test(lines[index])) continue
        hits.push({ path: relative, line: index + 1, api: entry.api, chrome: entry.chrome })
      }
    }
  }
  return hits
}

function report(scope, files, misses, entries, reportAtFloor) {
  const violations = []
  const known = []
  for (const hit of findUsages(files, entries)) {
    const reason = knownFindings.get(`${hit.path}:${hit.api}`)
    if (reason === undefined) violations.push(hit)
    else known.push({ ...hit, reason })
  }

  console.log(`${scope}：扫描 ${files.length} 个文件`)

  if (reportAtFloor) {
    const inside = findUsages(files, atFloor)
    if (inside.length === 0) {
      console.log(`  门槛内 API（${floor}）0 处`)
    } else {
      console.log(`  门槛内 API（${floor}）${inside.length} 处，这些调用把门槛钉在 ${floor}：`)
      for (const hit of inside) console.log(`    ${hit.path}:${hit.line}  ${hit.api}`)
    }
  }

  if (known.length === 0) {
    console.log('  已知项命中共 0 处')
  } else {
    console.log(`  已知项命中 ${known.length} 处：`)
    for (const hit of known) console.log(`    ${hit.path}:${hit.line}  ${hit.api}（Chrome ${hit.chrome} 起支持）\n      原因：${hit.reason}`)
  }

  if (violations.length === 0) {
    console.log('  越界 API 0 处')
  } else {
    console.log(`  越界 API ${violations.length} 处（门槛 ${floor} 之上，且未登记为已知项）：`)
    for (const hit of violations) console.log(`    ${hit.path}:${hit.line}  ${hit.api}（Chrome ${hit.chrome} 起支持）`)
  }

  if (misses.length > 0) {
    console.log(`  缺失产物 ${misses.length} 个：`)
    for (const miss of misses) console.log(`    ${miss}`)
  }

  return violations.length + misses.length
}

console.log(`WebView 门槛：${floor}；语法目标：${targets.syntaxTarget}`)

let failures = 0

if (scanSources) {
  const files = targets.sources
    .map((entry) => path.join(root, entry))
    .filter((entry) => existsSync(entry))
    .flatMap((directory) => collectSources(directory, []))
  failures += report(`源码（${targets.sources.join('、')}）`, files, [], aboveFloor, true)
}

if (scanBundles) {
  const missing = targets.bundles.filter((bundle) => !existsSync(path.join(root, bundle)))
  const present = targets.bundles
    .filter((bundle) => existsSync(path.join(root, bundle)))
    .map((bundle) => path.join(root, bundle))
  failures += report('构建产物（仅静态调用）', present, missing, bundleEntries, false)
}

const knownItems = apiFloor.knownItems ?? []
if (knownItems.length > 0) {
  console.log(`已知项说明 ${knownItems.length} 条：`)
  for (const item of knownItems) console.log(`  - ${item}`)
}

console.log(failures === 0 ? '结论：通过' : '结论：未通过')
process.exitCode = failures === 0 ? 0 : 1
