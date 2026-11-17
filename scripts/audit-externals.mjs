import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
const re = /require\("([^"]+)"\)/g
const seen = new Map()
let match
while ((match = re.exec(text))) {
  const name = match[1]
  if (!seen.has(name)) seen.set(name, match.index)
}
for (const [name, index] of seen) {
  console.log(name, '=>', JSON.stringify(text.slice(Math.max(0, index - 120), index + 40)))
}
