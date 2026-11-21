import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  AssistantMessage,
  Message,
  Session,
  UserMessage,
} from '../../../vendor/chat-demo-src/services/chat/types.js'

import { forkSession, nextForkTitle } from './fork.ts'
import { getVisibleMessages } from '../../../vendor/chat-demo-src/services/chat/branches.ts'

const user = (
  id: string,
  content: string,
  extra: Partial<UserMessage> = {}
): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
  ...extra,
})

const assistant = (
  id: string,
  text: string,
  extra: Partial<AssistantMessage> = {}
): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-v4-pro',
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text }],
  ...extra,
})

/**
 * 构造一棵含兄弟版本的消息树。
 *
 * m1 是根；m2 与 m3 是同一提问的两个回答版本，m2 之下挂 m4、m5。
 */
const createSession = (): Session => ({
  id: 'session-a',
  title: 'A',
  createdAt: 100,
  updatedAt: 100,
  rootMessageId: 'm1',
  messages: [
    user('m1', '第一个问题', { selectedChildId: 'm2' }),
    assistant('m2', '回答版本一', { parentId: 'm1', selectedChildId: 'm4' }),
    assistant('m3', '回答版本二', { parentId: 'm1' }),
    user('m4', '追问', { parentId: 'm2' }),
    assistant('m5', '追问的回答', { parentId: 'm4' }),
  ],
})

const idsOf = (session: Session): string[] => session.messages.map((message) => message.id)

/** 可见路径由上游 branches.ts 决定，测试直接复用该实现，避免在本地复制规则。 */
const visibleIdsOf = (session: Session): string[] =>
  getVisibleMessages(session).map((message) => message.id)

const findMessage = (session: Session, id: string): Message => {
  const message = session.messages.find((item) => item.id === id)
  assert.ok(message, `缺少消息 ${id}`)
  return message
}

describe('nextForkTitle', () => {
  it('普通标题追加一级编号', () => {
    assert.equal(nextForkTitle('A'), 'A(1)')
  })

  it('已存在同级编号时取最大编号加一', () => {
    assert.equal(nextForkTitle('A', ['A(1)', 'A(2)']), 'A(3)')
  })

  it('已有编号的标题在括号内追加一级编号', () => {
    assert.equal(nextForkTitle('A(1)'), 'A(1-1)')
    assert.equal(nextForkTitle('A(1-1)'), 'A(1-1-1)')
  })

  it('手工改名的标题不续号', () => {
    assert.equal(nextForkTitle('我的会话'), '我的会话(1)')
    assert.equal(nextForkTitle('我的会话', ['我的会话(1)']), '我的会话(2)')
  })

  it('形似编号但不符合规则的标题视为普通标题', () => {
    assert.equal(nextForkTitle('讨论(beta)'), '讨论(beta)(1)')
    assert.equal(nextForkTitle('讨论(1-a)'), '讨论(1-a)(1)')
  })

  it('续号只统计同级的编号标题', () => {
    assert.equal(nextForkTitle('A(1)', ['A(1-1)', 'A(2)']), 'A(1-2)')
    assert.equal(nextForkTitle('A', ['A(1-1)']), 'A(1)')
    assert.equal(nextForkTitle('A', ['B(3)']), 'A(1)')
  })

  it('使用半角括号', () => {
    const title = nextForkTitle('A')
    assert.ok(title.includes('('))
    assert.ok(title.includes(')'))
    assert.ok(!title.includes('（'))
    assert.ok(!title.includes('）'))
  })
})

describe('forkSession', () => {
  it('分叉最后一条消息时保留全部消息', () => {
    const source = createSession()
    const forked = forkSession(source, 'm5', { newId: 'session-fork', now: 999 })

    assert.deepEqual(idsOf(forked), ['m1', 'm2', 'm3', 'm4', 'm5'])
    assert.equal(forked.rootMessageId, 'm1')
  })

  it('分叉中间消息时其下级不进入新会话', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    assert.deepEqual(idsOf(forked), ['m1', 'm2', 'm3'])
  })

  it('分叉点成为叶子并清除指向下级的 selectedChildId', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    const point = findMessage(forked, 'm2')
    assert.equal(point.selectedChildId, undefined)
    assert.equal(point.parentId, 'm1')
  })

  it('分叉有多版本兄弟的消息时其他版本仍保留可切换', () => {
    const source = createSession()
    const forked = forkSession(source, 'm4', { newId: 'session-fork', now: 999 })

    assert.deepEqual(idsOf(forked), ['m1', 'm2', 'm3', 'm4'])
    // 根的选中分支保持不变，兄弟版本仍在同一父节点下，可经 selectVersion 切换。
    assert.equal(findMessage(forked, 'm1').selectedChildId, 'm2')
    assert.equal(findMessage(forked, 'm3').parentId, 'm1')
  })

  it('分叉未选中的兄弟版本时该版本成为可见路径的终点，兄弟分支保留', () => {
    const source = createSession()
    const forked = forkSession(source, 'm3', { newId: 'session-fork', now: 999 })

    // m3 没有下级，分叉点因此成为叶子；m2 及其分支是同一父节点下的兄弟分支，随消息树保留。
    assert.deepEqual(idsOf(forked), ['m1', 'm2', 'm3', 'm4', 'm5'])
    assert.equal(findMessage(forked, 'm3').selectedChildId, undefined)
    // 用户点的是 m3，进入新会话必须看到 m3，因此父节点的选中分支改指向 m3。
    assert.equal(findMessage(forked, 'm1').selectedChildId, 'm3')
    assert.deepEqual(visibleIdsOf(forked), ['m1', 'm3'])
  })

  it('分叉可见路径上的消息时可见路径以分叉点结尾', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    assert.deepEqual(visibleIdsOf(forked), ['m1', 'm2'])
  })

  it('深层的未选中兄弟版本也能成为可见路径终点', () => {
    const source = createSession()
    // 给 m5 所在的问答补一个兄弟回答版本，从该版本分叉。
    const withSibling: Session = {
      ...source,
      messages: [
        ...source.messages,
        assistant('m6', '追问的另一个回答', { parentId: 'm4' }),
      ],
    }
    withSibling.messages[3] = { ...source.messages[3], selectedChildId: 'm5' }
    const forked = forkSession(withSibling, 'm6', { newId: 'session-fork', now: 999 })

    assert.equal(findMessage(forked, 'm4').selectedChildId, 'm6')
    assert.deepEqual(visibleIdsOf(forked), ['m1', 'm2', 'm4', 'm6'])
  })

  it('分叉根消息时只保留根消息', () => {
    const source = createSession()
    const forked = forkSession(source, 'm1', { newId: 'session-fork', now: 999 })

    assert.deepEqual(idsOf(forked), ['m1'])
    assert.equal(forked.rootMessageId, 'm1')
    assert.equal(forked.messages[0].selectedChildId, undefined)
  })

  it('新会话带有新的 id 与时间戳及血缘字段', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    assert.equal(forked.id, 'session-fork')
    assert.equal(forked.createdAt, 999)
    assert.equal(forked.updatedAt, 999)
    assert.equal(forked.parentSessionId, 'session-a')
    assert.equal(forked.forkedFromMessageId, 'm2')
  })

  it('缺省时间戳取当前时刻', () => {
    const source = createSession()
    const before = Date.now()
    const forked = forkSession(source, 'm2', { newId: 'session-fork' })

    assert.ok(forked.createdAt >= before)
    assert.ok(forked.createdAt <= Date.now())
    assert.equal(forked.createdAt, forked.updatedAt)
  })

  it('标题沿用源会话，由调用方按 nextForkTitle 赋值', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    assert.equal(forked.title, 'A')
    const titled = { ...forked, title: nextForkTitle(source.title, ['A(1)']) }
    assert.equal(titled.title, 'A(2)')
    assert.equal(forked.title, 'A')
  })

  it('调用后源会话深度不变', () => {
    const source = createSession()
    const snapshot = JSON.stringify(source)

    forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    assert.equal(JSON.stringify(source), snapshot)
  })

  it('新会话与原会话不共享嵌套对象引用', () => {
    const source = createSession()
    const root = findMessage(source, 'm1')
    assert.equal(root.role, 'user')
    root.files.push({
      id: 'file-1',
      serverId: null,
      name: 'a.png',
      size: 10,
      isImage: true,
      mimeType: 'image/png',
    })

    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })
    const forkedRoot = findMessage(forked, 'm1')
    const forkedReply = findMessage(forked, 'm2')
    assert.equal(forkedRoot.role, 'user')
    assert.equal(forkedReply.role, 'assistant')
    assert.equal(root.role, 'user')

    assert.notEqual(forked.messages, source.messages)
    assert.notEqual(forkedRoot, root)
    assert.notEqual(forkedRoot.files, root.files)
    assert.notEqual(forkedRoot.files[0], root.files[0])
    assert.notEqual(forkedReply.blocks, findMessage(source, 'm2').blocks)
    assert.equal(forkedRoot.files[0].name, 'a.png')
  })

  it('修改新会话不影响源会话', () => {
    const source = createSession()
    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })

    const forkedReply = findMessage(forked, 'm2')
    assert.equal(forkedReply.role, 'assistant')
    forkedReply.blocks.push({ type: 'text', text: '追加' })

    const sourceReply = findMessage(source, 'm2')
    assert.equal(sourceReply.role, 'assistant')
    assert.equal(sourceReply.blocks.length, 1)
  })

  it('消息 id 与附件 id 保留原样', () => {
    const source = createSession()
    const root = findMessage(source, 'm1')
    assert.equal(root.role, 'user')
    root.files.push({
      id: 'file-1',
      serverId: null,
      name: 'a.png',
      size: 10,
      isImage: true,
      mimeType: 'image/png',
    })

    const forked = forkSession(source, 'm2', { newId: 'session-fork', now: 999 })
    const forkedRoot = findMessage(forked, 'm1')
    assert.equal(forkedRoot.role, 'user')
    assert.equal(forkedRoot.files[0].id, 'file-1')
    assert.deepEqual(
      idsOf(forked),
      idsOf(source).filter((id) => id !== 'm4' && id !== 'm5')
    )
  })

  it('fromMessageId 不存在时抛出带明确信息的错误', () => {
    const source = createSession()
    assert.throws(
      () => forkSession(source, 'missing', { newId: 'session-fork', now: 999 }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /missing/)
        return true
      }
    )
  })

  it('线性会话按消息顺序确定父子关系', () => {
    const source: Session = {
      id: 'linear',
      title: '线性',
      createdAt: 1,
      updatedAt: 1,
      messages: [user('u1', '问题一'), assistant('a1', '回答一'), user('u2', '问题二')],
    }
    const forked = forkSession(source, 'a1', { newId: 'linear-fork', now: 5 })

    assert.deepEqual(idsOf(forked), ['u1', 'a1'])
    assert.equal(forked.rootMessageId, undefined)
  })
})
