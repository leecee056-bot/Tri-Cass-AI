import { basename } from 'node:path'
import type { AgentResult, AgentStep, ChatConfig } from '../../shared/types'
import { chatOnce } from './ollama'
import {
  GRAMMAR_SYSTEM,
  MAX_GRAMMAR_STEPS,
  parseGrammarCall,
  type GrammarCall
} from './grammar'
import {
  detectScaffoldIntent,
  extractProjectTitle,
  scaffoldApp,
  scaffoldWebsite
} from './templates'
import {
  editText,
  getWorkspaceRoot,
  listDir,
  readText,
  resolveInWorkspace,
  runCommand,
  writeText,
  createProjectDir
} from './workspace'
import { knowledgeContext, searchKnowledge } from './knowledge'

export type AgentRunOpts = {
  prompt: string
  chatId: string
  model: string
  config: ChatConfig
  signal?: AbortSignal
  onStep?: (step: AgentStep) => void
  /** Force scaffold without waiting on the model */
  forceKind?: 'website' | 'app'
}

function emit(
  steps: AgentStep[],
  onStep: AgentRunOpts['onStep'],
  kind: AgentStep['kind'],
  text: string,
  path?: string
): AgentStep {
  const step: AgentStep = { at: Date.now(), kind, text, path }
  steps.push(step)
  onStep?.(step)
  return step
}

async function execTool(
  call: GrammarCall,
  projectName: string,
  chatId: string
): Promise<{ text: string; path?: string; done?: boolean; message?: string }> {
  const projectRoot = resolveInWorkspace('.', projectName)

  switch (call.tool) {
    case 'write_file': {
      const path = resolveInWorkspace(call.args.path || 'file.txt', projectName)
      writeText(path, call.args.content || '')
      return { text: `wrote ${path} (${(call.args.content || '').length} bytes)`, path }
    }
    case 'edit_file': {
      const path = resolveInWorkspace(call.args.path || '', projectName)
      const msg = editText(path, call.args.old || '', call.args.new || '')
      return { text: msg, path }
    }
    case 'read_file': {
      const path = resolveInWorkspace(call.args.path || '', projectName)
      return { text: readText(path), path }
    }
    case 'list_dir': {
      const path = resolveInWorkspace(call.args.path || '.', projectName)
      return { text: listDir(path) || '(empty)', path }
    }
    case 'run': {
      const out = await runCommand(projectRoot, call.args.command || 'echo ok')
      return { text: out }
    }
    case 'search_knowledge': {
      const hits = searchKnowledge(chatId, call.args.query || '')
      return {
        text: hits.length
          ? hits.map((h) => `${h.path}: ${h.excerpt}`).join('\n---\n')
          : '(no knowledge hits)'
      }
    }
    case 'finish':
      return { text: call.args.message || 'Done.', done: true, message: call.args.message || 'Done.' }
    default:
      return { text: `unknown tool` }
  }
}

/**
 * Primary coding path: template-first for website/app intents, then optional
 * model polish via Cline-slim grammar when Ollama is available.
 */
export async function runCodingAgent(opts: AgentRunOpts): Promise<AgentResult> {
  const steps: AgentStep[] = []
  const filesCreated: string[] = []
  const kind = opts.forceKind || detectScaffoldIntent(opts.prompt)

  emit(steps, opts.onStep, 'plan', `Workspace: ${getWorkspaceRoot()}`)

  if (kind) {
    emit(steps, opts.onStep, 'plan', `Detected intent: create ${kind}`)
    const title = extractProjectTitle(
      opts.prompt,
      kind === 'website' ? 'Tri Cass Website' : 'Tri Cass App'
    )

    const scaffold = kind === 'website' ? scaffoldWebsite(title) : scaffoldApp(title)
    filesCreated.push(...scaffold.files)
    for (const f of scaffold.files) {
      emit(steps, opts.onStep, 'write', `Created ${basename(f)}`, f)
    }

    // Optional model refinement — best-effort; scaffold already satisfies disk requirement
    try {
      const kb = knowledgeContext(opts.chatId, opts.prompt)
      const projectName = basename(scaffold.projectPath)
      const messages: Array<{ role: string; content: string }> = [
        {
          role: 'user',
          content:
            `Project already scaffolded at ${scaffold.projectPath}.\n` +
            `User request: ${opts.prompt}\n` +
            (kb ? `\n${kb}\n` : '') +
            `Improve the project with at most a few tool calls, then finish.`
        }
      ]

      for (let i = 0; i < Math.min(4, MAX_GRAMMAR_STEPS); i++) {
        if (opts.signal?.aborted) break
        const reply = await chatOnce(messages, {
          model: opts.model,
          temperature: Math.min(opts.config.temperature, 0.4),
          topP: opts.config.topP,
          maxTokens: Math.min(opts.config.maxTokens, 2048),
          system: GRAMMAR_SYSTEM,
          format: 'json',
          signal: opts.signal
        })
        const call = parseGrammarCall(reply)
        if (!call) {
          emit(steps, opts.onStep, 'observe', 'Model reply was not valid tool JSON — keeping scaffold.')
          break
        }
        emit(steps, opts.onStep, 'tool', `${call.tool} ${JSON.stringify(call.args).slice(0, 180)}`)
        const result = await execTool(call, projectName, opts.chatId)
        emit(steps, opts.onStep, 'observe', result.text.slice(0, 500), result.path)
        if (result.path && call.tool === 'write_file') filesCreated.push(result.path)
        if (result.done) {
          emit(steps, opts.onStep, 'done', result.message || 'Finished')
          return {
            ok: true,
            projectPath: scaffold.projectPath,
            steps,
            message: result.message || `Created ${kind} at ${scaffold.projectPath}`,
            filesCreated: [...new Set(filesCreated)]
          }
        }
        messages.push({ role: 'assistant', content: reply })
        messages.push({ role: 'user', content: `Observation:\n${result.text}` })
      }
    } catch (err) {
      emit(
        steps,
        opts.onStep,
        'observe',
        `Model polish skipped (${err instanceof Error ? err.message : String(err)}). Scaffold is ready.`
      )
    }

    emit(steps, opts.onStep, 'done', `Created ${kind} at ${scaffold.projectPath}`)
    const tree = [...new Set(filesCreated)]
      .map((f) => `- \`${f.replace(scaffold.projectPath + '/', '')}\``)
      .join('\n')
    const howTo =
      kind === 'website'
        ? 'Open `index.html` in a browser, or run `python3 -m http.server 4173` in the project folder.'
        : 'Run `npm start` (and `npm test`) in the project folder.'
    return {
      ok: true,
      projectPath: scaffold.projectPath,
      steps,
      message: `Created **${title}** (${kind}) with ${filesCreated.length} files at \`${scaffold.projectPath}\`.\n\n**Files**\n${tree}\n\n${howTo}`,
      filesCreated: [...new Set(filesCreated)]
    }
  }

  // Generic agent loop (no website/app template)
  const projectName = `task-${Date.now()}`
  const projectPath = createProjectDir(projectName)
  emit(steps, opts.onStep, 'plan', `New project folder: ${projectPath}`)

  const kb = knowledgeContext(opts.chatId, opts.prompt)
  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'user',
      content:
        `Workspace project: ${projectPath}\nUser request: ${opts.prompt}\n` +
        (kb ? `\n${kb}\n` : '') +
        `Implement with tools, then finish.`
    }
  ]

  try {
    for (let i = 0; i < MAX_GRAMMAR_STEPS; i++) {
      if (opts.signal?.aborted) {
        return {
          ok: false,
          projectPath,
          steps,
          message: 'Stopped.',
          filesCreated: [...new Set(filesCreated)]
        }
      }
      const reply = await chatOnce(messages, {
        model: opts.model,
        temperature: Math.min(opts.config.temperature, 0.5),
        topP: opts.config.topP,
        maxTokens: Math.min(opts.config.maxTokens, 2048),
        system: GRAMMAR_SYSTEM,
        format: 'json',
        signal: opts.signal
      })
      const call = parseGrammarCall(reply)
      if (!call) {
        emit(steps, opts.onStep, 'error', 'Invalid tool JSON from model')
        messages.push({ role: 'assistant', content: reply })
        messages.push({
          role: 'user',
          content: 'Reply with ONE JSON tool object only.'
        })
        continue
      }
      emit(steps, opts.onStep, 'tool', `${call.tool}`)
      const result = await execTool(call, projectName, opts.chatId)
      emit(steps, opts.onStep, 'observe', result.text.slice(0, 500), result.path)
      if (result.path && (call.tool === 'write_file' || call.tool === 'edit_file')) {
        filesCreated.push(result.path)
      }
      if (result.done) {
        emit(steps, opts.onStep, 'done', result.message || 'Done')
        return {
          ok: true,
          projectPath,
          steps,
          message: result.message || 'Done.',
          filesCreated: [...new Set(filesCreated)]
        }
      }
      messages.push({ role: 'assistant', content: reply })
      messages.push({ role: 'user', content: `Observation:\n${result.text}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit(steps, opts.onStep, 'error', msg)
    return {
      ok: false,
      projectPath,
      steps,
      message: `Agent error: ${msg}`,
      filesCreated: [...new Set(filesCreated)]
    }
  }

  return {
    ok: filesCreated.length > 0,
    projectPath,
    steps,
    message: filesCreated.length
      ? `Reached step limit. Files are in ${projectPath}`
      : 'Agent stopped without creating files. Try “make a website” or “make an app”.',
    filesCreated: [...new Set(filesCreated)]
  }
}

export function wantsCodingAgent(prompt: string): boolean {
  return detectScaffoldIntent(prompt) !== null || /\b(create|write|scaffold|implement)\b.{0,30}\b(file|folder|project)\b/i.test(prompt)
}
