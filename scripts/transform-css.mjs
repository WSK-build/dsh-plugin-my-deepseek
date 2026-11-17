/**
 * Renames the demo's design tokens into a private `--dsc-*` namespace so the
 * official palette can be injected into the Harness page without touching the
 * Harness's own `--dsw-*` tokens.
 *
 * Run once over the vendored source; the result is committed into the package.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'vendor', 'chat-demo-src')

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.css')) files.push(full)
  }
}
walk(src)

const common = (css) =>
  css
    // `--dsw-` and `--ds-` both become one private namespace.
    .replaceAll('--dsw-', '--dsc-')
    .replaceAll('--ds-', '--dsc-')
    .replaceAll('--message-list-', '--dsc-message-list-')
    .replaceAll('--scroll-color', '--dsc-scroll-color')
    // Dark mode is driven by the Harness theme, not by the demo's body classes.
    .replaceAll('data-ds-dark-theme', 'data-dsc-dark')
    .replaceAll('body.dark', 'body[data-dsc-dark]')
    .replaceAll('body.light', 'body:not([data-dsc-dark])')

/** Page-level rules move from `body` onto the plugin's own root element. */
const scopePageRules = (css) =>
  css
    .replace(/^body \{$/gm, '.dsc-root {')
    // The demo's transition suppressor only exists during its own theme swap.
    .replace(/body\.change-theme [^{]*\{[^}]*\}\n?/g, '')
    // Mobile full-height container: the plugin root replaces html/body/#root.
    .replace(/(\n\s*)html,(\n\s*)body,(\n\s*)#root \{/g, '$1.dsc-root {')

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
