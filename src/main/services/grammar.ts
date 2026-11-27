export const GRAMMAR_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'list_dir',
  'run',
  'search_knowledge',
  'finish'
] as const

export type GrammarToolName = (typeof GRAMMAR_TOOLS)[number]

export type GrammarCall = {
  tool: GrammarToolName
  args: Record<string, string>
}

export const MAX_GRAMMAR_STEPS = 12

export const GRAMMAR_SYSTEM = `You are Tri Cass AI, a local coding agent. Reply with ONE JSON object only — no markdown fences, no prose.
Shape: {"tool":"<name>","args":{...}}
Tools (one per reply):
- write_file: args path, content — create/overwrite under the project folder
- edit_file: args path, old, new — replace first occurrence
- read_file: args path
- list_dir: args path ("" = project root)
- run: args command — run in project folder (node/npm/python preferred)
- search_knowledge: args query
- finish: args message — done; message is shown to the user
Prefer relative paths. Prefer short files. Call finish when the project exists on disk.`

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

export function parseGrammarCall(text: string): GrammarCall | null {
  const raw = extractJsonObject(text)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as { tool?: string; args?: Record<string, unknown> }
    if (!obj.tool || !TOOL_SET.has(obj.tool)) return null
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj.args || {})) {
      args[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
    return { tool: obj.tool as GrammarToolName, args }
  } catch {
    return null
  }
}
