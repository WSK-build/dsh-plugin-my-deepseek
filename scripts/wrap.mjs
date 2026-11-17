/**
 * Wraps the CommonJS bundle in the Harness client module protocol and hands the
 * extracted stylesheet to the entry through one global, so the entry injects it
 * itself. (The bundle's exports are getter-only, so patching `apply` from here
 * would silently fail.)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const id = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name
const outDir = path.join(root, 'build', 'out')
const bundlePath = path.join(outDir, 'client.js')
const cssPath = path.join(outDir, 'client.css')

for (const file of [bundlePath, cssPath]) {
  if (!existsSync(file)) {
    console.error(`missing build output: ${file}`)
    process.exit(1)
  }
}

const bundle = readFileSync(bundlePath, 'utf8')
const css = readFileSync(cssPath, 'utf8')
const body = bundle
  .split('\n')
  .map((line) => (line.length > 0 ? `\t\t${line}` : line))
  .join('\n')

const file = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tglobalThis.__DSH_DEEPSEEK_CHAT_CSS__ = ${JSON.stringify(css)};
${body}
\t\treturn module.exports;
\t},
});
`

const target = path.join(root, 'dist')
mkdirSync(target, { recursive: true })
writeFileSync(path.join(target, 'client.js'), file)
console.log(`wrote dist/client.js (${(file.length / 1024 / 1024).toFixed(1)} MiB)`)
