import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'

export type CoherenceIssue = {
  file: string
  problem: string
}

const STUB_RE =
  /<(?:h1|p|title)[^>]*>\s*(?:hello(\s+world)?|test|todo|placeholder|coming\s+soon)\s*<\/(?:h1|p|title)>/i

/** True when HTML looks like a throwaway stub, not a real homepage. */
export function isStubHtml(html: string): boolean {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (stripped.length < 40) return true
  if (STUB_RE.test(html) && stripped.length < 120) return true
  if (!/<link[^>]+rel=["']stylesheet["']/i.test(html) && !/<style[\s\S]*?<\/style>/i.test(html)) {
    // bare markup with almost no structure
    if (!/<header|<nav|<main|<footer|<section/i.test(html) && stripped.length < 200) return true
  }
  return false
}

function walkHtmlFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git' || name === '.tri-cass') continue
    const full = join(root, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkHtmlFiles(full, out)
    else if (/\.html?$/i.test(name)) out.push(full)
  }
  return out
}

function extractAssetRefs(html: string): string[] {
  const refs: string[] = []
  const re =
    /(?:href|src)=["']([^"']+\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf))["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const ref = m[1]
    if (/^(https?:|data:|\/\/)/i.test(ref)) continue
    refs.push(ref.split('#')[0].split('?')[0])
  }
  return refs
}

/**
 * Verify every local CSS/JS (and image) reference from HTML resolves on disk,
 * and that index/home pages are not stubs. Also flags common style.css vs styles.css drift.
 */
export function checkScaffoldCoherence(projectPath: string): {
  ok: boolean
  issues: CoherenceIssue[]
} {
  const issues: CoherenceIssue[] = []
  const absRoot = resolve(projectPath)
  if (!existsSync(absRoot)) {
    return { ok: false, issues: [{ file: projectPath, problem: 'project path missing' }] }
  }

  const htmls = walkHtmlFiles(absRoot)
  if (!htmls.length) {
    // apps/python may have no HTML — still ok
    return { ok: true, issues: [] }
  }

  const cssNames = new Set<string>()
  for (const html of htmls) {
    let body = ''
    try {
      body = readFileSync(html, 'utf8')
    } catch {
      issues.push({ file: html, problem: 'unreadable' })
      continue
    }
    const base = html.replace(/\\/g, '/').split('/').pop() || ''
    if (/^(index|home)\.html?$/i.test(base) && isStubHtml(body)) {
      issues.push({ file: html, problem: 'homepage looks like a stub (too little content / missing layout)' })
    }
    for (const ref of extractAssetRefs(body)) {
      if (/\.css$/i.test(ref)) cssNames.add(ref.replace(/\\/g, '/'))
      const target = normalize(resolve(dirname(html), ref))
      if (!target.startsWith(absRoot)) {
        issues.push({ file: html, problem: `asset escapes project: ${ref}` })
        continue
      }
      if (!existsSync(target)) {
        issues.push({ file: html, problem: `missing asset ${ref}` })
      }
    }
  }

  // Orphan / competing stylesheet names commonly break small-model polish
  const styleCss = join(absRoot, 'style.css')
  const stylesCss = join(absRoot, 'styles.css')
  const assetsStyles = join(absRoot, 'assets/css/styles.css')
  const assetsStyle = join(absRoot, 'assets/css/style.css')
  if (existsSync(styleCss) && existsSync(stylesCss)) {
    issues.push({
      file: styleCss,
      problem: 'both style.css and styles.css exist — pick one coherent path'
    })
  }
  if (existsSync(assetsStyle) && existsSync(assetsStyles)) {
    issues.push({
      file: assetsStyle,
      problem: 'both assets/css/style.css and styles.css exist — pick one coherent path'
    })
  }
  // If pages only reference assets/css/styles.css but style.css was written at root
  if (cssNames.size && existsSync(styleCss) && ![...cssNames].some((c) => /(^|\/)style\.css$/i.test(c))) {
    issues.push({
      file: styleCss,
      problem: 'orphan style.css not referenced by any HTML'
    })
  }

  return { ok: issues.length === 0, issues }
}

/** Human-readable observation for the agent loop. */
export function formatCoherenceIssues(issues: CoherenceIssue[]): string {
  if (!issues.length) return 'coherence ok'
  return issues.map((i) => `${i.file}: ${i.problem}`).join('\n')
}
