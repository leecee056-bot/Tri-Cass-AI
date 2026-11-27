import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type {
  CatalogModel,
  ChatConfig,
  ChatSession,
  OllamaStatus,
  PullProgress,
  WorkspaceInfo
} from '../../shared/types'
import { ramBadgeLabel } from '../../shared/catalog'
import { AboutPanel, AsciiPanel, TemplatesPanel } from './ExtraPanels'
import { BUILTIN_TEXTURES, DEFAULT_WALLPAPER_ID } from '../../shared/textures'
import type { WallpaperRef } from '../../shared/types'

type Snapshot = {
  ollama: OllamaStatus
  workspace: WorkspaceInfo
  sessions: ChatSession[]
  activeSessionId: string | null
  selectedModel: string | null
  config: ChatConfig
  catalog: CatalogModel[]
  version: string
}

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: number
  paths?: string[]
  citations?: string[]
}

type Panel = 'chat' | 'models' | 'knowledge' | 'workspace' | 'templates' | 'ascii' | 'settings' | 'about'

const HINT_LINKS = [
  'Create a website in my workspace',
  'Make an Android notes app',
  'Help me plan a local coding task'
]

function applyTheme(
  appearance: ChatConfig['appearance'],
  fontSize: number,
  wallpaperUrl?: string | null
) {
  const root = document.documentElement
  let theme: string = appearance
  if (appearance === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  if (theme === 'glass') {
    root.setAttribute('data-theme', 'glass')
  } else {
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
  }
  root.style.setProperty('--font-size', `${fontSize}px`)
  const layer = document.getElementById('app-wallpaper')
  if (layer) {
    if (theme === 'glass' && wallpaperUrl) {
      layer.style.backgroundImage = `url("${wallpaperUrl}")`
      layer.hidden = false
    } else {
      layer.style.backgroundImage = ''
      layer.hidden = true
    }
  }
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text || '', { async: false, gfm: true, breaks: true }) as string, [text])
  return (
    <div
      className="bubble"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const t = e.target as HTMLElement
        if (t.classList.contains('copy-code') || t.closest('pre')) {
          const pre = t.closest('pre')
          const code = pre?.querySelector('code')?.textContent || t.getAttribute('data-code') || ''
          if (code) void window.triCass.clipboardWrite(code)
        }
      }}
    />
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState('0.1.0')
  const [ollama, setOllama] = useState<OllamaStatus>({ ok: false, detail: '', models: [] })
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({ root: '', projects: [] })
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState('qwen2.5-coder:3b')
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [busy, setBusy] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [agentLog, setAgentLog] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panel, setPanel] = useState<Panel>('chat')
  const [query, setQuery] = useState('')
  const [agentMode, setAgentMode] = useState(true)
  const [useKb, setUseKb] = useState(true)
  const [attachments, setAttachments] = useState<string[]>([])
  const [pull, setPull] = useState<PullProgress | null>(null)
  const [toast, setToast] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [imageSize, setImageSize] = useState<'512' | '768' | '1024'>('512')
  const [imageQuality, setImageQuality] = useState<'standard' | 'detailed'>('detailed')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [packAttribution, setPackAttribution] = useState<string[]>([])
  const [modelQuery, setModelQuery] = useState('')
  const [modelSort, setModelSort] = useState<'name' | 'size' | 'installed'>('name')
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [ramGb, setRamGb] = useState<number | null>(null)
  const [collapsedMsgs, setCollapsedMsgs] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMsgIds, setSelectedMsgIds] = useState<string[]>([])
  const [chatFolders, setChatFolders] = useState<string[]>(['Inbox'])
  const [wallpapers, setWallpapers] = useState<WallpaperRef[]>([])
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamBuf = useRef('')
  const activeIdRef = useRef<string | null>(null)
  const userScrolledUp = useRef(false)
  const draftTimer = useRef<number | null>(null)

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) || null,
    [sessions, activeId]
  )

  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((s) => !s.archived)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
  }, [sessions, query])

  const selectedCatalog = catalog.find((c) => c.ollamaTag === model || model.startsWith(c.ollamaTag))

  useEffect(() => {
    void boot()
    const offs = [
      window.triCass.on('chat:token', (payload) => {
        const p = payload as { sessionId: string; chunk: string; runId: string }
        if (p.sessionId !== activeIdRef.current) return
        streamBuf.current += p.chunk
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.id === 'streaming') {
            next[next.length - 1] = { ...last, content: streamBuf.current }
            return next
          }
          return [...next, { id: 'streaming', role: 'assistant', content: streamBuf.current }]
        })
      }),
      window.triCass.on('chat:done', (payload) => {
        const p = payload as {
          sessionId: string
          content: string
          files?: string[]
          citations?: string[]
          runId?: string
        }
        if (p.sessionId !== activeIdRef.current) return
        streamBuf.current = ''
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'streaming'),
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: p.content,
            paths: p.files,
            citations: p.citations,
            createdAt: Date.now()
          }
        ])
        setBusy(false)
        setStatus('')
        setAgentLog('')
        setRunId(p.runId || null)
        void refreshSessions()
      }),
      window.triCass.on('chat:error', (payload) => {
        const p = payload as { sessionId: string; error: string; aborted?: boolean }
        if (p.sessionId !== activeIdRef.current) return
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'streaming'),
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: p.aborted ? '_Generation stopped._' : `Error: ${p.error}`
          }
        ])
        setBusy(false)
        setStatus('')
        setAgentLog('')
      }),
      window.triCass.on('chat:status', (payload) => {
        setStatus((payload as { status: string }).status)
      }),
      window.triCass.on('agent:step', (payload) => {
        const step = (payload as { step: { kind: string; text: string } }).step
        setAgentLog((prev) => `${prev}${prev ? '\n' : ''}${step.kind}: ${step.text}`.slice(-1200))
        setStatus(`${step.kind}`)
      }),
      window.triCass.on('models:pullProgress', (payload) => setPull(payload as PullProgress))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    if (!userScrolledUp.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentLog])

  useEffect(() => {
    if (!config) return
    applyTheme(config.appearance, config.fontSize, wallpaperUrl)
  }, [config, wallpaperUrl])

  useEffect(() => {
    if (!config) return
    void (async () => {
      const list = (await window.triCass.wallpapersList()) as WallpaperRef[]
      setWallpapers(list)
      const id = config.wallpaperId || DEFAULT_WALLPAPER_ID
      const res = (await window.triCass.wallpaperDataUrl(id)) as { ok: boolean; url?: string }
      if (res.ok && res.url) setWallpaperUrl(res.url)
      else {
        const builtin = BUILTIN_TEXTURES.find((t) => t.id === id) || BUILTIN_TEXTURES[0]
        setWallpaperUrl(`./textures/${builtin.file}`)
      }
    })()
  }, [config?.wallpaperId, config?.appearance, config?.customWallpaperIds?.join(',')])

  async function boot() {
    const snap = (await window.triCass.getSnapshot()) as Snapshot
    setVersion(snap.version)
    setOllama(snap.ollama)
    setWorkspace(snap.workspace)
    setSessions(snap.sessions)
    setActiveId(snap.activeSessionId)
    setModel(snap.selectedModel || 'qwen2.5-coder:3b')
    setConfig(snap.config)
    setCatalog(snap.catalog)
    applyTheme(snap.config.appearance, snap.config.fontSize, null)
    const active = snap.sessions.find((s) => s.id === snap.activeSessionId)
    loadMessages(active)
    setDraft(active?.draft || '')
    setAgentMode(active?.agentMode !== false)
    setMaximized(await window.triCass.windowIsMaximized())
    setReady(true)
    void window.triCass.templatesStatus().then((st) => {
      const s = st as { attribution?: string[] }
      setPackAttribution(s.attribution || [])
    })
    void window.triCass.diagRam().then(setRamGb)
    if (!snap.config.welcomeDismissed) setWelcomeOpen(true)
    const folders = [
      ...new Set(
        snap.sessions.map((s) => s.folder).filter((f): f is string => Boolean(f))
      )
    ]
    if (folders.length) setChatFolders((prev) => [...new Set([...prev, ...folders])])
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function loadMessages(session?: ChatSession | null) {
    setMessages(
      (session?.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt,
          paths: m.meta?.paths,
          citations: m.meta?.citations
        }))
    )
  }

  async function refreshSessions() {
    setSessions(await window.triCass.listSessions())
  }

  async function selectSession(id: string) {
    setPanel('chat')
    setActiveId(id)
    const session = await window.triCass.getSession(id)
    loadMessages(session)
    setDraft(session?.draft || '')
    setAgentMode(session?.agentMode !== false)
    if (session?.model) setModel(session.model)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function newChat() {
    const session = await window.triCass.createSession()
    setSessions((prev) => [session, ...prev])
    setActiveId(session.id)
    setMessages([])
    setDraft('')
    setAttachments([])
    setPanel('chat')
    setAgentMode(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function queueDraft(value: string) {
    setDraft(value)
    if (!activeId) return
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void window.triCass.setDraft(activeId, value)
    }, 400)
  }

  async function send(
    mode: 'chat' | 'summarise' | 'plan' | 'research' | 'build' = 'chat',
    override?: string
  ) {
    if (!activeId || !config || busy) return
    let content = (override ?? draft).trim()
    if (!content && !attachments.length) return

    // slash commands
    let forceImage = imageMode
    if (content.startsWith('/plan ')) {
      mode = 'plan'
      content = content.slice(6)
    } else if (content.startsWith('/code ')) {
      mode = 'build'
      content = content.slice(6)
    } else if (content.startsWith('/kb ')) {
      mode = 'research'
      content = content.slice(4)
    } else if (content.startsWith('/ascii')) {
      setPanel('ascii')
      setDraft('')
      return
    } else if (content.startsWith('/image ')) {
      forceImage = true
      content = content.slice(7)
    }

    if (attachments.length) {
      content = `${content}\n\nAttached:\n${attachments.map((a) => `- ${a}`).join('\n')}`
    }

    if (selectedTemplateId && agentMode && !forceImage) {
      content = `${content}\n\n[Selected template: ${selectedTemplateId}]`
    }

    setDraft('')
    setAttachments([])
    void window.triCass.setDraft(activeId, '')
    setBusy(true)
    streamBuf.current = ''
    setAgentLog('')
    userScrolledUp.current = false
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content, createdAt: Date.now() }])

    if (forceImage) {
      const img = (await window.triCass.imageGenerate(content, imageSize, imageQuality)) as {
        ok: boolean
        path?: string
        backend?: string
        error?: string
        safetyNote?: string
      }
      const assistantText = img.ok
        ? `Generated image with \`${img.backend}\` (${imageSize}px · ${imageQuality}):\n\n\`${img.path}\`\n\n${img.safetyNote || ''}`
        : `Image generation failed: ${img.error}`
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: assistantText,
          paths: img.path ? [img.path] : [],
          createdAt: Date.now()
        }
      ])
      setBusy(false)
      flash(img.ok ? 'Image saved' : 'Image failed')
      return
    }

    const result = (await window.triCass.chatSend({
      sessionId: activeId,
      content,
      model,
      config: { ...config, imageGeneration: forceImage || config.imageGeneration },
      mode,
      agentMode,
      useKb,
      selectedTemplateId,
      imageMode: forceImage
    })) as { runId?: string }
    if (result?.runId) setRunId(result.runId)
  }

  async function stop() {
    await window.triCass.chatStop(runId || undefined)
    setBusy(false)
    setStatus('stopped')
  }

  async function endChat() {
    if (!activeId) return
    if (!confirm('Delete this chat?')) return
    const list = await window.triCass.deleteSession(activeId)
    setSessions(list)
    if (list[0]) await selectSession(list[0].id)
    else await newChat()
  }

  async function renameChat(id: string) {
    const current = sessions.find((s) => s.id === id)
    const title = prompt('Rename chat', current?.title || '')
    if (!title) return
    await window.triCass.renameSession(id, title)
    await refreshSessions()
  }

  async function togglePin(session: ChatSession) {
    await window.triCass.updateSession({ ...session, pinned: !session.pinned })
    await refreshSessions()
  }

  async function archiveChat(session: ChatSession) {
    await window.triCass.updateSession({ ...session, archived: true })
    await refreshSessions()
    if (session.id === activeId) {
      const next = (await window.triCass.listSessions()).find((s) => !s.archived)
      if (next) await selectSession(next.id)
      else await newChat()
    }
  }

  async function saveConfig(next: ChatConfig) {
    setConfig(next)
    await window.triCass.setConfig(next)
  }

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2200)
  }

  if (!ready || !config) {
    return <div className="empty"><p>Starting Tri Cass AI…</p></div>
  }

  return (
    <>
    <div id="app-wallpaper" className="app-wallpaper" hidden aria-hidden />
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-brand">
          <div className="brand-mark" aria-hidden />
          <span className="hide-sm">Tri Cass AI</span>
        </div>
        <div className="titlebar-center">
          <span className={`status-dot ${ollama.ok ? 'on' : ''}`} />
          <span className="pill">{ollama.ok ? 'Local · Online' : 'Ollama offline'}</span>
        </div>
        <div className="titlebar-right">
          <button className="win-btn" type="button" title="Minimize" onClick={() => void window.triCass.windowMinimize()}>
            ─
          </button>
          <button
            className="win-btn"
            type="button"
            title="Maximize"
            onClick={async () => setMaximized(await window.triCass.windowMaximize())}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button className="win-btn close" type="button" title="Close" onClick={() => void window.triCass.windowClose()}>
            ×
          </button>
        </div>
      </header>

      <div className={`shell ${sidebarOpen ? '' : 'collapsed'}`}>
        <aside className="sidebar">
          <div className="sidebar-inner">
            <button className="btn primary block" type="button" onClick={() => void newChat()}>
              + New chat
            </button>
            <input
              className="search"
              placeholder="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search chats"
            />
            <div className="nav-section">
              <button className={`nav-item ${panel === 'models' ? 'active' : ''}`} type="button" onClick={() => setPanel('models')}>
                Models
              </button>
              <button className={`nav-item ${panel === 'knowledge' ? 'active' : ''}`} type="button" onClick={() => setPanel('knowledge')}>
                Knowledge
              </button>
              <button className={`nav-item ${panel === 'workspace' ? 'active' : ''}`} type="button" onClick={() => setPanel('workspace')}>
                Workspace
              </button>
              <button className={`nav-item ${panel === 'templates' ? 'active' : ''}`} type="button" onClick={() => setPanel('templates')}>
                Templates
              </button>
              <button className={`nav-item ${panel === 'ascii' ? 'active' : ''}`} type="button" onClick={() => setPanel('ascii')}>
                ASCII
              </button>
              <button className={`nav-item ${panel === 'settings' ? 'active' : ''}`} type="button" onClick={() => setPanel('settings')}>
                Settings
              </button>
              <button className={`nav-item ${panel === 'about' ? 'active' : ''}`} type="button" onClick={() => setPanel('about')}>
                About
              </button>
            </div>
            <div className="sidebar-footer" title={workspace.root}>{workspace.root || 'No workspace'}</div>
            <div className="nav-section" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Folders</span>
              {chatFolders.map((f) => (
                <button
                  key={f}
                  className="nav-item"
                  type="button"
                  onClick={() => setQuery(f === 'Inbox' ? '' : f)}
                >
                  {f}
                </button>
              ))}
              <button
                className="nav-item"
                type="button"
                onClick={() => {
                  const name = prompt('New chat folder')
                  if (!name) return
                  setChatFolders((prev) => [...new Set([...prev, name])])
                }}
              >
                + Folder
              </button>
            </div>
            <div className="chat-list">
              {ready && !sessions.length ? <div className="skeleton" /> : null}
              {visibleSessions.map((s) => (
                <div key={s.id} className={`chat-item ${s.id === activeId ? 'active' : ''}`} role="button" tabIndex={0}
                  onClick={() => void selectSession(s.id)}
                  onKeyDown={(e) => e.key === 'Enter' && void selectSession(s.id)}
                >
                  <span>
                    {s.pinned ? <span className="pin">📌 </span> : null}
                    {s.title}
                  </span>
                  <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn"
                      type="button"
                      title="Move to folder"
                      onClick={async () => {
                        const folder = prompt('Folder name (blank = Inbox)', s.folder || '')
                        await window.triCass.sessionsSetFolder(s.id, folder?.trim() || null)
                        if (folder?.trim()) setChatFolders((prev) => [...new Set([...prev, folder.trim()])])
                        await refreshSessions()
                      }}
                    >
                      📁
                    </button>
                    <button className="icon-btn" type="button" title="Rename" onClick={() => void renameChat(s.id)}>✎</button>
                    <button className="icon-btn" type="button" title="Pin" onClick={() => void togglePin(s)}>📌</button>
                    <button className="icon-btn" type="button" title="Archive" onClick={() => void archiveChat(s)}>⬇</button>
                    <button className="icon-btn" type="button" title="Delete" onClick={async () => {
                      if (!confirm('Delete chat?')) return
                      const list = await window.triCass.deleteSession(s.id)
                      setSessions(list)
                      if (s.id === activeId) {
                        if (list[0]) await selectSession(list[0].id)
                        else await newChat()
                      }
                    }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="main">
          <div className="thread-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="icon-btn" type="button" title="Toggle sidebar" onClick={() => setSidebarOpen((v) => !v)}>
                ☰
              </button>
              <h1 className="thread-title">{activeSession?.title || 'New chat'}</h1>
            </div>
            <div className="header-actions">
              <select
                className="model-select"
                value={model}
                aria-label="Model"
                onChange={(e) => {
                  const v = e.target.value
                  setModel(v)
                  void window.triCass.setSelectedModel(v)
                }}
              >
                {ollama.models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
                {!ollama.models.some((m) => m.name === model) && (
                  <option value={model}>{model} (not installed)</option>
                )}
              </select>
              {selectedCatalog?.contextLength ? (
                <span className="pill">ctx {selectedCatalog.contextLength.toLocaleString()}</span>
              ) : null}
              <button className="btn ghost" type="button" onClick={() => setPanel('models')}>Download models</button>
              <button className="btn ghost" type="button" onClick={() => void endChat()}>End chat</button>
              <button className="btn ghost" type="button" onClick={() => void window.triCass.exportChat(activeId!, 'md').then(() => flash('Exported'))}>Export</button>
            </div>
          </div>

          {panel === 'chat' && (
            <>
              <div
                className="messages"
                ref={listRef}
                onScroll={() => {
                  const el = listRef.current
                  if (!el) return
                  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
                  userScrolledUp.current = dist > 120
                  setShowJump(dist > 180)
                }}
              >
                <div className="messages-inner">
                  {!messages.length && (
                    <div className="empty" aria-label="Tri Cass AI home">
                      <div className="empty-mark" aria-hidden />
                      <h2>Tri Cass AI</h2>
                      <p>Local chat that can write real projects on your machine.</p>
                      {!ollama.ok && (
                        <div className="banner warn">
                          Ollama is offline. Install from <strong>ollama.com</strong>, run <code>ollama serve</code>, then download a model from Models.
                        </div>
                      )}
                      {ollama.ok && !ollama.models.length && (
                        <div className="banner">
                          No models installed yet.{' '}
                          <button type="button" className="text-link" onClick={() => setPanel('models')}>
                            Download the recommended model
                          </button>
                        </div>
                      )}
                      <div className="hint-links">
                        {HINT_LINKS.map((ex) => (
                          <button key={ex} type="button" className="text-link" onClick={() => queueDraft(ex)}>
                            {ex}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {welcomeOpen && (
                    <div className="banner">
                      <strong>Welcome to Tri Cass AI</strong>
                      <p style={{ margin: '6px 0' }}>
                        You don’t need to code — ask for a website, Android app, image, or ASCII art. Skip anytime.
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => {
                            setWelcomeOpen(false)
                            if (config) void saveConfig({ ...config, welcomeDismissed: true })
                          }}
                        >
                          Get started
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            setWelcomeOpen(false)
                            if (config) void saveConfig({ ...config, welcomeDismissed: true })
                          }}
                        >
                          Skip onboarding
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => {
                            queueDraft('Create a website in my workspace')
                            setWelcomeOpen(false)
                            if (config) void saveConfig({ ...config, welcomeDismissed: true })
                          }}
                        >
                          Try agent (only when you click)
                        </button>
                      </div>
                    </div>
                  )}
                  {messages.map((m) => {
                    const long = (m.content || '').length > 1800
                    const collapsed = collapsedMsgs[m.id]
                    const body = collapsed && long ? `${m.content.slice(0, 1200)}\n\n…` : m.content
                    return (
                    <article key={m.id} className={`msg ${m.role}`} id={`msg-${m.id}`}>
                      <div className="msg-role">
                        <span className="avatar-initial">{m.role === 'user' ? 'Y' : 'T'}</span>
                        <span>{m.role === 'user' ? 'You' : 'Tri Cass AI'}</span>
                        {m.createdAt ? (
                          <span title={new Date(m.createdAt).toLocaleString()}>
                            {config?.relativeTimestamps
                              ? `${Math.max(1, Math.round((Date.now() - m.createdAt) / 60000))}m ago`
                              : new Date(m.createdAt).toLocaleTimeString()}
                          </span>
                        ) : null}
                        {selectMode ? (
                          <input
                            type="checkbox"
                            checked={selectedMsgIds.includes(m.id)}
                            onChange={() =>
                              setSelectedMsgIds((prev) =>
                                prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                              )
                            }
                            aria-label="Select message"
                          />
                        ) : null}
                      </div>
                      <Markdown text={body} />
                      {long ? (
                        <button
                          className="text-link"
                          type="button"
                          onClick={() =>
                            setCollapsedMsgs((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                          }
                        >
                          {collapsed ? 'Show more' : 'Collapse'}
                        </button>
                      ) : null}
                      {m.paths?.length ? (
                        <div className="paths">
                          {m.paths.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                if (/\.(png|jpe?g|gif|webp)$/i.test(p)) setLightbox(p)
                                else void window.triCass.openWorkspace(p)
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {m.citations?.length ? (
                        <div className="citations">
                          <strong>Sources: </strong>
                          {m.citations.map((c) => (
                            <button key={c} type="button" className="chip on" onClick={() => flash(`Citation: ${c}`)}>
                              {c}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="msg-actions">
                        <button className="icon-btn" type="button" title="Copy" onClick={() => void window.triCass.clipboardWrite(m.content).then(() => flash('Copied'))}>⧉</button>
                        {m.role === 'assistant' && (
                          <button className="icon-btn" type="button" title="Regenerate" onClick={() => {
                            const idx = messages.findIndex((x) => x.id === m.id)
                            const prevUser = [...messages].slice(0, idx).reverse().find((x) => x.role === 'user')
                            if (prevUser) void send('chat', prevUser.content)
                          }}>↻</button>
                        )}
                        <button
                          className="icon-btn"
                          type="button"
                          title="Continue"
                          onClick={() => void send('chat', 'Continue generating from where you left off.')}
                        >
                          ↪
                        </button>
                        <details className="more-menu">
                          <summary className="icon-btn" title="More">⋯</summary>
                          <div className="more-pop">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!activeId) return
                                const fork = await window.triCass.sessionsFork(activeId, m.id)
                                if (fork) {
                                  await refreshSessions()
                                  flash('Branched chat')
                                }
                              }}
                            >
                              Branch
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!activeId) return
                                await window.triCass.sessionsDeletePair(activeId, m.id)
                                const s = await window.triCass.getSession(activeId)
                                loadMessages(s)
                              }}
                            >
                              Delete pair
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                queueDraft(`> ${m.content.slice(0, 280)}\n\n`)
                                inputRef.current?.focus()
                              }}
                            >
                              Quote reply
                            </button>
                            <button
                              type="button"
                              onClick={() => void window.triCass.clipboardWrite(m.content)}
                            >
                              View raw / copy
                            </button>
                          </div>
                        </details>
                      </div>
                    </article>
                    )
                  })}
                  {lightbox ? (
                    <div className="lightbox" role="dialog" onClick={() => setLightbox(null)}>
                      <p>{lightbox}</p>
                      <button className="btn" type="button">Close</button>
                    </div>
                  ) : null}
                  {agentLog ? <div className="agent-steps">{agentLog}</div> : null}
                  {status && busy ? <div className="pill">{status}…</div> : null}
                  <div ref={bottomRef} />
                </div>
              </div>

              <div className="composer-wrap">
                {showJump && (
                  <div style={{ textAlign: 'center', marginBottom: 8 }}>
                    <button className="btn" type="button" onClick={() => {
                      userScrolledUp.current = false
                      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
                      setShowJump(false)
                    }}>Jump to latest</button>
                  </div>
                )}
                <div
                  className={`composer ${dragOver ? 'drag' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const files = [...e.dataTransfer.files].map((f) => (f as File & { path?: string }).path || f.name)
                    setAttachments((prev) => [...prev, ...files])
                  }}
                >
                  {dragOver && <div className="drop-overlay">Drop to attach</div>}
                  {attachments.length > 0 && (
                    <div className="attachments">
                      {attachments.map((a) => (
                        <span key={a} className="chip">
                          {a.split(/[\\/]/).pop()}
                          <button type="button" className="icon-btn" onClick={() => setAttachments((p) => p.filter((x) => x !== a))}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {slashOpen && (
                    <div className="slash-menu" role="listbox">
                      {[
                        { cmd: '/plan ', label: 'Plan', desc: 'Numbered implementation plan' },
                        { cmd: '/code ', label: 'Code', desc: 'Agent writes files in workspace' },
                        { cmd: '/kb ', label: 'Research', desc: 'Answer using attached knowledge' },
                        { cmd: '/ascii', label: 'ASCII', desc: 'Open ASCII studio' },
                        { cmd: '/image ', label: 'Image', desc: 'Generate a local PNG' }
                      ].map((item) => (
                        <button
                          key={item.cmd}
                          type="button"
                          className="slash-item"
                          onClick={() => {
                            queueDraft(item.cmd)
                            setSlashOpen(false)
                            inputRef.current?.focus()
                          }}
                        >
                          <strong>{item.label}</strong>
                          <span>{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    value={draft}
                    rows={1}
                    placeholder="Message Tri Cass AI…"
                    onChange={(e) => {
                      const v = e.target.value
                      queueDraft(v)
                      setSlashOpen(v === '/' || /^\/[a-z]*$/i.test(v))
                      e.target.style.height = 'auto'
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData?.getData('text') || ''
                      if (text.length > 8000 && !confirm('Paste a large block of text?')) {
                        e.preventDefault()
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && busy) {
                        e.preventDefault()
                        void stop()
                        return
                      }
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        void send('chat')
                        return
                      }
                      if (!config.enterToSend) return
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (busy) void stop()
                        else void send('chat')
                      }
                    }}
                  />
                  <div className="composer-bar">
                    <div className="composer-tools">
                      <button className="tool-toggle" type="button" onClick={async () => {
                        const files = await window.triCass.pickFiles()
                        if (files.length) setAttachments((p) => [...p, ...files])
                      }}>Attach</button>
                      <button
                        className={`tool-toggle ${agentMode ? 'on' : ''}`}
                        type="button"
                        title="When on, Tri Cass AI can create and edit files in your workspace"
                        onClick={() => setAgentMode((v) => !v)}
                      >
                        Write files {agentMode ? 'on' : 'off'}
                      </button>
                      <button
                        className={`tool-toggle ${useKb ? 'on' : ''}`}
                        type="button"
                        onClick={() => setUseKb((v) => !v)}
                      >
                        KB{(activeSession?.kbPaths?.length ? ` · ${activeSession.kbPaths.length}` : '')}
                      </button>
                      <button
                        className={`tool-toggle ${imageMode ? 'on' : ''}`}
                        type="button"
                        title="Local image generation (writes a real PNG)"
                        onClick={() => setImageMode((v) => !v)}
                      >
                        Image {imageMode ? 'on' : 'off'}
                      </button>
                      {imageMode ? (
                        <>
                          <select
                            className="model-select"
                            value={imageSize}
                            aria-label="Image size"
                            onChange={(e) => setImageSize(e.target.value as '512' | '768' | '1024')}
                          >
                            <option value="512">512</option>
                            <option value="768">768</option>
                            <option value="1024">1024</option>
                          </select>
                          <select
                            className="model-select"
                            value={imageQuality}
                            aria-label="Image quality"
                            onChange={(e) =>
                              setImageQuality(e.target.value as 'standard' | 'detailed')
                            }
                          >
                            <option value="standard">Standard</option>
                            <option value="detailed">Detailed</option>
                          </select>
                        </>
                      ) : null}
                      {selectedTemplateId ? (
                        <button
                          className="tool-toggle on"
                          type="button"
                          title="Clear selected template"
                          onClick={() => setSelectedTemplateId(null)}
                        >
                          Template selected
                        </button>
                      ) : null}
                      <button className="tool-toggle" type="button" onClick={() => setSlashOpen((v) => !v)} title="Slash commands">/</button>
                    </div>
                    {busy ? (
                      <button className="send stop" type="button" title="Stop" onClick={() => void stop()}>Stop</button>
                    ) : (
                      <button className="send" type="button" title="Send" disabled={!draft.trim() && !attachments.length} onClick={() => void send('chat')}>Send</button>
                    )}
                  </div>
                </div>
                <div className="hint">Enter send · Shift+Enter newline · / for commands · local only</div>
              </div>
            </>
          )}

          {panel === 'models' && (
            <div className="messages panel-page">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Models</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  One-click pull via Ollama. Prefer “Fits ~8 GB” on household PCs.
                  {ramGb != null ? ` Detected ~${ramGb} GB RAM.` : ''}
                  {!ollama.ok && ' Install Ollama from https://ollama.com and start it locally.'}
                </p>
                <div className="template-filters">
                  <input
                    className="search"
                    placeholder="Search catalog"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    aria-label="Search models"
                  />
                  <select
                    value={modelSort}
                    onChange={(e) => setModelSort(e.target.value as typeof modelSort)}
                    aria-label="Sort models"
                  >
                    <option value="name">Sort: name</option>
                    <option value="size">Sort: size</option>
                    <option value="installed">Sort: installed</option>
                  </select>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      const tag = prompt('Custom Ollama tag (e.g. llama3.2:3b)')
                      if (tag) {
                        setModel(tag)
                        void window.triCass.setSelectedModel(tag)
                        flash('Custom tag selected — pull from Ollama if needed')
                      }
                    }}
                  >
                    Add custom tag
                  </button>
                </div>
                <div className="catalog-list">
                  {[...catalog]
                    .filter((m) => {
                      const q = modelQuery.trim().toLowerCase()
                      if (!q) return true
                      return (
                        m.displayName.toLowerCase().includes(q) ||
                        m.ollamaTag.includes(q) ||
                        m.family.includes(q)
                      )
                    })
                    .sort((a, b) => {
                      if (modelSort === 'size') return a.approxRamGb - b.approxRamGb
                      if (modelSort === 'installed') {
                        const ai = ollama.models.some((x) => x.name.startsWith(a.ollamaTag)) ? 0 : 1
                        const bi = ollama.models.some((x) => x.name.startsWith(b.ollamaTag)) ? 0 : 1
                        return ai - bi
                      }
                      return a.displayName.localeCompare(b.displayName)
                    })
                    .map((m) => {
                    const installed = ollama.models.some((x) => x.name === m.ollamaTag || x.name.startsWith(m.ollamaTag))
                    const running = model === m.ollamaTag || model.startsWith(m.ollamaTag)
                    return (
                      <div key={m.id} className="catalog-row">
                        <div>
                          <h4>{m.displayName}</h4>
                          <p>{m.notes}</p>
                          <span className={`badge ${m.ramBand === 'fits-8gb' ? 'good' : m.ramBand === 'stretch' ? 'warn' : 'bad'}`}>
                            {ramBadgeLabel(m.ramBand)} · ~{m.approxRamGb} GB
                          </span>
                          {m.recommended ? <span className="badge good">Recommended</span> : null}
                          {installed ? <span className="badge good">Installed</span> : <span className="badge">Available</span>}
                          {running ? <span className="badge good">Running</span> : null}
                          {m.contextLength ? <span className="badge">ctx {m.contextLength}</span> : null}
                          {m.quantization ? <span className="badge">{m.quantization}</span> : null}
                          {m.license ? <span className="badge">{m.license}</span> : null}
                          {m.params ? <span className="badge">{m.params}</span> : null}
                          <div style={{ marginTop: 6 }}>
                            <a className="text-link" href={`https://ollama.com/library/${m.ollamaTag.split(':')[0]}`} target="_blank" rel="noreferrer">
                              Ollama library
                            </a>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {!installed ? (
                            <button className="btn primary" type="button" onClick={() => void window.triCass.pullModel(m.ollamaTag).then(async (r) => {
                              if (r.ok) {
                                setModel(m.ollamaTag)
                                setOllama(await window.triCass.ollamaStatus() as OllamaStatus)
                                flash('Model ready')
                              }
                            })}>Download</button>
                          ) : (
                            <>
                              <button className="btn" type="button" onClick={() => { setModel(m.ollamaTag); void window.triCass.setSelectedModel(m.ollamaTag); flash('Selected') }}>Use</button>
                              <button className="btn danger" type="button" onClick={async () => {
                                if (!confirm(`Delete ${m.ollamaTag}?`)) return
                                await window.triCass.deleteModel(m.ollamaTag)
                                setOllama(await window.triCass.ollamaStatus() as OllamaStatus)
                              }}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {pull && (
                  <div style={{ marginTop: 16 }}>
                    <div className="row-between">
                      <span>{pull.model}: {pull.status}{pull.percent != null ? ` · ${pull.percent}%` : ''}</span>
                      {!pull.done && <button className="btn" type="button" onClick={() => void window.triCass.cancelPull()}>Cancel</button>}
                    </div>
                    <div className="progress"><i style={{ width: `${pull.percent || 0}%` }} /></div>
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
                </div>
              </div>
            </div>
          )}

          {panel === 'knowledge' && (
            <div className="messages panel-page">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Knowledge · this chat</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  Sources are linked to the current conversation and retrieved into prompts. Privacy: stays on this machine.
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Supported types: txt, md, json, code, html, csv (docx best-effort). Excludes .git / node_modules.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button className="btn primary" type="button" onClick={async () => {
                    if (!activeId) return
                    const res = await window.triCass.kbAttach(activeId) as { sources: string[]; added: number; warned?: string }
                    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, kbPaths: res.sources } : s))
                    flash(res.warned || `Attached ${res.added} file(s)`)
                  }}>Attach files / folder</button>
                  <button className="btn" type="button" onClick={async () => {
                    if (!activeId) return
                    await window.triCass.kbReindex(activeId)
                    flash('Re-indexed')
                  }}>Re-index</button>
                  <button className="btn" type="button" onClick={async () => {
                    const res = await window.triCass.kbWorkspaceAttach() as { added: number }
                    flash(`Workspace KB +${res.added}`)
                  }}>Attach workspace KB</button>
                  <button className="btn danger" type="button" onClick={async () => {
                    if (!activeId) return
                    await window.triCass.kbClear(activeId)
                    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, kbPaths: [] } : s))
                  }}>Clear KB</button>
                  <button className="btn danger" type="button" onClick={async () => {
                    if (!activeId || !activeSession?.kbPaths?.length) return
                    if (!confirm('Bulk remove all chat sources?')) return
                    await window.triCass.kbRemove(activeId, activeSession.kbPaths)
                    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, kbPaths: [] } : s))
                  }}>Bulk remove</button>
                </div>
                <ul>
                  {(activeSession?.kbPaths || []).map((p) => <li key={p}>{p}</li>)}
                  {!activeSession?.kbPaths?.length && <li style={{ color: 'var(--text-muted)' }}>No sources yet. Add files this chat can use.</li>}
                </ul>
                <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
              </div>
            </div>
          )}

          {panel === 'workspace' && (
            <div className="messages">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Workspace</h2>
                <p style={{ color: 'var(--text-muted)' }}>Agent projects are created under this folder.</p>
                <code style={{ display: 'block', marginBottom: 12 }}>{workspace.root}</code>
                <p style={{ color: 'var(--text-muted)' }}>
                  Disk ~{workspace.diskMb ?? '?'} MB
                  {workspace.recent?.length ? ` · Recent: ${workspace.recent.slice(0, 3).join(', ')}` : ''}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn primary" type="button" onClick={async () => setWorkspace(await window.triCass.pickWorkspace() as WorkspaceInfo)}>Choose folder</button>
                  <button className="btn" type="button" onClick={() => void window.triCass.openWorkspace()}>Open in explorer</button>
                  <button className="btn" type="button" onClick={async () => {
                    const name = prompt('New folder name')
                    if (!name) return
                    await window.triCass.workspaceCreateFolder(name)
                    setWorkspace(await window.triCass.workspaceInfo() as WorkspaceInfo)
                  }}>Create folder</button>
                  <button className="btn" type="button" onClick={async () => {
                    setWorkspace(await window.triCass.workspacePin(workspace.root, true) as WorkspaceInfo)
                    flash('Pinned workspace')
                  }}>Pin workspace</button>
                  <button className="btn" type="button" onClick={() => { setPanel('chat'); queueDraft('Create a website in my workspace'); inputRef.current?.focus() }}>New website…</button>
                  <button className="btn" type="button" onClick={() => { setPanel('chat'); queueDraft('Create a Node app with tests'); inputRef.current?.focus() }}>New app…</button>
                </div>
                <h3 style={{ marginTop: 24 }}>Projects</h3>
                <ul>
                  {workspace.projects.map((p) => (
                    <li key={p}>
                      <button className="btn ghost" type="button" onClick={() => void window.triCass.openWorkspace(`${workspace.root}/${p}`)}>{p}</button>
                    </li>
                  ))}
                  {!workspace.projects.length && <li style={{ color: 'var(--text-muted)' }}>No projects yet.</li>}
                </ul>
                <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
              </div>
            </div>
          )}

          {panel === 'templates' && (
            <TemplatesPanel
              onBack={() => setPanel('chat')}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={setSelectedTemplateId}
              flash={flash}
              onUseTemplate={async (id, name) => {
                const res = (await window.triCass.templatesUse(id, name)) as {
                  ok: boolean
                  projectPath?: string
                  error?: string
                }
                if (res.ok && res.projectPath) {
                  flash(`Copied to ${res.projectPath}`)
                  setSelectedTemplateId(id)
                  await window.triCass.templatesOpenFolder(res.projectPath)
                  setWorkspace((await window.triCass.workspaceInfo()) as WorkspaceInfo)
                } else flash(res.error || 'Failed')
              }}
              onEditTemplate={(id) => {
                setSelectedTemplateId(id)
                setPanel('chat')
                queueDraft('Customise this template for my project — change colours and copy in plain English.')
                inputRef.current?.focus()
              }}
            />
          )}

          {panel === 'ascii' && <AsciiPanel onBack={() => setPanel('chat')} flash={flash} />}

          {panel === 'settings' && (
            <div className="messages panel-page">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Settings</h2>
                <div className="settings-grid">
                  <h3>Appearance</h3>
                  <div className="field">
                    <label><span>Theme</span></label>
                    <select
                      value={config.appearance}
                      onChange={(e) => {
                        const appearance = e.target.value as ChatConfig['appearance']
                        void saveConfig({
                          ...config,
                          appearance,
                          wallpaperId: config.wallpaperId || DEFAULT_WALLPAPER_ID
                        })
                      }}
                    >
                      <option value="system">System</option>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="glass">Glass</option>
                    </select>
                  </div>
                  <div className="field">
                      <label>
                        <span>Glass wallpaper / texture</span>
                      </label>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
                        Frosted glass over a texture. Pick a built-in look or add your own image.
                        {config.appearance !== 'glass' ? ' Selecting a texture switches to Glass.' : ''}
                      </p>
                      <div className="texture-grid" role="listbox" aria-label="Wallpaper textures">
                        {wallpapers.map((w) => {
                          const selected = (config.wallpaperId || DEFAULT_WALLPAPER_ID) === w.id
                          const thumb =
                            w.kind === 'builtin'
                              ? w.src
                              : wallpaperUrl && config.wallpaperId === w.id
                                ? wallpaperUrl
                                : undefined
                          return (
                            <button
                              key={w.id}
                              type="button"
                              className={`texture-card ${selected ? 'selected' : ''}`}
                              role="option"
                              aria-selected={selected}
                              onClick={async () => {
                                const next = { ...config, appearance: 'glass' as const, wallpaperId: w.id }
                                await saveConfig(next)
                                const res = (await window.triCass.wallpaperDataUrl(w.id)) as {
                                  ok: boolean
                                  url?: string
                                }
                                if (res.ok && res.url) setWallpaperUrl(res.url)
                                flash(`Wallpaper: ${w.label}`)
                              }}
                            >
                              {thumb ? (
                                <img src={thumb} alt="" className="texture-thumb" />
                              ) : (
                                <div className="texture-thumb" />
                              )}
                              <figcaption>
                                {w.label}
                                <div className="muted">{w.kind === 'builtin' ? 'Built-in' : 'Custom'}</div>
                              </figcaption>
                            </button>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button
                          className="btn primary"
                          type="button"
                          onClick={async () => {
                            const res = (await window.triCass.wallpaperAdd()) as {
                              ok: boolean
                              wallpaper?: WallpaperRef
                              error?: string
                            }
                            if (!res.ok) {
                              flash(res.error || 'Cancelled')
                              return
                            }
                            const list = (await window.triCass.wallpapersList()) as WallpaperRef[]
                            setWallpapers(list)
                            if (res.wallpaper) {
                              await saveConfig({
                                ...config,
                                appearance: 'glass',
                                wallpaperId: res.wallpaper.id,
                                customWallpaperIds: [
                                  ...(config.customWallpaperIds || []),
                                  res.wallpaper.id
                                ]
                              })
                              const url = (await window.triCass.wallpaperDataUrl(res.wallpaper.id)) as {
                                ok: boolean
                                url?: string
                              }
                              if (url.ok && url.url) setWallpaperUrl(url.url)
                              flash(`Added ${res.wallpaper.label}`)
                            }
                          }}
                        >
                          Add custom wallpaper
                        </button>
                        {(config.wallpaperId || '').startsWith('custom:') ? (
                          <button
                            className="btn danger"
                            type="button"
                            onClick={async () => {
                              const id = config.wallpaperId!
                              if (!confirm('Remove this custom wallpaper?')) return
                              await window.triCass.wallpaperRemove(id)
                              const list = (await window.triCass.wallpapersList()) as WallpaperRef[]
                              setWallpapers(list)
                              await saveConfig({
                                ...config,
                                wallpaperId: DEFAULT_WALLPAPER_ID,
                                customWallpaperIds: (config.customWallpaperIds || []).filter((x) => x !== id)
                              })
                              const url = (await window.triCass.wallpaperDataUrl(DEFAULT_WALLPAPER_ID)) as {
                                ok: boolean
                                url?: string
                              }
                              if (url.ok && url.url) setWallpaperUrl(url.url)
                              flash('Removed')
                            }}
                          >
                            Remove selected custom
                          </button>
                        ) : null}
                      </div>
                    </div>
                  <div className="field">
                    <label><span>Font size</span><span>{config.fontSize}px</span></label>
                    <input type="range" min={13} max={18} value={config.fontSize} onChange={(e) => void saveConfig({ ...config, fontSize: Number(e.target.value) })} />
                  </div>
                  <h3>General</h3>
                  <div className="field">
                    <label><span>Custom instructions</span></label>
                    <textarea rows={4} value={config.systemPrompt} onChange={(e) => void saveConfig({ ...config, systemPrompt: e.target.value })} />
                  </div>
                  <div className="field">
                    <label><span>Default output platform</span></label>
                    <select
                      value={config.defaultPlatform || 'auto'}
                      onChange={(e) =>
                        void saveConfig({
                          ...config,
                          defaultPlatform: e.target.value as ChatConfig['defaultPlatform']
                        })
                      }
                    >
                      <option value="auto">Auto / ask</option>
                      <option value="web">Web</option>
                      <option value="android">Android</option>
                      <option value="electron">Electron</option>
                      <option value="python">Python</option>
                    </select>
                  </div>
                  <h3>Models &amp; agent</h3>
                  <div className="row-between">
                    <span>Streaming</span>
                    <button className={`tool-toggle ${config.streaming ? 'on' : ''}`} type="button" onClick={() => void saveConfig({ ...config, streaming: !config.streaming })}>{config.streaming ? 'On' : 'Off'}</button>
                  </div>
                  <div className="row-between">
                    <span>Enter to send</span>
                    <button className={`tool-toggle ${config.enterToSend ? 'on' : ''}`} type="button" onClick={() => void saveConfig({ ...config, enterToSend: !config.enterToSend })}>{config.enterToSend ? 'On' : 'Off'}</button>
                  </div>
                  <div className="row-between">
                    <span>Auto-approve agent commands</span>
                    <button className={`tool-toggle ${config.autoApproveCommands ? 'on' : ''}`} type="button" onClick={() => void saveConfig({ ...config, autoApproveCommands: !config.autoApproveCommands })}>{config.autoApproveCommands ? 'On' : 'Off'}</button>
                  </div>
                  <h3>Templates &amp; image</h3>
                  <div className="field">
                    <label><span>Image backend</span></label>
                    <input
                      value={config.imageBackend || 'procedural-png@1'}
                      onChange={(e) => void saveConfig({ ...config, imageBackend: e.target.value })}
                    />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '6px 0 0' }}>
                      Built-in offline PNG writer (standard + detailed presets). NSFW blocked. Full SD/ONNX deferred for 8GB.
                    </p>
                  </div>
                  <div className="field">
                    <label><span>Image quality default</span></label>
                    <select
                      value={config.imageQuality || 'detailed'}
                      onChange={(e) => {
                        const q = e.target.value as 'standard' | 'detailed'
                        setImageQuality(q)
                        void saveConfig({ ...config, imageQuality: q })
                      }}
                    >
                      <option value="standard">Standard</option>
                      <option value="detailed">Detailed</option>
                    </select>
                  </div>
                  <div className="row-between">
                    <span>Tray / background run</span>
                    <button
                      className={`tool-toggle ${config.trayEnabled ? 'on' : ''}`}
                      type="button"
                      onClick={() => {
                        const next = !config.trayEnabled
                        void window.triCass.traySet(next)
                        void saveConfig({ ...config, trayEnabled: next })
                      }}
                    >
                      {config.trayEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="row-between">
                    <span>Web search when researching</span>
                    <button
                      className={`tool-toggle ${config.webSearch ? 'on' : ''}`}
                      type="button"
                      onClick={() => void saveConfig({ ...config, webSearch: !config.webSearch })}
                    >
                      {config.webSearch ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="row-between">
                    <span>Relative timestamps</span>
                    <button
                      className={`tool-toggle ${config.relativeTimestamps ? 'on' : ''}`}
                      type="button"
                      onClick={() =>
                        void saveConfig({ ...config, relativeTimestamps: !config.relativeTimestamps })
                      }
                    >
                      {config.relativeTimestamps ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="field">
                    <label><span>Ollama URL</span></label>
                    <input
                      value={config.ollamaUrl || 'http://127.0.0.1:11434'}
                      onChange={(e) => void saveConfig({ ...config, ollamaUrl: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label><span>Proxy (optional Advanced)</span></label>
                    <input
                      value={config.proxyUrl || ''}
                      placeholder="http://proxy:port"
                      onChange={(e) => void saveConfig({ ...config, proxyUrl: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" type="button" onClick={() => void window.triCass.windowNew()}>
                      New window
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        const text = await window.triCass.diagText()
                        await window.triCass.clipboardWrite(text)
                        flash('Diagnostics copied')
                      }}
                    >
                      Copy diagnostics
                    </button>
                    <button className="btn" type="button" onClick={() => void window.triCass.diagOpenLogs()}>
                      Open logs folder
                    </button>
                    <button className="btn" type="button" onClick={() => void window.triCass.dataExportAll()}>
                      Export all data
                    </button>
                    <button className="btn" type="button" onClick={() => void window.triCass.dataImportBackup().then(() => refreshSessions())}>
                      Import backup
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void window.triCass.templatesUndo().then((r) => flash((r as { ok?: boolean }).ok ? 'Template undone' : 'No checkpoint'))}
                    >
                      Undo last template
                    </button>
                  </div>
                  <div className="field">
                    <label><span>Template pack location (optional override)</span></label>
                    <input
                      value={config.templatePackPath || ''}
                      placeholder="Leave blank for default userData/template-packs"
                      onChange={(e) => void saveConfig({ ...config, templatePackPath: e.target.value })}
                    />
                  </div>
                  <details>
                    <summary>Advanced sampling</summary>
                    <div className="field">
                      <label><span>Temperature</span><span>{config.temperature.toFixed(2)}</span></label>
                      <input type="range" min={0} max={1.5} step={0.05} value={config.temperature} onChange={(e) => void saveConfig({ ...config, temperature: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label><span>Top P</span><span>{config.topP.toFixed(2)}</span></label>
                      <input type="range" min={0} max={1} step={0.05} value={config.topP} onChange={(e) => void saveConfig({ ...config, topP: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label><span>Max tokens</span><span>{config.maxTokens}</span></label>
                      <input type="range" min={256} max={8192} step={256} value={config.maxTokens} onChange={(e) => void saveConfig({ ...config, maxTokens: Number(e.target.value) })} />
                    </div>
                  </details>
                  <details>
                    <summary>How templates + AI editing works</summary>
                    <p style={{ color: 'var(--text-muted)' }}>
                      Download the library once, browse offline, click Use to copy into your workspace, then chat
                      with “AI edit” selected — Tri Cass AI changes the files for you. No code editor required.
                    </p>
                  </details>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Privacy: chats, knowledge, and models stay on this machine. Telemetry is off. Releases are manual via GitHub.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn danger" type="button" onClick={async () => {
                      if (!confirm('Clear all chats?')) return
                      const s = await window.triCass.clearAllSessions()
                      setSessions([s])
                      await selectSession(s.id)
                    }}>Clear all chats</button>
                    <button className="btn" type="button" onClick={() => void window.triCass.exportChat(activeId!, 'json')}>Export chat JSON</button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void saveConfig({
                          ...config,
                          temperature: 0.7,
                          topP: 0.9,
                          maxTokens: 4096,
                          streaming: true,
                          appearance: 'dark',
                          fontSize: 15,
                          defaultPlatform: 'auto',
                          imageBackend: 'procedural-png@1'
                        })
                      }
                    >
                      Reset defaults
                    </button>
                    <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
                  </div>
                  <details>
                    <summary>Keyboard shortcuts</summary>
                    <ul>
                      <li>Enter — send (when enabled)</li>
                      <li>Shift+Enter — newline</li>
                      <li>Ctrl/Cmd+Q — quit</li>
                      <li>/plan /code /kb /ascii /image — slash commands</li>
                    </ul>
                  </details>
                </div>
              </div>
            </div>
          )}

          {panel === 'about' && (
            <AboutPanel version={version} onBack={() => setPanel('chat')} attribution={packAttribution} />
          )}
        </section>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
    </>
  )
}
