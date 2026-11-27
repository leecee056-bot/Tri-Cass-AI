import type { ChatMessage, OllamaModel, OllamaStatus, PullProgress } from '../../shared/types'
import { loadPrefs } from './paths'

export function ollamaBase(): string {
  const fromEnv = process.env.OLLAMA_HOST?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  try {
    const url = loadPrefs().config.ollamaUrl?.replace(/\/$/, '')
    if (url) return url
  } catch {
    /* ignore */
  }
  return 'http://127.0.0.1:11434'
}

const OLLAMA = (): string => ollamaBase()

export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${OLLAMA()}/api/tags`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) {
      return { ok: false, detail: `Ollama HTTP ${res.status}`, models: [] }
    }
    const data = (await res.json()) as {
      models?: Array<{ name: string; size?: number; modified_at?: string }>
    }
    const models: OllamaModel[] = (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at
    }))
    return { ok: true, detail: `Connected · ${OLLAMA()}`, models }
  } catch {
    return {
      ok: false,
      detail: `Ollama unreachable at ${OLLAMA()}. Install from https://ollama.com and start it.`,
      models: []
    }
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const status = await ollamaStatus()
  return status.models
}

export type ChatOpts = {
  model: string
  temperature?: number
  topP?: number
  maxTokens?: number
  system?: string
  format?: 'json'
  signal?: AbortSignal
}

function toOllamaMessages(
  messages: Array<{ role: string; content: string }>,
  system?: string
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = []
  if (system?.trim()) out.push({ role: 'system', content: system.trim() })
  for (const m of messages) {
    if (m.role === 'system') continue
    out.push({ role: m.role, content: m.content })
  }
  return out
}

export async function chatOnce(
  messages: Array<{ role: string; content: string }>,
  opts: ChatOpts
): Promise<string> {
  const payload: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    messages: toOllamaMessages(messages, opts.system),
    options: {
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 0.9,
      num_predict: opts.maxTokens ?? 2048
    }
  }
  if (opts.format) payload.format = opts.format

  const res = await fetch(`${OLLAMA()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal ?? AbortSignal.timeout(180_000)
  })
  if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}`)
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content?.trim() || ''
}

export async function chatStream(
  messages: Array<{ role: string; content: string }>,
  opts: ChatOpts,
  onToken: (chunk: string) => void
): Promise<string> {
  const payload = {
    model: opts.model,
    stream: true,
    messages: toOllamaMessages(messages, opts.system),
    options: {
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 0.9,
      num_predict: opts.maxTokens ?? 2048
    }
  }

  const res = await fetch(`${OLLAMA()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal
  })
  if (!res.ok || !res.body) throw new Error(`Ollama stream HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed) as {
          message?: { content?: string }
          done?: boolean
        }
        const piece = json.message?.content || ''
        if (piece) {
          full += piece
          onToken(piece)
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }
  return full
}

export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${OLLAMA()}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal
  })
  if (!res.ok || !res.body) {
    onProgress({ model, status: 'error', error: `HTTP ${res.status}`, done: true })
    throw new Error(`Ollama pull HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed) as {
          status?: string
          completed?: number
          total?: number
          error?: string
        }
        const percent =
          json.total && json.completed
            ? Math.min(100, Math.round((json.completed / json.total) * 100))
            : undefined
        onProgress({
          model,
          status: json.status || 'pulling',
          completed: json.completed,
          total: json.total,
          percent,
          error: json.error,
          done: json.status === 'success'
        })
        if (json.error) throw new Error(json.error)
      } catch (err) {
        if (err instanceof Error && err.message && !err.message.includes('JSON')) throw err
      }
    }
  }
  onProgress({ model, status: 'success', percent: 100, done: true })
}

export function historyToPayload(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({ role: m.role, content: m.content }))
}
