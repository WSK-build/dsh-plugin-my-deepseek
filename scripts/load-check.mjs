/**
 * 产物的运行期自检。
 *
 * 构建成功、审计通过、打包成功都只说明产物**生成**了，不说明它能**运行**。
 * 构建期常量一旦没被替换，产物里就留下裸标识符，模块求值时报 ReferenceError，
 * 而构建、审计与打包仍然全部通过。
 *
 * 因此这里检查两件能可靠判定的事：
 *  1. 构建期常量是否都已替换（残留原文即未定义）；
 *  2. 产物能否作为脚本编译（语法与顶层解析）。
 *
 * 渲染层能否运行需要真实 DOM；那部分由真机验证覆盖，不在此处假装验证。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 构建期注入的常量；产物中一旦残留原文即为未定义。 */
const BUILD_CONSTANTS = ['__API_ORIGIN__', '__CHAT_MEMORY_ONLY__', '__APP_VERSION__', '__APP_TARGET__']

const bundles = [
  { file: 'dsh-plugin/dist/client.js', label: 'DSH client bundle' },
  { file: 'build/mobile/www/app.js', label: 'standalone page bundle' },
  { file: 'website/app/app.js', label: 'experience page bundle' },
]

const failures = []

for (const bundle of bundles) {
  let source
  try {
    source = readFileSync(path.join(root, bundle.file), 'utf8')
  } catch {
    failures.push(`${bundle.label}: 产物不存在（${bundle.file}），先跑构建`)
    continue
  }

  for (const constant of BUILD_CONSTANTS) {
    if (source.includes(constant)) {
      failures.push(`${bundle.label}: 构建期常量 ${constant} 未被替换（产物中残留原文）`)
    }
  }

  try {
    new vm.Script(source, { filename: bundle.file })
  } catch (error) {
    failures.push(`${bundle.label}: 无法编译为脚本：${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  console.log(`ok   ${bundle.label}`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log('load check: 通过')
}
