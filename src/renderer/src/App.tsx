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

type Panel = 'chat' | 'models' | 'knowledge' | 'workspace' | 'settings' | 'about'

const EXAMPLES = [
  'Make a website called Local Launch',
  'Make an app called Notes CLI',
  'Plan a small Python scraper for local files',
  'Summarise the knowledge attached to this chat'
]

function applyTheme(appearance: ChatConfig['appearance'], fontSize: number) {
  const root = document.documentElement
  let theme = appearance
  if (appearance === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
  root.style.setProperty('--font-size', `${fontSize}px`)
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
    if (config) applyTheme(config.appearance, config.fontSize)
  }, [config])

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
    applyTheme(snap.config.appearance, snap.config.fontSize)
    const active = snap.sessions.find((s) => s.id === snap.activeSessionId)
    loadMessages(active)
    setDraft(active?.draft || '')
    setAgentMode(active?.agentMode !== false)
    setMaximized(await window.triCass.windowIsMaximized())
    setReady(true)
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
    if (content.startsWith('/plan ')) {
      mode = 'plan'
      content = content.slice(6)
    } else if (content.startsWith('/code ')) {
      mode = 'build'
      content = content.slice(6)
    } else if (content.startsWith('/kb ')) {
      mode = 'research'
      content = content.slice(4)
    }

    if (attachments.length) {
      content = `${content}\n\nAttached:\n${attachments.map((a) => `- ${a}`).join('\n')}`
    }

    setDraft('')
    setAttachments([])
    void window.triCass.setDraft(activeId, '')
    setBusy(true)
    streamBuf.current = ''
    setAgentLog('')
    userScrolledUp.current = false
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content, createdAt: Date.now() }])
    const result = (await window.triCass.chatSend({
      sessionId: activeId,
      content,
      model,
      config,
      mode,
      agentMode,
      useKb
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
              <button className={`nav-item ${panel === 'settings' ? 'active' : ''}`} type="button" onClick={() => setPanel('settings')}>
                Settings
              </button>
              <button className={`nav-item ${panel === 'about' ? 'active' : ''}`} type="button" onClick={() => setPanel('about')}>
                About
              </button>
            </div>
            <div className="chat-list">
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
                    <div className="empty">
                      <h2>Tri Cass AI</h2>
                      <p>Local coding assistant for your PC. Chat, attach knowledge, or ask it to make a website or app on disk.</p>
                      <div className="examples">
                        {EXAMPLES.map((ex) => (
                          <button key={ex} type="button" onClick={() => void send('chat', ex)}>{ex}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((m) => (
                    <article key={m.id} className={`msg ${m.role}`}>
                      <div className="msg-role">
                        <span>{m.role === 'user' ? 'You' : 'Tri Cass AI'}</span>
                        {m.createdAt ? <span title={new Date(m.createdAt).toLocaleString()}>{new Date(m.createdAt).toLocaleTimeString()}</span> : null}
                      </div>
                      <Markdown text={m.content} />
                      {m.paths?.length ? (
                        <div className="paths">
                          {m.paths.map((p) => (
                            <button key={p} type="button" onClick={() => void window.triCass.openWorkspace(p)}>{p}</button>
                          ))}
                        </div>
                      ) : null}
                      {m.citations?.length ? (
                        <div className="citations">
                          <strong>Sources: </strong>
                          {m.citations.map((c) => <span key={c}>{c}</span>)}
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
                      </div>
                    </article>
                  ))}
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
                  className="composer"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const files = [...e.dataTransfer.files].map((f) => (f as File & { path?: string }).path || f.name)
                    setAttachments((prev) => [...prev, ...files])
                  }}
                >
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
                  <textarea
                    ref={inputRef}
                    value={draft}
                    placeholder="Message Tri Cass AI — local chat that can create websites & apps…"
                    onChange={(e) => queueDraft(e.target.value)}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items
                      if (!items) return
                      for (const item of items) {
                        if (item.type.startsWith('image/')) {
                          flash('Image paste noted — attach files for durable KB ingest')
                        }
                      }
                    }}
                    onKeyDown={(e) => {
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
                      <button className={`tool-toggle ${agentMode ? 'on' : ''}`} type="button" onClick={() => setAgentMode((v) => !v)}>
                        Agent
                      </button>
                      <button className={`tool-toggle ${useKb ? 'on' : ''}`} type="button" onClick={() => setUseKb((v) => !v)}>
                        KB
                      </button>
                      <button className="tool-toggle" type="button" onClick={() => void send('summarise', draft || 'Summarise our conversation so far')}>Summarise</button>
                      <button className="tool-toggle" type="button" onClick={() => void send('plan', draft || 'Make a plan for this project')}>Plan</button>
                      <button className="tool-toggle" type="button" onClick={() => void send('research', draft || 'Research using the knowledge base')}>Research</button>
                    </div>
                    {busy ? (
                      <button className="send stop" type="button" title="Stop" onClick={() => void stop()}>■</button>
                    ) : (
                      <button className="send" type="button" title="Send" disabled={!draft.trim() && !attachments.length} onClick={() => void send('chat')}>↑</button>
                    )}
                  </div>
                </div>
                <div className="hint">Enter to send · Shift+Enter for newline · /plan /code /kb · data stays on this machine</div>
              </div>
            </>
          )}

          {panel === 'models' && (
            <div className="messages">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Models</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  One-click pull via Ollama. Prefer “Fits ~8 GB” on household PCs.
                  {!ollama.ok && ' Install Ollama from https://ollama.com and start it locally.'}
                </p>
                <div className="catalog-list">
                  {catalog.map((m) => {
                    const installed = ollama.models.some((x) => x.name === m.ollamaTag || x.name.startsWith(m.ollamaTag))
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
                          {m.contextLength ? <span className="badge">ctx {m.contextLength}</span> : null}
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
            <div className="messages">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Knowledge · this chat</h2>
                <p style={{ color: 'var(--text-muted)' }}>Sources are linked to the current conversation and retrieved into prompts.</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn primary" type="button" onClick={async () => {
                    if (!activeId) return
                    const res = await window.triCass.kbAttach(activeId) as { sources: string[]; added: number }
                    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, kbPaths: res.sources } : s))
                    flash(`Attached ${res.added} file(s)`)
                  }}>Attach files / folder</button>
                  <button className="btn danger" type="button" onClick={async () => {
                    if (!activeId) return
                    await window.triCass.kbClear(activeId)
                    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, kbPaths: [] } : s))
                  }}>Clear KB</button>
                </div>
                <ul>
                  {(activeSession?.kbPaths || []).map((p) => <li key={p}>{p}</li>)}
                  {!activeSession?.kbPaths?.length && <li style={{ color: 'var(--text-muted)' }}>No sources yet.</li>}
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn primary" type="button" onClick={async () => setWorkspace(await window.triCass.pickWorkspace() as WorkspaceInfo)}>Choose folder</button>
                  <button className="btn" type="button" onClick={() => void window.triCass.openWorkspace()}>Open in explorer</button>
                  <button className="btn" type="button" onClick={() => void send('build', 'Make a website called Quick Site')}>Create website</button>
                  <button className="btn" type="button" onClick={() => void send('build', 'Make an app called Quick App')}>Create app</button>
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

          {panel === 'settings' && (
            <div className="messages">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Settings</h2>
                <div className="settings-grid">
                  <div className="field">
                    <label><span>Appearance</span></label>
                    <select value={config.appearance} onChange={(e) => void saveConfig({ ...config, appearance: e.target.value as ChatConfig['appearance'] })}>
                      <option value="system">System</option>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </div>
                  <div className="field">
                    <label><span>Font size</span><span>{config.fontSize}px</span></label>
                    <input type="range" min={13} max={18} value={config.fontSize} onChange={(e) => void saveConfig({ ...config, fontSize: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label><span>Custom instructions</span></label>
                    <textarea rows={4} value={config.systemPrompt} onChange={(e) => void saveConfig({ ...config, systemPrompt: e.target.value })} />
                  </div>
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
                    <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
                  </div>
                  <details>
                    <summary>Keyboard shortcuts</summary>
                    <ul>
                      <li>Enter — send (when enabled)</li>
                      <li>Shift+Enter — newline</li>
                      <li>Ctrl/Cmd+Q — quit</li>
                      <li>/plan /code /kb — slash commands</li>
                    </ul>
                  </details>
                </div>
              </div>
            </div>
          )}

          {panel === 'about' && (
            <div className="messages">
              <div className="messages-inner">
                <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>About Tri Cass AI</h2>
                <p>Version {version} · MIT License</p>
                <p style={{ color: 'var(--text-muted)' }}>
                  Standalone local coding assistant. Updates ship as GitHub Releases (portable zip / installer).
                </p>
                <button className="btn" type="button" onClick={() => setPanel('chat')}>Back to chat</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
