import { basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { AgentResult, AgentStep, ChatConfig } from '../../shared/types'
import { chatOnce } from './ollama'
import {
  GRAMMAR_SYSTEM,
  STUCK_ERROR_LIMIT,
  parseGrammarReply,
  resolveMaxAgentSteps,
  type GrammarCall
} from './grammar'
import { applyUnifiedDiff } from './applyDiff'
import {
  detectScaffoldIntent,
  extractProjectTitle,
  isCreateFilesIntent,
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
  createProjectDir,
  slugifyProject
} from './workspace'
import { knowledgeContext, searchKnowledge } from './knowledge'
import { useTemplate, getTemplate, searchTemplates } from './templatePack'
import { generateLocalImage } from './imageGen'
import { textToAscii, imageToAscii, saveAscii } from './asciiArt'
import { createCheckpoint, rollbackCheckpoint } from './checkpoints'
import { webSearch, fetchUrl } from './webFetch'
import { isDangerousCommand } from './workspace'

export type AgentRunOpts = {
  prompt: string
  chatId: string
  model: string
  config: ChatConfig
  signal?: AbortSignal
  onStep?: (step: AgentStep) => void
          forceKind?: Exclude<ScaffoldKind, null> | null
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

const OBSERVE_CAP = 1200

function truncateObs(text: string, cap = OBSERVE_CAP): string {
  if (text.length <= cap) return text
  return text.slice(0, cap) + `\n…(truncated ${text.length - cap} chars)`
}

function formatObservation(tool: string, text: string, path?: string): string {
  const head = path ? `[${tool}] ${path}` : `[${tool}]`
  return truncateObs(`${head}\n${text}`)
}

async function execTool(
  call: GrammarCall,
  projectName: string,
  chatId: string
): Promise<{
  text: string
  path?: string
  done?: boolean
  message?: string
  files?: string[]
  error?: boolean
}> {
  const projectRoot = resolveInWorkspace('.', projectName)

  try {
    switch (call.tool) {
      case 'write_file': {
        const path = resolveInWorkspace(call.args.path || 'file.txt', projectName)
        writeText(path, call.args.content || '')
        return { text: `wrote ${path} (${(call.args.content || '').length} bytes)`, path }
      }
      case 'edit_file': {
        const path = resolveInWorkspace(call.args.path || '', projectName)
        const replaceAll = /^(1|true|yes)$/i.test(call.args.replaceAll || '')
        const msg = editText(path, call.args.old || '', call.args.new || '', { replaceAll })
        return { text: msg, path }
      }
      case 'apply_diff': {
        const result = applyUnifiedDiff(
          projectRoot,
          (rel) => resolveInWorkspace(rel, projectName),
          call.args.diff || call.args.patch || ''
        )
        return {
          text: result.text,
          path: result.paths[0],
          files: result.paths,
          error: !result.ok
        }
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
          return { text: `blocked dangerous command: ${cmd}`, error: true }
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
        if (!result.ok) return { text: result.error || 'template failed', error: true }
        return {
          text: `Applied template ${result.template?.name} → ${result.projectPath}`,
          path: result.projectPath,
          files: result.files
        }
      }
      case 'generate_image': {
        const result = generateLocalImage(
          call.args.prompt || 'Tri Cass',
          (call.args.size as '512' | '768' | '1024') || '512'
        )
        if (!result.ok) return { text: result.error || 'image failed', error: true }
        return {
          text: `Generated image ${result.path}`,
          path: result.path,
          files: result.path ? [result.path] : []
        }
      }
      case 'generate_ascii': {
        if (call.args.image) {
          const result = imageToAscii(call.args.image)
          if (!result.ok) return { text: result.error || 'ascii failed', error: true }
          const saved = saveAscii(result.ascii, call.args.name || 'ascii')
          return {
            text: result.ascii.slice(0, 2000),
            path: saved.path,
            files: saved.path ? [saved.path] : []
          }
        }
        const result = textToAscii(
          call.args.text || call.args.prompt || 'Tri Cass',
          call.args.font || 'Standard'
        )
        if (!result.ok) return { text: result.error || 'ascii failed', error: true }
        const saved = saveAscii(result.ascii, call.args.name || 'ascii')
        return {
          text: '```\n' + result.ascii + '\n```',
          path: saved.path,
          files: saved.path ? [saved.path] : []
        }
      }
      case 'restore_checkpoint': {
        const id = call.args.id || ''
        const result = rollbackCheckpoint(id)
        if (!result.ok) return { text: result.error || 'restore failed', error: true }
        return {
          text: `Restored checkpoint ${id} → ${result.projectPath}`,
          path: result.projectPath
        }
      }
      case 'finish':
        return { text: call.args.message || 'Done.', done: true, message: call.args.message || 'Done.' }
      default:
        return { text: `unknown tool: ${(call as GrammarCall).tool}`, error: true }
    }
  } catch (err) {
    return {
      text: err instanceof Error ? err.message : String(err),
      error: true
    }
  }
}

export type StuckState = {
  lastError: string
  count: number
}

/** Track identical error observations; returns true when limit reached. */
export function noteStuck(state: StuckState, errorText: string, limit: number): boolean {
  const key = errorText.slice(0, 240)
  if (key && key === state.lastError) {
    state.count += 1
  } else {
    state.lastError = key
    state.count = 1
  }
  return state.count >= limit
}

export function clearStuck(state: StuckState): void {
  state.lastError = ''
  state.count = 0
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

/** Keep only paths that exist on disk with size > 0. */
export function verifyFilesOnDisk(paths: string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = []
  const missing: string[] = []
  for (const p of [...new Set(paths)]) {
    try {
      if (existsSync(p) && statSync(p).isFile() && statSync(p).size > 0) ok.push(p)
      else missing.push(p)
    } catch {
      missing.push(p)
    }
  }
  return { ok, missing }
}

/** Lightweight post-write check (Cline-slim auto-check). */
export function postWriteCheck(path: string): string {
  try {
    if (!existsSync(path)) return `missing: ${path}`
    const st = statSync(path)
    if (!st.isFile() || st.size <= 0) return `empty: ${path}`
    if (/\.html?$/i.test(path)) {
      const body = readText(path, 4000)
      if (!/<html[\s>]/i.test(body) && !/<!DOCTYPE/i.test(body)) {
        return `html warning: ${path} missing doctype/html`
      }
      if (!/<\/html>/i.test(body)) return `html warning: ${path} unclosed html`
    }
    if (/\.json$/i.test(path)) {
      JSON.parse(readText(path, 200_000))
    }
    return `ok ${path} (${st.size} bytes)`
  } catch (err) {
    return `check failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

function fileInventory(paths: string[]): string {
  return paths
    .map((f) => {
      try {
        const st = statSync(f)
        return `- \`${f}\` (${st.size} bytes)`
      } catch {
        return `- \`${f}\` (missing)`
      }
    })
    .join('\n')
}

function stuckStop(args: {
  steps: AgentStep[]
  opts: AgentRunOpts
  projectPath: string
  filesCreated: string[]
  baselineId: string
  autoRestore: boolean
  stuckLimit: number
}): AgentResult {
  const { steps, opts, projectPath, filesCreated, baselineId, autoRestore, stuckLimit } = args
  emit(
    steps,
    opts.onStep,
    'error',
    `Stuck: identical error ×${stuckLimit} — stopping agent loop`
  )
  let restored = false
  if (autoRestore && baselineId) {
    const rb = rollbackCheckpoint(baselineId)
    restored = Boolean(rb.ok)
    emit(
      steps,
      opts.onStep,
      restored ? 'observe' : 'error',
      restored
        ? `Restored baseline checkpoint ${baselineId}`
        : `Could not restore checkpoint: ${rb.error || 'unknown'}`
    )
  }
  const verified = verifyFilesOnDisk(filesCreated)
  return {
    ok: false,
    projectPath,
    steps,
    message:
      `Stopped after ${stuckLimit} identical errors (stuck detection).` +
      (restored
        ? `\nRestored baseline checkpoint \`${baselineId}\`.`
        : `\nBaseline checkpoint \`${baselineId}\` is available — ask to restore it or use Undo.`) +
      (verified.ok.length ? `\n\n**Files still on disk**\n${fileInventory(verified.ok)}` : ''),
    filesCreated: verified.ok,
    checkpointId: baselineId
  }
}

/**
 * Primary coding path: template-first for website/app intents, then optional
 * model polish via Cline-slim grammar when Ollama is available.
 * Create intents MUST write real files — finish with zero files is a hard fail.
 */
export async function runCodingAgent(opts: AgentRunOpts): Promise<AgentResult> {
  const steps: AgentStep[] = []
  const filesCreated: string[] = []
  const mustCreate = isCreateFilesIntent(opts.prompt) || Boolean(opts.forceKind) || Boolean(opts.selectedTemplateId)
  emit(steps, opts.onStep, 'plan', `Workspace: ${getWorkspaceRoot()}`)
  if (mustCreate) {
    emit(steps, opts.onStep, 'plan', 'Create intent — write-files mode forced (no prose-only done)')
  }

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
    emit(steps, opts.onStep, 'plan', `Project folder name: ${title}`)
    const scaffold = runScaffold(kind, title)
    const baseline = createCheckpoint(scaffold.projectPath, 'after-scaffold')
    filesCreated.push(...scaffold.files)
    for (const f of scaffold.files) {
      emit(steps, opts.onStep, 'write', `Created ${basename(f)}`, f)
      emit(steps, opts.onStep, 'observe', postWriteCheck(f), f)
    }

    const verifiedScaffold = verifyFilesOnDisk(filesCreated)
    if (verifiedScaffold.ok.length === 0) {
      emit(steps, opts.onStep, 'error', 'Scaffold wrote zero verifiable files')
      return {
        ok: false,
        projectPath: scaffold.projectPath,
        steps,
        message: `Failed to create ${kind}: no files appeared on disk under \`${scaffold.projectPath}\`. Check workspace permissions.`,
        filesCreated: [],
        checkpointId: baseline.id
      }
    }
    filesCreated.length = 0
    filesCreated.push(...verifiedScaffold.ok)

    const maxSteps = Math.min(4, resolveMaxAgentSteps(opts.config.maxAgentSteps))
    const stuckLimit = opts.config.stuckErrorLimit ?? STUCK_ERROR_LIMIT
    const autoRestore = opts.config.autoRestoreOnStuck !== false
    const stuck: StuckState = { lastError: '', count: 0 }

    try {
      const kb = knowledgeContext(opts.chatId, opts.prompt)
      const projectName = basename(scaffold.projectPath)
      const messages: Array<{ role: string; content: string }> = [
        {
          role: 'user',
          content:
            `Project already scaffolded at ${scaffold.projectPath} with ${verifiedScaffold.ok.length} real files.\n` +
            `User request: ${opts.prompt}\n` +
            (kb ? `\n${kb}\n` : '') +
            `Improve with grammar tool calls only (write_file/edit_file/apply_diff/…). ` +
            `Never claim success without tools. Call finish only after files exist.`
        }
      ]

      for (let i = 0; i < maxSteps; i++) {
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
        const parsed = parseGrammarReply(reply)
        if (parsed.kind !== 'call') {
          const obs =
            parsed.kind === 'unknown_tool'
              ? `unknown tool "${parsed.tool}" — use one of the allowed tools`
              : parsed.kind === 'missing_args'
                ? `missing args for ${parsed.tool}: ${parsed.missing.join(', ')}`
                : `invalid tool JSON (${parsed.reason}) — keeping scaffold`
          emit(steps, opts.onStep, 'observe', formatObservation('parse', obs))
          messages.push({ role: 'assistant', content: reply })
          messages.push({ role: 'user', content: `Observation:\n${obs}` })
          if (parsed.kind === 'invalid') break
          if (noteStuck(stuck, obs, stuckLimit)) {
            return stuckStop({
              steps,
              opts,
              projectPath: scaffold.projectPath,
              filesCreated,
              baselineId: baseline.id,
              autoRestore,
              stuckLimit
            })
          }
          continue
        }
        const call = parsed.call
        emit(steps, opts.onStep, 'tool', `${call.tool} ${JSON.stringify(call.args).slice(0, 180)}`)
        if (call.tool === 'finish') {
          const verified = verifyFilesOnDisk(filesCreated)
          if (verified.ok.length === 0) {
            const errObs = 'finish rejected — zero files on disk'
            emit(steps, opts.onStep, 'error', errObs)
            messages.push({ role: 'assistant', content: reply })
            messages.push({
              role: 'user',
              content: 'Observation: finish rejected. Write files with write_file first, then finish.'
            })
            if (noteStuck(stuck, errObs, stuckLimit)) {
              return stuckStop({
                steps,
                opts,
                projectPath: scaffold.projectPath,
                filesCreated,
                baselineId: baseline.id,
                autoRestore,
                stuckLimit
              })
            }
            continue
          }
          createCheckpoint(scaffold.projectPath, 'after-polish')
          emit(steps, opts.onStep, 'done', call.args.message || 'Finished')
          return {
            ok: true,
            projectPath: scaffold.projectPath,
            steps,
            message:
              (call.args.message || `Created ${kind} at ${scaffold.projectPath}`) +
              `\n\n**Files on disk**\n${fileInventory(verified.ok)}`,
            filesCreated: verified.ok,
            checkpointId: baseline.id
          }
        }
        const result = await execTool(call, projectName, opts.chatId)
        const obs = formatObservation(call.tool, result.text, result.path)
        emit(steps, opts.onStep, result.error ? 'error' : 'observe', obs, result.path)
        if (result.files) filesCreated.push(...result.files)
        if (
          result.path &&
          (call.tool === 'write_file' || call.tool === 'edit_file' || call.tool === 'apply_diff')
        ) {
          filesCreated.push(result.path)
          if (!result.error) {
            const check = postWriteCheck(result.path)
            emit(steps, opts.onStep, 'observe', check, result.path)
            messages.push({ role: 'assistant', content: reply })
            messages.push({
              role: 'user',
              content: `Observation:\n${obs}\nPost-write check: ${check}`
            })
            clearStuck(stuck)
            continue
          }
        }
        messages.push({ role: 'assistant', content: reply })
        messages.push({ role: 'user', content: `Observation:\n${obs}` })
        if (result.error) {
          if (noteStuck(stuck, result.text, stuckLimit)) {
            return stuckStop({
              steps,
              opts,
              projectPath: scaffold.projectPath,
              filesCreated,
              baselineId: baseline.id,
              autoRestore,
              stuckLimit
            })
          }
        } else {
          clearStuck(stuck)
        }
      }
    } catch (err) {
      emit(
        steps,
        opts.onStep,
        'observe',
        `Model polish skipped (${err instanceof Error ? err.message : String(err)}). Scaffold is ready.`
      )
    }

    const verified = verifyFilesOnDisk(filesCreated)
    if (verified.ok.length === 0) {
      emit(steps, opts.onStep, 'error', 'Create intent failed — zero files verified')
      return {
        ok: false,
        projectPath: scaffold.projectPath,
        steps,
        message: `Could not verify any files for **${title}**. Nothing durable was written.`,
        filesCreated: [],
        checkpointId: baseline.id
      }
    }
    createCheckpoint(scaffold.projectPath, 'create-complete')
    emit(steps, opts.onStep, 'done', `Created ${kind} at ${scaffold.projectPath}`)
    const tree = verified.ok
      .map((f) => {
        const rel = f.replace(scaffold.projectPath + '/', '')
        try {
          return `- \`${rel}\` (${statSync(f).size} bytes)`
        } catch {
          return `- \`${rel}\``
        }
      })
      .join('\n')
    return {
      ok: true,
      projectPath: scaffold.projectPath,
      steps,
      message: `Created **${title}** (${kind}) with ${verified.ok.length} files at \`${scaffold.projectPath}\`.\n\n**Files**\n${tree}\n\n${howToFor(kind)}\n\nYou don’t need to code — just ask for changes in plain English.`,
      filesCreated: verified.ok,
      checkpointId: baseline.id
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

  // Create intent without a typed scaffold → still force a real website folder on disk
  if (mustCreate) {
    emit(steps, opts.onStep, 'plan', 'Create intent without typed scaffold — forcing website scaffold')
    const title = extractProjectTitle(opts.prompt, defaultTitle('website'))
    const scaffold = runScaffold('website', title)
    createCheckpoint(scaffold.projectPath, 'forced-create')
    const verified = verifyFilesOnDisk(scaffold.files)
    if (verified.ok.length === 0) {
      return {
        ok: false,
        projectPath: scaffold.projectPath,
        steps,
        message: `Create intent failed: could not write files under \`${scaffold.projectPath}\`.`,
        filesCreated: []
      }
    }
    for (const f of verified.ok) emit(steps, opts.onStep, 'write', `Created ${basename(f)}`, f)
    emit(steps, opts.onStep, 'done', `Created website at ${scaffold.projectPath}`)
    return {
      ok: true,
      projectPath: scaffold.projectPath,
      steps,
      message: `Created **${title}** in \`${scaffold.projectPath}\` with ${verified.ok.length} real files.\n\n**Files**\n${fileInventory(verified.ok)}\n\n${howToFor('website')}`,
      filesCreated: verified.ok
    }
  }

  const projectName = extractProjectTitle(opts.prompt, `task-${Date.now()}`)
  const projectPath = createProjectDir(projectName)
  const baseline = createCheckpoint(projectPath, 'before-grammar')
  emit(steps, opts.onStep, 'plan', `New project folder: ${projectPath}`)
  emit(
    steps,
    opts.onStep,
    'plan',
    `Max agent steps: ${resolveMaxAgentSteps(opts.config.maxAgentSteps)} (config/env TRI_CASS_MAX_AGENT_STEPS)`
  )

  const kb = knowledgeContext(opts.chatId, opts.prompt)
  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'user',
      content:
        `Workspace project: ${projectPath}\nUser request: ${opts.prompt}\n` +
        (kb ? `\n${kb}\n` : '') +
        `Implement with grammar tools only (write_file / apply_diff first). ` +
        `finish is rejected until at least one file exists on disk. Prefer plain-English finish messages.`
    }
  ]

  const maxSteps = resolveMaxAgentSteps(opts.config.maxAgentSteps)
  const stuckLimit = opts.config.stuckErrorLimit ?? STUCK_ERROR_LIMIT
  const autoRestore = opts.config.autoRestoreOnStuck !== false
  const stuck: StuckState = { lastError: '', count: 0 }
  const slug = slugifyProject(projectName)

  try {
    for (let i = 0; i < maxSteps; i++) {
      if (opts.signal?.aborted) {
        return {
          ok: false,
          projectPath,
          steps,
          message: 'Stopped.',
          filesCreated: verifyFilesOnDisk(filesCreated).ok,
          checkpointId: baseline.id
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
      const parsed = parseGrammarReply(reply)
      if (parsed.kind !== 'call') {
        const obs =
          parsed.kind === 'unknown_tool'
            ? `unknown tool "${parsed.tool}" — allowed tools only`
            : parsed.kind === 'missing_args'
              ? `missing args for ${parsed.tool}: ${parsed.missing.join(', ')}`
              : `invalid tool JSON (${parsed.reason})`
        emit(steps, opts.onStep, 'error', formatObservation('parse', obs))
        messages.push({ role: 'assistant', content: reply })
        messages.push({
          role: 'user',
          content: `Observation:\n${obs}\nReply with ONE JSON tool object only.`
        })
        if (noteStuck(stuck, obs, stuckLimit)) {
          return stuckStop({
            steps,
            opts,
            projectPath,
            filesCreated,
            baselineId: baseline.id,
            autoRestore,
            stuckLimit
          })
        }
        continue
      }
      const call = parsed.call
      emit(steps, opts.onStep, 'tool', `${call.tool}`)
      if (call.tool === 'finish') {
        const verified = verifyFilesOnDisk(filesCreated)
        if (verified.ok.length === 0) {
          const errObs = 'finish rejected — zero files on disk'
          emit(steps, opts.onStep, 'error', errObs)
          messages.push({ role: 'assistant', content: reply })
          messages.push({
            role: 'user',
            content: 'Observation: finish rejected. Use write_file to create real files, then finish.'
          })
          if (noteStuck(stuck, errObs, stuckLimit)) {
            return stuckStop({
              steps,
              opts,
              projectPath,
              filesCreated,
              baselineId: baseline.id,
              autoRestore,
              stuckLimit
            })
          }
          continue
        }
        createCheckpoint(projectPath, 'grammar-complete')
        emit(steps, opts.onStep, 'done', call.args.message || 'Done')
        return {
          ok: true,
          projectPath,
          steps,
          message: `${call.args.message || 'Done.'}\n\n**Files on disk**\n${fileInventory(verified.ok)}`,
          filesCreated: verified.ok,
          checkpointId: baseline.id
        }
      }
      const result = await execTool(call, slug, opts.chatId)
      const obs = formatObservation(call.tool, result.text, result.path)
      emit(steps, opts.onStep, result.error ? 'error' : 'observe', obs, result.path)
      if (result.files) filesCreated.push(...result.files)
      if (
        result.path &&
        (call.tool === 'write_file' || call.tool === 'edit_file' || call.tool === 'apply_diff')
      ) {
        filesCreated.push(result.path)
        if (!result.error) {
          const check = postWriteCheck(result.path)
          emit(steps, opts.onStep, 'observe', check, result.path)
        }
      }
      messages.push({ role: 'assistant', content: reply })
      messages.push({ role: 'user', content: `Observation:\n${obs}` })
      if (result.error) {
        if (noteStuck(stuck, result.text, stuckLimit)) {
          return stuckStop({
            steps,
            opts,
            projectPath,
            filesCreated,
            baselineId: baseline.id,
            autoRestore,
            stuckLimit
          })
        }
      } else {
        clearStuck(stuck)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit(steps, opts.onStep, 'error', msg)
    if (autoRestore) {
      const rb = rollbackCheckpoint(baseline.id)
      if (rb.ok) emit(steps, opts.onStep, 'observe', `Restored baseline ${baseline.id} after error`)
    }
    return {
      ok: false,
      projectPath,
      steps,
      message: `Agent error: ${msg}`,
      filesCreated: verifyFilesOnDisk(filesCreated).ok,
      checkpointId: baseline.id
    }
  }

  const verified = verifyFilesOnDisk(filesCreated)
  return {
    ok: verified.ok.length > 0,
    projectPath,
    steps,
    message: verified.ok.length
      ? `Reached step limit. Files are in ${projectPath}\n\n${fileInventory(verified.ok)}`
      : 'Agent stopped without creating files. Try “make a website”, “make an Android notes app”, or download Templates.',
    filesCreated: verified.ok,
    checkpointId: baseline.id
  }
}

export function wantsCodingAgent(prompt: string): boolean {
  return (
    isCreateFilesIntent(prompt) ||
    detectScaffoldIntent(prompt) !== null ||
    /\b(create|write|scaffold|implement)\b.{0,30}\b(file|folder|project)\b/i.test(prompt) ||
    /\b(template|android|electron|ascii|generate an? image)\b/i.test(prompt) ||
    /\b(continue building|refactor|add (a )?feature)\b/i.test(prompt)
  )
}

void fetchUrl
