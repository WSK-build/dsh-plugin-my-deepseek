/**
 * 校验两种语言的文案键完全对齐。
 *
 * 源码里的 `satisfies Record<keyof typeof zh, string>` 只在 TypeScript 类型检查时生效，
 * 而构建走 swc 只剥离类型。缺键不会让构建失败，却会在运行时抛出
 * `Cannot read properties of undefined (reading 'replace')` —— 默认语言是英文，
 * 这类缺失会直接把页面打白。因此把对齐关系做成可执行的检查。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const locales = ['zh', 'en']

/** 顶层文案对象的键；缩进两空格，形如 `  key: '...'`。 */
const KEY_PATTERN = /^ {2}([A-Za-z][A-Za-z0-9]*):/gm

const readKeys = (locale) => {
  const file = path.join(root, 'vendor', 'chat-demo-src', 'i18n', `${locale}.ts`)
  const source = readFileSync(file, 'utf8')
  return new Set([...source.matchAll(KEY_PATTERN)].map((match) => match[1]))
}

const sets = new Map(locales.map((locale) => [locale, readKeys(locale)]))
const [base] = locales
const baseKeys = sets.get(base)
const failures = []

for (const locale of locales.slice(1)) {
  const keys = sets.get(locale)
  for (const key of baseKeys) {
    if (!keys.has(key)) {
      failures.push(`${locale}.ts 缺少 ${base}.ts 中的键：${key}`)
    }
  }
  for (const key of keys) {
    if (!baseKeys.has(key)) {
      failures.push(`${base}.ts 缺少 ${locale}.ts 中的键：${key}`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(`i18n keys: 两种语言各 ${baseKeys.size} 个键，完全对齐`)
}
