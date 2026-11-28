import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { detectRuntimes, formatRuntimeGuidance } from './runtimes'
import { getWorkspaceRoot, isDangerousCommand, sandboxEnv } from './workspace'

export type ProjectKind = 'node' | 'python' | 'static' | 'unknown'

export type RunRecord = {
  id: string
  projectPath: string
  command: string
  cwd: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  timedOut?: boolean
  running: boolean
  stdout: string
  stderr: string
}

export type ProjectInspect = {
  projectPath: string
  kind: ProjectKind
  hasPackageJson: boolean
  hasPython: boolean
  startCommand: string | null
  installCommand: string | null
  files: string[]
  runtimes: ReturnType<typeof detectRuntimes>
}

const MAX_LOG = 200_000
const active = new Map<string, ChildProcess>()
let lastRun: RunRecord | null = null

function assertInWorkspace(projectPath: string): string {
  const root = resolve(getWorkspaceRoot())
  const abs = resolve(projectPath)
  const rel = relative(root, abs)
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Project path escapes workspace: ${projectPath}`)
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`Not a project directory: ${projectPath}`)
  }
  return abs
}

export function inspectProject(projectPath: string): ProjectInspect {
  const abs = assertInWorkspace(projectPath)
  const hasPackageJson = existsSync(join(abs, 'package.json'))
  const pyFiles = listFiles(abs, 2).filter((f) => f.endsWith('.py'))
  const hasPython = pyFiles.length > 0 || existsSync(join(abs, 'requirements.txt'))
  let kind: ProjectKind = 'unknown'
  let startCommand: string | null = null
  let installCommand: string | null = null

  if (hasPackageJson) {
    kind = 'node'
    installCommand = 'npm install'
    try {
      const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      if (pkg.scripts?.start) startCommand = 'npm start'
      else if (pkg.scripts?.dev) startCommand = 'npm run dev'
      else startCommand = 'npm start'
    } catch {
      startCommand = 'npm start'
    }
  } else if (hasPython) {
    kind = 'python'
    const main =
      pyFiles.find((f) => /(^|\/)main\.py$/.test(f)) ||
      pyFiles.find((f) => /(^|\/)app\.py$/.test(f)) ||
      pyFiles[0]
    startCommand = main ? `python3 ${main}` : 'python3 -c "print(\'no main.py\')"'
  } else if (existsSync(join(abs, 'index.html'))) {
    kind = 'static'
    startCommand = 'python3 -m http.server 4173'
  }

  return {
    projectPath: abs,
    kind,
    hasPackageJson,
    hasPython,
    startCommand,
    installCommand,
    files: listFiles(abs, 3).slice(0, 80),
    runtimes: detectRuntimes()
  }
}

function listFiles(root: string, depth: number, dir = root, out: string[] = []): string[] {
  if (depth < 0 || out.length >= 80) return out
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (st.isDirectory()) listFiles(root, depth - 1, full, out)
      else out.push(relative(root, full).split(sep).join('/'))
    } catch {
      /* skip */
    }
  }
  return out
}

export function getLastRun(): RunRecord | null {
  return lastRun
}

export function isRunActive(id?: string): boolean {
  if (id) return active.has(id)
  return active.size > 0
}

export function stopProjectRun(id?: string): { ok: boolean; stopped: string[] } {
  const stopped: string[] = []
  const stopOne = (runId: string, child: ChildProcess) => {
    try {
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 1500)
      stopped.push(runId)
    } catch {
      /* ignore */
    }
    active.delete(runId)
    if (lastRun && lastRun.id === runId) {
      lastRun.running = false
      lastRun.endedAt = Date.now()
      lastRun.exitCode = lastRun.exitCode ?? 130
      lastRun.stderr = (lastRun.stderr || '') + '\n[stopped by user]\n'
    }
  }
  if (id && active.has(id)) {
    stopOne(id, active.get(id)!)
  } else {
    for (const [runId, child] of [...active.entries()]) stopOne(runId, child)
  }
  return { ok: stopped.length > 0, stopped }
}

export type RunAction = 'install' | 'start' | 'custom'

export async function startProjectRun(
  projectPath: string,
  action: RunAction,
  opts?: {
    command?: string
    timeoutMs?: number
    onChunk?: (chunk: { stream: 'stdout' | 'stderr' | 'system'; text: string }) => void
  }
): Promise<RunRecord> {
  const abs = assertInWorkspace(projectPath)
  const info = inspectProject(abs)
  const rt = info.runtimes

  let command: string
  if (action === 'install') {
    if (!info.installCommand) throw new Error('No package.json — npm install not available')
    if (!rt.node.ok) throw new Error(formatRuntimeGuidance(rt))
    command = info.installCommand
  } else if (action === 'start') {
    if (!info.startCommand) throw new Error('No start command detected for this project')
    if (info.kind === 'node' && !rt.node.ok) throw new Error(formatRuntimeGuidance(rt))
    if ((info.kind === 'python' || info.kind === 'static') && !rt.python.ok) {
      throw new Error(formatRuntimeGuidance(rt))
    }
    command = info.startCommand
  } else {
    command = (opts?.command || '').trim()
    if (!command) throw new Error('Custom command required')
  }

  if (isDangerousCommand(command)) {
    throw new Error(`Blocked dangerous command: ${command}`)
  }

  // Only one long-running start at a time per process table (stop previous)
  if (action === 'start' && active.size) stopProjectRun()

  const id = `run-${Date.now()}`
  const timeoutMs =
    opts?.timeoutMs ??
    (action === 'install' ? 180_000 : action === 'start' ? 0 : 60_000)

  const record: RunRecord = {
    id,
    projectPath: abs,
    command,
    cwd: abs,
    startedAt: Date.now(),
    running: true,
    stdout: '',
    stderr: ''
  }
  lastRun = record

  const isWin = process.platform === 'win32'
  const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', command] : ['-c', command], {
    cwd: abs,
    env: sandboxEnv(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  active.set(id, child)
  opts?.onChunk?.({ stream: 'system', text: `[cwd ${abs}]\n$ ${command}\n` })

  const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
    const text = String(chunk)
    if (stream === 'stdout') {
      record.stdout = (record.stdout + text).slice(-MAX_LOG)
    } else {
      record.stderr = (record.stderr + text).slice(-MAX_LOG)
    }
    opts?.onChunk?.({ stream, text })
  }

  child.stdout.on('data', (c) => append('stdout', c))
  child.stderr.on('data', (c) => append('stderr', c))

  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      record.timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }, timeoutMs)
  }

  return await new Promise<RunRecord>((resolvePromise) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      lastRun = { ...record }
      resolvePromise({ ...record })
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      active.delete(id)
      record.running = false
      record.endedAt = Date.now()
      record.exitCode = 1
      record.stderr += `\n${err.message}\n`
      opts?.onChunk?.({ stream: 'system', text: `error: ${err.message}\n` })
      settle()
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      active.delete(id)
      record.running = false
      record.endedAt = Date.now()
      record.exitCode = code
      const line = `[exit ${code ?? '?'}]${record.timedOut ? ' [timeout]' : ''}\n`
      opts?.onChunk?.({ stream: 'system', text: line })
      settle()
    })

    // For start action: return once spawned so UI can show Stop while process runs
    if (action === 'start') {
      setTimeout(() => {
        if (record.running) settle()
      }, 300)
    }
  })
}

export function readProjectFile(projectPath: string, rel: string): { ok: boolean; text?: string; error?: string } {
  const abs = assertInWorkspace(projectPath)
  const full = resolve(abs, rel)
  const relCheck = relative(abs, full)
  if (relCheck.startsWith(`..${sep}`) || relCheck === '..') {
    return { ok: false, error: 'Path escapes project' }
  }
  try {
    if (!existsSync(full) || !statSync(full).isFile()) return { ok: false, error: 'Not a file' }
    const st = statSync(full)
    if (st.size > 400_000) return { ok: false, error: 'File too large to preview' }
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|woff2?)$/i.test(full)) {
      return { ok: false, error: 'Binary preview not supported' }
    }
    return { ok: true, text: readFileSync(full, 'utf8') }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

void basename
