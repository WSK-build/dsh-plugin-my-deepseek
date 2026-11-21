import { accountHeaderFor, nativeFetch } from './account.js'
import { shouldRouteToAccount } from './account-routing.js'

/**
 * 账号模式的请求接缝。
 *
 * 上游 API 客户端通过本模块发起账号请求，不直接依赖账号模块，
 * 使上游补丁面收敛到一个稳定的接口上；账号模块内部重构不影响 vendor。
 * 返回完整的 Response，流式响应由账号桥提供的 ReadableStream 承载。
 */
export const accountRequestActive = (): boolean => accountHeaderFor(null) !== null

export const accountShouldHandle = (headers: HeadersInit | undefined): boolean =>
  shouldRouteToAccount(accountRequestActive(), headers)

export const dispatchAccountRequest = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  signal?: AbortSignal
): Promise<Response | null> =>
  nativeFetch(
    {
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    },
    signal
  )

export { reportAccountTokenRejected } from './account.js'
