import type { Message, Session } from '../../../vendor/chat-demo-src/services/chat/types.js'

/**
 * 分叉产生的会话。血缘字段用于会话列表展示，不进入官方导出格式。
 */
export interface ForkedSession extends Session {
  /** 派生来源会话的 id。 */
  parentSessionId?: string
  /** 派生起点在源会话中的消息 id。 */
  forkedFromMessageId?: string
}

/** 分叉参数。 */
export interface ForkOptions {
  /** 新会话的 id。 */
  newId: string
  /** 新会话的创建与更新时间戳，缺省取当前时刻。 */
  now?: number
}

/** 标题中的分叉编号结构，例如 A(1)、A(1-1)。 */
const FORK_TITLE_PATTERN = /^(.+)\((\d+(?:-\d+)*)\)$/

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 计算分叉后的标题。
 *
 * 标题含编号结构时在已有括号内追加一级编号：A(1) 分叉得到 A(1-1)，A(1-1) 分叉得到
 * A(1-1-1)。标题不含编号结构时视为手工命名，直接追加一级编号：名字 得到 名字(1)。
 * 编号取同级已有标题中的最大编号加一，因此 A 在已有 A(1)、A(2) 时分叉得到 A(3)。
 */
export function nextForkTitle(title: string, siblingTitles?: string[]): string {
  const match = FORK_TITLE_PATTERN.exec(title)
  const base = match ? match[1] : title
  const segments = match ? match[2].split('-') : []
  const prefix = segments.length > 0 ? `${segments.join('-')}-` : ''
  const numberedPattern = new RegExp(`^${escapeRegExp(base)}\\(${escapeRegExp(prefix)}(\\d+)\\)$`)
  let counter = 1
  for (const existing of siblingTitles ?? []) {
    const found = numberedPattern.exec(existing)
    if (found) {
      counter = Math.max(counter, Number(found[1]) + 1)
    }
  }
  return `${base}(${prefix}${counter})`
}

/** 深拷贝纯数据，使派生会话与源会话不共享嵌套对象。 */
const cloneData = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneData(item)) as T
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneData(item)
    }
    return result as T
  }
  return value
}

/**
 * 解析消息的父节点 id。
 *
 * 结构化会话按 parentId 上溯；线性会话没有 parentId，父节点由消息顺序给出。
 */
const resolveParentId = (
  session: Session,
  index: number,
  message: Message
): string | null => {
  if (session.rootMessageId !== undefined) {
    return message.parentId ?? null
  }
  return index > 0 ? session.messages[index - 1].id : null
}

/**
 * 判断消息是否位于分叉点的下级。
 *
 * 沿父链上溯时经过分叉点的消息属于分叉点之后的内容，不带入派生会话；同一父节点下的
 * 兄弟版本不在分叉点的父链上，因此随完整消息树一并保留。
 */
const isBelowForkPoint = (
  session: Session,
  fromMessageId: string,
  message: Message,
  index: number
): boolean => {
  let parentId = resolveParentId(session, index, message)
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    if (parentId === fromMessageId) {
      return true
    }
    visited.add(parentId)
    const parentIndex = session.messages.findIndex((item) => item.id === parentId)
    if (parentIndex < 0) {
      return false
    }
    parentId = resolveParentId(session, parentIndex, session.messages[parentIndex])
  }
  return false
}

/**
 * 复制分叉范围内的消息。
 *
 * 除分叉点的下级之外，源会话的消息全部复制，未被选中的兄弟版本与它们的后续分支一并保留；
 * 分叉点的 selectedChildId 指向被排除的下级，因此随之外除，分叉点成为叶子。
 */
const copyForkMessages = (
  source: Session,
  fromMessageId: string
): Message[] => {
  const included = source.messages.filter(
    (message, index) => !isBelowForkPoint(source, fromMessageId, message, index)
  )
  const copiedIds = new Set(included.map((message) => message.id))
  return included.map((message) => {
    const copy = cloneData(message)
    if (copy.selectedChildId !== undefined && !copiedIds.has(copy.selectedChildId)) {
      delete copy.selectedChildId
    }
    return copy
  })
}

/**
 * 从源会话的指定消息派生新会话。
 *
 * 新会话复制分叉点所在层级的完整消息树，包含未被选中的兄弟版本；分叉点的下级不带入，
 * 分叉点因此成为叶子。源会话保持不变。
 *
 * 分叉点所在父链上的选中分支会被改写成指向分叉点：用户在某条消息上触发分叉，
 * 进入新会话后应当看到那条消息，而不是原来选中的兄弟版本。
 *
 * 消息 id 不做重映射：附件以 files[].id 指向本地原件，版本树以 parentId 与 selectedChildId
 * 指向消息，重映射需要同步改写全部引用点，并使同一份原件在两个会话间失去一致性。
 *
 * 标题不在本函数内计算：调用方用 nextForkTitle 得到新标题后赋值，分叉只负责结构拷贝。
 */
export function forkSession(
  source: Session,
  fromMessageId: string,
  options: ForkOptions
): ForkedSession {
  const target = source.messages.find((message) => message.id === fromMessageId)
  if (!target) {
    throw new Error(`会话 ${source.id} 中不存在消息 ${fromMessageId}，无法分叉`)
  }
  const messages = copyForkMessages(source, fromMessageId)
  const copiedIds = new Set(messages.map((message) => message.id))
  selectPathToForkPoint(messages, copiedIds, fromMessageId)
  let rootMessageId = source.rootMessageId
  if (rootMessageId !== undefined && !copiedIds.has(rootMessageId)) {
    const top = source.messages.find((message) => copiedIds.has(message.id))
    rootMessageId = top ? top.id : null
  }
  const now = options.now ?? Date.now()
  return {
    id: options.newId,
    title: source.title,
    createdAt: now,
    updatedAt: now,
    messages,
    rootMessageId,
    parentSessionId: source.id,
    forkedFromMessageId: fromMessageId,
  }
}

/**
 * 让新会话的可见路径落在分叉点上。
 *
 * 沿分叉点的父链逐级把 selectedChildId 改写成当前层级的子节点，
 * 使 getVisibleMessages 的可见路径以分叉点结尾。
 */
const selectPathToForkPoint = (
  messages: Message[],
  copiedIds: Set<string>,
  fromMessageId: string
): void => {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const child = byId.get(fromMessageId)
  if (!child) {
    return
  }
  let parentId = child.parentId ?? null
  let current: Message | undefined = child
  while (current) {
    if (parentId === null) {
      // 线性会话没有 parentId：由消息顺序确定可见顺序，无需改写选中分支。
      return
    }
    const parent = byId.get(parentId)
    if (!parent || !copiedIds.has(parentId)) {
      return
    }
    parent.selectedChildId = current.id
    current = parent
    parentId = parent.parentId ?? null
  }
}
