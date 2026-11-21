import type { ChatModel } from '../../../vendor/chat-demo-src/services/api/types.js'

/**
 * 模型标识与上下文预算的单一来源。
 *
 * 聊天、标题生成与压缩摘要都通过本模块取值。两个 resolver 是接入服务端模型
 * 列表的扩展点，目前尚未接线：没有安装 resolver 时使用兜底值，行为等价于
 * “用兜底模型跑”，但调用点不含具体模型 ID，接入时不需要改动它们。
 */
export const FALLBACK_MODEL: ChatModel = 'deepseek-flash'

/**
 * 兜底上下文预算。窗口按保守值给出，输出预留覆盖一次完整回答；
 * 宁可提前压缩，也不让请求直接超限。
 */
export const FALLBACK_BUDGET = { windowTokens: 64_000, outputTokens: 8_000 } as const

export type ContextBudget = { windowTokens: number; outputTokens: number }

type ModelResolver = () => ChatModel | null
type BudgetResolver = () => ContextBudget | null

let resolver: ModelResolver | null = null
let budgetResolver: BudgetResolver | null = null

/** 安装模型来源；传入 null 撤销。尚未接线的扩展点。 */
export const installModelResolver = (next: ModelResolver | null): void => {
  resolver = next
}

/** 安装上下文预算来源；传入 null 撤销。尚未接线的扩展点。 */
export const installBudgetResolver = (next: BudgetResolver | null): void => {
  budgetResolver = next
}

export const currentModel = (): ChatModel => resolver?.() ?? FALLBACK_MODEL

export const currentBudget = (): ContextBudget => budgetResolver?.() ?? FALLBACK_BUDGET
