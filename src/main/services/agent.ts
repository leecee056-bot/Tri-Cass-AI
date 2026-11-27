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
  runScaffold,
  type ScaffoldKind
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
import { useTemplate, getTemplate, searchTemplates } from './templatePack'
import { generateLocalImage } from './imageGen'
import { textToAscii, imageToAscii, saveAscii } from './asciiArt'
import { createCheckpoint } from './checkpoints'
import { webSearch, fetchUrl } from './webFetch'
import { isDangerousCommand } from './workspace'

export type AgentRunOpts = {
  prompt: string
  chatId: string
  model: string
  config: ChatConfig
  signal?: AbortSignal
  onStep?: (step: AgentStep) => void
  forceKind?: Exclude<ScaffoldKind, null>
  selectedTemplateId?: string | null
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
): Promise<{ text: string; path?: string; done?: boolean; message?: string; files?: string[] }> {
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
      const cmd = call.args.command || 'echo ok'
      if (isDangerousCommand(cmd)) {
        return { text: `blocked dangerous command: ${cmd}` }
      }
      const out = await runCommand(projectRoot, cmd, 60_000, {
        autoApprove: true,
        onChunk: undefined
      })
      return { text: `[cwd ${projectRoot}]\n${out}` }
    }
    case 'search_knowledge': {
      const hits = searchKnowledge(chatId, call.args.query || '')
      return {
        text: hits.length
          ? hits.map((h) => `${h.path}: ${h.excerpt}`).join('\n---\n')
          : '(no knowledge hits)'
      }
    }
    case 'apply_template': {
      const id = call.args.id || call.args.templateId || ''
      const name = call.args.name || call.args.project || undefined
      const result = useTemplate(id, name)
      if (!result.ok) return { text: result.error || 'template failed' }
      return {
        text: `Applied template ${result.template?.name} → ${result.projectPath}`,
        path: result.projectPath,
        files: result.files
      }
    }
    case 'generate_image': {
      const result = generateLocalImage(call.args.prompt || 'Tri Cass', (call.args.size as '512' | '768' | '1024') || '512')
      if (!result.ok) return { text: result.error || 'image failed' }
      return { text: `Generated image ${result.path}`, path: result.path, files: result.path ? [result.path] : [] }
    }
    case 'generate_ascii': {
      if (call.args.image) {
        const result = imageToAscii(call.args.image)
        if (!result.ok) return { text: result.error || 'ascii failed' }
        const saved = saveAscii(result.ascii, call.args.name || 'ascii')
        return { text: result.ascii.slice(0, 2000), path: saved.path, files: saved.path ? [saved.path] : [] }
      }
      const result = textToAscii(call.args.text || call.args.prompt || 'Tri Cass', call.args.font || 'Standard')
      if (!result.ok) return { text: result.error || 'ascii failed' }
      const saved = saveAscii(result.ascii, call.args.name || 'ascii')
      return { text: '```\n' + result.ascii + '\n```', path: saved.path, files: saved.path ? [saved.path] : [] }
    }
    case 'finish':
      return { text: call.args.message || 'Done.', done: true, message: call.args.message || 'Done.' }
    default:
      return { text: `unknown tool` }
  }
}

function defaultTitle(kind: Exclude<ScaffoldKind, null>): string {
  switch (kind) {
    case 'website':
      return 'Tri Cass Website'
    case 'android':
      return 'Tri Cass Android'
    case 'electron':
      return 'Tri Cass Desktop'
    case 'python':
      return 'Tri Cass Python'
    case 'game':
      return 'Tri Cass Game'
    default:
      return 'Tri Cass App'
  }
}

function howToFor(kind: Exclude<ScaffoldKind, null>): string {
  switch (kind) {
    case 'website':
      return 'Open `index.html` in a browser, or run `python3 -m http.server 4173` in the project folder.'
    case 'android':
      return 'Open `www/index.html` now. When Android SDK is installed, follow `android/README.md` for Capacitor → APK. Tri Cass AI will not sign release builds.'
    case 'electron':
      return 'Run `npm install` then `npm start` in the project folder.'
    case 'python':
      return 'Run `python3 *.py` (see README) and `python3 -m unittest`.'
    case 'game':
      return 'Open `index.html` in a browser.'
    default:
      return 'Run `npm start` (and `npm test`) in the project folder.'
  }
}

/**
 * Primary coding path: template-first for website/app intents, then optional
 * model polish via Cline-slim grammar when Ollama is available.
 */
export async function runCodingAgent(opts: AgentRunOpts): Promise<AgentResult> {
  const steps: AgentStep[] = []
  const filesCreated: string[] = []
  emit(steps, opts.onStep, 'plan', `Workspace: ${getWorkspaceRoot()}`)

  // Selected template → copy then optionally customise
  if (opts.selectedTemplateId) {
    const tpl = getTemplate(opts.selectedTemplateId)
    emit(steps, opts.onStep, 'plan', `Using template: ${tpl?.name || opts.selectedTemplateId}`)
    const title = extractProjectTitle(opts.prompt, tpl?.name || 'From Template')
    const applied = useTemplate(opts.selectedTemplateId, title)
    if (!applied.ok || !applied.projectPath) {
      return {
        ok: false,
        steps,
        message: applied.error || 'Could not apply template',
        filesCreated: []
      }
    }
    filesCreated.push(...applied.files)
    for (const f of applied.files.slice(0, 12)) {
      emit(steps, opts.onStep, 'write', `Copied ${basename(f)}`, f)
    }
    emit(
      steps,
      opts.onStep,
      'done',
      `Template applied. You can keep chatting to customise — no code editor required.`
    )
    return {
      ok: true,
      projectPath: applied.projectPath,
      steps,
      message:
        `Applied template **${applied.template?.name}** into \`${applied.projectPath}\`.\n\n` +
        `In plain English: I copied a real MIT/free template into your workspace so you can open it in a browser. ` +
        `Ask me to change colours, copy, or sections — you don’t need to code.\n\n` +
        `Open the folder or say what to customise next.`,
      filesCreated: [...new Set(filesCreated)]
    }
  }

  // Natural language: restaurant site from a template
  if (/\btemplate\b/i.test(opts.prompt) && /\b(website|site|page)\b/i.test(opts.prompt)) {
    const q = /restaurant|portfolio|shop|dashboard|landing|business/i.exec(opts.prompt)?.[0] || 'landing'
    const found = searchTemplates({ query: q, limit: 5 })
    const pick = found.items[0]
    if (pick) {
      emit(steps, opts.onStep, 'plan', `Picked template ${pick.name} for “${q}”`)
      const title = extractProjectTitle(opts.prompt, pick.name)
      const applied = useTemplate(pick.id, title)
      if (applied.ok && applied.projectPath) {
        filesCreated.push(...applied.files)
        emit(steps, opts.onStep, 'done', `Template site ready at ${applied.projectPath}`)
        return {
          ok: true,
          projectPath: applied.projectPath,
          steps,
          message: `Created **${title}** from template **${pick.name}** at \`${applied.projectPath}\`.\n\nYou don’t need to code — open the folder or ask me to customise it.`,
          filesCreated: [...new Set(filesCreated)]
        }
      }
    }
  }

  if (opts.config.webSearch && /\b(search|research|look up|fetch)\b/i.test(opts.prompt)) {
    emit(steps, opts.onStep, 'plan', 'Web search enabled — fetching…')
    try {
      const hits = await webSearch(opts.prompt, 3)
      for (const h of hits) {
        emit(
          steps,
          opts.onStep,
          'observe',
          h.ok ? `${h.url}: ${(h.text || '').slice(0, 200)}` : h.error || 'fail'
        )
      }
    } catch (err) {
      emit(steps, opts.onStep, 'error', err instanceof Error ? err.message : String(err))
    }
  }

  const kind = opts.forceKind || detectScaffoldIntent(opts.prompt)

  // Continue / refactor existing project
  const continueMatch = opts.prompt.match(
    /\b(?:continue|keep)\s+building\b|\brefactor\b|\badd\s+(?:a\s+)?feature\b.{0,40}\b(?:in|to|on)\s+([~\w./-]+)/i
  )
  if (continueMatch && !kind) {
    const hint = continueMatch[1]
    const projectName = hint ? basename(hint) : 'project'
    emit(steps, opts.onStep, 'plan', `Continue/refactor on ${projectName}`)
    try {
      createCheckpoint(
        hint && hint.includes('/') ? hint : resolveInWorkspace('.', projectName),
        'before-continue'
      )
    } catch {
      /* ignore */
    }
  }

  if (kind) {
    emit(steps, opts.onStep, 'plan', `Detected intent: create ${kind}`)
    const title = extractProjectTitle(opts.prompt, defaultTitle(kind))
    const scaffold = runScaffold(kind, title)
    createCheckpoint(scaffold.projectPath, 'after-scaffold')
    filesCreated.push(...scaffold.files)
    for (const f of scaffold.files) {
      emit(steps, opts.onStep, 'write', `Created ${basename(f)}`, f)
    }

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
            `Improve the project with at most a few tool calls, then finish. Explain changes in plain English in the finish message.`
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
        if (result.files) filesCreated.push(...result.files)
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
    return {
      ok: true,
      projectPath: scaffold.projectPath,
      steps,
      message: `Created **${title}** (${kind}) with ${filesCreated.length} files at \`${scaffold.projectPath}\`.\n\n**Files**\n${tree}\n\n${howToFor(kind)}\n\nYou don’t need to code — just ask for changes in plain English.`,
      filesCreated: [...new Set(filesCreated)]
    }
  }

  // Image / ASCII shortcuts without full scaffold
  if (/\b(generate|make|create)\b.{0,20}\bimage\b/i.test(opts.prompt) || opts.config.imageGeneration) {
    if (/\bimage\b/i.test(opts.prompt)) {
      const prompt = opts.prompt.replace(/^.*?\b(?:of|for|:)\s+/i, '').trim() || opts.prompt
      const img = generateLocalImage(prompt, '512')
      if (img.ok && img.path) {
        emit(steps, opts.onStep, 'write', `Wrote ${img.path}`, img.path)
        return {
          ok: true,
          projectPath: img.path,
          steps,
          message: `Generated a local PNG with backend \`${img.backend}\`:\n\n\`${img.path}\`\n\n${img.safetyNote}`,
          filesCreated: [img.path]
        }
      }
    }
  }
  if (/\bascii\b/i.test(opts.prompt)) {
    const textMatch = opts.prompt.match(/ascii(?:\s+art)?(?:\s+of)?\s+["']?(.+?)["']?$/i)
    const text = textMatch?.[1]?.trim() || 'Tri Cass'
    const art = textToAscii(text, 'Standard')
    if (art.ok) {
      const saved = saveAscii(art.ascii, text)
      emit(steps, opts.onStep, 'write', saved.path || 'ascii', saved.path)
      return {
        ok: true,
        projectPath: saved.path,
        steps,
        message: `ASCII art (figlet.js):\n\n\`\`\`\n${art.ascii}\n\`\`\`\n\nSaved: \`${saved.path}\``,
        filesCreated: saved.path ? [saved.path] : []
      }
    }
  }

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
        `Implement with tools, then finish. Prefer plain-English finish messages. Ask if web vs Android is unclear.`
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
      if (result.files) filesCreated.push(...result.files)
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
      : 'Agent stopped without creating files. Try “make a website”, “make an Android notes app”, or download Templates.',
    filesCreated: [...new Set(filesCreated)]
  }
}

export function wantsCodingAgent(prompt: string): boolean {
  return (
    detectScaffoldIntent(prompt) !== null ||
    /\b(create|write|scaffold|implement)\b.{0,30}\b(file|folder|project)\b/i.test(prompt) ||
    /\b(template|android|electron|ascii|generate an? image)\b/i.test(prompt) ||
    /\b(continue building|refactor|add (a )?feature)\b/i.test(prompt)
  )
}

void fetchUrl
