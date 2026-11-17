/**
 * Host half of the standalone DeepSeek chat panel.
 *
 * The panel is the official chat-demo bundled as a Harness client module. This
 * half does exactly one thing: keep the panel's conversations in a local folder
 * on this machine, so history survives a browser cache reset.
 *
 * It reads and writes no Harness data — no sessions, no workspaces, no models —
 * and talks to no service besides its own routes.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Same-origin routes owned by this package. */
const PREFIX = '/my-deepseek/api'

/** Largest request body accepted (the panel sends whole conversations). */
const MAX_BODY_BYTES = 16 * 1024 * 1024

export const inject = ['webServer']

/**
 * Where conversations live, independent of any other tool:
 * `$DSH_CHAT_DATA_DIR`, else the platform's per-user data directory.
 */
const dataDirectory = () => {
  const override = process.env.DSH_CHAT_DATA_DIR
  if (override) return override
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'my-deepseek-panel')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'my-deepseek-panel')
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'my-deepseek-panel')
}

const sessionsDirectory = () => path.join(dataDirectory(), 'sessions')

const sessionFile = (id) => path.join(sessionsDirectory(), `${encodeURIComponent(id)}.json`)

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const readSessionFile = async (id) => {
  try {
    return JSON.parse(await readFile(sessionFile(id), 'utf8'))
  } catch {
    return undefined
  }
}

/** One file per session: a save rewrites only that session, atomically. */
const writeSessionFile = async (session) => {
  await mkdir(sessionsDirectory(), { recursive: true })
  const file = sessionFile(session.id)
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(session), 'utf8')
  await rename(temporary, file)
}

const deleteSessionFile = (id) => rm(sessionFile(id), { force: true })

const listSessionFiles = async () => {
  try {
    return (await readdir(sessionsDirectory())).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
}

const readAllSessions = async () => {
  const names = await listSessionFiles()
  const sessions = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(await readFile(path.join(sessionsDirectory(), name), 'utf8'))
      } catch {
        return undefined
      }
    })
  )
  return sessions.filter((session) => session && typeof session.id === 'string')
}

/** Bulk replace: used by the one-time migration out of browser storage. */
const writeAllSessions = async (sessions) => {
  const ids = new Set()
  for (const session of sessions) {
    if (!session || typeof session.id !== 'string') continue
    await writeSessionFile(session)
    ids.add(session.id)
  }
  for (const name of await listSessionFiles()) {
    const id = decodeURIComponent(name.slice(0, -'.json'.length))
    if (!ids.has(id)) await deleteSessionFile(id)
  }
  return ids.size
}

export function apply(ctx) {
  const reply = (res, status, body) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  }

  const handle = async (req, res) => {
    try {
      const requestOrigin = req.headers.origin
      let self
      try {
        self = ctx.webServer.getOrigin()
      } catch {
        self = undefined
      }
      if (requestOrigin && self && requestOrigin !== self) {
        reply(res, 403, { error: 'cross-origin request refused' })
        return
      }

      const url = new URL(req.url, 'http://localhost')
      if (!url.pathname.startsWith(PREFIX)) {
        reply(res, 404, { error: 'not found' })
        return
      }
      const path = url.pathname.slice(PREFIX.length) || '/'

      if (path === '/store') {
        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req))
          const list = Array.isArray(body?.sessions) ? body.sessions : []
          reply(res, 200, { ok: true, count: await writeAllSessions(list) })
          return
        }
        if (req.method !== 'GET') {
          reply(res, 405, { error: 'only GET and PUT are supported' })
          return
        }
        reply(res, 200, { sessions: await readAllSessions() })
        return
      }

      const item = /^\/store\/([^/]+)$/.exec(path)
      if (item) {
        const id = decodeURIComponent(item[1])
        if (req.method === 'PUT') {
          const session = JSON.parse(await readBody(req))
          if (!session || typeof session.id !== 'string' || session.id !== id) {
            reply(res, 400, { error: 'the body must be the session named by the path' })
            return
          }
          await writeSessionFile(session)
          reply(res, 200, { ok: true })
          return
        }
        if (req.method === 'DELETE') {
          await deleteSessionFile(id)
          reply(res, 200, { ok: true })
          return
        }
        if (req.method !== 'GET') {
          reply(res, 405, { error: 'only GET, PUT and DELETE are supported' })
          return
        }
        const session = await readSessionFile(id)
        if (session === undefined) {
          reply(res, 404, { error: 'no such session' })
          return
        }
        reply(res, 200, session)
        return
      }

      reply(res, 404, { error: 'not found' })
    } catch (error) {
      reply(res, 500, { error: String(error?.message ?? error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle }),
    'my-deepseek: conversation store'
  )
}
