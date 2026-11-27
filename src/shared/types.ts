export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  meta?: {
    kind?: 'plan' | 'tool' | 'files' | 'error' | 'kb'
    paths?: string[]
    citations?: string[]
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
  kind: 'plan' | 'tool' | 'observe' | 'write' | 'run' | 'error' | 'done'
  text: string
  path?: string
}

export type AgentResult = {
  ok: boolean
  projectPath?: string
  steps: AgentStep[]
  message: string
  filesCreated: string[]
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
  /** Default scaffold platform when user ask is ambiguous */
  defaultPlatform?: 'web' | 'android' | 'electron' | 'python' | 'auto'
  /** Image backend id — built-in procedural-png@1 */
  imageBackend?: string
  /** Override template pack directory (optional) */
  templatePackPath?: string
}

export type WorkspaceInfo = {
  root: string
  projects: string[]
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
