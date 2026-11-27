import figlet from 'figlet'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { getWorkspaceRoot, slugifyProject } from './workspace'

/** Bundled figlet fonts we expose in the UI (≥10). */
export const ASCII_FONTS = [
  'Standard',
  'Big',
  'Slant',
  'Doom',
  'Small',
  'Banner',
  'Block',
  'Digital',
  'Isometric1',
  'Larry 3D',
  'ANSI Shadow',
  'Big Money-ne',
  'Cyberlarge',
  'Letters'
]

const RAMP = ' .:-=+*#%@'

export function listAsciiFonts(): string[] {
  try {
    const all = figlet.fontsSync() as string[]
    const preferred = ASCII_FONTS.filter((f) => all.includes(f))
    return preferred.length >= 10
      ? preferred
      : [...preferred, ...all.filter((f) => !preferred.includes(f))].slice(0, 24)
  } catch {
    return [...ASCII_FONTS]
  }
}

export function textToAscii(text: string, font = 'Standard'): { ok: boolean; ascii: string; error?: string } {
  try {
    // figlet font names are a wide string union; accept runtime names from listAsciiFonts()
    const ascii = figlet.textSync(text || 'Tri Cass', {
      font: font as 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    })
    return { ok: true, ascii }
  } catch {
    try {
      const ascii = figlet.textSync(text || 'Tri Cass', { font: 'Standard' })
      return { ok: true, ascii }
    } catch (err2) {
      return { ok: false, ascii: '', error: err2 instanceof Error ? err2.message : String(err2) }
    }
  }
}

/** Image → ASCII (local; similar role to get-ascii-image / ascii-art). */
export function imageToAscii(
  imagePath: string,
  maxWidth = 80
): { ok: boolean; ascii: string; error?: string } {
  try {
    const buf = readFileSync(imagePath)
    const png = PNG.sync.read(buf)
    const scale = Math.max(1, Math.floor(png.width / maxWidth))
    const w = Math.floor(png.width / scale)
    const h = Math.floor(png.height / (scale * 2)) // aspect for monospace
    const lines: string[] = []
    for (let y = 0; y < h; y++) {
      let line = ''
      for (let x = 0; x < w; x++) {
        const sx = Math.min(png.width - 1, x * scale)
        const sy = Math.min(png.height - 1, y * scale * 2)
        const idx = (png.width * sy + sx) << 2
        const r = png.data[idx]
        const g = png.data[idx + 1]
        const b = png.data[idx + 2]
        const a = png.data[idx + 3] / 255
        const lum = ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * a
        const i = Math.min(RAMP.length - 1, Math.floor(lum * (RAMP.length - 1)))
        line += RAMP[i]
      }
      lines.push(line)
    }
    return { ok: true, ascii: lines.join('\n') }
  } catch (err) {
    return { ok: false, ascii: '', error: err instanceof Error ? err.message : String(err) }
  }
}

export function saveAscii(
  ascii: string,
  name = 'ascii-art'
): { ok: boolean; path?: string; error?: string } {
  try {
    const dir = join(getWorkspaceRoot(), 'ascii')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const path = join(dir, `${slugifyProject(name)}-${Date.now()}.txt`)
    writeFileSync(path, ascii, 'utf8')
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Optional: render ASCII string into a simple PNG (monospace blocks). */
export function asciiToPng(
  ascii: string,
  outName = 'ascii'
): { ok: boolean; path?: string; error?: string } {
  try {
    const lines = ascii.replace(/\r/g, '').split('\n')
    const cols = Math.max(1, ...lines.map((l) => l.length))
    const rows = lines.length
    const cell = 8
    const png = new PNG({ width: cols * cell, height: rows * cell })
    // fill dark
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 15
      png.data[i + 1] = 17
      png.data[i + 2] = 21
      png.data[i + 3] = 255
    }
    for (let y = 0; y < rows; y++) {
      const line = lines[y] || ''
      for (let x = 0; x < line.length; x++) {
        if (line[x] === ' ') continue
        for (let dy = 1; dy < cell - 1; dy++) {
          for (let dx = 1; dx < cell - 1; dx++) {
            const px = x * cell + dx
            const py = y * cell + dy
            const idx = (png.width * py + px) << 2
            png.data[idx] = 61
            png.data[idx + 1] = 154
            png.data[idx + 2] = 106
            png.data[idx + 3] = 255
          }
        }
      }
    }
    const dir = join(getWorkspaceRoot(), 'ascii')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const path = join(dir, `${slugifyProject(outName)}-${Date.now()}.png`)
    writeFileSync(path, PNG.sync.write(png))
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
