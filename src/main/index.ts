import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu
} from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
  knowledgeContext
} from './services/knowledge'
import {
  loadSessions,
  createSession,
  getSession,
  appendMessage,
  updateSession,
  deleteSession
} from './services/chatStore'
import { loadPrefs, savePrefs } from './services/paths'

let mainWindow: BrowserWindow | null = null
const abortControllers = new Map<string, AbortController>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0f0c',
    title: 'Tri Cass AI',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

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
    activeSessionId: sessions[0]?.id ?? null,
    selectedModel: prefs.selectedModel || ollama.models[0]?.name || DEFAULT_MODEL_TAG,
    config: prefs.config,
    catalog: MODEL_CATALOG
  }
})

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
  try {
    await pullModel(
      model,
      (p: PullProgress) => send('models:pullProgress', p),
      ac.signal
    )
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
  }
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
  const target = path || getWorkspaceRoot()
  await shell.openPath(target)
  return true
})

ipcMain.handle('workspace:setRoot', async (_e, path: string) => setWorkspaceRoot(path))

ipcMain.handle('sessions:list', async () => loadSessions())

ipcMain.handle('sessions:create', async () => createSession('New Chat'))

ipcMain.handle('sessions:delete', async (_e, id: string) => {
  deleteSession(id)
  return loadSessions()
})

ipcMain.handle('sessions:get', async (_e, id: string) => getSession(id))

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
  const result = attachKnowledge(chatId, res.filePaths)
  const session = getSession(chatId)
  if (session) {
    session.kbPaths = result.sources
    updateSession(session)
  }
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
    }
  ) => {
    const { sessionId, content, model, config } = payload
    const mode = payload.mode || 'chat'
    const runId = randomUUID()
    const ac = new AbortController()
    abortControllers.set(runId, ac)

    appendMessage(sessionId, 'user', content)
    send('chat:user', { sessionId, content })

    const coding =
      mode === 'build' || wantsCodingAgent(content) || detectQuickBuild(content)

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
        const assistantText =
          result.message +
          (result.filesCreated.length
            ? `\n\nFiles:\n${result.filesCreated.map((f) => `- ${f}`).join('\n')}`
            : '')
        appendMessage(sessionId, 'assistant', assistantText, {
          kind: 'files',
          paths: result.filesCreated
        })
        send('chat:done', {
          sessionId,
          content: assistantText,
          projectPath: result.projectPath,
          files: result.filesCreated,
          runId
        })
        return { ok: result.ok, runId, projectPath: result.projectPath }
      }

      const session = getSession(sessionId)
      const kb = knowledgeContext(sessionId, content)
      let system =
        'You are Tri Cass AI, a local coding assistant. Be practical and concise. Help the user plan, research, and create software on their machine. Never claim cloud APIs are required.'
      if (mode === 'summarise') system += ' Summarise clearly in short bullets.'
      if (mode === 'plan') system += ' Produce a numbered implementation plan.'
      if (mode === 'research') system += ' Research-style answer using attached knowledge when present.'
      if (kb) system += `\n\n${kb}`

      const history = historyToPayload(session?.messages || [])
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

      appendMessage(sessionId, 'assistant', full)
      send('chat:done', { sessionId, content: full, runId })
      return { ok: true, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendMessage(sessionId, 'assistant', `Error: ${message}`, { kind: 'error' })
      send('chat:error', { sessionId, error: message, runId })
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
