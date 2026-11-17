/**
 * Static audit of a built client artifact: checks the loader envelope, the
 * module id against the package name, the module requests, and the embedded
 * stylesheet. Usage: node tools/audit-client.mjs <client.js> <expected-package-name>
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const file = path.resolve(process.argv[2])
const expected = process.argv[3]
const code = readFileSync(file, 'utf8')
const problems = []

const idMatch = /^\s*id:\s*"([^"]+)"/m.exec(code)
if (!idMatch) problems.push('no module id in the loader record')
else if (expected && idMatch[1] !== expected) {
  problems.push(`module id ${idMatch[1]} does not match package ${expected}`)
}

if (!code.startsWith('window.__ModuleLoader__.load(')) problems.push('not a loader bundle')
if (!/factory:\s*\(require\)\s*=>/.test(code)) problems.push('no factory(require) function')
if (!/return module\.exports/.test(code)) problems.push('factory does not return module.exports')

const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom'])
const requests = new Set()
const re = /(?<![.\w])require\("([^"]+)"\)/g
let match
while ((match = re.exec(code))) requests.add(match[1])
for (const name of requests) {
  if (!allowed.has(name)) problems.push(`module request outside the baseline table: ${name}`)
}

const cssMatch = /globalThis\.__DSH_DEEPSEEK_CHAT_CSS__\s*=\s*"([\s\S]*?)";\n/.exec(code)
if (!cssMatch) problems.push('no embedded stylesheet')
else if (cssMatch[1].length < 100_000) problems.push(`embedded stylesheet is only ${cssMatch[1].length} bytes`)

console.log('file          :', path.relative(process.cwd(), file), `${(statSync(file).size / 1048576).toFixed(2)} MiB`)
console.log('module id     :', idMatch?.[1] ?? '(missing)')
console.log('module requests:', [...requests].join(', ') || '(none)')
console.log('stylesheet    :', cssMatch ? `${(cssMatch[1].length / 1024).toFixed(0)} KiB` : '(missing)')
console.log('problems      :', problems.length === 0 ? 'none' : '')
for (const problem of problems) console.log('  -', problem)
process.exitCode = problems.length === 0 ? 0 : 1
