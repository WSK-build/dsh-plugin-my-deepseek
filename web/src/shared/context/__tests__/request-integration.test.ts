import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTEXT_SUMMARY_ACK,
  CONTEXT_SUMMARY_LABEL,
  compressForRequest,
  isContextSummary,
} from '../compression.ts'
import type {
  CompressionBudget,
  CompressionStrategy,
  ContextAssistantMessage,
  ContextUserMessage,
  Message,
} from '../compression.ts'
import {
  getContextRounds,
  toRequestMessages,
} from '../../../../../vendor/chat-demo-src/services/chat/reply.ts'

/**
 * 直接导入请求组装函数，而不是在本层复写配对规则：
 * 摘要能否进入请求取决于请求侧的轮次配对，只有用真实实现断言才能发现两侧漂移。
 */
type VendorHistory = Parameters<typeof toRequestMessages>[0]
type VendorQuestion = Parameters<typeof toRequestMessages>[1]
type RequestMessage = ReturnType<typeof toRequestMessages>[number]

type Pair = [ContextUserMessage, ContextAssistantMessage]

const budget: CompressionBudget = { windowTokens: 80000, outputTokens: 1000 }

const user = (id: string, content: string): ContextUserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const assistant = (id: string, text: string): ContextAssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

const questionText = (index: number) => `问题${index}：`
const answerText = (index: number) => `答复${index}：`

/** 每轮正文都带唯一标记，并留足触发压缩的长度。 */
const rounds = (count: number, padding: number): Message[] =>
  Array.from({ length: count }, (_, index) => [
    user(`u${index}`, `${questionText(index)}${'词'.repeat(padding)}`),
    assistant(`a${index}`, `${answerText(index)}${'答'.repeat(padding)}`),
  ]).flat()

const SUMMARY_MARKER = '摘要标记：'

const summarize = async (span: Message[]) =>
  `${SUMMARY_MARKER}已压缩 ${span.length} 条早期消息。`

const QUESTION = user('question', '本轮提问：')

const requestFor = (history: Message[]): RequestMessage[] =>
  toRequestMessages(history as unknown as VendorHistory, QUESTION as unknown as VendorQuestion)

const pairsFor = (history: Message[]): Pair[] =>
  getContextRounds(history as unknown as VendorHistory) as unknown as Pair[]

/** 请求消息的正文：用户消息是字符串，助手消息由内容块拼出。 */
const textOf = (message: RequestMessage): string =>
  typeof message.content === 'string'
    ? message.content
    : message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

const requestText = (messages: RequestMessage[]): string => messages.map(textOf).join('\n')

const replyTextOf = (reply: ContextAssistantMessage): string =>
  reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/** 原始消息 id 对应的唯一标记，用于在最终请求里检索。 */
const markerOf = (id: string): string => {
  const match = /^([ua])(\d+)$/.exec(id)
  assert.ok(match, `无法识别的原始消息 id：${id}`)
  return match[1] === 'u' ? questionText(Number(match[2])) : answerText(Number(match[2]))
}

const compress = async (strategy: CompressionStrategy, history: Message[], window = budget) => {
  const result = await compressForRequest({ messages: history, budget: window, strategy, summarize })
  return { result, projection: result.applied ? result.projection : history }
}

const STRATEGIES: CompressionStrategy[] = [
  'none',
  'harness',
  'claude',
  'librechat',
  'openwebui',
  'programmatic',
]

/** 只有这三类策略生成摘要，其余策略按自身规则丢弃或原样发送。 */
const SUMMARIZING: CompressionStrategy[] = ['harness', 'claude', 'librechat']

test('六种策略的压缩投影经真实请求组装后，每条用户消息都能配上可用回答', async () => {
  const history = rounds(6, 9000)
  for (const strategy of STRATEGIES) {
    const { result, projection } = await compress(strategy, history)
    const pairs = pairsFor(projection)
    const request = requestFor(projection)
    const userCount = projection.filter((message) => message.role === 'user').length

    assert.equal(result.applied, strategy !== 'none', `${strategy}: 压缩是否生效`)
    assert.equal(pairs.length, userCount, `${strategy}: 每个用户消息都应配上可用回答`)
    assert.equal(request.length, pairs.length * 2 + 1, `${strategy}: 轮次之外只追加本轮提问`)
    assert.equal(textOf(request[request.length - 1]), '本轮提问：', `${strategy}: 末尾是本轮提问`)

    // 保留的原始轮次必须完整进入请求，提问与回答都不缺。
    const keptIds = result.originalIds.filter((id) => !result.shadowedIds.includes(id))
    for (const id of keptIds) {
      assert.ok(
        requestText(request).includes(markerOf(id)),
        `${strategy}: 保留消息 ${id} 未进入请求`
      )
    }

    // 被压缩的轮次不能以原文形式重新出现，只能由摘要代表。
    for (const id of result.shadowedIds) {
      assert.equal(
        requestText(request).includes(markerOf(id)),
        false,
        `${strategy}: 被压缩的 ${id} 仍出现在请求里`
      )
    }
  }
})

test('生成摘要的策略把摘要作为首轮问答送入请求', async () => {
  const history = rounds(6, 9000)
  for (const strategy of SUMMARIZING) {
    const { result, projection } = await compress(strategy, history)
    const pairs = pairsFor(projection)
    const request = requestFor(projection)

    assert.ok(result.shadowedIds.length > 0, `${strategy}: 应压缩掉早期轮次`)
    assert.ok(pairs.length >= 2, `${strategy}: 首轮是摘要，其后是保留的原文轮次`)

    const [summaryUser, summaryReply] = pairs[0]
    assert.ok(isContextSummary(summaryUser), `${strategy}: 首轮提问应是摘要`)
    assert.match(summaryUser.content, /早期对话的压缩摘要/, `${strategy}: 摘要需标注来源`)
    assert.ok(summaryUser.content.includes(SUMMARY_MARKER), `${strategy}: 摘要正文缺失`)
    assert.equal(textOf(request[0]), summaryUser.content, `${strategy}: 摘要位于请求首条`)
    assert.equal(textOf(request[1]), CONTEXT_SUMMARY_ACK, `${strategy}: 摘要需带助手回执`)
    assert.equal(replyTextOf(summaryReply), CONTEXT_SUMMARY_ACK, `${strategy}: 回执是配对的回答`)
    assert.ok(
      requestText(request).includes(CONTEXT_SUMMARY_LABEL),
      `${strategy}: 摘要标记未进入请求`
    )

    // 摘要之后紧接保留的原文轮次，顺序与投影一致。
    for (const [index, [questionMessage, reply]] of pairs.entries()) {
      assert.equal(
        textOf(request[index * 2]),
        questionMessage.content,
        `${strategy}: 第 ${index} 轮提问顺序与投影一致`
      )
      assert.equal(
        textOf(request[index * 2 + 1]),
        replyTextOf(reply),
        `${strategy}: 第 ${index} 轮回答顺序与投影一致`
      )
    }
  }
})

test('不生成摘要的策略不注入摘要轮', async () => {
  const history = rounds(6, 9000)
  for (const strategy of ['none', 'openwebui', 'programmatic'] as CompressionStrategy[]) {
    const { projection } = await compress(strategy, history)
    const request = requestFor(projection)
    assert.equal(requestText(request).includes(SUMMARY_MARKER), false, strategy)
    assert.equal(requestText(request).includes(CONTEXT_SUMMARY_LABEL), false, strategy)
    assert.equal(projection.some((message) => isContextSummary(message)), false, strategy)
  }
})

test('harness 策略下六轮历史装配为摘要加一轮原文加本轮提问', async () => {
  // 与调用方一致的窗口取值：此时只有最后一轮原文能留在预算内。
  const window: CompressionBudget = { windowTokens: 64000, outputTokens: 8000 }
  const history = rounds(6, 13000)
  const { result, projection } = await compress('harness', history, window)
  const request = requestFor(projection)

  assert.equal(result.applied, true)
  assert.deepEqual(
    projection.map((message) => message.id),
    ['summary:harness:u0:user', 'summary:harness:u0:reply', 'u5', 'a5']
  )
  assert.deepEqual(
    request.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant', 'user']
  )
  assert.match(textOf(request[0]), /早期对话的压缩摘要/)
  assert.match(textOf(request[0]), /摘要标记：已压缩 10 条早期消息/)
  assert.equal(textOf(request[1]), CONTEXT_SUMMARY_ACK)
  assert.match(textOf(request[2]), /问题5：/)
  assert.match(textOf(request[3]), /答复5：/)
  assert.equal(textOf(request[4]), '本轮提问：')

  // 早期五轮不再以原文出现，由首条摘要代表。
  for (let index = 0; index < 5; index += 1) {
    assert.equal(requestText(request).includes(questionText(index)), false, `问题${index} 不应出现`)
    assert.equal(requestText(request).includes(answerText(index)), false, `答复${index} 不应出现`)
  }
})

test('单独的助手摘要消息不会被请求组装保留', async () => {
  // 请求组装只识别相邻的「用户消息 + 可用回答」，此用例固定该规则，避免摘要退回单条消息。
  const history: Message[] = [
    assistant('summary:bare', `${SUMMARY_MARKER}早期对话`),
    ...rounds(2, 10),
  ]
  const pairs = pairsFor(history)
  assert.deepEqual(
    pairs.map(([questionMessage]) => questionMessage.id),
    ['u0', 'u1']
  )
  assert.equal(requestText(requestFor(history)).includes(SUMMARY_MARKER), false)
})

test('摘要轮不携带附件，以纯文本用户消息发送', async () => {
  const history = rounds(6, 9000)
  const { projection } = await compress('harness', history)
  const summaryUser = projection.find((message) => isContextSummary(message))
  assert.ok(summaryUser, '投影里应有摘要消息')
  assert.equal(summaryUser.role, 'user')
  assert.deepEqual(summaryUser.role === 'user' ? summaryUser.files : null, [])
  const request = requestFor(projection)
  assert.equal(typeof request[0].content, 'string')
})
