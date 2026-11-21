/**
 * 上下文压缩层：把会话消息投影为「本次请求应当发送什么」。
 *
 * 该层不持有会话状态，也不修改输入：压缩只体现为返回的 projection，
 * 原消息 id 通过 originalIds 与 shadowedIds 完整保留，调用方据此断言
 * 「压缩前后消息 id 序列逐项全等」。
 */

/** 压缩策略。none 保持上游的全量发送行为，其余策略各自定义切分与摘要方式。 */
export type CompressionStrategy =
  | 'none'
  | 'harness'
  | 'claude'
  | 'librechat'
  | 'openwebui'
  | 'programmatic'

/** token 预算：窗口上限与为本次回复预留的输出量。 */
export interface CompressionBudget {
  windowTokens: number
  outputTokens: number
}

/** 摘要回调的提示参数。instruction 描述该策略要求的摘要结构。 */
export interface SummarizeHint {
  strategy: CompressionStrategy
  instruction: string
}

/** 摘要回调：由调用方注入，本层不决定使用哪个模型。 */
export type Summarize<M> = (span: M[], hint: SummarizeHint) => Promise<string>

/** 消息附件。字段与上游附件结构一致，便于直接透传。 */
export interface ContextFileAttachment {
  id: string
  serverId: string | null
  name: string
  size: number
  isImage: boolean
  mimeType: string
}

/** 文本引用。cited_text 是被引用的网页原文，压缩时只保留定位信息。 */
export interface ContextCitation {
  type: string
  url: string
  title: string | null
  cited_text?: string
  encrypted_index?: string
}

/** 思考块。历史轮次的思考不回传，程序化压缩会直接剥离。 */
export interface ContextThinkingBlock {
  type: 'thinking'
  thinking: string
  signature?: string
  startedAt?: number
  endedAt?: number
  elapsedSeconds?: number
}

/** 文本块。 */
export interface ContextTextBlock {
  type: 'text'
  text: string
  citations?: ContextCitation[]
  isTemplate?: boolean
}

/** 搜索结果条目。snippet 与 encrypted_content 是原文，压缩时只留标题与链接。 */
export interface ContextSearchEntry {
  type: 'web_search_result'
  title: string
  url: string
  snippet: string
  encrypted_content: string
  image_url?: string
  site_icon: string | null
  site_name: string | null
  page_age: string | null
}

/** 搜索失败条目。 */
export interface ContextSearchEntryError {
  type: 'web_search_tool_result_error'
  error_code: string
}

/** 搜索工具结果块。 */
export interface ContextSearchToolResultBlock {
  type: 'web_search_tool_result'
  tool_use_id: string
  content: (ContextSearchEntry | ContextSearchEntryError)[]
  kind: string
}

/** 服务端工具调用块。 */
export interface ContextServerToolUseBlock {
  type: 'server_tool_use'
  id: string
  name: string
  input: unknown
  kind: string
  caller?: unknown
}

/** 链接读取结果块。 */
export interface ContextFetchToolResultBlock {
  type: 'web_fetch_tool_result'
  tool_use_id: string
  kind: string
  content: unknown
  signature?: string
}

/** 回复内容块。 */
export type ContextBlock =
  | ContextThinkingBlock
  | ContextTextBlock
  | ContextServerToolUseBlock
  | ContextSearchToolResultBlock
  | ContextFetchToolResultBlock

/** 用户消息。 */
export interface ContextUserMessage {
  id: string
  role: 'user'
  content: string
  files: ContextFileAttachment[]
  createdAt: number
  parentId?: string | null
  selectedChildId?: string
}

/** 助手消息。 */
export interface ContextAssistantMessage {
  id: string
  role: 'assistant'
  createdAt: number
  model: string | null
  thinking?: boolean
  search?: boolean
  latestReminder?: string
  prefix: boolean
  status: 'pending' | 'streaming' | 'done' | 'stopped' | 'error'
  blocks: ContextBlock[]
  stopReason?: string
  stopDetails?: unknown
  usage?: unknown
  error?: {
    kind: string
    message: string
    status?: number
    retryable?: boolean
    localMessage?: unknown
  }
  parentId?: string | null
  selectedChildId?: string
}

/** 会话消息。 */
export type Message = ContextUserMessage | ContextAssistantMessage

/** 策略可调参数。 */
export interface CompressOptions {
  /** claude 策略保留的最近轮数，默认 4。 */
  keepRounds?: number
  /** librechat 策略保留的最近消息条数，默认 8。 */
  keepMessages?: number
  /** harness 策略保留的原文 token 量，默认取可用窗口的 16%。 */
  keepTokens?: number
}

/** 压缩输入。 */
export interface CompressInput<M extends Message = Message> {
  messages: M[]
  budget: CompressionBudget
  strategy: CompressionStrategy
  summarize?: Summarize<M>
  /** 熔断状态。注入后由本层记录每次压缩的 token 变化。 */
  guard?: CompressionGuard
  options?: CompressOptions
  /** 取消信号，透传给摘要回调，使用户中止本轮时同时中止摘要请求。 */
  signal?: AbortSignal
}

/** 压缩结果。 */
export interface CompressResult<M extends Message = Message> {
  /** 本次请求应当发送的消息。 */
  projection: M[]
  /** projection 的别名，便于按调用点习惯取值。 */
  messages: M[]
  /** 是否发生了压缩。 */
  applied: boolean
  strategy: CompressionStrategy
  /** 被摘要或丢弃替代的原始消息 id。 */
  shadowedIds: string[]
  /** 输入消息的 id，顺序与输入一致。 */
  originalIds: string[]
  /** 被压缩区间在原始数组中的下标范围，右端不含。 */
  condensedRange?: { from: number; to: number }
  /** 压缩节省的 token，可为负值。 */
  freedTokens?: number
  /** 未压缩时的原因。 */
  reason?: string
}

/** 摘要消息 id 前缀，用于把摘要与真实消息区分开。 */
export const CONTEXT_SUMMARY_ID_PREFIX = 'summary:'

/**
 * 摘要轮用户消息的开头标记。摘要必须明确标注来源，
 * 否则后续模型会把摘要当成用户尚未处理的新要求。
 */
export const CONTEXT_SUMMARY_LABEL = '以下是本会话早期对话的压缩摘要，较早的原始消息不再单独发送。'

/**
 * 摘要轮的助手回执。请求组装只保留「用户消息 + 有正文的回复」组成的轮次，
 * 摘要轮缺少回执就配不成轮次，会被整段丢弃。
 */
export const CONTEXT_SUMMARY_ACK = '已收到上述摘要，后续回答以其为基础继续。'

/** 判断一条消息是否为压缩产生的摘要。 */
export const isContextSummary = (message: Message): boolean =>
  message.id.startsWith(CONTEXT_SUMMARY_ID_PREFIX)

const CJK_PATTERN =
  /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g

/** 本地 token 估算：中文按字计 0.7，其余字符按 3.5 字符计 1 token。 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  const cjk = (text.match(CJK_PATTERN) ?? []).length
  const rest = text.length - cjk
  return Math.max(1, Math.round(cjk * 0.7 + rest / 3.5))
}

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

const blockTokens = (block: ContextBlock): number => {
  switch (block.type) {
    case 'thinking':
      return estimateTokens(block.thinking)
    case 'text':
      return estimateTokens(block.text)
    case 'server_tool_use':
      return estimateTokens(safeStringify(block.input))
    case 'web_search_tool_result':
      return block.content.reduce((sum, entry) => {
        if (entry.type === 'web_search_result') {
          return (
            sum +
            estimateTokens(entry.title) +
            estimateTokens(entry.url) +
            estimateTokens(entry.snippet) +
            estimateTokens(entry.encrypted_content)
          )
        }
        return sum + estimateTokens(entry.error_code)
      }, 0)
    case 'web_fetch_tool_result':
      return estimateTokens(safeStringify(block.content))
  }
}

/** 单条消息的 token 估算。 */
export const estimateMessageTokens = (message: Message): number => {
  if (message.role === 'user') {
    const attachments = (message.files ?? []).reduce(
      (sum, file) => sum + estimateTokens(file.name),
      0
    )
    return estimateTokens(message.content) + attachments
  }
  return (message.blocks ?? []).reduce((sum, block) => sum + blockTokens(block), 0)
}

/** 一组消息的 token 估算。 */
export const estimateMessagesTokens = (messages: Message[]): number =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

/**
 * 切分点只落在用户消息边界：一段以用户消息开始，到下一条用户消息之前结束。
 * 因此压缩区间不会切断一轮问答。
 */
interface Segment {
  start: number
  end: number
  hasUser: boolean
  hasAssistant: boolean
  tokens: number
}

const segmentMessages = (messages: Message[]): Segment[] => {
  const segments: Segment[] = []
  let current: Segment | null = null
  messages.forEach((message, index) => {
    if (message.role === 'user' || current === null) {
      current = {
        start: index,
        end: index + 1,
        hasUser: message.role === 'user',
        hasAssistant: false,
        tokens: 0,
      }
      segments.push(current)
    } else {
      current.end = index + 1
    }
    current.hasAssistant = current.hasAssistant || message.role === 'assistant'
    current.tokens += estimateMessageTokens(message)
  })
  return segments
}

/** harness 的触发阈值：窗口的八成与「窗口减输出预留减 64K」中的较小者。 */
export const harnessThreshold = (budget: CompressionBudget): number => {
  const { windowTokens, outputTokens } = budget
  const ratio = Math.floor(windowTokens * 0.8)
  if (windowTokens < 65536 + outputTokens) {
    return ratio
  }
  return Math.min(ratio, Math.floor(windowTokens - outputTokens - 65536))
}

/** harness 保留的原文 token 量：可用窗口的 16%。 */
export const harnessKeepTokens = (budget: CompressionBudget): number =>
  Math.floor((budget.windowTokens - budget.outputTokens) * 0.16)

/** 各策略共用的触发阈值。 */
export const defaultThreshold = (budget: CompressionBudget): number =>
  harnessThreshold(budget)

const HARNESS_INSTRUCTION =
  '把下面的历史对话压缩成一段摘要，保留任务目标、已完成的工作、关键结论与待处理事项，供后续对话继续使用。'

const CLAUDE_INSTRUCTION =
  '把下面的历史对话写成继续摘要，分三段：任务概述、当前状态、下一步。'

const LIBRECHAT_INSTRUCTION =
  '把下面的历史对话压缩成一个摘要检查点，保留任务目标、已确定的结论与接下来要处理的事项。'

const instructionFor = (strategy: CompressionStrategy): string => {
  switch (strategy) {
    case 'claude':
      return CLAUDE_INSTRUCTION
    case 'librechat':
      return LIBRECHAT_INSTRUCTION
    default:
      return HARNESS_INSTRUCTION
  }
}

/**
 * 摘要轮由一条用户消息和一条助手回执组成。
 *
 * 请求组装按相邻两条消息配对成轮次，摘要以完整轮次出现才能进入请求；
 * 单独一条摘要消息既不是用户消息也配不上对，会在组装请求时被丢掉。
 * id 取被压缩区间的首条消息，便于按区间识别同一份摘要。
 */
const createSummaryRound = (
  strategy: CompressionStrategy,
  text: string,
  firstShadowedId: string
): [ContextUserMessage, ContextAssistantMessage] => {
  const id = `${CONTEXT_SUMMARY_ID_PREFIX}${strategy}:${firstShadowedId}`
  const summaryUser: ContextUserMessage = {
    id: `${id}:user`,
    role: 'user',
    content: `${CONTEXT_SUMMARY_LABEL}\n\n${text}`,
    files: [],
    createdAt: 0,
  }
  const summaryReply: ContextAssistantMessage = {
    id: `${id}:reply`,
    role: 'assistant',
    createdAt: 0,
    model: null,
    prefix: false,
    status: 'done',
    blocks: [{ type: 'text', text: CONTEXT_SUMMARY_ACK }],
  }
  return [summaryUser, summaryReply]
}

const originalIdsOf = (messages: Message[]): string[] => messages.map((message) => message.id)

const unchangedResult = <M extends Message>(
  messages: M[],
  strategy: CompressionStrategy,
  reason: string
): CompressResult<M> => ({
  projection: [...messages],
  messages: [...messages],
  applied: false,
  strategy,
  shadowedIds: [],
  originalIds: originalIdsOf(messages),
  reason,
})

/** 摘要消息不计入已发送的原消息 id。 */
const sentIdsOf = (projection: Message[]): string[] =>
  projection.filter((message) => !isContextSummary(message)).map((message) => message.id)

const buildResult = <M extends Message>(
  messages: M[],
  projection: M[],
  strategy: CompressionStrategy,
  condensedRange?: { from: number; to: number }
): CompressResult<M> => {
  const sent = new Set(sentIdsOf(projection))
  const originalIds = originalIdsOf(messages)
  const before = estimateMessagesTokens(messages)
  const after = estimateMessagesTokens(projection)
  return {
    projection,
    messages: projection,
    applied: true,
    strategy,
    shadowedIds: originalIds.filter((id) => !sent.has(id)),
    originalIds,
    condensedRange,
    freedTokens: before - after,
  }
}

/**
 * 从最旧开始丢弃整轮，直到剩余消息的 token 降到阈值以下。
 * 只丢弃含有助手回复的轮次，最后一轮永远保留，避免丢掉本次提问。
 */
const dropOldestSegments = (
  messages: Message[],
  threshold: number
): { kept: Message[]; dropped: Segment[] } => {
  const segments = segmentMessages(messages)
  const prefix = segments.length > 0 && !segments[0].hasUser ? segments[0] : null
  const rest = prefix ? segments.slice(1) : segments
  let remaining = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  let droppedCount = 0
  for (const segment of rest) {
    if (remaining <= threshold || !segment.hasAssistant) {
      break
    }
    if (segment === rest[rest.length - 1]) {
      break
    }
    remaining -= segment.tokens
    droppedCount += 1
  }
  const dropped = rest.slice(0, droppedCount)
  const keepStart = droppedCount < rest.length ? rest[droppedCount].start : messages.length
  return { kept: messages.slice(keepStart), dropped }
}

/** 剥离思考块与搜索原文，保留搜索结果的标题与链接；无内容可剥离时返回原对象。 */
const stripAssistant = (message: ContextAssistantMessage): ContextAssistantMessage => {
  let changed = false
  const blocks: ContextBlock[] = []
  for (const block of message.blocks ?? []) {
    if (block.type === 'thinking') {
      changed = true
      continue
    }
    if (block.type === 'web_search_tool_result') {
      const content = block.content.map((entry) => {
        if (entry.type !== 'web_search_result') {
          return entry
        }
        if (!entry.snippet && !entry.encrypted_content) {
          return entry
        }
        changed = true
        return { ...entry, snippet: '', encrypted_content: '' }
      })
      blocks.push({ ...block, content })
      continue
    }
    if (block.type === 'text' && block.citations) {
      const citations = block.citations.map((citation) => {
        if (!citation.cited_text) {
          return citation
        }
        changed = true
        return { ...citation, cited_text: '' }
      })
      blocks.push({ ...block, citations })
      continue
    }
    blocks.push(block)
  }
  return changed ? { ...message, blocks } : message
}

/** 熔断状态：连续无效压缩达到上限后停止自动压缩。 */
export interface CompressionGuardState {
  /** 连续未带来 token 下降的压缩次数。 */
  consecutiveIneffective: number
  /** 是否已经停止自动压缩。 */
  stopped: boolean
  /** 最近一次压缩前的 token 量。 */
  lastBeforeTokens?: number
  /** 最近一次压缩后的 token 量。 */
  lastAfterTokens?: number
}

/**
 * 压缩熔断器：连续若干次压缩后 token 没有下降时停止自动压缩，
 * 避免在同一会话里反复生成等量的摘要。
 */
export class CompressionGuard {
  /** 连续无效压缩的上限。 */
  readonly maxConsecutiveIneffective: number
  state: CompressionGuardState

  constructor(options?: { maxConsecutiveIneffective?: number }) {
    this.maxConsecutiveIneffective = options?.maxConsecutiveIneffective ?? 3
    this.state = { consecutiveIneffective: 0, stopped: false }
  }

  /** 是否已经停止自动压缩。 */
  get stopped(): boolean {
    return this.state.stopped
  }

  /**
   * 记录一次压缩的 token 变化，返回本次压缩是否有效。
   * 有效（token 下降）时计数清零，无效时累加并可能触发停止。
   */
  record(beforeTokens: number, afterTokens: number): boolean {
    const effective = afterTokens < beforeTokens
    this.state.lastBeforeTokens = beforeTokens
    this.state.lastAfterTokens = afterTokens
    if (effective) {
      this.state.consecutiveIneffective = 0
      this.state.stopped = false
      return true
    }
    this.state.consecutiveIneffective += 1
    this.state.stopped = this.state.consecutiveIneffective >= this.maxConsecutiveIneffective
    return false
  }

  /** 复位熔断状态。 */
  reset(): void {
    this.state = { consecutiveIneffective: 0, stopped: false }
  }
}

const OVERFLOW_PATTERN =
  /(context[_ ]?(window|length)|maximum context|too many tokens|prompt is too long|input length exceeded|上下文(超|窗口)|超出上下文)/i

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return ''
}

/** 上下文溢出后的重试判定。 */
export interface OverflowRetryContext {
  /** 请求失败时的错误对象。 */
  error: unknown
  /** 本次请求是否已经重试过。 */
  alreadyRetried: boolean
  /** 当前策略。 */
  strategy: CompressionStrategy
  /** 熔断状态，已停止时不再重试。 */
  guard?: CompressionGuard
}

/**
 * 判断上下文溢出后是否应当压缩一次并重试。
 * 仅在错误确认为上下文超限、尚未重试、策略允许压缩且熔断未触发时返回 true。
 */
export const shouldRetryAfterOverflow = (context: OverflowRetryContext): boolean => {
  if (context.alreadyRetried) {
    return false
  }
  if (context.strategy === 'none') {
    return false
  }
  if (context.guard?.stopped) {
    return false
  }
  return OVERFLOW_PATTERN.test(errorMessageOf(context.error))
}

const compressWithSummary = async <M extends Message>(
  input: CompressInput<M>,
  span: M[],
  condensedRange: { from: number; to: number },
  keepStart: number
): Promise<CompressResult<M>> => {
  const { messages, strategy, summarize, guard } = input
  if (!summarize) {
    return unchangedResult(messages, strategy, 'summarize-unavailable')
  }
  let text: string
  try {
    text = await summarize(span, { strategy, instruction: instructionFor(strategy) })
  } catch {
    return unchangedResult(messages, strategy, 'summarize-failed')
  }
  if (typeof text !== 'string' || !text.trim()) {
    return unchangedResult(messages, strategy, 'summarize-empty')
  }
  const summary = createSummaryRound(strategy, text, span[0].id) as unknown as M[]
  const projection = [
    ...messages.slice(0, condensedRange.from),
    ...summary,
    ...messages.slice(keepStart),
  ] as M[]
  const result = buildResult(messages, projection, strategy, condensedRange)
  if (guard) {
    guard.record(estimateMessagesTokens(messages), estimateMessagesTokens(projection))
  }
  return result
}

const compressHarness = async <M extends Message>(
  input: CompressInput<M>
): Promise<CompressResult<M>> => {
  const { messages, budget, strategy, options } = input
  if (estimateMessagesTokens(messages) <= harnessThreshold(budget)) {
    return unchangedResult(messages, strategy, 'below-threshold')
  }
  const segments = segmentMessages(messages).filter((segment) => segment.hasUser)
  if (segments.length < 2) {
    return unchangedResult(messages, strategy, 'nothing-to-compress')
  }
  const keepTokens = options?.keepTokens ?? harnessKeepTokens(budget)
  let keepIndex = segments.length
  let keptTokens = 0
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (keepIndex < segments.length && keptTokens + segment.tokens > keepTokens) {
      break
    }
    keptTokens += segment.tokens
    keepIndex = index
  }
  if (keepIndex === 0 || keepIndex === segments.length) {
    return unchangedResult(messages, strategy, 'nothing-to-compress')
  }
  const spanStart = segments[0].start
  const keepStart = segments[keepIndex].start
  const span = messages.slice(spanStart, keepStart)
  return compressWithSummary(input, span, { from: spanStart, to: keepStart }, keepStart)
}

const compressClaude = async <M extends Message>(
  input: CompressInput<M>
): Promise<CompressResult<M>> => {
  const { messages, budget, strategy, options } = input
  if (estimateMessagesTokens(messages) <= defaultThreshold(budget)) {
    return unchangedResult(messages, strategy, 'below-threshold')
  }
  const keepRounds = options?.keepRounds ?? 4
  const segments = segmentMessages(messages).filter((segment) => segment.hasUser)
  if (segments.length <= keepRounds) {
    return unchangedResult(messages, strategy, 'nothing-to-compress')
  }
  const spanStart = segments[0].start
  const keepStart = segments[segments.length - keepRounds].start
  const span = messages.slice(spanStart, keepStart)
  return compressWithSummary(input, span, { from: spanStart, to: keepStart }, keepStart)
}

const compressLibreChat = async <M extends Message>(
  input: CompressInput<M>
): Promise<CompressResult<M>> => {
  const { messages, budget, strategy, options } = input
  if (estimateMessagesTokens(messages) <= defaultThreshold(budget)) {
    return unchangedResult(messages, strategy, 'below-threshold')
  }
  const keepMessages = options?.keepMessages ?? 8
  const segments = segmentMessages(messages).filter((segment) => segment.hasUser)
  if (segments.length === 0) {
    return unchangedResult(messages, strategy, 'nothing-to-compress')
  }
  let count = 0
  let keepIndex = segments.length
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    const size = segment.end - segment.start
    if (count > 0 && count + size > keepMessages) {
      break
    }
    count += size
    keepIndex = index
  }
  if (keepIndex === 0 || keepIndex === segments.length) {
    return unchangedResult(messages, strategy, 'nothing-to-compress')
  }
  const spanStart = segments[0].start
  const keepStart = segments[keepIndex].start
  const span = messages.slice(spanStart, keepStart)
  return compressWithSummary(input, span, { from: spanStart, to: keepStart }, keepStart)
}

const compressOpenWebUi = <M extends Message>(input: CompressInput<M>): CompressResult<M> => {
  const { messages, budget, strategy, guard } = input
  if (estimateMessagesTokens(messages) <= defaultThreshold(budget)) {
    return unchangedResult(messages, strategy, 'below-threshold')
  }
  const { kept, dropped } = dropOldestSegments(messages, defaultThreshold(budget))
  if (dropped.length === 0) {
    return unchangedResult(messages, strategy, 'no-user-boundary')
  }
  const projection = kept as unknown as M[]
  const result = buildResult(
    messages,
    projection,
    strategy,
    { from: dropped[0].start, to: dropped[dropped.length - 1].end }
  )
  if (guard) {
    guard.record(estimateMessagesTokens(messages), estimateMessagesTokens(projection))
  }
  return result
}

const compressProgrammatic = <M extends Message>(input: CompressInput<M>): CompressResult<M> => {
  const { messages, budget, strategy, guard } = input
  const segments = segmentMessages(messages)
  const removed: string[] = []
  const stripped: Message[] = []
  for (const segment of segments) {
    const slice = messages.slice(segment.start, segment.end)
    const failed = slice.some(
      (message) => message.role === 'assistant' && message.status !== 'done'
    )
    if (failed && segment.hasUser) {
      for (const message of slice) {
        removed.push(message.id)
      }
      continue
    }
    for (const message of slice) {
      if (message.role === 'assistant') {
        if (message.status !== 'done') {
          removed.push(message.id)
          continue
        }
        stripped.push(stripAssistant(message))
        continue
      }
      stripped.push(message)
    }
  }
  const { kept } = dropOldestSegments(stripped, defaultThreshold(budget))
  const projection = kept as unknown as M[]
  const strippedChanged =
    stripped.length !== messages.length || stripped.some((message, index) => message !== messages[index])
  if (!strippedChanged && projection.length === messages.length) {
    return unchangedResult(messages, strategy, 'below-threshold')
  }
  const result = buildResult(messages, projection, strategy)
  if (guard) {
    guard.record(estimateMessagesTokens(messages), estimateMessagesTokens(projection))
  }
  return result
}

/**
 * 按策略计算本次请求应当发送的消息。
 *
 * 任何分支都不会修改输入数组或其中的消息对象；摘要失败时返回原始投影，
 * 调用方可以直接发送。
 */
export const compressForRequest = async <M extends Message>(
  input: CompressInput<M>
): Promise<CompressResult<M>> => {
  const { strategy, guard } = input
  if (strategy === 'none') {
    return unchangedResult(input.messages, strategy, 'none-strategy')
  }
  if (guard?.stopped) {
    return unchangedResult(input.messages, strategy, 'guard-stopped')
  }
  switch (strategy) {
    case 'harness':
      return compressHarness(input)
    case 'claude':
      return compressClaude(input)
    case 'librechat':
      return compressLibreChat(input)
    case 'openwebui':
      return compressOpenWebUi(input)
    case 'programmatic':
      return compressProgrammatic(input)
  }
}
