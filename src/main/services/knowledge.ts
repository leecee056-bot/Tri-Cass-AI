import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { KnowledgeHit } from '../../shared/types'
import { kbRoot } from './paths'

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
  '.csv'
])

type Chunk = {
  source: string
  text: string
}

type KbIndex = {
  sources: string[]
  chunks: Chunk[]
}

function indexPath(chatId: string): string {
  return join(kbRoot(chatId), 'index.json')
}

function loadIndex(chatId: string): KbIndex {
  try {
    if (!existsSync(indexPath(chatId))) return { sources: [], chunks: [] }
    return JSON.parse(readFileSync(indexPath(chatId), 'utf8')) as KbIndex
  } catch {
    return { sources: [], chunks: [] }
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
      if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue
      collectFiles(join(path, name), out, depth + 1)
    }
  }
}

export function attachKnowledge(chatId: string, paths: string[]): { sources: string[]; added: number } {
  const index = loadIndex(chatId)
  const destDir = join(kbRoot(chatId), 'files')
  mkdirSync(destDir, { recursive: true })
  let added = 0

  for (const raw of paths) {
    const files: string[] = []
    collectFiles(raw, files)
    if (!files.length && existsSync(raw) && statSync(raw).isFile()) files.push(raw)

    for (const file of files) {
      const name = basename(file)
      const dest = join(destDir, `${Date.now()}-${name}`)
      try {
        copyFileSync(file, dest)
        const text = readFileSync(dest, 'utf8')
        for (const piece of chunkText(text)) {
          index.chunks.push({ source: name, text: piece })
        }
        if (!index.sources.includes(name)) index.sources.push(name)
        added++
      } catch {
        /* skip binary / unreadable */
      }
    }
  }

  saveIndex(chatId, index)
  return { sources: index.sources, added }
}

export function listKnowledge(chatId: string): string[] {
  return loadIndex(chatId).sources
}

export function clearKnowledge(chatId: string): void {
  saveIndex(chatId, { sources: [], chunks: [] })
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
  const index = loadIndex(chatId)
  const scored = index.chunks
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
