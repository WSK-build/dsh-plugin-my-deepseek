/**
 * 请求归属判定：一次 API 请求应当由账号令牌承载鉴权，还是由调用方提供的凭据。
 *
 * 独立成模块的原因：判定规则需要被固定住，而它依赖的平台状态（账号桥）在
 * 无壳环境里不存在，因此把规则与平台状态分开，规则本身保持纯函数。
 */

/**
 * 是否让账号模式接管这次请求。
 *
 * 判据是调用方是否真的提供了凭据，而不是请求头是否存在：上游客户端在
 * API Key 为空时仍会写入 `x-api-key: ''`，按键存在判断会让账号模式永远走不到壳。
 * 非空的 x-api-key 或 Authorization 一律不接管——那类请求校验的是用户填写的
 * 凭据，失败不代表账号令牌失效。
 */
export const shouldRouteToAccount = (active: boolean, headers: HeadersInit | undefined): boolean => {
  if (!active) {
    return false
  }
  const provided = new Headers(headers)
  const apiKey = provided.get('x-api-key')?.trim() ?? ''
  const authorization = provided.get('authorization')?.trim() ?? ''
  return apiKey === '' && authorization === ''
}
