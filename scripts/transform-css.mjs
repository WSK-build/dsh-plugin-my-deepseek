/**
 * 把 demo 的设计令牌改名为私有的 `--dsc-*` 命名空间，
 * 使官方配色可以注入 Harness 页面，而不覆盖 Harness 自己的 `--dsw-*` 令牌。
 *
 * 每次构建都会执行，且幂等：已改名的令牌与主题属性不再匹配它查找的模式。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'vendor', 'chat-demo-src')

const files = []
const scripts = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.css')) files.push(full)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) scripts.push(full)
  }
}
walk(src)

const common = (css) =>
  css
    // `--dsw-` 与 `--ds-` 归入同一个私有命名空间。
    .replaceAll('--dsw-', '--dsc-')
    .replaceAll('--ds-', '--dsc-')
    .replaceAll('--message-list-', '--dsc-message-list-')
    .replaceAll('--scroll-color', '--dsc-scroll-color')
    // 深色只由一个属性判定：面板与独立整页都由应用自身的主题设置驱动它。
    .replaceAll('data-ds-dark-theme', 'data-dsc-dark')
    .replaceAll('body.dark', 'body[data-dsc-dark]')
    .replaceAll('body.light', 'body:not([data-dsc-dark])')

/**
 * 主题属性由脚本切换，选择器改名后属性名必须同步，
 * 否则样式表等一个永远不出现的属性，深色模式整条失效。
 */
const renameAttributeInScript = (source) => source.replaceAll('data-ds-dark-theme', 'data-dsc-dark')

/** 页面级规则从 `body` 移到插件自己的根元素上。 */
const scopePageRules = (css) =>
  css
    .replace(/^body \{$/gm, '.dsc-root {')
    // demo 的过渡抑制规则只服务于它自己的主题切换。
    .replace(/body\.change-theme [^{]*\{[^}]*\}\n?/g, '')
    // 移动端整高容器：插件根节点取代原先的 html/body/#root。
    .replace(/(\n\s*)html,(\n\s*)body,(\n\s*)#root \{/g, '$1.dsc-root {')
    // `color-scheme` 写在 body 上会连带重绘宿主页面，因此只作用于本项目的子树；
    // 独立整页的页面级取值由 app/theme.ts 设置在文档元素上。
    .replace(
      /body\[data-dsc-dark\] \{\s*color-scheme: dark;\s*\}/g,
      'body[data-dsc-dark] .dsc-root {\n  color-scheme: dark;\n}'
    )

let changed = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  let after = common(before)
  const base = path.basename(file)
  if (base === 'global.css') after = scopePageRules(after)
  if (after !== before) {
    writeFileSync(file, after)
    changed += 1
  }
}
console.log(`transformed ${changed}/${files.length} stylesheets`)

let scriptChanges = 0
for (const file of scripts) {
  const before = readFileSync(file, 'utf8')
  const after = renameAttributeInScript(before)
  if (after !== before) {
    writeFileSync(file, after)
    scriptChanges += 1
  }
}
console.log(`renamed theme attribute in ${scriptChanges}/${scripts.length} scripts`)
