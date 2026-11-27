export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  meta?: {
    kind?: 'plan' | 'tool' | 'files' | 'error' | 'kb' | 'diff' | 'command'
    paths?: string[]
    citations?: string[]
    stdout?: string
    stderr?: string
    diff?: string
    pinned?: boolean
    feedback?: 'up' | 'down' | null
  }
}

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  kbPaths: string[]
  pinned?: boolean
  archived?: boolean
  model?: string | null
  draft?: string
  agentMode?: boolean
  /** Sidebar folder / project grouping */
  folder?: string | null
  parentId?: string | null
}

export type OllamaModel = {
  name: string
  size?: number
  modifiedAt?: string
}

export type ModelRamBand = 'fits-8gb' | 'stretch' | 'needs-more-ram'

export type CatalogModel = {
  id: string
  displayName: string
  family: 'qwen' | 'granite' | 'other'
  sizeLabel: string
  ollamaTag: string
  approxRamGb: number
  ramBand: ModelRamBand
  recommended?: boolean
  notes: string
  contextLength?: number
  license?: string
  params?: string
  quantization?: string
}

export type PullProgress = {
  model: string
  status: string
  completed?: number
  total?: number
  percent?: number
  done?: boolean
  error?: string
}

export type AgentStep = {
  at: number
  kind: 'plan' | 'tool' | 'observe' | 'write' | 'run' | 'error' | 'done' | 'diff'
  text: string
  path?: string
}

export type AgentResult = {
  ok: boolean
  projectPath?: string
  steps: AgentStep[]
  message: string
  filesCreated: string[]
  checkpointId?: string
}

export type Appearance = 'system' | 'light' | 'dark'

export type ChatConfig = {
  temperature: number
  topP: number
  maxTokens: number
  streaming: boolean
  webSearch: boolean
  codeInterpreter: boolean
  imageGeneration: boolean
  fileAnalysis: boolean
  appearance: Appearance
  fontSize: number
  systemPrompt: string
  enterToSend: boolean
  autoApproveCommands: boolean
  defaultPlatform?: 'web' | 'android' | 'electron' | 'python' | 'auto'
  imageBackend?: string
  imageQuality?: 'standard' | 'detailed'
  templatePackPath?: string
  /** Optional tray / background */
  trayEnabled?: boolean
  /** Relative vs absolute timestamps */
  relativeTimestamps?: boolean
  /** UI language */
  locale?: string
  /** Ollama base URL */
  ollamaUrl?: string
  /** Proxy URL advanced */
  proxyUrl?: string
  /** Welcome dismissed */
  welcomeDismissed?: boolean
  /** Show voice button (only when implemented) */
  voiceEnabled?: boolean
  kbScope?: 'chat' | 'workspace'
}

export type WorkspaceInfo = {
  root: string
  projects: string[]
  recent?: string[]
  pinned?: string[]
  diskMb?: number
}

export type KnowledgeHit = {
  path: string
  excerpt: string
  score: number
}

export type OllamaStatus = {
  ok: boolean
  detail: string
  models: OllamaModel[]
}

export type AppStateSnapshot = {
  ollama: OllamaStatus
  workspace: WorkspaceInfo
  sessions: ChatSession[]
  activeSessionId: string | null
  selectedModel: string | null
  config: ChatConfig
  catalog: CatalogModel[]
  version: string
}
