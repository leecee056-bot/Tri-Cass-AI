import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  clipboard
} from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { MODEL_CATALOG, DEFAULT_MODEL_TAG } from '../shared/catalog'
import type { ChatConfig, PullProgress } from '../shared/types'
import { ollamaStatus, chatStream, chatOnce, pullModel, historyToPayload } from './services/ollama'
import { runCodingAgent, wantsCodingAgent } from './services/agent'
import {
  getWorkspaceInfo,
  setWorkspaceRoot,
  getWorkspaceRoot
} from './services/workspace'
import {
  attachKnowledge,
  listKnowledge,
  clearKnowledge,
  knowledgeContext,
  searchKnowledge
} from './services/knowledge'
import {
  loadSessions,
  createSession,
  getSession,
  appendMessage,
  updateSession,
  deleteSession,
  renameSession,
  clearAllSessions,
  setDraft
} from './services/chatStore'
import { loadPrefs, savePrefs, DEFAULT_CONFIG } from './services/paths'

let mainWindow: BrowserWindow | null = null
const abortControllers = new Map<string, AbortController>()
let activePullId: string | null = null
const VERSION = '0.1.0'

function createWindow(): void {
  const prefs = loadPrefs()
  const bounds = prefs.windowBounds
  mainWindow = new BrowserWindow({
    width: bounds?.width || 1280,
    height: bounds?.height || 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'Tri Cass AI',
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

  mainWindow.once('ready-to-show', () => mainWindow?.show())

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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

ipcMain.handle('kb:attach', async (_e, chatId: string) => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Attach knowledge to this chat',
    properties: ['openFile', 'openDirectory', 'multiSelections']
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

    const coding =
      payload.agentMode !== false &&
      (mode === 'build' || wantsCodingAgent(content) || detectQuickBuild(content))

    try {
      if (coding) {
        send('chat:status', { sessionId, status: 'agent' })
        const result = await runCodingAgent({
          prompt: content,
          chatId: sessionId,
          model,
          config,
          signal: ac.signal,
          onStep: (step) => send('agent:step', { sessionId, step })
        })
        const citations = useKb ? searchKnowledge(sessionId, content).map((h) => h.path) : []
        const assistantText =
          result.message +
          (result.filesCreated.length
            ? `\n\n**Files created**\n${result.filesCreated.map((f) => `- \`${f}\``).join('\n')}`
            : '')
        appendMessage(sessionId, 'assistant', assistantText, {
          kind: 'files',
          paths: result.filesCreated,
          citations
        })
        send('chat:done', {
          sessionId,
          content: assistantText,
          projectPath: result.projectPath,
          files: result.filesCreated,
          citations,
          runId
        })
        return { ok: result.ok, runId, projectPath: result.projectPath }
      }

      const fresh = getSession(sessionId)
      const kb = useKb ? knowledgeContext(sessionId, content) : ''
      const citations = useKb ? searchKnowledge(sessionId, content).map((h) => h.path) : []
      let system =
        config.systemPrompt?.trim() ||
        'You are Tri Cass AI, a local coding assistant. Be practical and concise.'
      if (mode === 'summarise') system += ' Summarise clearly in short bullets.'
      if (mode === 'plan') system += ' Produce a numbered implementation plan.'
      if (mode === 'research') system += ' Research-style answer using attached knowledge when present.'
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
  return /\bmake (that |this )?(a |an )?(website|web site|app)\b/i.test(content)
}
