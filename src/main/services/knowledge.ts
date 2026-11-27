import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { KnowledgeHit } from '../../shared/types'
import { kbRoot, userDataRoot } from './paths'

const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.py',
  '.rs',
  '.go',
  '.yml',
  '.yaml',
  '.toml',
  '.csv',
  '.docx'
])

const EXCLUDE_DIR = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '__pycache__'])
const MAX_CORPUS_BYTES = 40 * 1024 * 1024

export const SUPPORTED_KB_TYPES =
  'txt, md, markdown, json, ts/tsx, js/jsx, css, html, py, yml/yaml, toml, csv (docx attempted as text; binary PDF limited)'

type Chunk = {
  source: string
  text: string
  mtime?: number
}

type KbIndex = {
  sources: string[]
  chunks: Chunk[]
  failures?: Array<{ path: string; reason: string }>
  scope?: 'chat' | 'workspace'
}

function indexPath(chatId: string): string {
  return join(kbRoot(chatId), 'index.json')
}

function workspaceKbId(): string {
  return '__workspace__'
}

function loadIndex(chatId: string): KbIndex {
  try {
    if (!existsSync(indexPath(chatId))) return { sources: [], chunks: [], failures: [] }
    return JSON.parse(readFileSync(indexPath(chatId), 'utf8')) as KbIndex
  } catch {
    return { sources: [], chunks: [], failures: [] }
  }
}

function saveIndex(chatId: string, index: KbIndex): void {
  writeFileSync(indexPath(chatId), JSON.stringify(index, null, 2), 'utf8')
}

function chunkText(text: string, size = 900): string[] {
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    parts.push(text.slice(i, i + size))
    i += size
  }
  return parts.length ? parts : ['']
}

function collectFiles(path: string, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 200) return
  let st
  try {
    st = statSync(path)
  } catch {
    return
  }
  if (st.isFile()) {
    if (TEXT_EXT.has(extname(path).toLowerCase()) && st.size < 2_000_000) out.push(path)
    return
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name.startsWith('.') || EXCLUDE_DIR.has(name)) continue
      collectFiles(join(path, name), out, depth + 1)
    }
  }
}

function corpusBytes(index: KbIndex): number {
  return index.chunks.reduce((n, c) => n + c.text.length, 0)
}

export type AttachProgress = { chatId: string; file: string; status: string; reason?: string }

export function attachKnowledge(
  chatId: string,
  paths: string[],
  onProgress?: (p: AttachProgress) => void
): { sources: string[]; added: number; failures: Array<{ path: string; reason: string }>; warned?: string } {
  const index = loadIndex(chatId)
  index.failures = index.failures || []
  const destDir = join(kbRoot(chatId), 'files')
  mkdirSync(destDir, { recursive: true })
  let added = 0
  const failures: Array<{ path: string; reason: string }> = []
  let warned: string | undefined

  for (const raw of paths) {
    const files: string[] = []
    collectFiles(raw, files)
    if (!files.length && existsSync(raw) && statSync(raw).isFile()) files.push(raw)

    for (const file of files) {
      const name = basename(file)
      onProgress?.({ chatId, file: name, status: 'embedding' })
      const dest = join(destDir, `${Date.now()}-${name}`)
      try {
        if (!TEXT_EXT.has(extname(file).toLowerCase())) {
          throw new Error(`Unsupported type ${extname(file)}. Supported: ${SUPPORTED_KB_TYPES}`)
        }
        copyFileSync(file, dest)
        const text = readFileSync(dest, 'utf8')
        const mtime = statSync(file).mtimeMs
        // replace existing chunks for same source name
        index.chunks = index.chunks.filter((c) => c.source !== name)
        for (const piece of chunkText(text)) {
          index.chunks.push({ source: name, text: piece, mtime })
        }
        if (!index.sources.includes(name)) index.sources.push(name)
        added++
        onProgress?.({ chatId, file: name, status: 'done' })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        failures.push({ path: name, reason })
        index.failures.push({ path: name, reason })
        onProgress?.({ chatId, file: name, status: 'failed', reason })
      }
      if (corpusBytes(index) > MAX_CORPUS_BYTES) {
        warned = `Knowledge corpus exceeds ~${Math.round(MAX_CORPUS_BYTES / 1024 / 1024)} MB — consider clearing old sources.`
      }
    }
  }

  saveIndex(chatId, index)
  return { sources: index.sources, added, failures, warned }
}

export function reindexKnowledge(chatId: string): { sources: string[]; chunks: number } {
  const index = loadIndex(chatId)
  const filesDir = join(kbRoot(chatId), 'files')
  if (!existsSync(filesDir)) return { sources: index.sources, chunks: index.chunks.length }
  const files = readdirSync(filesDir).map((n) => join(filesDir, n))
  index.chunks = []
  index.sources = []
  for (const file of files) {
    try {
      const name = basename(file).replace(/^\d+-/, '')
      const text = readFileSync(file, 'utf8')
      for (const piece of chunkText(text)) {
        index.chunks.push({ source: name, text: piece, mtime: statSync(file).mtimeMs })
      }
      if (!index.sources.includes(name)) index.sources.push(name)
    } catch {
      /* skip */
    }
  }
  saveIndex(chatId, index)
  return { sources: index.sources, chunks: index.chunks.length }
}

export function removeKnowledgeSources(chatId: string, names: string[]): string[] {
  const index = loadIndex(chatId)
  const set = new Set(names)
  index.sources = index.sources.filter((s) => !set.has(s))
  index.chunks = index.chunks.filter((c) => !set.has(c.source))
  saveIndex(chatId, index)
  return index.sources
}

export function listKnowledge(chatId: string): string[] {
  return loadIndex(chatId).sources
}

export function knowledgeFailures(chatId: string): Array<{ path: string; reason: string }> {
  return loadIndex(chatId).failures || []
}

export function clearKnowledge(chatId: string): void {
  saveIndex(chatId, { sources: [], chunks: [], failures: [] })
  const filesDir = join(kbRoot(chatId), 'files')
  if (existsSync(filesDir)) rmSync(filesDir, { recursive: true, force: true })
}

function score(query: string, text: string): number {
  const q = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  if (!q.length) return 0
  const hay = text.toLowerCase()
  let hits = 0
  for (const term of q) {
    if (hay.includes(term)) hits++
  }
  return hits / q.length
}

export function searchKnowledge(chatId: string, query: string, limit = 4): KnowledgeHit[] {
  const indexes = [loadIndex(chatId)]
  // merge workspace-scoped KB when present
  const ws = loadIndex(workspaceKbId())
  if (ws.chunks.length) indexes.push(ws)
  const chunks = indexes.flatMap((i) => i.chunks)
  const scored = chunks
    .map((c) => ({
      path: c.source,
      excerpt: c.text.slice(0, 500),
      score: score(query, c.text)
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

export function knowledgeContext(chatId: string, query: string): string {
  const hits = searchKnowledge(chatId, query)
  if (!hits.length) return ''
  return (
    'Knowledge base excerpts for this chat:\n' +
    hits.map((h, i) => `[${i + 1}] (${h.path})\n${h.excerpt}`).join('\n\n')
  )
}

export function attachWorkspaceKnowledge(paths: string[]): ReturnType<typeof attachKnowledge> {
  return attachKnowledge(workspaceKbId(), paths)
}

export function listWorkspaceKnowledge(): string[] {
  return listKnowledge(workspaceKbId())
}

export function kbSupportedTypes(): string {
  return SUPPORTED_KB_TYPES
}

void userDataRoot
