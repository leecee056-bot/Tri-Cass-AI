/**
 * Local image generation backend (procedural).
 *
 * Tri Cass AI ships a tiny offline renderer that always writes a real PNG —
 * no cloud, no Stable Diffusion weights required. Prompt text drives palette,
 * composition, and label. Documented so users know this is not SD/ONNX unless
 * they later point Settings at another backend.
 *
 * Backend id: `procedural-png@1` (standard) / `procedural-png@1-detailed` (higher quality preset).
 * Full SD/ONNX on 8GB is deferred — weights + install friction exceed this pass.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { getWorkspaceRoot, slugifyProject } from './workspace'
import { userDataRoot } from './paths'

export type ImageSizePreset = '512' | '768' | '1024'
export type ImageQuality = 'standard' | 'detailed'

export type ImageGenResult = {
  ok: boolean
  path?: string
  width?: number
  height?: number
  backend: string
  prompt: string
  quality?: ImageQuality
  error?: string
  safetyNote?: string
}

const HISTORY_PATH = () => join(userDataRoot(), 'image-history.json')

function hashPrompt(prompt: string): number {
  const h = createHash('sha256').update(prompt).digest()
  return h.readUInt32BE(0)
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function isUnsafe(prompt: string): boolean {
  return /\b(nsfw|nude|naked|porn|xxx|gore|child\s*porn)\b/i.test(prompt)
}

function drawLabel(png: PNG, text: string, color: [number, number, number]): void {
  // Tiny 3x5 bitmap font for A-Z 0-9 space
  const glyphs: Record<string, number[]> = {
    ' ': [0, 0, 0, 0, 0],
    A: [2, 5, 7, 5, 5],
    B: [6, 5, 6, 5, 6],
    C: [3, 4, 4, 4, 3],
    D: [6, 5, 5, 5, 6],
    E: [7, 4, 6, 4, 7],
    F: [7, 4, 6, 4, 4],
    G: [3, 4, 5, 5, 3],
    H: [5, 5, 7, 5, 5],
    I: [7, 2, 2, 2, 7],
    J: [1, 1, 1, 5, 2],
    K: [5, 5, 6, 5, 5],
    L: [4, 4, 4, 4, 7],
    M: [5, 7, 5, 5, 5],
    N: [5, 7, 7, 5, 5],
    O: [2, 5, 5, 5, 2],
    P: [6, 5, 6, 4, 4],
    Q: [2, 5, 5, 7, 3],
    R: [6, 5, 6, 5, 5],
    S: [3, 4, 2, 1, 6],
    T: [7, 2, 2, 2, 2],
    U: [5, 5, 5, 5, 2],
    V: [5, 5, 5, 2, 2],
    W: [5, 5, 5, 7, 5],
    X: [5, 5, 2, 5, 5],
    Y: [5, 5, 2, 2, 2],
    Z: [7, 1, 2, 4, 7],
    '0': [2, 5, 5, 5, 2],
    '1': [2, 6, 2, 2, 7],
    '2': [6, 1, 2, 4, 7],
    '3': [6, 1, 6, 1, 6],
    '4': [5, 5, 7, 1, 1],
    '5': [7, 4, 6, 1, 6],
    '6': [3, 4, 6, 5, 2],
    '7': [7, 1, 2, 2, 2],
    '8': [2, 5, 2, 5, 2],
    '9': [2, 5, 3, 1, 6],
    '-': [0, 0, 7, 0, 0],
    '.': [0, 0, 0, 0, 2]
  }
  const scale = Math.max(2, Math.floor(png.width / 280))
  const clean = text
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, '')
    .slice(0, 28)
  const startX = Math.floor(png.width * 0.08)
  const startY = Math.floor(png.height * 0.82)
  let cx = startX
  for (const ch of clean) {
    const g = glyphs[ch] || glyphs[' ']
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if ((g[row] >> (2 - col)) & 1) {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const x = cx + col * scale + dx
              const y = startY + row * scale + dy
              if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue
              const idx = (png.width * y + x) << 2
              png.data[idx] = color[0]
              png.data[idx + 1] = color[1]
              png.data[idx + 2] = color[2]
              png.data[idx + 3] = 255
            }
          }
        }
      }
    }
    cx += 4 * scale
    if (cx > png.width - 8 * scale) break
  }
}

export function generateLocalImage(
  prompt: string,
  size: ImageSizePreset = '512',
  outDir?: string,
  quality: ImageQuality = 'standard'
): ImageGenResult {
  const backend = quality === 'detailed' ? 'procedural-png@1-detailed' : 'procedural-png@1'
  const safetyNote =
    'Local procedural renderer (standard | detailed presets). Adult/NSFW blocked. Not Stable Diffusion — SD/ONNX deferred for 8GB install size.'
  if (!prompt.trim()) return { ok: false, backend, prompt, quality, error: 'Empty prompt', safetyNote }
  if (isUnsafe(prompt)) {
    return {
      ok: false,
      backend,
      prompt,
      quality,
      error: 'That prompt was blocked by the local safety filter.',
      safetyNote
    }
  }

  const dim = Number(size) || 512
  const seed = hashPrompt(prompt.trim().toLowerCase() + '|' + quality)
  const rand = mulberry32(seed)
  const png = new PNG({ width: dim, height: dim })

  const hue = Math.floor(rand() * 360)
  const hue2 = (hue + 40 + Math.floor(rand() * 80)) % 360
  const hue3 = (hue + 200) % 360
  const [r1, g1, b1] = hslToRgb(hue, 0.45, 0.16)
  const [r2, g2, b2] = hslToRgb(hue2, 0.55, 0.42)
  const [r3, g3, b3] = hslToRgb(hue3, 0.4, 0.28)
  const [ra, ga, ba] = hslToRgb((hue + 120) % 360, 0.65, 0.55)

  const detailed = quality === 'detailed'
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const t = y / dim
      const nx = x / dim
      const wave =
        Math.sin(nx * Math.PI * (2 + (detailed ? 3 : 0)) + seed * 0.0001) * (detailed ? 0.22 : 0.15)
      const ridge = detailed ? Math.sin((nx * 8 + t * 3) * Math.PI) * 0.08 : 0
      const mix = Math.min(1, Math.max(0, t + wave + ridge))
      const mist = detailed ? Math.sin((nx + t) * 12) * 0.04 : 0
      const idx = (dim * y + x) << 2
      const rr = r1 + (r2 - r1) * mix + (r3 - r1) * mist
      const gg = g1 + (g2 - g1) * mix + (g3 - g1) * mist
      const bb = b1 + (b2 - b1) * mix + (b3 - b1) * mist
      const grain = detailed ? (rand() - 0.5) * 10 : 0
      png.data[idx] = Math.max(0, Math.min(255, Math.round(rr + grain)))
      png.data[idx + 1] = Math.max(0, Math.min(255, Math.round(gg + grain)))
      png.data[idx + 2] = Math.max(0, Math.min(255, Math.round(bb + grain)))
      png.data[idx + 3] = 255
    }
  }

  const orbCount = detailed ? 12 : 5
  for (let i = 0; i < orbCount; i++) {
    const cx = Math.floor(rand() * dim)
    const cy = Math.floor(rand() * dim * 0.75)
    const rad = dim * (0.05 + rand() * (detailed ? 0.22 : 0.18))
    for (let y = Math.max(0, cy - rad); y < Math.min(dim, cy + rad); y++) {
      for (let x = Math.max(0, cx - rad); x < Math.min(dim, cx + rad); x++) {
        const d = Math.hypot(x - cx, y - cy) / rad
        if (d > 1) continue
        const a = (1 - d) * (1 - d) * (detailed ? 0.45 : 0.55)
        const idx = (dim * Math.floor(y) + Math.floor(x)) << 2
        png.data[idx] = Math.round(png.data[idx] * (1 - a) + ra * a)
        png.data[idx + 1] = Math.round(png.data[idx + 1] * (1 - a) + ga * a)
        png.data[idx + 2] = Math.round(png.data[idx + 2] * (1 - a) + ba * a)
      }
    }
  }

  if (detailed) {
    // Horizon band + vignette for a stronger composition
    const horizon = Math.floor(dim * (0.55 + rand() * 0.1))
    for (let x = 0; x < dim; x++) {
      for (let y = horizon; y < Math.min(dim, horizon + 3); y++) {
        const idx = (dim * y + x) << 2
        png.data[idx] = Math.min(255, png.data[idx] + 30)
        png.data[idx + 1] = Math.min(255, png.data[idx + 1] + 24)
        png.data[idx + 2] = Math.min(255, png.data[idx + 2] + 18)
      }
    }
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dx = x / dim - 0.5
        const dy = y / dim - 0.5
        const v = Math.min(1, Math.hypot(dx, dy) * 1.35)
        const dark = v * v * 0.35
        const idx = (dim * y + x) << 2
        png.data[idx] = Math.round(png.data[idx] * (1 - dark))
        png.data[idx + 1] = Math.round(png.data[idx + 1] * (1 - dark))
        png.data[idx + 2] = Math.round(png.data[idx + 2] * (1 - dark))
      }
    }
  }

  const label = prompt.trim().slice(0, 40)
  drawLabel(png, label, [245, 248, 252])

  const dir = outDir || join(getWorkspaceRoot(), 'generated-images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const slug = slugifyProject(prompt).slice(0, 40) || 'image'
  const path = join(dir, `${slug}-${quality}-${Date.now()}.png`)
  const buf = PNG.sync.write(png)
  writeFileSync(path, buf)

  try {
    const hist = existsSync(HISTORY_PATH())
      ? (JSON.parse(readFileSync(HISTORY_PATH(), 'utf8')) as Array<Record<string, unknown>>)
      : []
    hist.unshift({ prompt, path, width: dim, height: dim, at: Date.now(), backend, quality })
    writeFileSync(HISTORY_PATH(), JSON.stringify(hist.slice(0, 100), null, 2), 'utf8')
  } catch {
    /* ignore */
  }

  return { ok: true, path, width: dim, height: dim, backend, prompt, quality, safetyNote }
}

export function imageHistory(): Array<Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH(), 'utf8')) as Array<Record<string, unknown>>
  } catch {
    return []
  }
}

export function imageBackendHelp(): string {
  return [
    'Image backend: procedural-png@1 (+ detailed quality preset).',
    'Writes a real PNG locally from your prompt (palette, orbs, grain, vignette in detailed).',
    'No cloud API. Full SD/ONNX skipped on 8GB PCs this pass (download size / setup).',
    'NSFW prompts are blocked.'
  ].join('\n')
}
