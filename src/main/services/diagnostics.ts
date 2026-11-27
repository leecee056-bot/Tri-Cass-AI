import { cpus, freemem, totalmem, platform, arch, release, homedir } from 'node:os'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { userDataRoot, sessionsPath, prefsPath } from './paths'
import { getWorkspaceRoot } from './workspace'
import { getPackStatus } from './templatePack'
import { imageBackendHelp } from './imageGen'

export function detectRamGb(): number {
  return Math.round((totalmem() / (1024 ** 3)) * 10) / 10
}

export function detectFreeDiskRough(path = getWorkspaceRoot()): { freeGb?: number; note: string } {
  try {
    // Node 18.15+ has statfsSync
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as { statfsSync?: (p: string) => { bavail: number; bsize: number } }
    if (fs.statfsSync) {
      const s = fs.statfsSync(path)
      const freeGb = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
      return { freeGb, note: `${freeGb} GB free near workspace` }
    }
  } catch {
    /* ignore */
  }
  return { note: 'Free disk unavailable on this host API' }
}

export function folderSizeMb(path: string, maxFiles = 5000): number {
  let total = 0
  let n = 0
  const walk = (p: string) => {
    if (n > maxFiles) return
    let entries
    try {
      entries = readdirSync(p)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git') continue
      const full = join(p, name)
      try {
        const st = statSync(full)
        if (st.isDirectory()) walk(full)
        else {
          total += st.size
          n++
        }
      } catch {
        /* skip */
      }
    }
  }
  if (existsSync(path)) walk(path)
  return Math.round((total / (1024 * 1024)) * 10) / 10
}

export function buildDiagnostics(): string {
  const ram = detectRamGb()
  const free = freemem() / 1024 ** 3
  const disk = detectFreeDiskRough()
  const pack = getPackStatus()
  const lines = [
    'Tri Cass AI diagnostics',
    `Platform: ${platform()} ${arch()} ${release()}`,
    `CPU: ${cpus()[0]?.model || 'unknown'} × ${cpus().length}`,
    `RAM: ${ram} GB total · ${free.toFixed(1)} GB free`,
    `Disk: ${disk.note}`,
    `User data: ${userDataRoot()}`,
    `Prefs: ${prefsPath()} (${existsSync(prefsPath()) ? 'ok' : 'missing'})`,
    `Sessions: ${sessionsPath()} (${existsSync(sessionsPath()) ? 'ok' : 'missing'})`,
    `Workspace: ${getWorkspaceRoot()} (~${folderSizeMb(getWorkspaceRoot())} MB)`,
    `Home: ${homedir()}`,
    `Template pack: ${pack.count} / ${pack.target}`,
    imageBackendHelp().split('\n')[0],
    'Telemetry: off',
    'Code signing: unsigned portable build (honest note for Windows Defender SmartScreen)'
  ]
  return lines.join('\n')
}
