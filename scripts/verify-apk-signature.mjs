/**
 * 校验 APK 的签名方案。
 *
 * 规则来自 apksigner 的实际行为：V2 是否会写入由 APK 清单里的 minSdkVersion 决定。
 * 低于 Android 9（API 28）的设备只认 V2，因此那时两个方案并存；
 * 而 minSdk 达到 28 及以上时，目标设备都支持 V3，V2 不会被用到，工具只写 V3。
 * 两种结果都算正确，判断依据必须是 minSdk 而不是偏好。
 *
 * V1 一律不允许：它只服务于 Android 6 及更早版本，保留它等于多一个可降级的签名块。
 *
 * 用法：node scripts/verify-apk-signature.mjs <apk> [--min-sdk <n>]
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runApksigner } from './lib/apksigner.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const [, , apk, ...rest] = process.argv
if (!apk) {
  console.error('用法: node scripts/verify-apk-signature.mjs <apk> [--min-sdk <n>]')
  process.exit(2)
}
if (!existsSync(apk)) {
  console.error(`找不到 APK: ${apk}`)
  process.exit(2)
}

const explicitMinSdk = (() => {
  const index = rest.indexOf('--min-sdk')
  if (index === -1) return null
  const value = Number(rest[index + 1])
  return Number.isFinite(value) ? value : null
})()

/** 从 android/android/variables.gradle 读取 minSdk，读不到时按本项目的取值兜底。 */
const readMinSdk = () => {
  if (explicitMinSdk !== null) return { value: explicitMinSdk, source: '命令行参数' }
  const gradleFile = path.join(repoRoot, 'android', 'android', 'variables.gradle')
  if (existsSync(gradleFile)) {
    const match = /minSdkVersion\s*=\s*(\d+)/.exec(readFileSync(gradleFile, 'utf8'))
    if (match) return { value: Number(match[1]), source: 'variables.gradle' }
  }
  return { value: 29, source: '默认值' }
}

const minSdk = readMinSdk()
const { output } = runApksigner(['verify', '--verbose', '--print-certs', apk])

const readScheme = (label) => {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(label))
  if (!line) return null
  const value = line.slice(label.length).trim()
  return value === 'true' ? true : value === 'false' ? false : null
}

const v1 = readScheme('Verified using v1 scheme (JAR signing):')
const v2 = readScheme('Verified using v2 scheme (APK Signature Scheme v2):')
const v3 = readScheme('Verified using v3 scheme (APK Signature Scheme v3):')

const signerLine = output
  .split(/\r?\n/)
  .find((entry) => entry.startsWith('Signer #1 certificate DN:'))
const digestLine = output
  .split(/\r?\n/)
  .find((entry) => entry.startsWith('Signer #1 certificate SHA-256 digest:'))

// minSdk 低于 28 时目标设备里存在只认 V2 的机型，V2 必须存在。
const requiresV2 = minSdk.value < 28

const problems = []
if (v3 !== true) problems.push('V3 签名缺失或未通过校验')
if (v1 !== false) problems.push('V1 签名仍然存在：不需要，且多一个可降级的签名块')
if (requiresV2 && v2 !== true) {
  problems.push(`minSdk ${minSdk.value} 低于 28，必须同时具备 V2 签名`)
}
if (!requiresV2 && v2 === true && v3 !== true) {
  problems.push('只检测到 V2：V3 也必须开启')
}

console.log(`APK            ${apk}`)
console.log(`minSdk         ${minSdk.value}（来源：${minSdk.source}）`)
console.log(`V1 (JAR)       ${v1 === null ? '未报告' : v1}`)
console.log(`V2             ${v2 === null ? '未报告' : v2}`)
console.log(`V3             ${v3 === null ? '未报告' : v3}`)
if (signerLine) console.log(signerLine.trim())
if (digestLine) console.log(digestLine.trim())

if (problems.length > 0) {
  console.error('\n签名校验未通过:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const expected = requiresV2 ? 'V2 + V3' : 'V3'
console.log(`\n签名校验通过：${expected}，无 V1`)
