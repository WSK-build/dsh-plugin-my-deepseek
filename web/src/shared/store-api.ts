import type { Session } from '../../../vendor/chat-demo-src/services/chat/types.js'

/**
 * 会话存储后端。
 *
 * 三种后端：
 *  - host    宿主提供的 HTTP 路由（DeepSeek Harness 插件）
 *  - indexed 浏览器 IndexedDB（独立 App、网页体验站）
 *  - memory  仅内存（网页体验站，刷新即清空）
 *
 * 选择方式：原生壳没有宿主路由可探测，直接使用 indexed；其余环境探测宿主路由，
 * 成功则使用 host；探测失败只让本次读取走 indexed，不固化选择，冷却之后重新探测；
 * 体验站通过构建期常量强制使用 memory。
 *
 * 整体替换（`putHostSessions`）在三种后端上都是先清空再写入，与宿主的
 * `writeAllSessions` 一致。
 */
export type StoredSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: unknown[]
  rootMessageId?: string | null
}

type Backend = 'host' | 'indexed' | 'memory'

const HOST_PREFIX = '/my-deepseek/api'
/** 探测带轻量标记：宿主实现该参数时只回状态，不必把全部会话读出来。 */
const HOST_PROBE_URL = `${HOST_PREFIX}/store?probe=1`
const INDEXED_DB_NAME = 'my-deepseek-store'
const INDEXED_DB_VERSION = 1
const INDEXED_STORE = 'sessions'
/** 探测超时：宿主读取全部会话的耗时随数据量增长，需要留出余量。 */
const PROBE_TIMEOUT_MS = 8000
/** 探测失败后的冷却时间：既允许重新探测，也避免每次读写都等一次超时。 */
const PROBE_RETRY_MS = 30_000
const WARN_PREFIX = '[chat-store]'

/** 构建期为 true 时使用内存后端，用于不保留任何数据的体验站。 */
const FORCE_MEMORY = typeof __CHAT_MEMORY_ONLY__ !== 'undefined' && __CHAT_MEMORY_ONLY__

let backend: Backend | null = null
let probing: Promise<Backend> | null = null
/** 探测响应里附带的会话，供本页第一次读取直接使用。 */
let primedSessions: StoredSession[] | null = null
/** 降级状态：记录失败原因与下次探测时间；失败不写入 backend。 */
let degraded: { reason: string; retryAt: number } | null = null
let warnedAboutDegrade = false

const memoryStore = new Map<string, StoredSession>()

const openIndexedDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(INDEXED_STORE)) {
        db.createObjectStore(INDEXED_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('cannot open the conversation store'))
  })

const withIndexedStore = async <T>(
  mode: 'readonly' | 'readwrite',
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openIndexedDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(INDEXED_STORE, mode)
    const request = run(tx.objectStore(INDEXED_STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * 在一个事务中执行多次写入，事务提交后才返回。
 * 清空与写入必须同属一个事务，否则中途失败会留下半份数据。
 */
const withIndexedTransaction = async <T>(
  run: (store: IDBObjectStore) => T
): Promise<T> => {
  const db = await openIndexedDb()
  const tx = db.transaction(INDEXED_STORE, 'readwrite')
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'))
  })
  try {
    const result = run(tx.objectStore(INDEXED_STORE))
    await committed
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // 事务已经结束，无需再次中止。
    }
    // 事务中止同样会让 committed 失败，这里消费掉它，避免留下未处理的拒绝。
    await committed.catch(() => undefined)
    throw error
  }
}

/**
 * 识别探测响应：只有会话列表，或宿主明确回执（ok / count）才算命中。
 * 其他路由的 200 响应形状不明，不能据此认定宿主存储可用。
 */
const readProbeBody = (body: unknown): StoredSession[] | null | undefined => {
  if (body === null || typeof body !== 'object') return undefined
  const record = body as { sessions?: unknown; ok?: unknown; count?: unknown }
  if (Array.isArray(record.sessions)) return record.sessions as StoredSession[]
  if (record.ok === true || typeof record.count === 'number') return null
  return undefined
}

type ProbeResult = { ok: true; sessions: StoredSession[] | null } | { ok: false; reason: string }

const probeHostBackend = async (): Promise<ProbeResult> => {
  try {
    const response = await fetch(HOST_PROBE_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` }
    }
    const sessions = readProbeBody(await response.json())
    if (sessions === undefined) {
      return { ok: false, reason: 'unexpected probe response' }
    }
    return { ok: true, sessions }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 是否运行在原生壳里（Android / 鸿蒙）。
 *
 * 原生壳的页面来自本地资源，没有宿主路由可探测：探测只会拿到一个 HTML 兜底页，
 * 既产生无意义请求，也会在日志里留下误导性的“宿主不可用”告警。
 */
const inNativeShell = (): boolean => {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (capacitor?.isNativePlatform?.()) {
    return true
  }
  return typeof (globalThis as { __DSH_ACCOUNT_HARMONY__?: unknown }).__DSH_ACCOUNT_HARMONY__ !== 'undefined'
}

const startProbe = (): Promise<Backend> => {
  if (inNativeShell()) {
    // 原生壳只用浏览器存储，不进行宿主探测。
    backend = 'indexed'
    degraded = null
    return Promise.resolve('indexed')
  }
  const run = (async (): Promise<Backend> => {
    const result = await probeHostBackend()
    if (result.ok) {
      backend = 'host'
      degraded = null
      primedSessions = result.sessions
      return 'host'
    }
    // 一次探测失败不足以决定整页的读写去向：超时就永久改走浏览器存储，
    // 会让刷新后重新探测成功的数据看起来凭空消失。因此只降级当前这次读取，
    // 冷却结束后重新探测，把原因留给诊断接口与一次告警。
    degraded = { reason: result.reason, retryAt: Date.now() + PROBE_RETRY_MS }
    if (!warnedAboutDegrade) {
      warnedAboutDegrade = true
      console.warn(`${WARN_PREFIX} host store probe failed, using browser storage for now: ${result.reason}`)
    }
    return 'indexed'
  })()
  return run.finally(() => {
    probing = null
  })
}

const resolveBackend = async (): Promise<Backend> => {
  if (backend !== null) {
    return backend
  }
  if (FORCE_MEMORY) {
    backend = 'memory'
    return backend
  }
  if (degraded !== null && Date.now() < degraded.retryAt) {
    return 'indexed'
  }
  probing ??= startProbe()
  return probing
}

const listIndexed = async (): Promise<StoredSession[]> => {
  const all = await withIndexedStore('readonly', (store) => store.getAll() as IDBRequest<StoredSession[]>)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

const listMemory = (): StoredSession[] =>
  [...memoryStore.values()].sort((a, b) => b.updatedAt - a.updatedAt)

export const loadHostSessions = async (signal?: AbortSignal): Promise<StoredSession[]> => {
  const selected = await resolveBackend()
  if (selected === 'memory') {
    return listMemory()
  }
  if (selected === 'indexed') {
    return listIndexed()
  }
  // 探测响应已经携带全部会话，直接作为本页首次读取的结果，避免把整个存储读两遍。
  if (primedSessions !== null) {
    const sessions = primedSessions
    primedSessions = null
    return sessions
  }
  const response = await fetch(`${HOST_PREFIX}/store`, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Conversation store answered ${response.status}`)
  const body = (await response.json()) as { sessions?: StoredSession[] }
  return Array.isArray(body.sessions) ? body.sessions : []
}

export const loadHostSession = async (id: string): Promise<StoredSession | undefined> => {
  const selected = await resolveBackend()
  if (selected === 'memory') {
    return memoryStore.get(id)
  }
  if (selected === 'indexed') {
    return withIndexedStore('readonly', (store) => store.get(id) as IDBRequest<StoredSession | undefined>)
  }
  const response = await fetch(`${HOST_PREFIX}/store/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Conversation store answered ${response.status}`)
  return (await response.json()) as StoredSession
}

export const putHostSession = async (session: StoredSession): Promise<void> => {
  const selected = await resolveBackend()
  if (selected === 'memory') {
    memoryStore.set(session.id, session)
    return
  }
  if (selected === 'indexed') {
    await withIndexedStore('readwrite', (store) => store.put(session))
    return
  }
  const response = await fetch(`${HOST_PREFIX}/store/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session),
  })
  if (!response.ok) throw new Error(`Conversation store rejected ${session.id}: ${response.status}`)
  // 写入之后探测带回来的列表已经过时，不能再当作首次读取的结果。
  primedSessions = null
}

/**
 * 整体替换全部会话：清空后写入，与宿主的 `writeAllSessions` 语义一致。
 * 历史导入依赖这一点——保留旧会话会让导入结果与磁盘内容不一致。
 */
export const putHostSessions = async (sessions: StoredSession[]): Promise<void> => {
  const selected = await resolveBackend()
  if (selected === 'memory') {
    memoryStore.clear()
    for (const session of sessions) {
      memoryStore.set(session.id, session)
    }
    return
  }
  if (selected === 'indexed') {
    await withIndexedTransaction((store) => {
      store.clear()
      for (const session of sessions) {
        store.put(session)
      }
    })
    return
  }
  const response = await fetch(`${HOST_PREFIX}/store`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessions }),
  })
  if (!response.ok) throw new Error(`Conversation store rejected the bulk write: ${response.status}`)
  primedSessions = null
}

export const deleteHostSession = async (id: string): Promise<void> => {
  const selected = await resolveBackend()
  if (selected === 'memory') {
    memoryStore.delete(id)
    return
  }
  if (selected === 'indexed') {
    await withIndexedStore('readwrite', (store) => store.delete(id))
    return
  }
  const response = await fetch(`${HOST_PREFIX}/store/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Conversation store rejected the delete of ${id}: ${response.status}`)
  primedSessions = null
}

/** 当前存储后端与降级状态，供界面提示与排障读取。 */
export const storeBackendState = (): { backend: Backend | null; degraded: boolean; reason?: string } => ({
  backend: FORCE_MEMORY ? 'memory' : backend,
  degraded: degraded !== null,
  reason: degraded?.reason,
})

/** 会话类型导出，保持调用方与存储结构同步。 */
export type { Session }
