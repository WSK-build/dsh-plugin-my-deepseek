/**
 * apksigner 的定位与调用。
 *
 * 构建产物的签名方案由 apksigner 决定：Gradle 在启用 V3 时会跳过 V2，
 * 因此需要同时具备两个方案时必须自行调用它。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** 在 Android SDK 中找版本最高的 apksigner。 */
export const findApksigner = () => {
  const explicit = process.env.APKSIGNER
  if (explicit && existsSync(explicit)) return explicit

  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  ].filter(Boolean)

  for (const sdk of sdkRoots) {
    const buildTools = path.join(sdk, 'build-tools')
    if (!existsSync(buildTools)) continue
    const versions = readdirSync(buildTools).sort((a, b) => {
      const [aMajor = 0, aMinor = 0] = a.split('.').map(Number)
      const [bMajor = 0, bMinor = 0] = b.split('.').map(Number)
      return bMajor - aMajor || bMinor - aMinor
    })
    for (const version of versions) {
      const candidate = path.join(
        buildTools,
        version,
        process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'
      )
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * apksigner 由 java 启动；未设置 JAVA_HOME 时它直接退出。
 * 这里在常见位置补一个 JDK，避免签名步骤依赖调用方先配好环境。
 */
const resolveJavaHome = () => {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  if (process.platform !== 'win32') return undefined

  const home = process.env.USERPROFILE ?? ''
  const candidates = []
  const jdks = path.join(home, '.jdks')
  if (existsSync(jdks)) {
    for (const name of readdirSync(jdks)) candidates.push(path.join(jdks, name))
  }
  candidates.push(
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Android Studio', 'jbr'),
    path.join(process.env.ProgramFiles ?? '', 'Android', 'Android Studio', 'jbr')
  )
  return candidates.find((candidate) => existsSync(path.join(candidate, 'bin', 'java.exe')))
}

/**
 * 执行 apksigner；校验失败时以非零码退出，输出仍需返回给调用方判断。
 * 返回 { ok, output }。
 */
export const runApksigner = (args) => {
  const tool = findApksigner()
  if (!tool) {
    throw new Error('找不到 apksigner：请设置 ANDROID_HOME，或用 APKSIGNER 指定路径')
  }

  const env = { ...process.env }
  const javaHome = resolveJavaHome()
  if (javaHome) env.JAVA_HOME = javaHome

  // Windows 上 apksigner 是批处理文件，不能直接创建进程：交由 cmd.exe 执行。
  // 不使用 shell: true —— 那会把参数拼进命令行而不做转义。
  const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(tool)
  const command = isBatch ? (process.env.ComSpec ?? 'cmd.exe') : tool
  const commandArgs = isBatch ? ['/d', '/s', '/c', tool, ...args] : args

  try {
    const output = execFileSync(command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsVerbatimArguments: isBatch,
    })
    return { ok: true, output }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (!output.trim()) throw new Error(`apksigner 执行失败: ${error.message}`)
    return { ok: false, output }
  }
}
