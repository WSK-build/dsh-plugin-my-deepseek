import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CompressionGuard, CompressionGuardTable } from './context/index.ts'

/**
 * 压缩熔断器与会话隔离的淘汰策略。
 *
 * 熔断状态表是「状态 + 淘汰」结构，最容易在改动中悄悄退化，
 * 因此把三条不变量固定在真实实现上：按会话隔离、命中重排、淘汰不复活熔断。
 */
describe('CompressionGuard', () => {
  it('连续无效压缩达到上限后停止', () => {
    const guard = new CompressionGuard()
    guard.record(1000, 1000)
    guard.record(1000, 1000)
    assert.equal(guard.stopped, false)
    guard.record(1000, 1000)
    assert.equal(guard.stopped, true)
  })

  it('有效压缩会清除计数并解除熔断', () => {
    const guard = new CompressionGuard()
    guard.record(1000, 1000)
    guard.record(1000, 1000)
    guard.record(1000, 1000)
    assert.equal(guard.stopped, true)
    guard.record(2000, 500)
    assert.equal(guard.stopped, false)
    assert.equal(guard.state.consecutiveIneffective, 0)
  })

  it('记录最近一次的 token 变化，供调用方判断有效性', () => {
    const guard = new CompressionGuard()
    guard.record(900, 400)
    assert.equal(guard.state.lastBeforeTokens, 900)
    assert.equal(guard.state.lastAfterTokens, 400)
  })
})

describe('CompressionGuardTable', () => {
  it('一个会话熔断不影响另一个会话', () => {
    const table = new CompressionGuardTable()
    const a = table.for('a')
    a.record(1000, 1000)
    a.record(1000, 1000)
    a.record(1000, 1000)
    assert.equal(a.stopped, true)
    assert.equal(table.for('b').stopped, false)
  })

  it('命中会重排到末尾，淘汰最久未用的会话', () => {
    const table = new CompressionGuardTable({ guardLimit: 3 })
    table.for('s0')
    table.for('s1')
    table.for('s2')
    // 重新访问 s0，使其不再是“最久未用”。
    table.for('s0')
    table.for('s3')
    assert.equal(table.for('s0').stopped, false, 's0 应仍可取出')
    assert.equal(table.size, 3, '表大小受上限约束')
  })

  it('被淘汰的熔断会话重建后仍处于熔断状态', () => {
    const table = new CompressionGuardTable({ guardLimit: 1 })
    const a = table.for('a')
    a.record(1000, 1000)
    a.record(1000, 1000)
    a.record(1000, 1000)
    assert.equal(a.stopped, true)
    table.sync('a')
    // 插入另一个会话，把 a 挤出去。
    table.for('b')
    // 重新访问 a：熔断状态必须恢复，否则会重复做一轮已知无效的压缩。
    const revived = table.for('a')
    assert.equal(revived.stopped, true)
    assert.equal(revived.state.consecutiveIneffective, revived.maxConsecutiveIneffective)
  })

  it('有效压缩解除熔断后，重建也不再熔断', () => {
    const table = new CompressionGuardTable({ guardLimit: 1 })
    const a = table.for('a')
    a.record(1000, 1000)
    a.record(1000, 1000)
    a.record(1000, 1000)
    table.sync('a')
    a.record(2000, 400)
    table.sync('a')
    table.for('b')
    assert.equal(table.for('a').stopped, false)
  })

  it('淘汰无效会话不影响其他会话的熔断', () => {
    const table = new CompressionGuardTable({ guardLimit: 1 })
    const a = table.for('a')
    a.record(1000, 1000)
    a.record(1000, 1000)
    a.record(1000, 1000)
    table.sync('a')
    const b = table.for('b')
    b.record(2000, 400)
    assert.equal(b.stopped, false)
    assert.equal(table.for('a').stopped, true)
  })
})
