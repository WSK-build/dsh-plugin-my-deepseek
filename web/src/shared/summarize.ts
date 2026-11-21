import { streamMessage } from '../../../vendor/chat-demo-src/services/api/client.js'
import type { ChatModel, MessageParam } from '../../../vendor/chat-demo-src/services/api/types.js'
import type { Message } from '../../../vendor/chat-demo-src/services/chat/types.js'
import type { Summarize } from './context/index.ts'

/** 摘要请求的助手身份说明，与聊天请求保持一致。 */
const SUMMARY_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 摘要长度上限，避免摘要本身占用过多预算。 */
const SUMMARY_MAX_CHARS = 1200

type SummarizeDeps = {
  /** 账号登录时为空串，鉴权由原生壳注入。 */
  apiKey: string
  /** 摘要沿用当前会话模型，由调用方注入；本模块不持有模型 ID。 */
  model: ChatModel
  signal: AbortSignal
}

/** 把待压缩的历史片段渲染成摘要请求可读的文本。 */
const renderSpan = (span: readonly Message[]): string => {
  const lines: string[] = []
  for (const message of span) {
    if (message.role === 'user') {
      const names = message.files.map((file) => file.name).filter(Boolean)
      const attachment = names.length > 0 ? `（附件：${names.join('、')}）` : ''
      lines.push(`用户：${message.content}${attachment}`)
      continue
    }
    const text = message.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
    lines.push(`助手：${text}`)
  }
  return lines.join('\n\n')
}

/**
 * 构造压缩层使用的摘要回调。
 *
 * 摘要是一次独立的模型请求；失败时抛出，由压缩层转成「压缩未生效」，
 * 不影响本轮发送。
 */
export const createSummarizer =
  (deps: SummarizeDeps): Summarize =>
  async (span, hint) => {
    const rendered = renderSpan(span)
    if (!rendered.trim()) {
      return ''
    }
    const instruction = [
      `请把下面这段较早的对话压缩成便于继续对话的中文摘要，不超过 ${SUMMARY_MAX_CHARS} 字。`,
      hint.instruction,
      '只输出摘要正文，不要复述原文，不要添加标题或客套话。',
    ].join('\n')

    const request: MessageParam[] = [
      { role: 'user', content: `${instruction}\n\n---\n${rendered}` },
    ]

    let text = ''
    for await (const event of streamMessage(
      deps.apiKey,
      {
        model: deps.model,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: request,
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
        tools: [],
      },
      deps.signal
    )) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    return text.trim().slice(0, SUMMARY_MAX_CHARS)
  }
