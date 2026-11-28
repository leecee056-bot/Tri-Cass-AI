import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  clipboard,
  Tray,
  nativeImage
} from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { MODEL_CATALOG, DEFAULT_MODEL_TAG } from '../shared/catalog'
import type { ChatConfig, PullProgress } from '../shared/types'
import { ollamaStatus, chatStream, chatOnce, pullModel, historyToPayload } from './services/ollama'
import { runCodingAgent, wantsCodingAgent, verifyFilesOnDisk } from './services/agent'
import { isCreateFilesIntent, detectScaffoldIntent } from './services/templates'
import {
  getWorkspaceInfo,
  setWorkspaceRoot,
  getWorkspaceRoot,
  pinWorkspace,
  createWorkspaceFolder,
  cancelCommand,
  touchRecentWorkspace
} from './services/workspace'
import {
  attachKnowledge,
  listKnowledge,
  clearKnowledge,
  knowledgeContext,
  knowledgeStats,
  searchKnowledge,
  reindexKnowledge,
  removeKnowledgeSources,
  knowledgeFailures,
  kbSupportedTypes,
  attachWorkspaceKnowledge,
  listWorkspaceKnowledge
} from './services/knowledge'
import { GRAMMAR_TOOLS } from './services/grammar'
import {
  loadSessions,
  saveSessions,
  createSession,
  getSession,
  appendMessage,
  updateSession,
  deleteSession,
  renameSession,
  clearAllSessions,
  setDraft,
  resetSessionsToEmpty,
  forkSessionFromMessage,
  deleteMessagePair,
  setSessionFolder,
  setSessionProject,
  importSession,
  exportAllData
} from './services/chatStore'
import { loadPrefs, savePrefs, DEFAULT_CONFIG, logsDir } from './services/paths'
import {
  cancelPackDownload,
  downloadTemplatePack,
  estimatePackDiskMb,
  getPackStatus,
  getTemplate,
  randomTemplate,
  searchTemplates,
  toggleFavorite,
  useTemplate,
  undoLastTemplateApply
} from './services/templatePack'
import { generateLocalImage, imageBackendHelp, imageHistory } from './services/imageGen'
import {
  asciiToPng,
  imageToAscii,
  listAsciiFonts,
  saveAscii,
  textToAscii
} from './services/asciiArt'
import { createCheckpoint, listCheckpoints, rollbackCheckpoint } from './services/checkpoints'
import { detectRuntimes, formatRuntimeGuidance } from './services/runtimes'
import {
  getLastRun,
  inspectProject,
  readProjectFile,
  startProjectRun,
  stopProjectRun,
  type RunAction
} from './services/projectRun'
import { buildDiagnostics, detectRamGb, detectFreeDiskRough } from './services/diagnostics'
import { webSearch, fetchUrl } from './services/webFetch'
import {
  listWallpapers,
  addCustomWallpaper,
  removeCustomWallpaper,
  wallpaperDataUrl
} from './services/wallpapers'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
const abortControllers = new Map<string, AbortController>()
let activePullId: string | null = null
const VERSION = '0.1.3'

function resolveAppIcon(): string {
  const candidates = [
    join(process.resourcesPath || '', 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(process.cwd(), 'build/icon.png'),
    join(__dirname, '../renderer/brand/icon-256.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: '#0c0f14',
    title: 'Tri Cass AI',
    icon: resolveAppIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/?$/, '/')
    void splash.loadURL(`${base}splash.html`)
  } else {
    void splash.loadFile(join(__dirname, '../renderer/splash.html'))
  }
  splash.once('ready-to-show', () => splash.show())
  return splash
}

function createWindow(): void {
  const prefs = loadPrefs()
  const bounds = prefs.windowBounds
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: bounds?.width || 1280,
    height: bounds?.height || 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'Tri Cass AI',
    icon,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (bounds?.isMaximized) mainWindow.maximize()

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const revealMain = (): void => {
    if (!mainWindow) return
    // Close splash first so the shell never peeks behind the small splash window
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    mainWindow.show()
    mainWindow.focus()
  }

  mainWindow.once('ready-to-show', () => {
    // Let splash animation play (~1.6s) before revealing the shell
    setTimeout(revealMain, splashWindow ? 1600 : 0)
  })

  const persistBounds = (): void => {
    if (!mainWindow) return
    const prefsNow = loadPrefs()
    const isMaximized = mainWindow.isMaximized()
    const b = mainWindow.getBounds()
    prefsNow.windowBounds = { ...b, isMaximized }
    savePrefs(prefsNow)
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)
  mainWindow.on('close', persistBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Tri Cass AI',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit', accelerator: 'CommandOrControl+Q' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'close' }]
      }
    ])
  )
  splashWindow = createSplash()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      splashWindow = createSplash()
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})
ipcMain.handle('window:close', async () => {
  if (abortControllers.size > 0) {
    const res = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Cancel', 'Stop & close'],
      defaultId: 1,
      cancelId: 0,
      title: 'Tri Cass AI',
      message: 'Generation in progress. Close anyway?'
    })
    if (res.response !== 1) return false
    for (const [, ac] of abortControllers) ac.abort()
    abortControllers.clear()
  }
  mainWindow?.close()
  return true
})
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

ipcMain.handle('app:getSnapshot', async () => {
  const prefs = loadPrefs()
  const ollama = await ollamaStatus()
  let sessions = loadSessions()
  // Collapse duplicate empty "New Chat" rows left by older builds
  const empties = sessions.filter(
    (s) => !s.archived && s.title === 'New Chat' && (s.messages?.length || 0) === 0
  )
  if (empties.length > 1) {
    const keep = empties[0].id
    sessions = sessions.filter((s) => s.id === keep || !(s.title === 'New Chat' && (s.messages?.length || 0) === 0))
    saveSessions(sessions)
  }
  if (!sessions.length) {
    createSession('New Chat')
    sessions = loadSessions()
  }
  return {
    ollama,
    workspace: getWorkspaceInfo(),
    sessions,
    activeSessionId: sessions.find((s) => !s.archived)?.id ?? sessions[0]?.id ?? null,
    selectedModel: prefs.selectedModel || ollama.models[0]?.name || DEFAULT_MODEL_TAG,
    config: { ...DEFAULT_CONFIG, ...prefs.config },
    catalog: MODEL_CATALOG,
    version: VERSION
  }
})

ipcMain.handle('app:getVersion', () => VERSION)

ipcMain.handle('ollama:status', async () => ollamaStatus())

ipcMain.handle('models:catalog', async () => MODEL_CATALOG)

ipcMain.handle('models:setSelected', async (_e, model: string) => {
  const prefs = loadPrefs()
  prefs.selectedModel = model
  savePrefs(prefs)
  return model
})

ipcMain.handle('models:pull', async (_e, model: string) => {
  const id = randomUUID()
  const ac = new AbortController()
  abortControllers.set(id, ac)
  activePullId = id
  try {
    await pullModel(model, (p: PullProgress) => send('models:pullProgress', p), ac.signal)
    const prefs = loadPrefs()
    prefs.selectedModel = model
    savePrefs(prefs)
    return { ok: true, model }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    send('models:pullProgress', { model, status: 'error', error: message, done: true })
    return { ok: false, error: message }
  } finally {
    abortControllers.delete(id)
    if (activePullId === id) activePullId = null
  }
})

ipcMain.handle('models:cancelPull', async () => {
  if (activePullId && abortControllers.has(activePullId)) {
    abortControllers.get(activePullId)!.abort()
    abortControllers.delete(activePullId)
    activePullId = null
    return true
  }
  return false
})

ipcMain.handle('models:delete', async (_e, model: string) => {
  const base = process.env.OLLAMA_HOST?.replace(/\/$/, '') || 'http://127.0.0.1:11434'
  const res = await fetch(`${base}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model })
  })
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
  return { ok: true }
})

ipcMain.handle('workspace:info', async () => getWorkspaceInfo())

ipcMain.handle('workspace:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Tri Cass AI workspace',
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return getWorkspaceInfo()
  return setWorkspaceRoot(res.filePaths[0])
})

ipcMain.handle('workspace:open', async (_e, path?: string) => {
  await shell.openPath(path || getWorkspaceRoot())
  return true
})

ipcMain.handle('workspace:setRoot', async (_e, path: string) => setWorkspaceRoot(path))

ipcMain.handle('sessions:list', async () => loadSessions())
ipcMain.handle('sessions:create', async () => createSession('New Chat'))
ipcMain.handle('sessions:delete', async (_e, id: string) => deleteSession(id))
ipcMain.handle('sessions:get', async (_e, id: string) => getSession(id))
ipcMain.handle('sessions:rename', async (_e, id: string, title: string) => renameSession(id, title))
ipcMain.handle('sessions:update', async (_e, session) => updateSession(session))
ipcMain.handle('sessions:clearAll', async () => {
  clearAllSessions()
  return createSession('New Chat')
})

ipcMain.handle('sessions:resetFresh', async () => resetSessionsToEmpty())
ipcMain.handle('sessions:setDraft', async (_e, id: string, draft: string) => {
  setDraft(id, draft)
  return true
})

ipcMain.handle('config:set', async (_e, config: ChatConfig) => {
  const prefs = loadPrefs()
  prefs.config = config
  savePrefs(prefs)
  return config
})

ipcMain.handle('kb:attach', async (_e, chatId: string, opts?: { folderOnly?: boolean }) => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: opts?.folderOnly ? 'Attach folder to this chat' : 'Attach knowledge to this chat',
    properties: opts?.folderOnly
      ? ['openDirectory', 'multiSelections']
      : ['openFile', 'openDirectory', 'multiSelections']
  })
  if (res.canceled || !res.filePaths.length) {
    return { sources: listKnowledge(chatId), added: 0 }
  }
  send('kb:progress', { chatId, status: 'ingesting' })
  const result = attachKnowledge(chatId, res.filePaths)
  const session = getSession(chatId)
  if (session) {
    session.kbPaths = result.sources
    updateSession(session)
  }
  send('kb:progress', { chatId, status: 'done', ...result })
  return result
})

ipcMain.handle('kb:list', async (_e, chatId: string) => listKnowledge(chatId))
ipcMain.handle('kb:stats', async (_e, chatId: string) => knowledgeStats(chatId))
ipcMain.handle('kb:clear', async (_e, chatId: string) => {
  clearKnowledge(chatId)
  const session = getSession(chatId)
  if (session) {
    session.kbPaths = []
    updateSession(session)
  }
  return true
})
ipcMain.handle('kb:search', async (_e, chatId: string, query: string) =>
  searchKnowledge(chatId, query)
)
ipcMain.handle('agent:tools', async () => [...GRAMMAR_TOOLS])

ipcMain.handle('clipboard:write', async (_e, text: string) => {
  clipboard.writeText(text)
  return true
})

ipcMain.handle('chat:export', async (_e, sessionId: string, format: 'md' | 'json') => {
  const session = getSession(sessionId)
  if (!session) return { ok: false }
  const res = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export chat',
    defaultPath: `${session.title.replace(/[^\w.-]+/g, '_')}.${format === 'md' ? 'md' : 'json'}`
  })
  if (res.canceled || !res.filePath) return { ok: false }
  if (format === 'json') {
    writeFileSync(res.filePath, JSON.stringify(session, null, 2), 'utf8')
  } else {
    const md = [`# ${session.title}`, '', ...session.messages.map((m) => `## ${m.role}\n\n${m.content}\n`)].join(
      '\n'
    )
    writeFileSync(res.filePath, md, 'utf8')
  }
  return { ok: true, path: res.filePath }
})

ipcMain.handle('composer:pickFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Attach files',
    properties: ['openFile', 'multiSelections']
  })
  if (res.canceled) return []
  return res.filePaths
})

ipcMain.handle(
  'chat:send',
  async (
    _e,
    payload: {
      sessionId: string
      content: string
      model: string
      config: ChatConfig
      mode?: 'chat' | 'summarise' | 'plan' | 'research' | 'build'
      agentMode?: boolean
      useKb?: boolean
      selectedTemplateId?: string | null
      imageMode?: boolean
    }
  ) => {
    const { sessionId, content, model, config } = payload
    const mode = payload.mode || 'chat'
    const useKb = payload.useKb !== false
    const runId = randomUUID()
    const ac = new AbortController()
    abortControllers.set(runId, ac)

    const session = getSession(sessionId)
    if (session) {
      session.model = model
      session.draft = ''
      updateSession(session)
    }

    appendMessage(sessionId, 'user', content)
    send('chat:user', { sessionId, content })

    try {
      if (payload.imageMode || (config.imageGeneration && /\bimage\b/i.test(content))) {
        send('chat:status', { sessionId, status: 'image' })
        const img = generateLocalImage(content.replace(/^\/image\s*/i, ''), '512')
        const assistantText = img.ok
          ? `Generated image with \`${img.backend}\`:\n\n\`${img.path}\`\n\n${img.safetyNote || ''}`
          : `Image generation failed: ${img.error}\n\n${imageBackendHelp()}`
        appendMessage(sessionId, 'assistant', assistantText, {
          kind: img.ok ? 'files' : 'error',
          paths: img.path ? [img.path] : []
        })
        send('chat:done', {
          sessionId,
          content: assistantText,
          files: img.path ? [img.path] : [],
          runId
        })
        return { ok: img.ok, runId, path: img.path }
      }

      const createIntent =
        isCreateFilesIntent(content) ||
        detectScaffoldIntent(content) !== null ||
        detectQuickBuild(content) ||
        Boolean(payload.selectedTemplateId)
      // Create intents always force the write-files agent — never prose-only chat theater
      // Plain chat (agentMode off): never silently enter file-writing agent.
      // Create intents still force the write-files path (Lee's disk bar).
      const coding =
        createIntent ||
        (payload.agentMode !== false && (mode === 'build' || wantsCodingAgent(content)))
      const planOnly = mode === 'plan' && payload.agentMode !== false && !createIntent

      if (coding || planOnly) {
        send('chat:status', { sessionId, status: 'agent' })
        let result
        try {
          const boundPath =
            session?.projectPath &&
            typeof session.projectPath === 'string' &&
            session.projectPath.length
              ? session.projectPath
              : null
          // Re-copy template only when this chat has no bound project yet
          const templateId =
            payload.selectedTemplateId &&
            boundPath &&
            session?.selectedTemplateId === payload.selectedTemplateId
              ? null
              : payload.selectedTemplateId
          result = await runCodingAgent({
            prompt: content,
            chatId: sessionId,
            model,
            config,
            signal: ac.signal,
            onStep: (step) => send('agent:step', { sessionId, step }),
            selectedTemplateId: templateId,
            boundProjectPath: boundPath,
            forceKind:
              createIntent && !templateId && !boundPath
                ? detectScaffoldIntent(content) || undefined
                : undefined,
            phase: planOnly ? 'plan' : 'act'
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (/already active/i.test(msg)) {
            appendMessage(sessionId, 'assistant', msg, { kind: 'error' })
            send('chat:done', { sessionId, content: msg, files: [], runId, ok: false })
            return { ok: false, runId, error: msg }
          }
          throw err
        }
        const verified = verifyFilesOnDisk(result.filesCreated)
        const files = verified.ok
        const failedCreate = createIntent && files.length === 0
        const citations = useKb ? searchKnowledge(sessionId, content).map((h) => h.path) : []
        let assistantText = result.message
        if (failedCreate) {
          assistantText =
            `I could not create any files on disk for that request.\n\n` +
            `Workspace: \`${result.projectPath || 'unknown'}\`\n` +
            `Try again with “make a website called MySite in a folder”, or check Workspace settings.\n\n` +
            result.message
        } else if (files.length) {
          assistantText +=
            `\n\n**Verified on disk**\n` +
            files
              .map((f) => {
                try {
                  return `- \`${f}\` (${statSync(f).size} bytes)`
                } catch {
                  return `- \`${f}\``
                }
              })
              .join('\n')
        }
        if (result.projectPath && !failedCreate) {
          setSessionProject(
            sessionId,
            result.projectPath,
            payload.selectedTemplateId ?? session?.selectedTemplateId ?? null
          )
        }
        appendMessage(sessionId, 'assistant', assistantText, {
          kind: failedCreate ? 'error' : 'files',
          paths: files,
          citations
        })
        send('chat:done', {
          sessionId,
          content: assistantText,
          projectPath: result.projectPath,
          files,
          citations,
          runId,
          ok: !failedCreate && result.ok,
          checkpointId: result.checkpointId
        })
        return {
          ok: !failedCreate && result.ok,
          runId,
          projectPath: result.projectPath,
          files,
          checkpointId: result.checkpointId
        }
      }

      const fresh = getSession(sessionId)
      const kb = useKb ? knowledgeContext(sessionId, content) : ''
      const citations = useKb ? searchKnowledge(sessionId, content).map((h) => h.path) : []
      let system =
        config.systemPrompt?.trim() ||
        'You are Tri Cass AI, a local coding assistant. Be practical and concise.'
      if (mode === 'summarise') system += ' Summarise clearly in short bullets.'
      if (mode === 'research') system += ' Research-style answer using attached knowledge when present.'
      // mode === 'plan' is handled by the coding-agent branch above (Plan phase + save_plan)
      if (kb) system += `\n\n${kb}`

      const history = historyToPayload(fresh?.messages || [])
      send('chat:status', { sessionId, status: 'streaming' })

      let full = ''
      if (config.streaming) {
        full = await chatStream(
          history,
          {
            model,
            temperature: config.temperature,
            topP: config.topP,
            maxTokens: config.maxTokens,
            system,
            signal: ac.signal
          },
          (chunk) => send('chat:token', { sessionId, chunk, runId })
        )
      } else {
        full = await chatOnce(history, {
          model,
          temperature: config.temperature,
          topP: config.topP,
          maxTokens: config.maxTokens,
          system,
          signal: ac.signal
        })
        send('chat:token', { sessionId, chunk: full, runId })
      }

      appendMessage(sessionId, 'assistant', full, citations.length ? { citations } : undefined)
      send('chat:done', { sessionId, content: full, citations, runId })
      return { ok: true, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const aborted = message.toLowerCase().includes('abort')
      const text = aborted ? '_Generation stopped._' : `Error: ${message}`
      appendMessage(sessionId, 'assistant', text, { kind: aborted ? undefined : 'error' })
      send('chat:error', { sessionId, error: message, aborted, runId })
      return { ok: false, error: message, runId }
    } finally {
      abortControllers.delete(runId)
    }
  }
)

ipcMain.handle('chat:stop', async (_e, runId?: string) => {
  if (runId && abortControllers.has(runId)) {
    abortControllers.get(runId)!.abort()
    abortControllers.delete(runId)
    return true
  }
  for (const [, ac] of abortControllers) ac.abort()
  abortControllers.clear()
  return true
})

function detectQuickBuild(content: string): boolean {
  return (
    /\bmake (me )?(that |this )?(a |an )?(website|web site|site|app|android|electron)\b/i.test(
      content
    ) || /\b(website|app|site)\b.{0,30}\bin a folder\b/i.test(content)
  )
}

ipcMain.handle('templates:status', async () => getPackStatus())
ipcMain.handle('templates:search', async (_e, opts) => searchTemplates(opts || {}))
ipcMain.handle('templates:download', async (_e, opts?: { extras?: boolean }) => {
  try {
    const status = await downloadTemplatePack((p) => send('templates:packProgress', p), opts)
    return { ok: true, status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: getPackStatus() }
  }
})
ipcMain.handle('templates:cancelDownload', async () => cancelPackDownload())
ipcMain.handle('templates:use', async (_e, id: string, name?: string) => useTemplate(id, name))
ipcMain.handle('templates:favorite', async (_e, id: string) => toggleFavorite(id))
ipcMain.handle('templates:random', async () => randomTemplate())
ipcMain.handle('templates:get', async (_e, id: string) => getTemplate(id))
ipcMain.handle('templates:diskEstimate', async () => estimatePackDiskMb())
ipcMain.handle('templates:preview', async (_e, id: string) => {
  const tpl = getTemplate(id)
  if (!tpl?.preview) return { ok: false }
  await shell.openPath(tpl.preview)
  return { ok: true, path: tpl.preview }
})
ipcMain.handle('templates:openFolder', async (_e, path: string) => {
  await shell.openPath(path)
  return true
})

ipcMain.handle(
  'image:generate',
  async (
    _e,
    prompt: string,
    size?: '512' | '768' | '1024',
    quality?: 'standard' | 'detailed'
  ) => generateLocalImage(prompt, size || '512', undefined, quality || 'detailed')
)
ipcMain.handle('image:history', async () => imageHistory())
ipcMain.handle('image:help', async () => imageBackendHelp())

ipcMain.handle('ascii:fonts', async () => listAsciiFonts())
ipcMain.handle('ascii:text', async (_e, text: string, font?: string) => textToAscii(text, font || 'Standard'))
ipcMain.handle('ascii:image', async (_e, imagePath: string, maxWidth?: number) =>
  imageToAscii(imagePath, maxWidth || 80)
)
ipcMain.handle('ascii:save', async (_e, ascii: string, name?: string) => saveAscii(ascii, name))
ipcMain.handle('ascii:toPng', async (_e, ascii: string, name?: string) => asciiToPng(ascii, name))

ipcMain.handle('window:new', () => {
  createWindow()
  return true
})

ipcMain.handle('sessions:fork', async (_e, id: string, messageId: string) =>
  forkSessionFromMessage(id, messageId)
)
ipcMain.handle('sessions:deletePair', async (_e, id: string, messageId: string) =>
  deleteMessagePair(id, messageId)
)
ipcMain.handle('sessions:setFolder', async (_e, id: string, folder: string | null) =>
  setSessionFolder(id, folder)
)
ipcMain.handle(
  'sessions:setProject',
  async (_e, id: string, projectPath: string | null, templateId?: string | null) =>
    setSessionProject(id, projectPath, templateId)
)
ipcMain.handle('sessions:import', async (_e, raw: unknown) => importSession(raw))
ipcMain.handle('data:exportAll', async () => {
  const data = exportAllData()
  const res = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export all Tri Cass AI data',
    defaultPath: 'tri-cass-ai-backup.json'
  })
  if (res.canceled || !res.filePath) return { ok: false }
  writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8')
  return { ok: true, path: res.filePath }
})
ipcMain.handle('data:importBackup', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  try {
    const raw = JSON.parse(readFileSync(res.filePaths[0], 'utf8')) as {
      sessions?: unknown[]
    }
    let n = 0
    for (const s of raw.sessions || []) {
      if (importSession(s)) n++
    }
    return { ok: true, imported: n }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('kb:reindex', async (_e, chatId: string) => reindexKnowledge(chatId))
ipcMain.handle('kb:remove', async (_e, chatId: string, names: string[]) => {
  const sources = removeKnowledgeSources(chatId, names)
  const session = getSession(chatId)
  if (session) {
    session.kbPaths = sources
    updateSession(session)
  }
  return sources
})
ipcMain.handle('kb:failures', async (_e, chatId: string) => knowledgeFailures(chatId))
ipcMain.handle('kb:types', async () => kbSupportedTypes())
ipcMain.handle('kb:workspaceAttach', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Attach workspace knowledge',
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  if (res.canceled || !res.filePaths.length) return { sources: listWorkspaceKnowledge(), added: 0 }
  return attachWorkspaceKnowledge(res.filePaths)
})
ipcMain.handle('kb:workspaceList', async () => listWorkspaceKnowledge())

ipcMain.handle('checkpoint:create', async (_e, projectPath: string, label?: string) =>
  createCheckpoint(projectPath, label)
)
ipcMain.handle('checkpoint:list', async () => listCheckpoints())
ipcMain.handle('checkpoint:rollback', async (_e, id: string) => rollbackCheckpoint(id))
ipcMain.handle('runtimes:detect', async () => {
  const info = detectRuntimes()
  return { ...info, summary: formatRuntimeGuidance(info) }
})
ipcMain.handle('templates:undo', async () => undoLastTemplateApply())

ipcMain.handle('diag:text', async () => buildDiagnostics())
ipcMain.handle('diag:ram', async () => detectRamGb())
ipcMain.handle('diag:disk', async () => detectFreeDiskRough())
ipcMain.handle('diag:openLogs', async () => {
  await shell.openPath(logsDir())
  return true
})

ipcMain.handle('web:search', async (_e, q: string) => webSearch(q))
ipcMain.handle('web:fetch', async (_e, url: string) => fetchUrl(url))

ipcMain.handle('workspace:pin', async (_e, path: string, pinned: boolean) => {
  pinWorkspace(path, pinned)
  return getWorkspaceInfo()
})
ipcMain.handle('workspace:createFolder', async (_e, name: string) => createWorkspaceFolder(name))
ipcMain.handle('workspace:cancelCommand', async (_e, id?: string) => cancelCommand(id))
ipcMain.handle('workspace:touchRecent', async (_e, path: string) => {
  touchRecentWorkspace(path)
  return getWorkspaceInfo()
})

ipcMain.handle('project:inspect', async (_e, projectPath: string) => {
  try {
    return { ok: true, ...inspectProject(projectPath) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle(
  'project:run',
  async (_e, projectPath: string, action: RunAction, command?: string) => {
    try {
      const record = await startProjectRun(projectPath, action, {
        command,
        onChunk: (chunk) => send('project:runChunk', { ...chunk, projectPath })
      })
      send('project:runDone', record)
      return { ok: true, run: record }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      send('project:runDone', { ok: false, error, projectPath })
      return { ok: false, error }
    }
  }
)
ipcMain.handle('project:stop', async (_e, id?: string) => stopProjectRun(id))
ipcMain.handle('project:lastRun', async () => getLastRun())
ipcMain.handle('project:readFile', async (_e, projectPath: string, rel: string) =>
  readProjectFile(projectPath, rel)
)

ipcMain.handle('tray:set', async (_e, enabled: boolean) => {
  const prefs = loadPrefs()
  prefs.config = { ...prefs.config, trayEnabled: enabled }
  savePrefs(prefs)
  if (enabled && !tray) {
    const iconPath = resolveAppIcon()
    const img = existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty()
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
    tray.setToolTip('Tri Cass AI')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: () => mainWindow?.show() },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  } else if (!enabled && tray) {
    tray.destroy()
    tray = null
  }
  return enabled
})

ipcMain.handle('config:reset', async () => {
  const prefs = loadPrefs()
  prefs.config = { ...DEFAULT_CONFIG }
  savePrefs(prefs)
  return prefs.config
})

ipcMain.handle('wallpapers:list', async () => listWallpapers())
ipcMain.handle('wallpapers:add', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Add wallpaper / texture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  })
  if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'cancelled' }
  return addCustomWallpaper(res.filePaths[0])
})
ipcMain.handle('wallpapers:remove', async (_e, id: string) => removeCustomWallpaper(id))
ipcMain.handle('wallpapers:dataUrl', async (_e, id: string) => {
  const roots = [
    join(__dirname, '../renderer/textures'),
    join(process.resourcesPath || '', 'textures'),
    join(app.getAppPath(), 'src/renderer/public/textures'),
    join(process.cwd(), 'src/renderer/public/textures'),
    join(process.cwd(), 'build/textures')
  ]
  for (const root of roots) {
    const hit = wallpaperDataUrl(id, root)
    if (hit.ok && hit.url?.startsWith('data:')) return hit
  }
  return wallpaperDataUrl(id)
})
