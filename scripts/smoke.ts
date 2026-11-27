/**
 * Headless smoke test for Tri Cass AI core services (no Electron window required).
 * Covers: workspace scaffolds, KB attach/search, optional Ollama chat/pull.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import {
  scaffoldApp,
  scaffoldWebsite,
  scaffoldAndroid,
  detectScaffoldIntent
} from '../src/main/services/templates'
import { attachKnowledge, searchKnowledge, clearKnowledge } from '../src/main/services/knowledge'
import { setWorkspaceRoot, getWorkspaceInfo } from '../src/main/services/workspace'
import { generateLocalImage } from '../src/main/services/imageGen'
import { textToAscii, listAsciiFonts } from '../src/main/services/asciiArt'
import { getPackStatus, searchTemplates } from '../src/main/services/templatePack'

const evidenceDir =
  process.env.TRI_CASS_EVIDENCE ||
  '/cursor/stores/bc-1081152d-a0ed-45d4-b2ac-7bfcd7b2851a/media/local-coder'
const logLines: string[] = []

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  logLines.push(line)
}

async function ollamaCheck(): Promise<{ ok: boolean; detail: string; models: string[] }> {
  const base = process.env.OLLAMA_HOST?.replace(/\/$/, '') || 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, models: [] }
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return {
      ok: true,
      detail: base,
      models: (data.models || []).map((m) => m.name)
    }
  } catch (err) {
    return { ok: false, detail: String(err), models: [] }
  }
}

async function main(): Promise<void> {
  mkdirSync(evidenceDir, { recursive: true })
  const smokeRoot = join(tmpdir(), `tri-cass-ai-smoke-${Date.now()}`)
  process.env.TRI_CASS_USER_DATA = join(smokeRoot, 'user-data')
  mkdirSync(smokeRoot, { recursive: true })
  setWorkspaceRoot(smokeRoot)
  log(`workspace => ${getWorkspaceInfo().root}`)

  // Intent detection
  if (detectScaffoldIntent('please make a website for my shop') !== 'website') {
    throw new Error('website intent failed')
  }
  if (detectScaffoldIntent('make an app called notes') !== 'app') {
    throw new Error('app intent failed')
  }
  log('intent detection OK')

  // Website scaffold
  const site = scaffoldWebsite('Smoke Website')
  for (const f of site.files) {
    if (!existsSync(f)) throw new Error(`missing site file ${f}`)
  }
  const html = readFileSync(join(site.projectPath, 'index.html'), 'utf8')
  if (!html.includes('Tri Cass AI')) throw new Error('website missing brand')
  log(`website OK => ${site.projectPath} (${site.files.length} files)`)

  // App scaffold
  const app = scaffoldApp('Smoke App')
  for (const f of app.files) {
    if (!existsSync(f)) throw new Error(`missing app file ${f}`)
  }
  log(`app OK => ${app.projectPath} (${app.files.length} files)`)

  // Knowledge base
  const chatId = 'smoke-chat'
  clearKnowledge(chatId)
  const kbDoc = join(smokeRoot, 'kb-source.md')
  writeFileSync(
    kbDoc,
    '# Tri Cass coding notes\nUse Qwen2.5 Coder 3B on 8GB RAM. Always scaffold websites with index.html.\n',
    'utf8'
  )
  const attached = attachKnowledge(chatId, [kbDoc])
  if (attached.added < 1) throw new Error('KB attach failed')
  const hits = searchKnowledge(chatId, 'Qwen coder 8GB website')
  if (!hits.length) throw new Error('KB search returned no hits')
  log(`KB OK => attached=${attached.added} hits=${hits.length} excerpt=${hits[0].excerpt.slice(0, 60)}`)

  // Ollama optional
  const ollama = await ollamaCheck()
  log(`ollama status => ok=${ollama.ok} detail=${ollama.detail} models=${ollama.models.join(',') || 'none'}`)

  if (ollama.ok) {
    const pullTarget = process.env.SMOKE_PULL_MODEL || 'qwen2.5-coder:1.5b'
    if (!ollama.models.some((m) => m === pullTarget || m.startsWith(pullTarget))) {
      log(`pulling ${pullTarget}…`)
      const res = await fetch(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pullTarget, stream: false })
      })
      log(`pull HTTP ${res.status}`)
    } else {
      log(`model already present: ${pullTarget}`)
    }

    const chatRes = await fetch(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: pullTarget,
        stream: false,
        messages: [
          { role: 'system', content: 'You are Tri Cass AI. Reply in one short sentence.' },
          { role: 'user', content: 'Say hello and confirm you are local.' }
        ],
        options: { num_predict: 64, temperature: 0.2 }
      }),
      signal: AbortSignal.timeout(180_000)
    })
    const chatJson = (await chatRes.json()) as { message?: { content?: string } }
    const reply = chatJson.message?.content || ''
    log(`chat OK => ${reply.slice(0, 200)}`)
    writeFileSync(join(evidenceDir, 'smoke-chat-reply.txt'), reply || '(empty)', 'utf8')
  } else {
    log('ollama offline — chat/pull skipped (scaffold+KB still verified)')
  }

  const android = scaffoldAndroid('Smoke Android Notes')
  log(`android scaffold files=${android.files.length} intent=${detectScaffoldIntent('make an Android notes app')}`)
  const img = generateLocalImage('smoke harbour dusk', '512')
  log(`image gen ok=${img.ok} backend=${img.backend} bytes=${img.path ? readFileSync(img.path).length : 0}`)
  const fonts = listAsciiFonts()
  const ascii = textToAscii('Tri Cass', fonts[0] || 'Standard')
  log(`ascii fonts=${fonts.length} ok=${ascii.ok} lines=${ascii.ascii.split('\n').length}`)
  const pack = getPackStatus()
  const tplSearch = searchTemplates({ limit: 3 })
  log(`template pack count=${pack.count} search=${tplSearch.total}`)

  const summary = {
    ok: true,
    workspace: smokeRoot,
    website: site.projectPath,
    websiteFiles: site.files,
    app: app.projectPath,
    appFiles: app.files,
    androidFiles: android.files.length,
    imageOk: img.ok,
    asciiFonts: fonts.length,
    templatePackCount: pack.count,
    kbHits: hits.length,
    ollama: ollama.ok,
    homeDefault: join(homedir(), 'TriCassAI', 'projects')
  }
  writeFileSync(join(evidenceDir, 'smoke-log.txt'), logLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(evidenceDir, 'smoke-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  log(`evidence written under ${evidenceDir}`)
  console.log(JSON.stringify(summary, null, 2))

  // keep smoke projects for inspection; remove only nested kb temp if needed
  void rmSync
}

main().catch((err) => {
  console.error(err)
  try {
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'smoke-log.txt'),
      logLines.join('\n') + `\nFAIL ${err}\n`,
      'utf8'
    )
  } catch {
    /* ignore */
  }
  process.exit(1)
})
