/** Client for this package's own on-disk conversation store. */
const PREFIX = '/my-deepseek/api'

export type StoredSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: unknown[]
  rootMessageId?: string | null
}

export const loadHostSessions = async (signal?: AbortSignal): Promise<StoredSession[]> => {
  const response = await fetch(`${PREFIX}/store`, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Conversation store answered ${response.status}`)
  const body = (await response.json()) as { sessions?: StoredSession[] }
  return Array.isArray(body.sessions) ? body.sessions : []
}

/** Read one session straight from disk (used when the cache misses). */
export const loadHostSession = async (id: string): Promise<StoredSession | undefined> => {
  const response = await fetch(`${PREFIX}/store/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Conversation store answered ${response.status}`)
  return (await response.json()) as StoredSession
}

export const putHostSession = async (session: StoredSession): Promise<void> => {
  const response = await fetch(`${PREFIX}/store/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session),
  })
  if (!response.ok) throw new Error(`Conversation store rejected ${session.id}: ${response.status}`)
}

/** Replace the whole stored set in one request (bulk import or migration). */
export const putHostSessions = async (sessions: StoredSession[]): Promise<void> => {
  const response = await fetch(`${PREFIX}/store`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessions }),
  })
  if (!response.ok) throw new Error(`Conversation store rejected the bulk write: ${response.status}`)
}

export const deleteHostSession = async (id: string): Promise<void> => {
  const response = await fetch(`${PREFIX}/store/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Conversation store rejected the delete of ${id}: ${response.status}`)
}
