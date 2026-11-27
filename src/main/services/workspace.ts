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
  return { root, projects }
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

export async function runCommand(
  cwd: string,
  command: string,
  timeoutMs = 60_000
): Promise<string> {
  // Local-first: shell via /bin/sh or cmd — capped timeout
  const isWin = process.platform === 'win32'
  try {
    const { stdout, stderr } = await execFileAsync(
      isWin ? 'cmd.exe' : '/bin/sh',
      isWin ? ['/c', command] : ['-c', command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CI: '1' }
      }
    )
    const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim()
    return out.slice(0, 6000) || '(no output)'
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return `error: ${(e.stderr || e.stdout || e.message || String(err)).slice(0, 4000)}`
  }
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
