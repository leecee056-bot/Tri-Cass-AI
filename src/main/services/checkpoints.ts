import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { userDataRoot } from './paths'

export type CheckpointMeta = {
  id: string
  at: number
  label: string
  projectPath: string
  files: string[]
}

function root(): string {
  const p = join(userDataRoot(), 'checkpoints')
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

function walkFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    try {
      if (statSync(full).isDirectory()) walkFiles(full, base, out)
      else out.push(full.slice(base.length + 1).replace(/\\/g, '/'))
    } catch {
      /* skip */
    }
  }
  return out
}

export function createCheckpoint(projectPath: string, label = 'before-write'): CheckpointMeta {
  const id = `cp-${Date.now()}`
  const dest = join(root(), id)
  mkdirSync(dest, { recursive: true })
  if (existsSync(projectPath)) {
    cpSync(projectPath, join(dest, 'tree'), { recursive: true })
  }
  const files = existsSync(join(dest, 'tree')) ? walkFiles(join(dest, 'tree')) : []
  const meta: CheckpointMeta = { id, at: Date.now(), label, projectPath, files }
  writeFileSync(join(dest, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  const ids = readdirSync(root()).sort().reverse()
  for (const old of ids.slice(20)) {
    rmSync(join(root(), old), { recursive: true, force: true })
  }
  return meta
}

export function listCheckpoints(): CheckpointMeta[] {
  return readdirSync(root())
    .map((id) => {
      try {
        return JSON.parse(readFileSync(join(root(), id, 'meta.json'), 'utf8')) as CheckpointMeta
      } catch {
        return null
      }
    })
    .filter((x): x is CheckpointMeta => Boolean(x))
    .sort((a, b) => b.at - a.at)
}

export function rollbackCheckpoint(id: string): { ok: boolean; error?: string; projectPath?: string } {
  const dir = join(root(), id)
  if (!existsSync(join(dir, 'meta.json'))) return { ok: false, error: 'Checkpoint missing' }
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CheckpointMeta
  const tree = join(dir, 'tree')
  if (!existsSync(tree)) return { ok: false, error: 'Checkpoint tree empty' }
  if (existsSync(meta.projectPath)) rmSync(meta.projectPath, { recursive: true, force: true })
  mkdirSync(meta.projectPath, { recursive: true })
  cpSync(tree, meta.projectPath, { recursive: true })
  return { ok: true, projectPath: meta.projectPath }
}
