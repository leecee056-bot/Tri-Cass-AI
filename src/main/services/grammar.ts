export const GRAMMAR_TOOLS = [
  'write_file',
  'edit_file',
  'apply_diff',
  'read_file',
  'list_dir',
  'run',
  'search_content',
  'search_files',
  'search_knowledge',
  'apply_template',
  'generate_image',
  'generate_ascii',
  'restore_checkpoint',
  'save_plan',
  'finish'
] as const

/** Tools allowed in Plan mode (no arbitrary file mutation). */
export const PLAN_MODE_TOOLS = new Set<string>([
  'read_file',
  'list_dir',
  'search_content',
  'search_files',
  'search_knowledge',
  'save_plan',
  'finish'
])

export const MUTATING_TOOLS = new Set<string>([
  'write_file',
  'edit_file',
  'apply_diff',
  'run',
  'apply_template',
  'generate_image',
  'generate_ascii',
  'restore_checkpoint'
])

export type GrammarToolName = (typeof GRAMMAR_TOOLS)[number]

export type GrammarCall = {
  tool: GrammarToolName
  args: Record<string, string>
}

export type ParseGrammarResult =
  | { kind: 'call'; call: GrammarCall }
  | { kind: 'unknown_tool'; tool: string; raw: string }
  | { kind: 'missing_args'; tool: string; missing: string[]; raw: string }
  | { kind: 'invalid'; reason: string }

/** Default max tool steps; overridable via ChatConfig.maxAgentSteps or TRI_CASS_MAX_AGENT_STEPS. */
export const MAX_GRAMMAR_STEPS = 12

/** Identical error observation count before stuck stop (Cline-class). */
export const STUCK_ERROR_LIMIT = 3

const REQUIRED_ARGS: Partial<Record<GrammarToolName, string[]>> = {
  write_file: ['path', 'content'],
  edit_file: ['path', 'old', 'new'],
  apply_diff: ['diff'],
  read_file: ['path'],
  run: ['command'],
  search_content: ['query'],
  search_files: ['query'],
  search_knowledge: ['query'],
  apply_template: ['id'],
  generate_image: ['prompt'],
  restore_checkpoint: ['id'],
  save_plan: ['content'],
  finish: ['message']
}

export const GRAMMAR_SYSTEM = `You are Tri Cass AI, a local no-code coding agent. Reply with ONE JSON object only — no markdown fences, no prose.
Shape: {"tool":"<name>","args":{...}}
Tools (one per reply):
- write_file: args path, content — create/overwrite under the project folder
- edit_file: args path, old, new — replace a unique occurrence (fails if old matches 0 or 2+)
- apply_diff: args diff — apply a unified diff (---/+++ @@ hunks) under the project
- read_file: args path
- list_dir: args path ("" = project root)
- run: args command — run in project folder (node/npm/python preferred)
- search_content: args query — ripgrep-style content search (path:line:snippet)
- search_files: args query — filename search in project
- search_knowledge: args query
- apply_template: args id, name — copy a library template into the workspace
- generate_image: args prompt, size (512|768|1024) — local PNG writer
- generate_ascii: args text, font OR image — figlet / image→ASCII
- restore_checkpoint: args id — restore a prior checkpoint snapshot
- save_plan: args content — write .tri-cass/plan.md (Plan mode)
- finish: args message — done; message is shown to the user in plain English
Prefer relative paths. Prefer short files. Never require the user to open a code editor.
Refuse unsafe Android signing / Play Store credential requests clearly.
Never reply with prose. Never call finish until at least one write_file (or scaffold) has created a real file on disk (Act mode).
In Plan mode you may ONLY use read/list/search/save_plan/finish — no mutating tools until the user switches to Act (/code).
If asked to make a website/app/folder in Act mode, you MUST use write_file / apply_template / apply_diff — claiming “done” without tools is forbidden.
Call finish only when the project exists on disk (Act) or the plan is saved (Plan).`

const TOOL_SET = new Set<string>(GRAMMAR_TOOLS)

export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Legacy helper — returns a call only when fully valid. */
export function parseGrammarCall(text: string): GrammarCall | null {
  const r = parseGrammarReply(text)
  return r.kind === 'call' ? r.call : null
}

export function parseGrammarReply(text: string): ParseGrammarResult {
  const raw = extractJsonObject(text)
  if (!raw) return { kind: 'invalid', reason: 'no JSON object' }
  try {
    const obj = JSON.parse(raw) as { tool?: string; args?: Record<string, unknown> }
    if (!obj.tool || typeof obj.tool !== 'string') {
      return { kind: 'invalid', reason: 'missing tool field' }
    }
    if (!TOOL_SET.has(obj.tool)) {
      return { kind: 'unknown_tool', tool: obj.tool, raw }
    }
    const tool = obj.tool as GrammarToolName
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj.args || {})) {
      args[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
    const required = REQUIRED_ARGS[tool] || []
    // Empty string OK for write_file content, edit new, finish message.
    const allowEmpty =
      tool === 'write_file'
        ? new Set(['content'])
        : tool === 'edit_file'
          ? new Set(['new'])
          : tool === 'finish'
            ? new Set(['message'])
            : new Set<string>()
    const missingStrict = required.filter((k) => {
      if (!(k in args)) return true
      if (allowEmpty.has(k)) return false
      return args[k] === ''
    })
    if (missingStrict.length) {
      return { kind: 'missing_args', tool, missing: missingStrict, raw }
    }
    return { kind: 'call', call: { tool, args } }
  } catch {
    return { kind: 'invalid', reason: 'JSON parse failed' }
  }
}

export function resolveMaxAgentSteps(configMax?: number): number {
  const env = Number(process.env.TRI_CASS_MAX_AGENT_STEPS || '')
  if (Number.isFinite(env) && env > 0) return Math.min(64, Math.floor(env))
  if (typeof configMax === 'number' && configMax > 0) return Math.min(64, Math.floor(configMax))
  return MAX_GRAMMAR_STEPS
}
