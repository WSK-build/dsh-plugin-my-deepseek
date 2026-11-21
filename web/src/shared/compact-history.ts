import {
  CompressionGuardTable,
  compressForRequest,
  shouldRetryAfterOverflow,
  type CompressionStrategy,
} from './context/index.ts'
import { currentBudget } from './model.ts'
import { createSummarizer } from './summarize.ts'
import type { ChatModel } from '../../../vendor/chat-demo-src/services/api/types.js'
import type { Message } from '../../../vendor/chat-demo-src/services/chat/types.js'

/**
 * 熔断状态按会话隔离。
 *
 * 压缩效果取决于会话内容：短问答会话反复压缩可能不降低 token，
 * 若共用同一个熔断器，一个这样的会话会让其他会话的压缩一起停掉。
 */
const guards = new CompressionGuardTable()

export type CompactDeps = {
  strategy: CompressionStrategy
  /** 会话 id：压缩状态与熔断计数按会话隔离。 */
  sessionId: string
  /** 账号登录时为空串，鉴权由原生壳注入。 */
  apiKey: string
  signal: AbortSignal
  /**
   * 本轮使用的模型。摘要必须与聊天用同一个模型：会话可能带着自己的模型，
   * 与当前默认值不同，用默认值摘要会让摘要与对话风格、能力不一致。
   */
  model: string
  /**
   * 预算缩放系数。服务端已报告上下文超限时由调用方下调，
   * 让重试的那一次压得更狠。
   */
  budgetScale?: number
}

/** 服务端报告上下文超限后，是否可以压缩得更狠再重发一次。 */
export const canRetryAfterOverflow = (input: {
  sessionId: string
  strategy: CompressionStrategy
  error: unknown
  alreadyRetried: boolean
}): boolean =>
  shouldRetryAfterOverflow({
    error: input.error,
    alreadyRetried: input.alreadyRetried,
    strategy: input.strategy,
    guard: guards.for(input.sessionId),
  })

/**
 * 计算本轮实际发送的历史。
 *
 * 返回值是本次请求的投影：会话本身的消息数组不被修改，
 * 被摘要替代的片段仍保留在会话中，可在界面上展开。
 * 压缩产生的摘要以一轮带标注的问答出现在投影开头，请求组装按轮次配对时才能把它发送出去。
 */
export const compactHistory = async (
  history: Message[],
  deps: CompactDeps
): Promise<Message[]> => {
  if (deps.strategy === 'none') {
    return history
  }
  const summarize = createSummarizer({
    apiKey: deps.apiKey,
    model: deps.model as ChatModel,
    signal: deps.signal,
  })
  const guard = guards.for(deps.sessionId)
  try {
    const budget = currentBudget()
    const scale = deps.budgetScale ?? 1
    const result = await compressForRequest({
      messages: history,
      budget: {
        windowTokens: Math.round(budget.windowTokens * scale),
        outputTokens: budget.outputTokens,
      },
      strategy: deps.strategy,
      summarize,
      guard,
      signal: deps.signal,
    })
    return result.applied ? (result.projection as Message[]) : history
  } catch {
    // 压缩失败不影响本轮发送，按原文全量发送。
    return history
  } finally {
    // 熔断状态要跟着淘汰走，否则被淘汰的会话下次又会重复做无效压缩。
    guards.sync(deps.sessionId)
  }
}
