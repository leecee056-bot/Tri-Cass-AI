import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { ChatConfig } from '../../shared/types'

export type PersistedPrefs = {
  workspaceRoot: string
  selectedModel: string | null
  config: ChatConfig
  windowBounds?: { x?: number; y?: number; width: number; height: number; isMaximized?: boolean }
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
  fontSize: 15,
  systemPrompt:
    'You are Tri Cass AI, a local coding assistant. Be practical and concise. The user does not need to code — help them create websites, apps, Android scaffolds, images, and ASCII by asking in plain English. Help plan, research, and create software on this machine.',
  enterToSend: true,
  autoApproveCommands: true,
  defaultPlatform: 'auto',
  imageBackend: 'procedural-png@1',
  templatePackPath: ''
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

export function kbRoot(chatId: string): string {
  return ensureDir(join(userDataRoot(), 'kb', chatId))
}

export function loadPrefs(): PersistedPrefs {
  try {
    if (!existsSync(prefsPath())) throw new Error('missing')
    const raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) as Partial<PersistedPrefs>
    return {
      workspaceRoot: raw.workspaceRoot || defaultWorkspaceRoot(),
      selectedModel: raw.selectedModel ?? null,
      config: { ...DEFAULT_CONFIG, ...(raw.config || {}) },
      windowBounds: raw.windowBounds
    }
  } catch {
    return {
      workspaceRoot: defaultWorkspaceRoot(),
      selectedModel: null,
      config: { ...DEFAULT_CONFIG }
    }
  }
}

export function savePrefs(prefs: PersistedPrefs): void {
  ensureDir(userDataRoot())
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf8')
}
