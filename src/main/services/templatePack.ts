import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync
} from 'node:fs'
import { join, basename, dirname, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import * as tar from 'tar'
import { userDataRoot } from './paths'
import { getWorkspaceRoot, slugifyProject } from './workspace'
import { createCheckpoint, rollbackCheckpoint, listCheckpoints } from './checkpoints'

export type TemplateMeta = {
  id: string
  name: string
  category: string
  path: string
  license: string
  pack: string
  tags: string[]
  preview?: string
  favorite?: boolean
}

export type PackProgress = {
  status: string
  percent?: number
  done?: boolean
  error?: string
  count?: number
}

export type PackStatus = {
  installed: boolean
  packDir: string
  indexPath: string
  count: number
  target: number
  attribution: string[]
  favorites: string[]
  recent: string[]
}

const TARGET_COUNT = 1000
const PACK_NAME = 'awesome-tailwind-ui-templates-1000'
const PACK_REPO = 'stephen-taipei/awesome-tailwind-ui-templates-1000'
const PACK_TARBALL = `https://codeload.github.com/${PACK_REPO}/tar.gz/refs/heads/main`
const EXTRA_PACKS = [
  {
    name: 'learning-zone-website-templates',
    repo: 'learning-zone/website-templates',
    tarball: 'https://codeload.github.com/learning-zone/website-templates/tar.gz/refs/heads/master'
  },
  {
    name: 'dawidolko-Website-Templates',
    repo: 'dawidolko/Website-Templates',
    tarball: 'https://codeload.github.com/dawidolko/Website-Templates/tar.gz/refs/heads/main'
  }
]

const CATEGORY_MAP: Record<string, string> = {
  templates: 'landing',
  cards: 'cards',
  forms: 'forms',
  lists: 'lists',
  business: 'business',
  portfolio: 'portfolio',
  shop: 'shop',
  ecommerce: 'shop',
  dashboard: 'dashboard',
  blog: 'blog',
  admin: 'dashboard',
  restaurant: 'business',
  landing: 'landing'
}

let abortPack: AbortController | null = null

function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function packsRoot(): string {
  return ensure(join(userDataRoot(), 'template-packs'))
}

export function primaryPackDir(): string {
  return join(packsRoot(), PACK_NAME)
}

function indexPath(): string {
  return join(packsRoot(), 'index.json')
}

function metaPath(): string {
  return join(packsRoot(), 'meta.json')
}

type PackMetaFile = {
  favorites: string[]
  recent: string[]
}

function loadMeta(): PackMetaFile {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf8')) as PackMetaFile
  } catch {
    return { favorites: [], recent: [] }
  }
}

function saveMeta(m: PackMetaFile): void {
  writeFileSync(metaPath(), JSON.stringify(m, null, 2), 'utf8')
}

function guessCategory(rel: string): string {
  const parts = rel.toLowerCase().split(/[\\/]/)
  for (const p of parts) {
    if (CATEGORY_MAP[p]) return CATEGORY_MAP[p]
  }
  if (/shop|store|cart/i.test(rel)) return 'shop'
  if (/dash|admin/i.test(rel)) return 'dashboard'
  if (/portfolio|resume/i.test(rel)) return 'portfolio'
  if (/blog/i.test(rel)) return 'blog'
  if (/business|agency|corp/i.test(rel)) return 'business'
  return 'landing'
}

function guessTags(rel: string, category: string): string[] {
  const tags = new Set<string>([category])
  if (/tailwind/i.test(rel)) tags.add('tailwind')
  if (/bootstrap/i.test(rel)) tags.add('bootstrap')
  if (/responsive|mobile/i.test(rel)) tags.add('responsive')
  if (/dark/i.test(rel)) tags.add('dark')
  return [...tags]
}

function walkHtml(root: string, base = root, out: string[] = []): string[] {
  if (!existsSync(root)) return out
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git' || name === 'tests' || name === 'docs') continue
    const full = join(root, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkHtml(full, base, out)
    else if (/\.html?$/i.test(name)) out.push(full)
  }
  return out
}

/**
 * Each HTML file is a usable gallery entry (≥1000 target).
 * `path` points at the HTML file; Use copies the file (+ sibling assets) into workspace.
 */
export function buildIndex(packDirs: string[] = [primaryPackDir()]): TemplateMeta[] {
  const items: TemplateMeta[] = []
  const seen = new Set<string>()
  for (const packDir of packDirs) {
    if (!existsSync(packDir)) continue
    const pack = basename(packDir)
    const htmls = walkHtml(packDir)
    for (const html of htmls) {
      const rel = relative(packDir, html).replace(/\\/g, '/')
      // skip pack shell pages at repo root
      if (/^(index|catalog|explore|preview|home)\.html$/i.test(basename(html)) && rel.split('/').length <= 2) {
        if (!/templates|cards|forms|lists|components/i.test(rel)) continue
      }
      const id = `${pack}::${rel}`
      if (seen.has(id)) continue
      seen.add(id)
      const category = guessCategory(rel)
      const base = basename(html, '.html').replace(/[-_]+/g, ' ')
      const parent = basename(dirname(html)).replace(/[-_]+/g, ' ')
      const name = `${parent} / ${base}`.replace(/\b\w/g, (c) => c.toUpperCase())
      items.push({
        id,
        name,
        category,
        path: html,
        license: 'MIT (see pack attribution)',
        pack,
        tags: guessTags(rel, category),
        preview: html
      })
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(indexPath(), JSON.stringify({ version: 1, count: items.length, items }, null, 2), 'utf8')
  return items
}

export function loadIndex(): TemplateMeta[] {
  try {
    const raw = JSON.parse(readFileSync(indexPath(), 'utf8')) as { items: TemplateMeta[] }
    const meta = loadMeta()
    return (raw.items || []).map((t) => ({
      ...t,
      favorite: meta.favorites.includes(t.id)
    }))
  } catch {
    return []
  }
}

export function getPackStatus(): PackStatus {
  const items = loadIndex()
  return {
    installed: items.length >= TARGET_COUNT || (existsSync(primaryPackDir()) && items.length > 0),
    packDir: packsRoot(),
    indexPath: indexPath(),
    count: items.length,
    target: TARGET_COUNT,
    attribution: [
      `${PACK_REPO} (MIT) — primary ~1000 Tailwind UI templates`,
      'learning-zone/website-templates (free/MIT where marked)',
      'dawidolko/Website-Templates (free templates)'
    ],
    favorites: loadMeta().favorites,
    recent: loadMeta().recent
  }
}

async function downloadAndExtract(
  url: string,
  destDir: string,
  onProgress?: (p: PackProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  ensure(dirname(destDir))
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })
  const tmpParent = ensure(join(packsRoot(), '.tmp'))
  const stamp = String(Date.now())
  const extractTo = ensure(join(tmpParent, stamp))

  onProgress?.({ status: `Downloading ${basename(destDir)}…`, percent: 5 })
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const reader = res.body.getReader()
  const { Readable } = await import('node:stream')
  const nodeStream = Readable.from(
    (async function* () {
      while (true) {
        if (signal?.aborted) throw new Error('aborted')
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (total > 0) {
          onProgress?.({
            status: `Downloading ${basename(destDir)}…`,
            percent: Math.min(70, Math.round((received / total) * 70))
          })
        }
        yield value
      }
    })()
  )

  onProgress?.({ status: `Extracting ${basename(destDir)}…`, percent: 75 })
  await pipeline(nodeStream, createGunzip(), tar.x({ cwd: extractTo }))

  const kids = readdirSync(extractTo)
  const root = kids.length === 1 ? join(extractTo, kids[0]) : extractTo
  cpSync(root, destDir, { recursive: true })
  rmSync(extractTo, { recursive: true, force: true })
  onProgress?.({ status: `Installed ${basename(destDir)}`, percent: 90 })
}

export async function downloadTemplatePack(
  onProgress?: (p: PackProgress) => void,
  opts?: { extras?: boolean }
): Promise<PackStatus> {
  if (abortPack) {
    abortPack.abort()
  }
  abortPack = new AbortController()
  const signal = abortPack.signal
  try {
    onProgress?.({ status: 'Checking disk…', percent: 1 })
    await downloadAndExtract(PACK_TARBALL, primaryPackDir(), onProgress, signal)

    const dirs = [primaryPackDir()]
    if (opts?.extras !== false) {
      for (const extra of EXTRA_PACKS) {
        if (signal.aborted) throw new Error('aborted')
        try {
          const dest = join(packsRoot(), extra.name)
          await downloadAndExtract(extra.tarball, dest, onProgress, signal)
          dirs.push(dest)
        } catch (err) {
          // extras are best-effort; primary pack is enough for ≥1000
          onProgress?.({
            status: `Extra pack skipped: ${err instanceof Error ? err.message : String(err)}`,
            percent: 92
          })
        }
      }
    }

    onProgress?.({ status: 'Building index…', percent: 95 })
    const items = buildIndex(dirs)
    const status = getPackStatus()
    onProgress?.({
      status: items.length >= TARGET_COUNT ? 'Template library ready' : `Indexed ${items.length} templates`,
      percent: 100,
      done: true,
      count: items.length
    })
    return status
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress?.({ status: 'error', error: message, done: true })
    throw err
  } finally {
    abortPack = null
  }
}

export function cancelPackDownload(): boolean {
  if (!abortPack) return false
  abortPack.abort()
  abortPack = null
  return true
}

export function searchTemplates(opts: {
  query?: string
  category?: string
  tag?: string
  favoritesOnly?: boolean
  offset?: number
  limit?: number
}): { total: number; items: TemplateMeta[]; categories: Record<string, number> } {
  let items = loadIndex()
  const meta = loadMeta()
  const categories: Record<string, number> = {}
  for (const t of items) {
    categories[t.category] = (categories[t.category] || 0) + 1
  }
  const q = (opts.query || '').trim().toLowerCase()
  if (q) {
    items = items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((x) => x.includes(q)) ||
        t.id.toLowerCase().includes(q)
    )
  }
  if (opts.category && opts.category !== 'all') {
    items = items.filter((t) => t.category === opts.category)
  }
  if (opts.tag) {
    items = items.filter((t) => t.tags.includes(opts.tag!))
  }
  if (opts.favoritesOnly) {
    items = items.filter((t) => meta.favorites.includes(t.id))
  }
  // pin favorites first, then recent
  items.sort((a, b) => {
    const af = meta.favorites.includes(a.id) ? 1 : 0
    const bf = meta.favorites.includes(b.id) ? 1 : 0
    if (af !== bf) return bf - af
    return a.name.localeCompare(b.name)
  })
  const total = items.length
  const offset = opts.offset || 0
  const limit = opts.limit ?? 60
  return {
    total,
    items: items.slice(offset, offset + limit).map((t) => ({
      ...t,
      favorite: meta.favorites.includes(t.id)
    })),
    categories
  }
}

export function toggleFavorite(id: string): PackMetaFile {
  const meta = loadMeta()
  const i = meta.favorites.indexOf(id)
  if (i >= 0) meta.favorites.splice(i, 1)
  else meta.favorites.unshift(id)
  saveMeta(meta)
  return meta
}

export function randomTemplate(): TemplateMeta | null {
  const items = loadIndex()
  if (!items.length) return null
  return items[Math.floor(Math.random() * items.length)]
}

export function getTemplate(id: string): TemplateMeta | null {
  return loadIndex().find((t) => t.id === id) || null
}

export function useTemplate(
  id: string,
  projectName?: string
): { ok: boolean; projectPath?: string; files: string[]; error?: string; template?: TemplateMeta } {
  const tpl = getTemplate(id)
  if (!tpl) return { ok: false, files: [], error: 'Template not found' }
  if (!existsSync(tpl.path)) return { ok: false, files: [], error: `Template path missing: ${tpl.path}` }

  const title = projectName?.trim() || tpl.name
  const root = getWorkspaceRoot()
  let slug = slugifyProject(title)
  let dest = join(root, slug)
  let n = 2
  while (existsSync(dest)) {
    dest = join(root, `${slug}-${n++}`)
  }
  ensure(dest)
  // checkpoint empty dest parent for undo-after-apply
  const cp = createCheckpoint(dest, `before-template-${tpl.id}`)

  const src = tpl.path
  const srcStat = statSync(src)
  if (srcStat.isDirectory()) {
    cpSync(src, dest, { recursive: true })
  } else {
    // Copy the HTML as index.html plus sibling assets in the same folder
    const srcDir = dirname(src)
    const htmlName = basename(src)
    for (const name of readdirSync(srcDir)) {
      const full = join(srcDir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        // copy shallow asset dirs commonly referenced (css/js/images/assets)
        if (/^(css|js|img|images|assets|fonts|static)$/i.test(name)) {
          cpSync(full, join(dest, name), { recursive: true })
        }
        continue
      }
      if (name === htmlName) {
        cpSync(full, join(dest, 'index.html'))
      } else if (/\.(css|js|mjs|map|svg|png|jpe?g|gif|webp|woff2?|ttf|ico)$/i.test(name)) {
        cpSync(full, join(dest, name))
      } else if (/\.html?$/i.test(name) && name !== htmlName) {
        // skip other sibling templates in a shared folder
        continue
      } else if (/\.(md|json|txt)$/i.test(name)) {
        cpSync(full, join(dest, name))
      }
    }
    if (!existsSync(join(dest, 'index.html'))) {
      cpSync(src, join(dest, 'index.html'))
    }
  }

  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(dest)

  const meta = loadMeta()
  meta.recent = [id, ...meta.recent.filter((x) => x !== id)].slice(0, 24)
  saveMeta(meta)

  writeFileSync(
    join(dest, 'TRI_CASS_TEMPLATE.json'),
    JSON.stringify(
      {
        templateId: tpl.id,
        name: tpl.name,
        category: tpl.category,
        pack: tpl.pack,
        license: tpl.license,
        appliedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  )
  files.push(join(dest, 'TRI_CASS_TEMPLATE.json'))

  return { ok: true, projectPath: dest, files, template: tpl, checkpointId: cp.id } as {
    ok: boolean
    projectPath?: string
    files: string[]
    error?: string
    template?: TemplateMeta
    checkpointId?: string
  }
}

export function undoLastTemplateApply(): { ok: boolean; error?: string; projectPath?: string } {
  const cps = listCheckpoints().filter((c) => c.label.startsWith('before-template-'))
  if (!cps.length) return { ok: false, error: 'No template checkpoint' }
  return rollbackCheckpoint(cps[0].id)
}

export function estimatePackDiskMb(): number {
  return 180 // approximate for primary + extras
}

export { TARGET_COUNT }
