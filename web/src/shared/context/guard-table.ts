import { CompressionGuard } from './compression.ts'

/**
 * 压缩熔断状态表：按会话隔离，并按最近使用顺序淘汰。
 *
 * 独立成模块而非放在接线层，是为了让「会话隔离 / 命中重排 / 淘汰不复活熔断」
 * 三条不变量可以被真实实现直接测试——这些状态与淘汰逻辑最容易在改动中退化。
 */
const DEFAULT_GUARD_LIMIT = 64
const DEFAULT_STOPPED_LIMIT = 256

export class CompressionGuardTable {
  private readonly guards = new Map<string, CompressionGuard>()
  private readonly stopped = new Map<string, true>()
  private readonly guardLimit: number
  private readonly stoppedLimit: number

  constructor(options?: { guardLimit?: number; stoppedLimit?: number }) {
    this.guardLimit = options?.guardLimit ?? DEFAULT_GUARD_LIMIT
    this.stoppedLimit = options?.stoppedLimit ?? DEFAULT_STOPPED_LIMIT
  }

  /** 取会话的熔断器；命中时重排到末尾，使淘汰遵循最近使用顺序。 */
  for(sessionId: string): CompressionGuard {
    const existing = this.guards.get(sessionId)
    if (existing) {
      this.guards.delete(sessionId)
      this.guards.set(sessionId, existing)
      return existing
    }
    if (this.guards.size >= this.guardLimit) {
      const oldest = this.guards.keys().next()
      if (!oldest.done) {
        const evictedId = oldest.value
        this.rememberStopped(evictedId, this.guards.get(evictedId)?.stopped ?? false)
        this.guards.delete(evictedId)
      }
    }
    const created = new CompressionGuard()
    // 被淘汰的会话重建时恢复熔断，否则会重新做一轮已知无效的压缩。
    if (this.stopped.has(sessionId)) {
      created.state.stopped = true
      created.state.consecutiveIneffective = created.maxConsecutiveIneffective
    }
    this.guards.set(sessionId, created)
    return created
  }

  /** 压缩结束后回写熔断状态，使其不随淘汰丢失。 */
  sync(sessionId: string): void {
    this.rememberStopped(sessionId, this.for(sessionId).stopped)
  }

  /** 已记录的会话数，供测试与排障使用。 */
  get size(): number {
    return this.guards.size
  }

  private rememberStopped(sessionId: string, isStopped: boolean): void {
    if (!isStopped) {
      this.stopped.delete(sessionId)
      return
    }
    this.stopped.delete(sessionId)
    this.stopped.set(sessionId, true)
    if (this.stopped.size > this.stoppedLimit) {
      const oldest = this.stopped.keys().next()
      if (!oldest.done) {
        this.stopped.delete(oldest.value)
      }
    }
  }
}
