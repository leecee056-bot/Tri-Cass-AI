import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { ChatConfig } from '../../shared/types'

export type PersistedPrefs = {
  workspaceRoot: string
  selectedModel: string | null
  config: ChatConfig
  windowBounds?: { x?: number; y?: number; width: number; height: number; isMaximized?: boolean }
  recentWorkspaces?: string[]
  pinnedWorkspaces?: string[]
  workspaceMeta?: Record<
    string,
    { defaultModel?: string; instructions?: string; rules?: string }
  >
}

export const DEFAULT_CONFIG: ChatConfig = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  streaming: true,
  webSearch: false,
  codeInterpreter: true,
  imageGeneration: false,
  fileAnalysis: true,
  appearance: 'dark',
  wallpaperId: 'digital',
  customWallpaperIds: [],
  fontSize: 15,
  systemPrompt:
    'You are Tri Cass AI, a local coding assistant. Be practical and concise. The user does not need to code — help them create websites, apps, Android scaffolds, images, and ASCII by asking in plain English. Help plan, research, and create software on this machine. Ask clarifying questions when platform (web vs Android) is unclear.',
  enterToSend: true,
  autoApproveCommands: true,
  defaultPlatform: 'auto',
  imageBackend: 'procedural-png@1',
  imageQuality: 'detailed',
  templatePackPath: '',
  trayEnabled: false,
  relativeTimestamps: true,
  locale: 'en-GB',
  ollamaUrl: 'http://127.0.0.1:11434',
  proxyUrl: '',
  welcomeDismissed: false,
  voiceEnabled: false,
  kbScope: 'chat'
}

function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

function electronUserData(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath: (name: string) => string } }
    if (electron?.app?.getPath) return electron.app.getPath('userData')
  } catch {
    /* not in electron */
  }
  return null
}

export function userDataRoot(): string {
  const fromEnv = process.env.TRI_CASS_USER_DATA
  if (fromEnv) return ensureDir(fromEnv)
  const electronPath = electronUserData()
  if (electronPath) return ensureDir(electronPath)
  return ensureDir(join(homedir(), '.tri-cass-ai'))
}

export function defaultWorkspaceRoot(): string {
  return ensureDir(join(homedir(), 'TriCassAI', 'projects'))
}

export function prefsPath(): string {
  return join(userDataRoot(), 'prefs.json')
}

export function sessionsPath(): string {
  return join(userDataRoot(), 'sessions.json')
}

export function logsDir(): string {
  return ensureDir(join(userDataRoot(), 'logs'))
}

export function kbRoot(chatId: string): string {
  return ensureDir(join(userDataRoot(), 'kb', chatId))
}

/** Recover corrupt JSON stores by renaming aside and returning fallback. */
export function readJsonSafe<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      /* ignore */
    }
    return fallback
  }
}

export function loadPrefs(): PersistedPrefs {
  const raw = readJsonSafe<Partial<PersistedPrefs>>(prefsPath(), {})
  try {
    return {
      workspaceRoot: raw.workspaceRoot || defaultWorkspaceRoot(),
      selectedModel: raw.selectedModel ?? null,
      config: { ...DEFAULT_CONFIG, ...(raw.config || {}) },
      windowBounds: raw.windowBounds,
      recentWorkspaces: raw.recentWorkspaces || [],
      pinnedWorkspaces: raw.pinnedWorkspaces || [],
      workspaceMeta: raw.workspaceMeta || {}
    }
  } catch {
    return {
      workspaceRoot: defaultWorkspaceRoot(),
      selectedModel: null,
      config: { ...DEFAULT_CONFIG },
      recentWorkspaces: [],
      pinnedWorkspaces: [],
      workspaceMeta: {}
    }
  }
}

export function savePrefs(prefs: PersistedPrefs): void {
  ensureDir(userDataRoot())
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf8')
}
