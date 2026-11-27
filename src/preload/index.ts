import { contextBridge, ipcRenderer } from 'electron'
import type { ChatConfig, CatalogModel, PullProgress, AgentStep } from '../shared/types'

export type TriCassAPI = {
  getSnapshot: () => Promise<unknown>
  ollamaStatus: () => Promise<unknown>
  getCatalog: () => Promise<CatalogModel[]>
  setSelectedModel: (model: string) => Promise<string>
  pullModel: (model: string) => Promise<{ ok: boolean; error?: string; model?: string }>
  workspaceInfo: () => Promise<unknown>
  pickWorkspace: () => Promise<unknown>
  openWorkspace: (path?: string) => Promise<boolean>
  setWorkspaceRoot: (path: string) => Promise<unknown>
  listSessions: () => Promise<unknown>
  createSession: () => Promise<unknown>
  deleteSession: (id: string) => Promise<unknown>
  getSession: (id: string) => Promise<unknown>
  setConfig: (config: ChatConfig) => Promise<ChatConfig>
  kbAttach: (chatId: string) => Promise<unknown>
  kbList: (chatId: string) => Promise<string[]>
  kbClear: (chatId: string) => Promise<boolean>
  chatSend: (payload: {
    sessionId: string
    content: string
    model: string
    config: ChatConfig
    mode?: 'chat' | 'summarise' | 'plan' | 'research' | 'build'
  }) => Promise<unknown>
  chatStop: (runId?: string) => Promise<boolean>
  on: (channel: string, handler: (payload: unknown) => void) => () => void
}

const allowed = new Set([
  'chat:token',
  'chat:done',
  'chat:error',
  'chat:status',
  'chat:user',
  'agent:step',
  'models:pullProgress'
])

const api: TriCassAPI = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  getCatalog: () => ipcRenderer.invoke('models:catalog'),
  setSelectedModel: (model) => ipcRenderer.invoke('models:setSelected', model),
  pullModel: (model) => ipcRenderer.invoke('models:pull', model),
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  openWorkspace: (path) => ipcRenderer.invoke('workspace:open', path),
  setWorkspaceRoot: (path) => ipcRenderer.invoke('workspace:setRoot', path),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  createSession: () => ipcRenderer.invoke('sessions:create'),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  kbAttach: (chatId) => ipcRenderer.invoke('kb:attach', chatId),
  kbList: (chatId) => ipcRenderer.invoke('kb:list', chatId),
  kbClear: (chatId) => ipcRenderer.invoke('kb:clear', chatId),
  chatSend: (payload) => ipcRenderer.invoke('chat:send', payload),
  chatStop: (runId) => ipcRenderer.invoke('chat:stop', runId),
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

export type { PullProgress, AgentStep }
