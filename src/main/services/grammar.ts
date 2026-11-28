export const GRAMMAR_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'list_dir',
  'run',
  'search_knowledge',
  'apply_template',
  'generate_image',
  'generate_ascii',
  'finish'
] as const

export type GrammarToolName = (typeof GRAMMAR_TOOLS)[number]

export type GrammarCall = {
  tool: GrammarToolName
  args: Record<string, string>
}

export const MAX_GRAMMAR_STEPS = 12

export const GRAMMAR_SYSTEM = `You are Tri Cass AI, a local no-code coding agent. Reply with ONE JSON object only — no markdown fences, no prose.
Shape: {"tool":"<name>","args":{...}}
Tools (one per reply):
- write_file: args path, content — create/overwrite under the project folder
- edit_file: args path, old, new — replace first occurrence
- read_file: args path
- list_dir: args path ("" = project root)
- run: args command — run in project folder (node/npm/python preferred)
- search_knowledge: args query
- apply_template: args id, name — copy a library template into the workspace
- generate_image: args prompt, size (512|768|1024) — local PNG writer
- generate_ascii: args text, font OR image — figlet / image→ASCII
- finish: args message — done; message is shown to the user in plain English
Prefer relative paths. Prefer short files. Never require the user to open a code editor.
Refuse unsafe Android signing / Play Store credential requests clearly.
Never reply with prose. Never call finish until at least one write_file (or scaffold) has created a real file on disk.
If asked to make a website/app/folder, you MUST use write_file / apply_template tools — claiming “done” without tools is forbidden.
Call finish only when the project exists on disk.`

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
