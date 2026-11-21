/**
 * 「检查更新」的数据来源与版本比较。
 *
 * 只在用户主动点击时执行，页面加载不发起任何网络请求：
 * 本项目对外承诺除 DeepSeek API 外不主动联网。
 *
 * 版本源统一用 npm registry：npm 包、APK、git tag 共用同一个版本号，
 * 因此三种形态都查同一个接口，判断结果一致。
 * 不用 GitHub 的 releases/latest：仓库可以只打 tag 而不建 Release，
 * 该接口会返回 404，导致永远提示失败。
 */

/** 当前构建的版本号，构建期写入，与 npm 包和 git tag 一致。 */
export const currentVersion = (): string => __APP_VERSION__

/** 当前运行形态，构建期写入。 */
export const currentTarget = (): 'plugin' | 'native' | 'web' => __APP_TARGET__

/** 发布页，供原生壳跳转到浏览器。列表页在没有 Release 对象时同样有效。 */
export const RELEASE_URL = 'https://github.com/WSK-build/dsh-plugin-my-deepseek/releases'

const NPM_LATEST_URL = 'https://registry.npmjs.org/dsh-plugin-my-deepseek/latest'
const REQUEST_TIMEOUT_MS = 8000

export type UpdateResult =
  | { ok: true; latest: string; hasUpdate: boolean }
  | { ok: false }

/** 读取最新版本号，任何异常都归为「查询失败」。 */
const fetchLatestVersion = async (): Promise<string> => {
  const response = await fetch(NPM_LATEST_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const body = (await response.json()) as { version?: unknown }
  if (typeof body.version !== 'string' || body.version.trim() === '') {
    throw new Error('unexpected response')
  }
  return body.version.trim()
}

/**
 * 把版本号拆成可比较的数字序列，忽略预发布后缀：
 * 0.2.2-rc.3 与 0.2.2 在这里同为 [0, 2, 2]，因此预发布不会被反复提示。
 */
const versionParts = (version: string): number[] =>
  version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part.replace(/[^0-9].*/, ''), 10) || 0)

/** 逐段比较，长度不足按 0 补齐。 */
const isNewer = (candidate: string, mine: string): boolean => {
  const a = versionParts(candidate)
  const b = versionParts(mine)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right
  }
  return false
}

/** 查询最新版本并给出是否需要更新。 */
export const checkForUpdate = async (): Promise<UpdateResult> => {
  const mine = currentVersion()
  try {
    const latest = (await fetchLatestVersion()).replace(/^v/i, '')
    return { ok: true, latest, hasUpdate: isNewer(latest, mine) }
  } catch {
    return { ok: false }
  }
}
