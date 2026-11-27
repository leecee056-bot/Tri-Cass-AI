import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { userDataRoot, loadPrefs, savePrefs } from './paths'
import { BUILTIN_TEXTURES, DEFAULT_WALLPAPER_ID } from '../../shared/textures'
import type { WallpaperRef } from '../../shared/types'

function customDir(): string {
  const d = join(userDataRoot(), 'wallpapers')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function metaPath(): string {
  return join(customDir(), 'index.json')
}

type CustomMeta = { id: string; label: string; file: string }

function loadMeta(): CustomMeta[] {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf8')) as CustomMeta[]
  } catch {
    return []
  }
}

function saveMeta(list: CustomMeta[]): void {
  writeFileSync(metaPath(), JSON.stringify(list, null, 2), 'utf8')
}

export function listWallpapers(): WallpaperRef[] {
  const builtins: WallpaperRef[] = BUILTIN_TEXTURES.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'builtin',
    src: `./textures/${t.file}`
  }))
  const customs: WallpaperRef[] = loadMeta().map((m) => ({
    id: `custom:${m.id}`,
    label: m.label,
    kind: 'custom',
    src: join(customDir(), m.file)
  }))
  return [...builtins, ...customs]
}

export function addCustomWallpaper(
  sourcePath: string,
  label?: string
): { ok: boolean; wallpaper?: WallpaperRef; error?: string } {
  try {
    const ext = extname(sourcePath).toLowerCase()
    if (!/\.(png|jpe?g|webp|gif)$/i.test(ext)) {
      return { ok: false, error: 'Use a PNG, JPEG, WebP, or GIF image' }
    }
    const id = randomUUID().slice(0, 8)
    const file = `${id}${ext}`
    const dest = join(customDir(), file)
    copyFileSync(sourcePath, dest)
    const meta = loadMeta()
    const entry: CustomMeta = {
      id,
      label: label?.trim() || basename(sourcePath, ext),
      file
    }
    meta.unshift(entry)
    saveMeta(meta)
    const prefs = loadPrefs()
    prefs.config.customWallpaperIds = meta.map((m) => `custom:${m.id}`)
    prefs.config.wallpaperId = `custom:${id}`
    prefs.config.appearance = 'glass'
    savePrefs(prefs)
    return {
      ok: true,
      wallpaper: {
        id: `custom:${id}`,
        label: entry.label,
        kind: 'custom',
        src: dest
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function removeCustomWallpaper(id: string): { ok: boolean; error?: string } {
  const raw = id.replace(/^custom:/, '')
  const meta = loadMeta()
  const hit = meta.find((m) => m.id === raw)
  if (!hit) return { ok: false, error: 'Custom wallpaper not found' }
  try {
    unlinkSync(join(customDir(), hit.file))
  } catch {
    /* ignore missing file */
  }
  const next = meta.filter((m) => m.id !== raw)
  saveMeta(next)
  const prefs = loadPrefs()
  prefs.config.customWallpaperIds = next.map((m) => `custom:${m.id}`)
  if (prefs.config.wallpaperId === `custom:${raw}`) {
    prefs.config.wallpaperId = DEFAULT_WALLPAPER_ID
  }
  savePrefs(prefs)
  return { ok: true }
}

/** Data URL for any wallpaper (builtin from pack path or custom disk). */
export function wallpaperDataUrl(
  id: string,
  builtinRoot?: string
): { ok: boolean; url?: string; error?: string } {
  try {
    if (id.startsWith('custom:')) {
      const raw = id.slice(7)
      const hit = loadMeta().find((m) => m.id === raw)
      if (!hit) return { ok: false, error: 'missing custom' }
      const buf = readFileSync(join(customDir(), hit.file))
      const mime =
        extname(hit.file).toLowerCase() === '.png'
          ? 'image/png'
          : extname(hit.file).toLowerCase() === '.webp'
            ? 'image/webp'
            : 'image/jpeg'
      return { ok: true, url: `data:${mime};base64,${buf.toString('base64')}` }
    }
    const t = BUILTIN_TEXTURES.find((x) => x.id === id) || BUILTIN_TEXTURES[0]
    const roots = [
      builtinRoot,
      join(__dirname, '../../renderer/textures'),
      join(process.resourcesPath || '', 'textures'),
      join(process.cwd(), 'src/renderer/public/textures'),
      join(process.cwd(), 'build/textures')
    ].filter(Boolean) as string[]
    for (const root of roots) {
      const path = join(root, t.file)
      if (existsSync(path)) {
        const buf = readFileSync(path)
        return { ok: true, url: `data:image/png;base64,${buf.toString('base64')}` }
      }
    }
    // renderer relative path fallback
    return { ok: true, url: `./textures/${t.file}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function syncCustomIdsFromDisk(): string[] {
  const ids = loadMeta().map((m) => `custom:${m.id}`)
  // prune orphan files not in meta
  try {
    for (const name of readdirSync(customDir())) {
      if (name === 'index.json') continue
      if (!loadMeta().some((m) => m.file === name)) {
        try {
          unlinkSync(join(customDir(), name))
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return ids
}
