import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.tri-cass'
])

function loadIgnoreNames(root: string): Set<string> {
  const names = new Set<string>(SKIP_DIR)
  for (const file of ['.gitignore', '.tri-cassignore']) {
    const p = join(root, file)
    if (!existsSync(p)) continue
    try {
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.includes('/')) continue
        names.add(t.replace(/\/$/, ''))
      }
    } catch {
      /* ignore */
    }
  }
  return names
}

function walkFiles(root: string, skip: Set<string>, out: string[] = [], dir = root): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (skip.has(name)) continue
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (st.isDirectory()) walkFiles(root, skip, out, full)
      else if (st.isFile() && st.size <= 512_000) out.push(full)
    } catch {
      /* skip */
    }
  }
  return out
}

function isTexty(path: string): boolean {
  return /\.(txt|md|json|js|jsx|ts|tsx|mjs|cjs|css|html?|py|rs|go|java|kt|swift|yml|yaml|toml|ini|sh|bat|ps1|xml|svg|csv)$/i.test(
    path
  )
}

/** Filename search (basename substring, case-insensitive). */
export function searchFilenames(
  root: string,
  query: string,
  limit = 40
): Array<{ path: string; name: string }> {
  if (!existsSync(root) || !query.trim()) return []
  const skip = loadIgnoreNames(root)
  const q = query.trim().toLowerCase()
  const hits: Array<{ path: string; name: string }> = []
  for (const full of walkFiles(root, skip)) {
    const name = full.split(/[/\\]/).pop() || ''
    if (name.toLowerCase().includes(q)) {
      hits.push({ path: full, name })
      if (hits.length >= limit) break
    }
  }
  return hits
}

/** Ripgrep-style content search — path + line snippets. */
export function searchContent(
  root: string,
  query: string,
  limit = 40
): Array<{ path: string; line: number; snippet: string }> {
  if (!existsSync(root) || !query.trim()) return []
  const skip = loadIgnoreNames(root)
  const q = query.trim().toLowerCase()
  const hits: Array<{ path: string; line: number; snippet: string }> = []
  for (const full of walkFiles(root, skip)) {
    if (!isTexty(full)) continue
    let body: string
    try {
      body = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const lines = body.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({
          path: full,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160)
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

export function formatSearchHits(
  hits: Array<{ path: string; line?: number; snippet?: string; name?: string }>,
  root: string
): string {
  if (!hits.length) return '(no matches)'
  return hits
    .map((h) => {
      const rel = relative(root, h.path).split(sep).join('/')
      if (h.line != null) return `${rel}:${h.line}: ${h.snippet || ''}`
      return rel
    })
    .join('\n')
}
