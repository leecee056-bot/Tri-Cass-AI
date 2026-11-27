import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatSession } from '../../shared/types'
import { sessionsPath, userDataRoot } from './paths'

function ensure(): void {
  mkdirSync(userDataRoot(), { recursive: true })
}

/** Titles/phrases from old QA runs that must never reappear as seed history. */
const BANNED_CHAT_RE =
  /\b(v2\s*demo|demo\s*site|local\s*launch|quick\s*site|quick\s*app|open\s*launch)\b/i

function isBannedSession(session: ChatSession): boolean {
  if (BANNED_CHAT_RE.test(session.title || '')) return true
  if (BANNED_CHAT_RE.test(session.draft || '')) return true
  return (session.messages || []).some(
    (m) => BANNED_CHAT_RE.test(m.content || '') || BANNED_CHAT_RE.test(m.meta?.paths?.join(' ') || '')
  )
}

export function loadSessions(): ChatSession[] {
  try {
    if (!existsSync(sessionsPath())) return []
    const raw = JSON.parse(readFileSync(sessionsPath(), 'utf8')) as ChatSession[]
    if (!Array.isArray(raw)) return []
    const cleaned = raw.filter((s) => s && !isBannedSession(s))
    if (cleaned.length !== raw.length) {
      saveSessions(cleaned)
    }
    return cleaned
  } catch {
    return []
  }
}

/** Wipe all chats (fresh empty slate). */
export function resetSessionsToEmpty(): ChatSession {
  saveSessions([])
  return createSession('New Chat')
}

export function saveSessions(sessions: ChatSession[]): void {
  ensure()
  writeFileSync(sessionsPath(), JSON.stringify(sessions.slice(0, 120), null, 2), 'utf8')
}

export function createSession(title = 'New Chat'): ChatSession {
  const sessions = loadSessions()
  const session: ChatSession = {
    id: randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    kbPaths: [],
    pinned: false,
    archived: false,
    model: null,
    draft: '',
    agentMode: true
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
  // pinned first, then by updatedAt
  sessions.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
  saveSessions(sessions)
  return session
}

export function deleteSession(id: string): ChatSession[] {
  saveSessions(loadSessions().filter((s) => s.id !== id))
  return loadSessions()
}

export function renameSession(id: string, title: string): ChatSession | null {
  const s = getSession(id)
  if (!s) return null
  s.title = title.trim() || 'New Chat'
  return updateSession(s)
}

export function clearAllSessions(): void {
  saveSessions([])
}

export function appendMessage(
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  meta?: ChatMessage['meta']
): ChatSession {
  const s = getSession(sessionId) || createSession()
  const target = getSession(sessionId) || s
  target.messages.push({
    id: randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    meta
  })
  if (target.title === 'New Chat' && role === 'user') {
    target.title = content.slice(0, 48) || 'New Chat'
  }
  return updateSession(target)
}

export function setDraft(sessionId: string, draft: string): void {
  const s = getSession(sessionId)
  if (!s) return
  s.draft = draft
  updateSession(s)
}
