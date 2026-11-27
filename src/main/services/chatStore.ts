import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatSession } from '../../shared/types'
import { sessionsPath, userDataRoot } from './paths'
import { mkdirSync } from 'node:fs'

function ensure(): void {
  mkdirSync(userDataRoot(), { recursive: true })
}

export function loadSessions(): ChatSession[] {
  try {
    if (!existsSync(sessionsPath())) return []
    const raw = JSON.parse(readFileSync(sessionsPath(), 'utf8')) as ChatSession[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  ensure()
  writeFileSync(sessionsPath(), JSON.stringify(sessions.slice(0, 80), null, 2), 'utf8')
}

export function createSession(title = 'New Chat'): ChatSession {
  const sessions = loadSessions()
  const session: ChatSession = {
    id: randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    kbPaths: []
  }
  sessions.unshift(session)
  saveSessions(sessions)
  return session
}

export function getSession(id: string): ChatSession | null {
  return loadSessions().find((s) => s.id === id) || null
}

export function updateSession(session: ChatSession): ChatSession {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === session.id)
  session.updatedAt = Date.now()
  if (idx >= 0) sessions[idx] = session
  else sessions.unshift(session)
  saveSessions(sessions)
  return session
}

export function deleteSession(id: string): void {
  saveSessions(loadSessions().filter((s) => s.id !== id))
}

export function appendMessage(
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  meta?: ChatMessage['meta']
): ChatSession {
  const session = getSession(sessionId) || createSession()
  if (session.id !== sessionId) {
    /* created new — shouldn't happen often */
  }
  const target = getSession(sessionId)
  const s = target || session
  s.messages.push({
    id: randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    meta
  })
  if (s.title === 'New Chat' && role === 'user') {
    s.title = content.slice(0, 48) || 'New Chat'
  }
  return updateSession(s)
}
