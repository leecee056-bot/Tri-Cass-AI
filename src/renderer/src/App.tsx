import { useEffect, useMemo, useRef, useState } from 'react'
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
}

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  paths?: string[]
}

const defaultConfig: ChatConfig = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  streaming: true,
  webSearch: false,
  codeInterpreter: true,
  imageGeneration: false,
  fileAnalysis: true
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [ollama, setOllama] = useState<OllamaStatus>({ ok: false, detail: '…', models: [] })
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({ root: '', projects: [] })
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState('qwen2.5-coder:3b')
  const [config, setConfig] = useState<ChatConfig>(defaultConfig)
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [busy, setBusy] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const [pull, setPull] = useState<PullProgress | null>(null)
  const [composerTools, setComposerTools] = useState({
    attach: true,
    image: false,
    file: true,
    code: true,
    web: false
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamBuf = useRef('')

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) || null,
    [sessions, activeId]
  )

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
          if (last?.role === 'assistant' && last.id === 'streaming') {
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
          runId?: string
        }
        if (p.sessionId !== activeIdRef.current) return
        streamBuf.current = ''
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== 'streaming')
          return [
            ...without,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content: p.content,
              paths: p.files
            }
          ]
        })
        setBusy(false)
        setStatus('')
        setRunId(p.runId || null)
        void refreshSessions()
      }),
      window.triCass.on('chat:error', (payload) => {
        const p = payload as { sessionId: string; error: string }
        if (p.sessionId !== activeIdRef.current) return
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'streaming'),
          { id: `e-${Date.now()}`, role: 'assistant', content: `Error: ${p.error}` }
        ])
        setBusy(false)
        setStatus('')
      }),
      window.triCass.on('chat:status', (payload) => {
        const p = payload as { status: string }
        setStatus(p.status)
      }),
      window.triCass.on('agent:step', (payload) => {
        const p = payload as { step: { kind: string; text: string } }
        setStatus(`${p.step.kind}: ${p.step.text.slice(0, 80)}`)
      }),
      window.triCass.on('models:pullProgress', (payload) => {
        setPull(payload as PullProgress)
      })
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  async function boot() {
    const snap = (await window.triCass.getSnapshot()) as Snapshot
    applySnapshot(snap)
    setReady(true)
  }

  function applySnapshot(snap: Snapshot) {
    setOllama(snap.ollama)
    setWorkspace(snap.workspace)
    setSessions(snap.sessions)
    setActiveId(snap.activeSessionId)
    setModel(snap.selectedModel || 'qwen2.5-coder:3b')
    setConfig(snap.config)
    setCatalog(snap.catalog)
    const active = snap.sessions.find((s) => s.id === snap.activeSessionId)
    setMessages(
      (active?.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          paths: m.meta?.paths
        }))
    )
  }

  async function refreshSessions() {
    const list = (await window.triCass.listSessions()) as ChatSession[]
    setSessions(list)
  }

  async function selectSession(id: string) {
    setActiveId(id)
    const session = (await window.triCass.getSession(id)) as ChatSession | null
    setMessages(
      (session?.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          paths: m.meta?.paths
        }))
    )
  }

  async function newChat() {
    const session = (await window.triCass.createSession()) as ChatSession
    setSessions((prev) => [session, ...prev])
    setActiveId(session.id)
    setMessages([])
  }

  async function send(
    mode: 'chat' | 'summarise' | 'plan' | 'research' | 'build' = 'chat',
    override?: string
  ) {
    if (!activeId || busy) return
    const content = (override ?? draft).trim()
    if (!content) return
    setDraft('')
    setBusy(true)
    streamBuf.current = ''
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content }])
    if (mode !== 'chat' || /make (a |an )?(website|app)/i.test(content)) {
      setMessages((prev) => [
        ...prev,
        { id: 'streaming', role: 'assistant', content: 'Working…' }
      ])
    }
    const result = (await window.triCass.chatSend({
      sessionId: activeId,
      content,
      model,
      config,
      mode
    })) as { runId?: string }
    if (result?.runId) setRunId(result.runId)
  }

  async function stop() {
    await window.triCass.chatStop(runId || undefined)
    setBusy(false)
    setStatus('stopped')
  }

  async function pullModel(tag: string) {
    setPull({ model: tag, status: 'starting', percent: 0 })
    const res = await window.triCass.pullModel(tag)
    if (res.ok) {
      setModel(tag)
      const st = (await window.triCass.ollamaStatus()) as OllamaStatus
      setOllama(st)
    }
  }

  if (!ready) {
    return <div className="empty-hint">Booting Tri Cass AI…</div>
  }

  return (
    <div className="app-shell">
      <header className="mech-frame topbar">
        <div className="logo-mark" aria-hidden />
        <div className="brand-block">
          <h1 className="brand-title">TRI CASS AI</h1>
          <p className="brand-tag">Plan · Research · Create · Automate</p>
        </div>
        <p className="top-aside">Advanced AI assistant powered by local intelligence</p>
      </header>

      <div className="main-grid">
        <aside className="panel left-panel">
          <button className="nav-btn primary" type="button" onClick={() => void newChat()}>
            <span className="nav-icon">＋</span> New Chat
          </button>
          <button className="nav-btn" type="button" onClick={() => setShowCatalog(true)}>
            <span className="nav-icon">⬇</span> Models
          </button>
          <button
            className="nav-btn"
            type="button"
            onClick={async () => {
              const info = (await window.triCass.pickWorkspace()) as WorkspaceInfo
              setWorkspace(info)
            }}
          >
            <span className="nav-icon">▣</span> Workspaces
          </button>
          <button
            className="nav-btn"
            type="button"
            onClick={async () => {
              if (!activeId) return
              const res = (await window.triCass.kbAttach(activeId)) as {
                sources: string[]
                added: number
              }
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === activeId ? { ...s, kbPaths: res.sources } : s
                )
              )
              setStatus(`KB: ${res.added} file(s) attached`)
            }}
          >
            <span className="nav-icon">📚</span> Knowledge
          </button>
          <button className="nav-btn" type="button" onClick={() => void window.triCass.openWorkspace()}>
            <span className="nav-icon">📂</span> Open folder
          </button>

          <div className="section-label">Recent</div>
          <div className="chat-list">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chat-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => void selectSession(s.id)}
              >
                {s.title}
              </button>
            ))}
          </div>

          <div className="workspace-box" title={workspace.root}>
            Workspace: {workspace.root || '—'}
          </div>
          <div className="status-row">
            <span className={`dot ${ollama.ok ? 'on' : ''}`} />
            {ollama.ok ? 'Online' : 'Ollama offline'}
          </div>
        </aside>

        <section className="panel center-panel">
          <div className="model-bar">
            <div className="model-select-wrap">
              <select
                className="model-select"
                value={model}
                onChange={(e) => {
                  const v = e.target.value
                  setModel(v)
                  void window.triCass.setSelectedModel(v)
                }}
              >
                {ollama.models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
                {!ollama.models.some((m) => m.name === model) && (
                  <option value={model}>{model} (not pulled)</option>
                )}
              </select>
              <span className="pill">{ollama.ok ? 'Online' : 'Offline'}</span>
            </div>
            <div className="toolbar-actions">
              <button className="ghost-btn" type="button" onClick={() => setShowCatalog(true)}>
                Download model
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() =>
                  void send('build', draft.trim() || 'Make a website called Local Launch')
                }
              >
                Create project
              </button>
              {busy && (
                <button className="ghost-btn danger" type="button" onClick={() => void stop()}>
                  Stop
                </button>
              )}
            </div>
          </div>

          <div className="messages">
            {!messages.length && (
              <div className="empty-hint">
                Ask Tri Cass AI anything — or say <strong>make a website</strong> /{' '}
                <strong>make an app</strong> to create real folders on disk.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <pre>{m.content}</pre>
                {m.paths?.length ? (
                  <div className="meta-paths">
                    {m.paths.map((p) => (
                      <div key={p}>{p}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {status ? <div className="empty-hint" style={{ padding: 8 }}>{status}</div> : null}
            <div ref={bottomRef} />
          </div>

          <div className="composer">
            <div className="tool-row">
              {(
                [
                  ['attach', 'Attach'],
                  ['image', 'Image'],
                  ['file', 'File'],
                  ['code', 'Code'],
                  ['web', 'Web Search']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`tool-chip ${composerTools[key] ? 'on' : ''}`}
                  onClick={() =>
                    setComposerTools((t) => ({ ...t, [key]: !t[key] }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="input-row">
              <textarea
                value={draft}
                placeholder="Ask Tri Cass AI anything…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send('chat')
                  }
                }}
              />
              <button
                className="send-btn"
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => void send('chat')}
                title="Send"
              >
                ✈
              </button>
            </div>
          </div>
        </section>

        <aside className="panel right-panel">
          <h3>Configuration</h3>
          <div className="slider-block">
            <label>
              <span>Temperature</span>
              <span>{config.temperature.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={config.temperature}
              onChange={(e) => {
                const next = { ...config, temperature: Number(e.target.value) }
                setConfig(next)
                void window.triCass.setConfig(next)
              }}
            />
          </div>
          <div className="slider-block">
            <label>
              <span>Top P</span>
              <span>{config.topP.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.topP}
              onChange={(e) => {
                const next = { ...config, topP: Number(e.target.value) }
                setConfig(next)
                void window.triCass.setConfig(next)
              }}
            />
          </div>
          <div className="slider-block">
            <label>
              <span>Max Tokens</span>
              <span>{config.maxTokens}</span>
            </label>
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={config.maxTokens}
              onChange={(e) => {
                const next = { ...config, maxTokens: Number(e.target.value) }
                setConfig(next)
                void window.triCass.setConfig(next)
              }}
            />
          </div>

          <div className="toggle-row">
            <span>Streaming</span>
            <button
              type="button"
              className={`toggle ${config.streaming ? 'on' : ''}`}
              onClick={() => {
                const next = { ...config, streaming: !config.streaming }
                setConfig(next)
                void window.triCass.setConfig(next)
              }}
            >
              <span />
            </button>
          </div>

          <h3>Tools</h3>
          {(
            [
              ['webSearch', 'Web Search'],
              ['codeInterpreter', 'Code Interpreter'],
              ['imageGeneration', 'Image Generation'],
              ['fileAnalysis', 'File Analysis']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={config[key]}
                onChange={(e) => {
                  const next = { ...config, [key]: e.target.checked }
                  setConfig(next)
                  void window.triCass.setConfig(next)
                }}
              />
            </label>
          ))}

          <h3>Quick Actions</h3>
          <div className="quick-actions">
            <button type="button" onClick={() => { setDraft('Summarise the current topic'); void send('summarise') }}>
              Summarise
            </button>
            <button type="button" onClick={() => { setDraft('Make a plan for this project'); void send('plan') }}>
              Plan
            </button>
            <button type="button" onClick={() => { setDraft('Research approaches using the knowledge base'); void send('research') }}>
              Research
            </button>
          </div>

          {activeSession?.kbPaths?.length ? (
            <>
              <h3>Chat knowledge</h3>
              <div className="workspace-box">
                {activeSession.kbPaths.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            </>
          ) : null}
        </aside>
      </div>

      {showCatalog && (
        <div className="modal-backdrop" onClick={() => setShowCatalog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>MODEL CATALOG</h2>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>
              One-click pull via Ollama. Prefer green “Fits ~8 GB” tags on household PCs.
            </p>
            <div className="catalog-grid">
              {catalog.map((m) => (
                <div key={m.id} className="catalog-card">
                  <div>
                    <h4>{m.displayName}</h4>
                    <p>{m.notes}</p>
                    <span
                      className={`badge ${
                        m.ramBand === 'stretch' ? 'warn' : m.ramBand === 'needs-more-ram' ? 'bad' : ''
                      }`}
                    >
                      {ramBadgeLabel(m.ramBand)} · ~{m.approxRamGb} GB
                    </span>
                    {m.recommended ? <span className="badge">Recommended</span> : null}
                    <span className="badge">{m.ollamaTag}</span>
                  </div>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => void pullModel(m.ollamaTag)}
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
            {pull && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {pull.model}: {pull.status}
                  {pull.percent != null ? ` · ${pull.percent}%` : ''}
                  {pull.error ? ` · ${pull.error}` : ''}
                </p>
                <div className="progress">
                  <span style={{ width: `${pull.percent || 0}%` }} />
                </div>
              </div>
            )}
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button className="ghost-btn" type="button" onClick={() => setShowCatalog(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
