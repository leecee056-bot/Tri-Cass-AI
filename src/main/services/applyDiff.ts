import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Apply a minimal unified diff (single or multi-file) to disk.
 * Supports ---/+++ headers and @@ hunks with context / - / + lines.
 */
export function applyUnifiedDiff(
  projectRoot: string,
  resolvePath: (rel: string) => string,
  diffText: string
): { ok: boolean; text: string; paths: string[] } {
  const text = (diffText || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return { ok: false, text: 'apply_diff: empty patch', paths: [] }

  const files: Array<{ path: string; hunks: Hunk[] }> = []
  let current: { path: string; hunks: Hunk[] } | null = null
  let pendingOld: string | null = null

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('--- ')) {
      pendingOld = stripPath(line.slice(4))
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = stripPath(line.slice(4))
      const target = p === '/dev/null' ? pendingOld : p
      if (!target || target === '/dev/null') {
        return { ok: false, text: 'apply_diff: cannot delete-only patches yet', paths: [] }
      }
      current = { path: target, hunks: [] }
      files.push(current)
      pendingOld = null
      continue
    }
    if (line.startsWith('@@')) {
      if (!current) return { ok: false, text: 'apply_diff: hunk before file header', paths: [] }
      const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/.exec(line)
      if (!m) return { ok: false, text: `apply_diff: bad hunk header: ${line}`, paths: [] }
      const hunk: Hunk = {
        oldStart: Number(m[1]),
        oldCount: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newCount: m[4] ? Number(m[4]) : 1,
        lines: []
      }
      current.hunks.push(hunk)
      continue
    }
    if (!current || !current.hunks.length) continue
    const hunk = current.hunks[current.hunks.length - 1]
    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line === '\\ No newline at end of file') {
      hunk.lines.push(line)
    }
  }

  if (!files.length) return { ok: false, text: 'apply_diff: no file headers found (need ---/+++)', paths: [] }

  const touched: string[] = []
  for (const file of files) {
    const abs = resolvePath(file.path)
    let body = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
    const endsWithNl = body.endsWith('\n')
    let bodyLines = body.length ? body.replace(/\n$/, '').split('\n') : []
    if (body === '') bodyLines = []

    // Apply hunks from bottom to top so offsets stay valid
    const ordered = [...file.hunks].sort((a, b) => b.oldStart - a.oldStart)
    for (const hunk of ordered) {
      const result = applyHunk(bodyLines, hunk)
      if (!result.ok) {
        return { ok: false, text: `apply_diff: ${file.path}: ${result.error}`, paths: touched }
      }
      bodyLines = result.lines
    }

    let out = bodyLines.join('\n')
    if (endsWithNl || out.length) out += '\n'
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, out, 'utf8')
    touched.push(abs)
  }

  return {
    ok: true,
    text: `applied patch to ${touched.length} file(s): ${touched.join(', ')}`,
    paths: touched
  }
}

type Hunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

function stripPath(raw: string): string {
  let p = raw.trim()
  // strip a/ b/ prefixes and optional timestamps
  const tab = p.indexOf('\t')
  if (tab >= 0) p = p.slice(0, tab)
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2)
  return p
}

function applyHunk(
  bodyLines: string[],
  hunk: Hunk
): { ok: true; lines: string[] } | { ok: false; error: string } {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const line of hunk.lines) {
    if (line === '\\ No newline at end of file') continue
    const tag = line[0]
    const content = line.slice(1)
    if (tag === ' ') {
      oldLines.push(content)
      newLines.push(content)
    } else if (tag === '-') {
      oldLines.push(content)
    } else if (tag === '+') {
      newLines.push(content)
    }
  }

  // Prefer exact start index from hunk; fall back to search
  let start = Math.max(0, hunk.oldStart - 1)
  if (oldLines.length === 0) {
    // pure insert
    const out = [...bodyLines]
    out.splice(start, 0, ...newLines)
    return { ok: true, lines: out }
  }

  const matchesAt = (idx: number): boolean => {
    if (idx < 0 || idx + oldLines.length > bodyLines.length) return false
    for (let i = 0; i < oldLines.length; i++) {
      if (bodyLines[idx + i] !== oldLines[i]) return false
    }
    return true
  }

  if (!matchesAt(start)) {
    // search whole file for unique match
    const hits: number[] = []
    for (let i = 0; i <= bodyLines.length - oldLines.length; i++) {
      if (matchesAt(i)) hits.push(i)
    }
    if (hits.length === 0) {
      return { ok: false, error: `hunk context not found near line ${hunk.oldStart}` }
    }
    if (hits.length > 1) {
      return { ok: false, error: `hunk context matches ${hits.length} places — patch ambiguous` }
    }
    start = hits[0]
  }

  const out = [...bodyLines.slice(0, start), ...newLines, ...bodyLines.slice(start + oldLines.length)]
  return { ok: true, lines: out }
}
