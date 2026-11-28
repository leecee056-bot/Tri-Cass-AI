import { contextBridge, ipcRenderer } from 'electron'
import type { ChatConfig, CatalogModel, ChatSession } from '../shared/types'

export type TriCassAPI = {
  getSnapshot: () => Promise<unknown>
  getVersion: () => Promise<string>
  ollamaStatus: () => Promise<unknown>
  getCatalog: () => Promise<CatalogModel[]>
  setSelectedModel: (model: string) => Promise<string>
  pullModel: (model: string) => Promise<{ ok: boolean; error?: string; model?: string }>
  cancelPull: () => Promise<boolean>
  deleteModel: (model: string) => Promise<{ ok: boolean; error?: string }>
  workspaceInfo: () => Promise<unknown>
  pickWorkspace: () => Promise<unknown>
  openWorkspace: (path?: string) => Promise<boolean>
  setWorkspaceRoot: (path: string) => Promise<unknown>
  listSessions: () => Promise<ChatSession[]>
  createSession: () => Promise<ChatSession>
  deleteSession: (id: string) => Promise<ChatSession[]>
  getSession: (id: string) => Promise<ChatSession | null>
  renameSession: (id: string, title: string) => Promise<ChatSession | null>
  updateSession: (session: ChatSession) => Promise<ChatSession>
  clearAllSessions: () => Promise<ChatSession>
  setDraft: (id: string, draft: string) => Promise<boolean>
  setConfig: (config: ChatConfig) => Promise<ChatConfig>
  kbAttach: (chatId: string, opts?: { folderOnly?: boolean }) => Promise<unknown>
  kbList: (chatId: string) => Promise<string[]>
  kbStats: (chatId: string) => Promise<unknown>
  kbClear: (chatId: string) => Promise<boolean>
  kbSearch: (chatId: string, query: string) => Promise<unknown>
  agentTools: () => Promise<string[]>
  pickFiles: () => Promise<string[]>
  exportChat: (sessionId: string, format: 'md' | 'json') => Promise<unknown>
  clipboardWrite: (text: string) => Promise<boolean>
  chatSend: (payload: {
    sessionId: string
    content: string
    model: string
    config: ChatConfig
    mode?: 'chat' | 'summarise' | 'plan' | 'research' | 'build'
    agentMode?: boolean
    useKb?: boolean
    selectedTemplateId?: string | null
    imageMode?: boolean
  }) => Promise<unknown>
  chatStop: (runId?: string) => Promise<boolean>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<boolean>
  windowClose: () => Promise<boolean>
  windowIsMaximized: () => Promise<boolean>
  templatesStatus: () => Promise<unknown>
  templatesSearch: (opts: unknown) => Promise<unknown>
  templatesDownload: (opts?: { extras?: boolean }) => Promise<unknown>
  templatesCancelDownload: () => Promise<boolean>
  templatesUse: (id: string, name?: string) => Promise<unknown>
  templatesFavorite: (id: string) => Promise<unknown>
  templatesRandom: () => Promise<unknown>
  templatesGet: (id: string) => Promise<unknown>
  templatesDiskEstimate: () => Promise<number>
  templatesPreview: (id: string) => Promise<unknown>
  templatesOpenFolder: (path: string) => Promise<boolean>
  imageGenerate: (
    prompt: string,
    size?: '512' | '768' | '1024',
    quality?: 'standard' | 'detailed'
  ) => Promise<unknown>
  imageHistory: () => Promise<unknown>
  imageHelp: () => Promise<string>
  asciiFonts: () => Promise<string[]>
  asciiText: (text: string, font?: string) => Promise<unknown>
  asciiImage: (imagePath: string, maxWidth?: number) => Promise<unknown>
  asciiSave: (ascii: string, name?: string) => Promise<unknown>
  asciiToPng: (ascii: string, name?: string) => Promise<unknown>
  windowNew: () => Promise<boolean>
  sessionsFork: (id: string, messageId: string) => Promise<unknown>
  sessionsDeletePair: (id: string, messageId: string) => Promise<unknown>
  sessionsSetFolder: (id: string, folder: string | null) => Promise<unknown>
  sessionsImport: (raw: unknown) => Promise<unknown>
  dataExportAll: () => Promise<unknown>
  dataImportBackup: () => Promise<unknown>
  kbReindex: (chatId: string) => Promise<unknown>
  kbRemove: (chatId: string, names: string[]) => Promise<unknown>
  kbFailures: (chatId: string) => Promise<unknown>
  kbTypes: () => Promise<string>
  kbWorkspaceAttach: () => Promise<unknown>
  kbWorkspaceList: () => Promise<string[]>
  checkpointCreate: (projectPath: string, label?: string) => Promise<unknown>
  checkpointList: () => Promise<unknown>
  checkpointRollback: (id: string) => Promise<unknown>
  runtimesDetect: () => Promise<unknown>
  templatesUndo: () => Promise<unknown>
  diagText: () => Promise<string>
  diagRam: () => Promise<number>
  diagDisk: () => Promise<unknown>
  diagOpenLogs: () => Promise<boolean>
  webSearch: (q: string) => Promise<unknown>
  webFetch: (url: string) => Promise<unknown>
  workspacePin: (path: string, pinned: boolean) => Promise<unknown>
  workspaceCreateFolder: (name: string) => Promise<string>
  traySet: (enabled: boolean) => Promise<boolean>
  configReset: () => Promise<ChatConfig>
  wallpapersList: () => Promise<unknown>
  wallpaperAdd: () => Promise<unknown>
  wallpaperRemove: (id: string) => Promise<unknown>
  wallpaperDataUrl: (id: string) => Promise<unknown>
  projectInspect: (projectPath: string) => Promise<unknown>
  projectRun: (projectPath: string, action: 'install' | 'start' | 'custom', command?: string) => Promise<unknown>
  projectStop: (id?: string) => Promise<unknown>
  projectLastRun: () => Promise<unknown>
  projectReadFile: (projectPath: string, rel: string) => Promise<unknown>
  on: (channel: string, handler: (payload: unknown) => void) => () => void
}

const allowed = new Set([
  'chat:token',
  'chat:done',
  'chat:error',
  'chat:status',
  'chat:user',
  'agent:step',
  'models:pullProgress',
  'kb:progress',
  'templates:packProgress',
  'project:runChunk',
  'project:runDone'
])

const api: TriCassAPI = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  getCatalog: () => ipcRenderer.invoke('models:catalog'),
  setSelectedModel: (model) => ipcRenderer.invoke('models:setSelected', model),
  pullModel: (model) => ipcRenderer.invoke('models:pull', model),
  cancelPull: () => ipcRenderer.invoke('models:cancelPull'),
  deleteModel: (model) => ipcRenderer.invoke('models:delete', model),
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  openWorkspace: (path) => ipcRenderer.invoke('workspace:open', path),
  setWorkspaceRoot: (path) => ipcRenderer.invoke('workspace:setRoot', path),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  createSession: () => ipcRenderer.invoke('sessions:create'),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  renameSession: (id, title) => ipcRenderer.invoke('sessions:rename', id, title),
  updateSession: (session) => ipcRenderer.invoke('sessions:update', session),
  clearAllSessions: () => ipcRenderer.invoke('sessions:clearAll'),
  setDraft: (id, draft) => ipcRenderer.invoke('sessions:setDraft', id, draft),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  kbAttach: (chatId, opts) => ipcRenderer.invoke('kb:attach', chatId, opts),
  kbList: (chatId) => ipcRenderer.invoke('kb:list', chatId),
  kbStats: (chatId) => ipcRenderer.invoke('kb:stats', chatId),
  kbClear: (chatId) => ipcRenderer.invoke('kb:clear', chatId),
  kbSearch: (chatId, query) => ipcRenderer.invoke('kb:search', chatId, query),
  agentTools: () => ipcRenderer.invoke('agent:tools'),
  pickFiles: () => ipcRenderer.invoke('composer:pickFiles'),
  exportChat: (sessionId, format) => ipcRenderer.invoke('chat:export', sessionId, format),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  chatSend: (payload) => ipcRenderer.invoke('chat:send', payload),
  chatStop: (runId) => ipcRenderer.invoke('chat:stop', runId),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  templatesStatus: () => ipcRenderer.invoke('templates:status'),
  templatesSearch: (opts) => ipcRenderer.invoke('templates:search', opts),
  templatesDownload: (opts) => ipcRenderer.invoke('templates:download', opts),
  templatesCancelDownload: () => ipcRenderer.invoke('templates:cancelDownload'),
  templatesUse: (id, name) => ipcRenderer.invoke('templates:use', id, name),
  templatesFavorite: (id) => ipcRenderer.invoke('templates:favorite', id),
  templatesRandom: () => ipcRenderer.invoke('templates:random'),
  templatesGet: (id) => ipcRenderer.invoke('templates:get', id),
  templatesDiskEstimate: () => ipcRenderer.invoke('templates:diskEstimate'),
  templatesPreview: (id) => ipcRenderer.invoke('templates:preview', id),
  templatesOpenFolder: (path) => ipcRenderer.invoke('templates:openFolder', path),
  imageGenerate: (prompt, size, quality) =>
    ipcRenderer.invoke('image:generate', prompt, size, quality),
  imageHistory: () => ipcRenderer.invoke('image:history'),
  imageHelp: () => ipcRenderer.invoke('image:help'),
  asciiFonts: () => ipcRenderer.invoke('ascii:fonts'),
  asciiText: (text, font) => ipcRenderer.invoke('ascii:text', text, font),
  asciiImage: (imagePath, maxWidth) => ipcRenderer.invoke('ascii:image', imagePath, maxWidth),
  asciiSave: (ascii, name) => ipcRenderer.invoke('ascii:save', ascii, name),
  asciiToPng: (ascii, name) => ipcRenderer.invoke('ascii:toPng', ascii, name),
  windowNew: () => ipcRenderer.invoke('window:new'),
  sessionsFork: (id, messageId) => ipcRenderer.invoke('sessions:fork', id, messageId),
  sessionsDeletePair: (id, messageId) => ipcRenderer.invoke('sessions:deletePair', id, messageId),
  sessionsSetFolder: (id, folder) => ipcRenderer.invoke('sessions:setFolder', id, folder),
  sessionsImport: (raw) => ipcRenderer.invoke('sessions:import', raw),
  dataExportAll: () => ipcRenderer.invoke('data:exportAll'),
  dataImportBackup: () => ipcRenderer.invoke('data:importBackup'),
  kbReindex: (chatId) => ipcRenderer.invoke('kb:reindex', chatId),
  kbRemove: (chatId, names) => ipcRenderer.invoke('kb:remove', chatId, names),
  kbFailures: (chatId) => ipcRenderer.invoke('kb:failures', chatId),
  kbTypes: () => ipcRenderer.invoke('kb:types'),
  kbWorkspaceAttach: () => ipcRenderer.invoke('kb:workspaceAttach'),
  kbWorkspaceList: () => ipcRenderer.invoke('kb:workspaceList'),
  checkpointCreate: (projectPath, label) =>
    ipcRenderer.invoke('checkpoint:create', projectPath, label),
  checkpointList: () => ipcRenderer.invoke('checkpoint:list'),
  checkpointRollback: (id) => ipcRenderer.invoke('checkpoint:rollback', id),
  runtimesDetect: () => ipcRenderer.invoke('runtimes:detect'),
  templatesUndo: () => ipcRenderer.invoke('templates:undo'),
  diagText: () => ipcRenderer.invoke('diag:text'),
  diagRam: () => ipcRenderer.invoke('diag:ram'),
  diagDisk: () => ipcRenderer.invoke('diag:disk'),
  diagOpenLogs: () => ipcRenderer.invoke('diag:openLogs'),
  webSearch: (q) => ipcRenderer.invoke('web:search', q),
  webFetch: (url) => ipcRenderer.invoke('web:fetch', url),
  workspacePin: (path, pinned) => ipcRenderer.invoke('workspace:pin', path, pinned),
  workspaceCreateFolder: (name) => ipcRenderer.invoke('workspace:createFolder', name),
  traySet: (enabled) => ipcRenderer.invoke('tray:set', enabled),
  configReset: () => ipcRenderer.invoke('config:reset'),
  wallpapersList: () => ipcRenderer.invoke('wallpapers:list'),
  wallpaperAdd: () => ipcRenderer.invoke('wallpapers:add'),
  wallpaperRemove: (id) => ipcRenderer.invoke('wallpapers:remove', id),
  wallpaperDataUrl: (id) => ipcRenderer.invoke('wallpapers:dataUrl', id),
  projectInspect: (projectPath) => ipcRenderer.invoke('project:inspect', projectPath),
  projectRun: (projectPath, action, command) =>
    ipcRenderer.invoke('project:run', projectPath, action, command),
  projectStop: (id) => ipcRenderer.invoke('project:stop', id),
  projectLastRun: () => ipcRenderer.invoke('project:lastRun'),
  projectReadFile: (projectPath, rel) => ipcRenderer.invoke('project:readFile', projectPath, rel),
  on: (channel, handler) => {
    if (!allowed.has(channel)) return () => undefined
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('triCass', api)

declare global {
  interface Window {
    triCass: TriCassAPI
  }
}
