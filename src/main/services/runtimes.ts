import { execFileSync } from 'node:child_process'

export type RuntimeInfo = {
  node: { ok: boolean; version?: string; guidance?: string }
  python: { ok: boolean; version?: string; guidance?: string }
}

function tryVersion(bin: string, args: string[]): string | null {
  try {
    const out = execFileSync(bin, args, {
      timeout: 2500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return String(out || '').trim().split('\n')[0] || null
  } catch {
    return null
  }
}

/** Detect Node and Python on PATH — honest guidance when missing. */
export function detectRuntimes(): RuntimeInfo {
  const nodeVer = tryVersion('node', ['-v'])
  const pyVer =
    tryVersion('python3', ['--version']) ||
    tryVersion('python', ['--version'])
  return {
    node: nodeVer
      ? { ok: true, version: nodeVer }
      : {
          ok: false,
          guidance: 'Node.js not found. Install from https://nodejs.org then reopen Tri Cass AI.'
        },
    python: pyVer
      ? { ok: true, version: pyVer }
      : {
          ok: false,
          guidance:
            'Python not found. Install Python 3 from https://www.python.org then reopen Tri Cass AI.'
        }
  }
}

export function formatRuntimeGuidance(info: RuntimeInfo): string {
  const lines: string[] = []
  if (info.node.ok) lines.push(`Node: ${info.node.version}`)
  else lines.push(`Node: missing — ${info.node.guidance}`)
  if (info.python.ok) lines.push(`Python: ${info.python.version}`)
  else lines.push(`Python: missing — ${info.python.guidance}`)
  return lines.join('\n')
}
