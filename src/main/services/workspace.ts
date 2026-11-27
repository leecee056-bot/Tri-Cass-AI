import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  statSync
} from 'node:fs'
import { join, resolve, normalize, relative, sep, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceInfo } from '../../shared/types'
import { defaultWorkspaceRoot, loadPrefs, savePrefs } from './paths'

const execFileAsync = promisify(execFile)

export function getWorkspaceRoot(): string {
  const prefs = loadPrefs()
  const root = prefs.workspaceRoot || defaultWorkspaceRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

export function setWorkspaceRoot(path: string): WorkspaceInfo {
  const resolved = resolve(normalize(path))
  if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true })
  const prefs = loadPrefs()
  prefs.workspaceRoot = resolved
  prefs.recentWorkspaces = [
    resolved,
    ...(prefs.recentWorkspaces || []).filter((p) => p !== resolved)
  ].slice(0, 12)
  savePrefs(prefs)
  return getWorkspaceInfo()
}

export function getWorkspaceInfo(): WorkspaceInfo {
  const root = getWorkspaceRoot()
  let projects: string[] = []
  try {
    projects = readdirSync(root).filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    projects = []
  }
  const prefs = loadPrefs()
  const recent = prefs.recentWorkspaces || []
  const pinned = prefs.pinnedWorkspaces || []
  let diskMb = 0
  let counted = 0
  const walkSize = (p: string) => {
    if (counted > 4000) return
    let entries: string[]
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
        if (st.isDirectory()) walkSize(full)
        else {
          diskMb += st.size
          counted++
        }
      } catch {
        /* skip */
      }
    }
  }
  walkSize(root)
  diskMb = Math.round((diskMb / (1024 * 1024)) * 10) / 10
  return { root, projects, recent, pinned, diskMb }
}

export function touchRecentWorkspace(path: string): void {
  const prefs = loadPrefs()
  prefs.recentWorkspaces = [path, ...(prefs.recentWorkspaces || []).filter((p) => p !== path)].slice(
    0,
    12
  )
  savePrefs(prefs)
}

export function pinWorkspace(path: string, pinned = true): void {
  const prefs = loadPrefs()
  const set = new Set(prefs.pinnedWorkspaces || [])
  if (pinned) set.add(path)
  else set.delete(path)
  prefs.pinnedWorkspaces = [...set]
  savePrefs(prefs)
}

export function createWorkspaceFolder(name: string): string {
  const path = join(getWorkspaceRoot(), slugifyProject(name))
  mkdirSync(path, { recursive: true })
  return path
}

export function resolveInWorkspace(raw: string, project?: string): string {
  const root = project ? join(getWorkspaceRoot(), project) : getWorkspaceRoot()
  const trimmed = (raw || '').trim()
  if (!trimmed || trimmed === '.' || trimmed === './') return root
  if (trimmed.startsWith('~')) return join(homedir(), trimmed.slice(1))
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    const abs = resolve(normalize(trimmed))
    assertInside(root, abs)
    return abs
  }
  const abs = resolve(root, trimmed)
  assertInside(root, abs)
  return abs
}

function assertInside(root: string, abs: string): void {
  const rel = relative(root, abs)
  if (rel.startsWith('..') || rel === '..' || abs === root + sep + '..') {
    // allow exact root
  }
  if (abs !== root && (rel.startsWith(`..${sep}`) || rel === '..')) {
    throw new Error(`Path escapes workspace: ${abs}`)
  }
}

export function listDir(path: string): string {
  const entries = readdirSync(path, { withFileTypes: true })
  return entries
    .slice(0, 80)
    .map((e) => `${e.isDirectory() ? 'dir' : 'file'} ${e.name}`)
    .join('\n')
}

export function readText(path: string, max = 8000): string {
  const body = readFileSync(path, 'utf8')
  return body.length > max ? body.slice(0, max) + '\n…[truncated]' : body
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

export function editText(path: string, oldStr: string, newStr: string): string {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`)
  const body = readFileSync(path, 'utf8')
  if (!body.includes(oldStr)) throw new Error('edit_file: old string not found')
  writeFileSync(path, body.replace(oldStr, newStr), 'utf8')
  return `edited ${path}`
}

const DANGEROUS =
  /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|format\s+[a-z]:|del\s+\/s|Remove-Item\s+-Recurse\s+-Force\s+C:\\)/i

const commandControllers = new Map<string, AbortController>()

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS.test(command)
}

export async function runCommand(
  cwd: string,
  command: string,
  timeoutMs = 60_000,
  opts?: { id?: string; autoApprove?: boolean; onChunk?: (chunk: string) => void }
): Promise<string> {
  if (isDangerousCommand(command) && !opts?.autoApprove) {
    return `error: blocked dangerous command (enable auto-approve in Settings to override carefully): ${command}`
  }
  const isWin = process.platform === 'win32'
  const id = opts?.id || `cmd-${Date.now()}`
  const ac = new AbortController()
  commandControllers.set(id, ac)
  try {
    opts?.onChunk?.(`[cwd ${cwd}]\n$ ${command}\n`)
    const { stdout, stderr } = await execFileAsync(
      isWin ? 'cmd.exe' : '/bin/sh',
      isWin ? ['/c', command] : ['-c', command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CI: '1' },
        signal: ac.signal
      }
    )
    const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim()
    const text = out.slice(0, 6000) || '(no output)'
    opts?.onChunk?.(text)
    return text
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; name?: string }
    if (e.name === 'AbortError' || /abort/i.test(e.message || '')) return 'error: command cancelled'
    return `error: ${(e.stderr || e.stdout || e.message || String(err)).slice(0, 4000)}`
  } finally {
    commandControllers.delete(id)
  }
}

export function cancelCommand(id?: string): boolean {
  if (id && commandControllers.has(id)) {
    commandControllers.get(id)!.abort()
    commandControllers.delete(id)
    return true
  }
  for (const [, ac] of commandControllers) ac.abort()
  commandControllers.clear()
  return true
}

/** Ignore large binaries when listing/reading for agent context. */
export function isIgnoredBinary(name: string, size: number): boolean {
  if (size > 2_000_000) return true
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|zip|gz|7z|exe|dll|so|dylib|pdf)$/i.test(name)
}

export function slugifyProject(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || `project-${Date.now()}`
  )
}

export function createProjectDir(name: string): string {
  const slug = slugifyProject(name)
  const path = join(getWorkspaceRoot(), slug)
  mkdirSync(path, { recursive: true })
  return path
}

export function openPathExternal(path: string): Promise<void> {
  // Dynamic import avoided — electron shell used from main index
  return Promise.resolve()
}

export { join }
