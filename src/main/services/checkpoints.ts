import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  renameSync
} from 'node:fs'
import { join, resolve, relative, sep, dirname } from 'node:path'
import { userDataRoot } from './paths'
import { getWorkspaceRoot } from './workspace'

export type CheckpointMeta = {
  id: string
  at: number
  label: string
  projectPath: string
  files: string[]
  fileCount: number
  bytes?: number
  warning?: string
}

export const MAX_CHECKPOINTS = 20
export const CHECKPOINT_SIZE_WARN_BYTES = 50 * 1024 * 1024

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'])
const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp4',
  '.mp3',
  '.wav',
  '.zip',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.pdf'
])
const LARGE_FILE_BYTES = 2 * 1024 * 1024

function root(): string {
  const p = join(userDataRoot(), 'checkpoints')
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

function shouldSkipFile(name: string, full: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot >= 0 && SKIP_EXT.has(lower.slice(dot))) return true
  try {
    if (statSync(full).size > LARGE_FILE_BYTES) return true
  } catch {
    return true
  }
  return false
}

function walkFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (st.isDirectory()) walkFiles(full, base, out)
      else if (!shouldSkipFile(name, full)) {
        out.push(full.slice(base.length + 1).replace(/\\/g, '/'))
      }
    } catch {
      /* skip */
    }
  }
  return out
}

function copyFiltered(src: string, dest: string): { files: string[]; bytes: number } {
  mkdirSync(dest, { recursive: true })
  let bytes = 0
  const files = walkFiles(src)
  for (const rel of files) {
    const from = join(src, rel)
    const to = join(dest, rel)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
    try {
      bytes += statSync(to).size
    } catch {
      /* ignore */
    }
  }
  return { files, bytes }
}

function assertProjectInWorkspace(projectPath: string): void {
  const rootWs = resolve(getWorkspaceRoot())
  const abs = resolve(projectPath)
  const rel = relative(rootWs, abs)
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Checkpoint path escapes workspace: ${projectPath}`)
  }
}

export function createCheckpoint(projectPath: string, label = 'before-write'): CheckpointMeta {
  assertProjectInWorkspace(projectPath)
  const id = `cp-${Date.now()}`
  const dest = join(root(), id)
  mkdirSync(dest, { recursive: true })
  let files: string[] = []
  let bytes = 0
  if (existsSync(projectPath)) {
    const copied = copyFiltered(projectPath, join(dest, 'tree'))
    files = copied.files
    bytes = copied.bytes
  } else {
    mkdirSync(join(dest, 'tree'), { recursive: true })
  }
  let warning: string | undefined
  if (bytes >= CHECKPOINT_SIZE_WARN_BYTES) {
    warning = `Checkpoint large: ${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  }
  const meta: CheckpointMeta = {
    id,
    at: Date.now(),
    label,
    projectPath: resolve(projectPath),
    files,
    fileCount: files.length,
    bytes,
    warning
  }
  writeFileSync(join(dest, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  pruneCheckpoints()
  return meta
}

export function pruneCheckpoints(max = MAX_CHECKPOINTS): void {
  const ids = readdirSync(root())
    .filter((id) => id.startsWith('cp-'))
    .sort()
    .reverse()
  for (const old of ids.slice(max)) {
    rmSync(join(root(), old), { recursive: true, force: true })
  }
}

export function listCheckpoints(): CheckpointMeta[] {
  return readdirSync(root())
    .map((id) => {
      try {
        const raw = JSON.parse(readFileSync(join(root(), id, 'meta.json'), 'utf8')) as CheckpointMeta
        if (!raw.id || !raw.projectPath) return null
        return {
          ...raw,
          fileCount: raw.fileCount ?? raw.files?.length ?? 0
        }
      } catch {
        return null
      }
    })
    .filter((x): x is CheckpointMeta => Boolean(x))
    .sort((a, b) => b.at - a.at)
}

/**
 * Atomic restore: copy checkpoint tree to a sibling temp dir, then swap.
 * Corrupt / escaping checkpoints fail closed without mutating the project.
 */
export function rollbackCheckpoint(id: string): { ok: boolean; error?: string; projectPath?: string } {
  const dir = join(root(), id)
  if (!existsSync(join(dir, 'meta.json'))) return { ok: false, error: 'Checkpoint missing' }
  let meta: CheckpointMeta
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CheckpointMeta
  } catch {
    return { ok: false, error: 'Corrupt checkpoint meta (JSON)' }
  }
  if (!meta.projectPath || typeof meta.projectPath !== 'string') {
    return { ok: false, error: 'Corrupt checkpoint: missing projectPath' }
  }
  try {
    assertProjectInWorkspace(meta.projectPath)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const tree = join(dir, 'tree')
  if (!existsSync(tree)) return { ok: false, error: 'Checkpoint tree empty or missing' }

  const parent = join(meta.projectPath, '..')
  const staging = join(parent, `.tri-cass-restore-${id}-${Date.now()}`)
  const backup = join(parent, `.tri-cass-backup-${id}-${Date.now()}`)
  try {
    mkdirSync(staging, { recursive: true })
    cpSync(tree, staging, { recursive: true })
    if (existsSync(meta.projectPath)) {
      renameSync(meta.projectPath, backup)
    }
    renameSync(staging, meta.projectPath)
    if (existsSync(backup)) {
      rmSync(backup, { recursive: true, force: true })
    }
    return { ok: true, projectPath: meta.projectPath }
  } catch (err) {
    // best-effort undo staging
    try {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
      if (!existsSync(meta.projectPath) && existsSync(backup)) {
        renameSync(backup, meta.projectPath)
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: `Restore failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
