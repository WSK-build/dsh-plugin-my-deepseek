import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CompressionGuard,
  compressForRequest,
  defaultThreshold,
  estimateMessagesTokens,
  estimateTokens,
  harnessKeepTokens,
  harnessThreshold,
  isContextSummary,
  shouldRetryAfterOverflow,
} from '../compression.ts'
import type {
  CompressResult,
  CompressionBudget,
  CompressionStrategy,
  ContextAssistantMessage,
  ContextUserMessage,
  Message,
} from '../compression.ts'

const budget: CompressionBudget = { windowTokens: 80000, outputTokens: 1000 }

const user = (id: string, content: string): ContextUserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const assistant = (
  id: string,
  text: string,
  extra: Partial<ContextAssistantMessage> = {}
): ContextAssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text, citations: [] }],
  ...extra,
})

const rounds = (count: number, text: string): Message[] =>
  Array.from({ length: count }, (_, index) => [
    user(`u${index}`, text),
    assistant(`a${index}`, '答复'),
  ]).flat()

const summarize = async (span: Message[]) => `已压缩 ${span.length} 条消息。`

const sentIds = (result: CompressResult) =>
  result.projection.filter((message) => !isContextSummary(message)).map((message) => message.id)

const originalIds = (messages: Message[]) => messages.map((message) => message.id)

test('estimateTokens 按中文字符和其他字符分别估算', () => {
  assert.equal(estimateTokens('字'.repeat(10)), 7)
  assert.equal(estimateTokens('a'.repeat(35)), 10)
  assert.equal(estimateTokens('字'.repeat(10) + 'a'.repeat(35)), 17)
  assert.equal(estimateTokens(''), 0)
})

test('harness 阈值与保留量按公式计算，并支持小窗口回退', () => {
  assert.equal(harnessThreshold({ windowTokens: 200000, outputTokens: 8000 }), 126464)
  assert.equal(harnessThreshold({ windowTokens: 73535, outputTokens: 8000 }), Math.floor(73535 * 0.8))
  assert.equal(harnessKeepTokens({ windowTokens: 80000, outputTokens: 1000 }), 12640)
  assert.equal(defaultThreshold(budget), 13464)
})

test('none 策略原样投影，不调用摘要回调', async () => {
  const messages = rounds(3, '短问题')
  let called = false
  const result = await compressForRequest({
    messages,
    budget,
    strategy: 'none',
    summarize: async () => {
      called = true
      return '不应发生'
    },
  })
  assert.equal(called, false)
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'none-strategy')
  assert.deepEqual(result.projection, messages)
  assert.notEqual(result.projection, messages)
})

test('harness 超过阈值时摘要旧区间，并按保留预算截取完整轮次', async () => {
  const messages = rounds(5, '词'.repeat(9000))
  const result = await compressForRequest({ messages, budget, strategy: 'harness', summarize })
  assert.equal(result.applied, true)
  assert.equal(result.shadowedIds.length, 6)
  assert.deepEqual(result.condensedRange, { from: 0, to: 6 })
  assert.deepEqual(sentIds(result), originalIds(messages).slice(6))
  const retained = estimateMessagesTokens(result.projection.filter((message) => !isContextSummary(message)))
  const nextRound = estimateMessagesTokens(messages.slice(0, 2))
  assert.ok(retained <= harnessKeepTokens(budget))
  assert.ok(retained + nextRound > harnessKeepTokens(budget))
  assert.ok((result.freedTokens ?? 0) > 0)
})

test('harness 在阈值以下不压缩', async () => {
  const messages = rounds(2, '短问题')
  const result = await compressForRequest({ messages, budget, strategy: 'harness', summarize })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'below-threshold')
  assert.deepEqual(result.projection, messages)
})

test('claude 生成三段继续摘要并保留最近四轮', async () => {
  const messages = rounds(5, '词'.repeat(9000))
  let instruction = ''
  const result = await compressForRequest({
    messages,
    budget,
    strategy: 'claude',
    summarize: async (_span, hint) => {
      instruction = hint.instruction
      return '继续摘要'
    },
  })
  assert.equal(result.applied, true)
  assert.match(instruction, /任务概述/)
  assert.match(instruction, /当前状态/)
  assert.match(instruction, /下一步/)
  assert.deepEqual(sentIds(result), originalIds(messages).slice(2))
  assert.equal(result.shadowedIds.length, 2)
})

test('librechat 生成摘要检查点并保留最近八条消息', async () => {
  const messages = rounds(5, '词'.repeat(9000))
  let instruction = ''
  const result = await compressForRequest({
    messages,
    budget,
    strategy: 'librechat',
    summarize: async (_span, hint) => {
      instruction = hint.instruction
      return '检查点'
    },
  })
  assert.equal(result.applied, true)
  assert.match(instruction, /检查点/)
  assert.equal(result.projection.filter((message) => !isContextSummary(message)).length, 8)
  assert.deepEqual(sentIds(result), originalIds(messages).slice(2))
  assert.equal(result.shadowedIds.length, 2)
})

test('openwebui 在用户消息边界丢弃旧轮次，不生成摘要', async () => {
  const smallBudget: CompressionBudget = { windowTokens: 40000, outputTokens: 1000 }
  const messages = rounds(7, '词'.repeat(9000))
  let called = false
  const result = await compressForRequest({
    messages,
    budget: smallBudget,
    strategy: 'openwebui',
    summarize: async () => {
      called = true
      return '不应发生'
    },
  })
  assert.equal(called, false)
  assert.equal(result.applied, true)
  assert.equal(result.shadowedIds.length % 2, 0)
  assert.equal(messages[result.shadowedIds.length]?.role, 'user')
  assert.equal(result.projection.some((message) => isContextSummary(message)), false)
  assert.ok(
    estimateMessagesTokens(result.projection) <=
      smallBudget.windowTokens - smallBudget.outputTokens
  )
})

test('openwebui 找不到用户边界时不压缩且投影等价', async () => {
  const messages: Message[] = [
    assistant('a0', '词'.repeat(9000)),
    user('u0', '问题'),
  ]
  const result = await compressForRequest({
    messages,
    budget: { windowTokens: 1000, outputTokens: 100 },
    strategy: 'openwebui',
    summarize,
  })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'no-user-boundary')
  assert.deepEqual(result.projection, messages)
  assert.deepEqual(result.originalIds, ['a0', 'u0'])
})

test('programmatic 剥离思考块、搜索原文与失败轮次且不调用模型', async () => {
  const failedRound: Message[] = [
    user('u-fail', '失败问题'),
    assistant('a-fail', '失败回复', { status: 'error' }),
  ]
  const heavyRound: Message[] = [
    user('u0', '词'.repeat(9000)),
    assistant('a0', '答复', {
      blocks: [
        { type: 'thinking', thinking: '内部推理原文' },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'tool-1',
          kind: 'search',
          content: [
            {
              type: 'web_search_result',
              title: '标题',
              url: 'https://example.test/page',
              snippet: '搜索结果原文',
              encrypted_content: '密文',
              site_icon: null,
              site_name: null,
              page_age: null,
            },
          ],
        },
        { type: 'text', text: '答复正文' },
      ],
    }),
  ]
  const tail = rounds(3, '短问题').map((message, index) => ({
    ...message,
    id: `tail-${index}`,
  }))
  const messages = [...heavyRound, ...failedRound, ...tail]
  const result = await compressForRequest({
    messages,
    budget,
    strategy: 'programmatic',
    summarize: async () => {
      throw new Error('programmatic 不得调用模型')
    },
  })
  assert.equal(result.applied, true)
  assert.ok(result.shadowedIds.includes('u-fail'))
  assert.ok(result.shadowedIds.includes('a-fail'))
  const kept = result.projection.find((message) => message.id === 'a0')
  assert.ok(kept && kept.role === 'assistant')
  if (kept && kept.role === 'assistant') {
    assert.equal(kept.blocks.some((block) => block.type === 'thinking'), false)
    const searchBlock = kept.blocks.find((block) => block.type === 'web_search_tool_result')
    assert.ok(searchBlock && searchBlock.type === 'web_search_tool_result')
    if (searchBlock && searchBlock.type === 'web_search_tool_result') {
      const entry = searchBlock.content[0]
      assert.equal(entry.type, 'web_search_result')
      if (entry.type === 'web_search_result') {
        assert.equal(entry.title, '标题')
        assert.equal(entry.url, 'https://example.test/page')
        assert.equal(entry.snippet, '')
        assert.equal(entry.encrypted_content, '')
      }
    }
  }
})

test('programmatic 仍超预算时按整轮丢弃最早对话', async () => {
  const messages = rounds(8, '词'.repeat(9000))
  const result = await compressForRequest({ messages, budget, strategy: 'programmatic' })
  assert.equal(result.applied, true)
  assert.ok(result.shadowedIds.length >= 2)
  assert.equal(result.shadowedIds.length % 2, 0)
  assert.deepEqual(sentIds(result), originalIds(messages).slice(result.shadowedIds.length))
  assert.ok(estimateMessagesTokens(result.projection) <= budget.windowTokens - budget.outputTokens)
})

test('摘要回调抛错时返回未压缩投影而不抛出', async () => {
  const messages = rounds(5, '词'.repeat(9000))
  const result = await compressForRequest({
    messages,
    budget,
    strategy: 'harness',
    summarize: async () => {
      throw new Error('模型不可用')
    },
  })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'summarize-failed')
  assert.deepEqual(result.projection, messages)
  assert.deepEqual(result.originalIds, originalIds(messages))
})

test('缺少摘要回调时返回未压缩投影', async () => {
  const messages = rounds(5, '词'.repeat(9000))
  const result = await compressForRequest({ messages, budget, strategy: 'claude' })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'summarize-unavailable')
  assert.deepEqual(result.projection, messages)
})

test('六种策略均保留输入消息 id 顺序与原始 id 清单', async () => {
  const strategies: CompressionStrategy[] = [
    'none',
    'harness',
    'claude',
    'librechat',
    'openwebui',
    'programmatic',
  ]
  const messages = rounds(6, '词'.repeat(9000))
  for (const strategy of strategies) {
    const result = await compressForRequest({ messages, budget, strategy, summarize })
    assert.deepEqual(result.originalIds, originalIds(messages), strategy)
    assert.deepEqual(
      result.shadowedIds,
      originalIds(messages).filter((id) => !sentIds(result).includes(id)),
      strategy
    )
    assert.equal(result.strategy, strategy)
  }
})

test('熔断在连续三次无效压缩后停止自动压缩', async () => {
  const guard = new CompressionGuard()
  const messages = rounds(5, '词'.repeat(9000))
  const ineffective = async (span: Message[]) => '词'.repeat(estimateMessagesTokens(span) * 2)
  for (let index = 0; index < 3; index += 1) {
    const result = await compressForRequest({
      messages,
      budget,
      strategy: 'harness',
      summarize: ineffective,
      guard,
    })
    assert.equal(result.applied, true, `第 ${index + 1} 次压缩`)
  }
  assert.equal(guard.stopped, true)
  assert.equal(guard.state.consecutiveIneffective, 3)
  const afterStop = await compressForRequest({
    messages,
    budget,
    strategy: 'harness',
    summarize,
    guard,
  })
  assert.equal(afterStop.applied, false)
  assert.equal(afterStop.reason, 'guard-stopped')
  assert.deepEqual(afterStop.projection, messages)
})

test('有效压缩会重置熔断计数', async () => {
  const guard = new CompressionGuard()
  const messages = rounds(5, '词'.repeat(9000))
  const ineffective = async (span: Message[]) => '词'.repeat(estimateMessagesTokens(span) * 2)
  await compressForRequest({ messages, budget, strategy: 'harness', summarize: ineffective, guard })
  await compressForRequest({ messages, budget, strategy: 'harness', summarize, guard })
  assert.equal(guard.state.consecutiveIneffective, 0)
  assert.equal(guard.stopped, false)
})

test('压缩不修改输入消息及其嵌套数组', async () => {
  const messages = rounds(4, '词'.repeat(9000))
  const before = structuredClone(messages)
  const strategies: CompressionStrategy[] = [
    'harness',
    'claude',
    'librechat',
    'openwebui',
    'programmatic',
  ]
  for (const strategy of strategies) {
    await compressForRequest({ messages, budget, strategy, summarize })
  }
  assert.deepEqual(messages, before)
})

test('溢出后重试判定只接受未重试的上下文溢出错误', () => {
  const overflow = {
    error: new Error('context window exceeded'),
    alreadyRetried: false,
    strategy: 'harness' as const,
  }
  assert.equal(shouldRetryAfterOverflow(overflow), true)
  assert.equal(shouldRetryAfterOverflow({ ...overflow, alreadyRetried: true }), false)
  assert.equal(shouldRetryAfterOverflow({ ...overflow, strategy: 'none' }), false)
  assert.equal(shouldRetryAfterOverflow({ ...overflow, error: new Error('网络连接失败') }), false)
  const guard = new CompressionGuard()
  guard.record(1000, 1000)
  guard.record(1000, 1000)
  guard.record(1000, 1000)
  assert.equal(shouldRetryAfterOverflow({ ...overflow, guard }), false)
})

test('压缩区间不切断一轮问答', async () => {
  const messages = rounds(6, '词'.repeat(9000))
  for (const strategy of ['harness', 'claude', 'librechat'] as CompressionStrategy[]) {
    const result = await compressForRequest({ messages, budget, strategy, summarize })
    assert.equal(result.applied, true, strategy)
    const range = result.condensedRange
    assert.ok(range, strategy)
    if (!range) continue
    assert.equal(messages[range.from].role, 'user', `${strategy} 区间起点必须是用户消息`)
    assert.ok(range.to - range.from >= 2, `${strategy} 区间至少覆盖一问一答`)
    const last = messages[range.to - 1]
    assert.equal(last.role, 'assistant', `${strategy} 区间终点必须是该轮的助手消息`)
  }
})

test('由 originalIds 与 shadowedIds 可重建输入的 id 序列', async () => {
  const messages = rounds(6, '词'.repeat(9000))
  for (const strategy of ['harness', 'claude', 'librechat', 'openwebui', 'programmatic'] as CompressionStrategy[]) {
    const result = await compressForRequest({ messages, budget, strategy, summarize })
    const rebuilt = originalIds(messages).filter((id) => !result.shadowedIds.includes(id))
    assert.deepEqual(rebuilt, sentIds(result), strategy)
  }
})

test('源码中不含具体模型 ID 字面量', () => {  const here = path.dirname(fileURLToPath(import.meta.url))
  const sourceDir = path.resolve(here, '..')
  const forbidden = ['deepseek' + '-flash', 'deepseek' + '-v4-pro', 'deepseek' + '-v3']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.ts')) {
        files.push(full)
      }
    }
  }
  walk(sourceDir)
  assert.ok(files.some((file) => file.endsWith('compression.ts')))
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const literal of forbidden) {
      assert.equal(source.includes(literal), false, `${file} 含被禁止的模型 ID`)
    }
  }
})
