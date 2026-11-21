/**
 * 为 release APK 签名，显式开启 APK Signature Scheme V2 与 V3。
 *
 * 不交给 Gradle 的原因：启用 V3 时 Gradle 会跳过 V2，而两个方案都要由同一条
 * 构建路径统一决定，签名参数因此写死在这里，避免不同路径产出不同结果。
 * 实际写入哪个方案仍由 apksigner 依据 minSdkVersion 决定：minSdk 29 时只写 V3。
 *
 * 需要的环境变量：
 *   MY_DEEPSEEK_KEYSTORE / MY_DEEPSEEK_KEYSTORE_PASSWORD
 *   MY_DEEPSEEK_KEY_ALIAS / MY_DEEPSEEK_KEY_PASSWORD
 *
 * 用法：node scripts/sign-apk.mjs <unsigned.apk> <signed.apk>
 */
import { copyFileSync, existsSync } from 'node:fs'
import { runApksigner } from './lib/apksigner.mjs'

const [, , input, output] = process.argv

if (!input || !output) {
  console.error('用法: node scripts/sign-apk.mjs <unsigned.apk> <signed.apk>')
  process.exit(2)
}
if (!existsSync(input)) {
  console.error(`找不到输入 APK: ${input}`)
  process.exit(2)
}

const required = {
  MY_DEEPSEEK_KEYSTORE: 'keystore 路径',
  MY_DEEPSEEK_KEYSTORE_PASSWORD: 'keystore 密码',
  MY_DEEPSEEK_KEY_ALIAS: '密钥别名',
  MY_DEEPSEEK_KEY_PASSWORD: '密钥密码',
}

const missing = Object.keys(required).filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error('缺少签名所需的环境变量:')
  for (const name of missing) console.error(`  ${name}  (${required[name]})`)
  process.exit(2)
}

if (!existsSync(process.env.MY_DEEPSEEK_KEYSTORE)) {
  console.error(`找不到 keystore: ${process.env.MY_DEEPSEEK_KEYSTORE}`)
  process.exit(2)
}

const args = [
  'sign',
  '--ks',
  process.env.MY_DEEPSEEK_KEYSTORE,
  '--ks-key-alias',
  process.env.MY_DEEPSEEK_KEY_ALIAS,
  '--ks-pass',
  `pass:${process.env.MY_DEEPSEEK_KEYSTORE_PASSWORD}`,
  '--key-pass',
  `pass:${process.env.MY_DEEPSEEK_KEY_PASSWORD}`,
  // V1 只服务于 Android 6 及更早版本；本应用 minSdk 29，保留它只会多出一个
  // 可被降级利用的旧签名块。V4 用于增量安装，只对 adb 安装有意义，
  // 默认开启会在产物旁多出一个 .idsig 文件，因此显式关闭。
  '--v1-signing-enabled',
  'false',
  '--v2-signing-enabled',
  'true',
  '--v3-signing-enabled',
  'true',
  '--v4-signing-enabled',
  'false',
  '--out',
  output,
  input,
]

const result = runApksigner(args)
if (!result.ok) {
  console.error('签名失败:')
  console.error(result.output.trim())
  process.exit(1)
}

// 未指定 --out 时 apksigner 会原地签名；这里显式分离产物，仍需确认文件落地。
if (!existsSync(output)) {
  copyFileSync(input, output)
}

console.log(`已签名: ${output}`)
console.log('签名方案: 由 apksigner 按 minSdk 决定（V3 必写，V2 在 minSdk < 28 时同时写入）；未启用 V1')
