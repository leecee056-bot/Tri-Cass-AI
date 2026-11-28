import { useEffect, useMemo, useRef, useState } from 'react'
// useRef used by ProjectRunPanel log scroll
import type { ChatConfig } from '../../shared/types'

type TemplateMeta = {
  id: string
  name: string
  category: string
  path: string
  license: string
  pack: string
  tags: string[]
  preview?: string
  favorite?: boolean
}

type PackStatus = {
  installed: boolean
  count: number
  target: number
  attribution: string[]
}

type Props = {
  panel: 'templates' | 'ascii' | 'about' | 'settings'
  config: ChatConfig
  version: string
  onBack: () => void
  onSaveConfig: (next: ChatConfig) => void
  onUseTemplate: (id: string, name?: string) => void
  onEditTemplate: (id: string) => void
  selectedTemplateId: string | null
  onSelectTemplate: (id: string | null) => void
  flash: (msg: string) => void
}

const PAGE = 48

export function TemplatesPanel({
  onBack,
  onUseTemplate,
  onEditTemplate,
  selectedTemplateId,
  onSelectTemplate,
  flash
}: Omit<Props, 'panel' | 'config' | 'version' | 'onSaveConfig'>) {
  const [status, setStatus] = useState<PackStatus | null>(null)
  const [items, setItems] = useState<TemplateMeta[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [tag, setTag] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [progress, setProgress] = useState<{ status: string; percent?: number; error?: string } | null>(
    null
  )
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const listRef = useRef<HTMLDivElement>(null)
  const loadingMore = useRef(false)

  async function refresh(reset = false) {
    const st = (await window.triCass.templatesStatus()) as PackStatus
    setStatus(st)
    const nextOffset = reset ? 0 : offset
    const res = (await window.triCass.templatesSearch({
      query,
      category,
      tag: tag || undefined,
      favoritesOnly,
      offset: nextOffset,
      limit: PAGE
    })) as { total: number; items: TemplateMeta[]; categories: Record<string, number> }
    setTotal(res.total)
    setCategories(res.categories || {})
    setItems((prev) => (reset ? res.items : [...prev, ...res.items]))
    if (reset) setOffset(res.items.length)
    else setOffset(nextOffset + res.items.length)
  }

  useEffect(() => {
    void refresh(true)
    const off = window.triCass.on('templates:packProgress', (p) => {
      setProgress(p as { status: string; percent?: number; error?: string })
    })
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void refresh(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, tag, favoritesOnly])

  const categoryEntries = useMemo(
    () => Object.entries(categories).sort((a, b) => b[1] - a[1]),
    [categories]
  )

  async function downloadPack() {
    const mb = await window.triCass.templatesDiskEstimate()
    if (!confirm(`Download template library (~${mb} MB)? Needs ~${status?.target || 1000} usable templates.`)) {
      return
    }
    setProgress({ status: 'Starting…', percent: 0 })
    const res = (await window.triCass.templatesDownload({ extras: true })) as {
      ok: boolean
      error?: string
      status?: PackStatus
    }
    if (res.ok) {
      flash(`Indexed ${res.status?.count ?? 0} templates`)
      await refresh(true)
    } else {
      flash(res.error || 'Download failed')
    }
  }

  function onScroll() {
    const el = listRef.current
    if (!el || loadingMore.current) return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 240 && items.length < total) {
      loadingMore.current = true
      void refresh(false).finally(() => {
        loadingMore.current = false
      })
    }
  }

  return (
    <div className="messages panel-page" ref={listRef} onScroll={onScroll}>
      <div className="messages-inner wide">
        <div className="row-between">
          <h2 style={{ fontFamily: 'var(--font-serif)', margin: 0 }}>Templates</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`tool-toggle ${view === 'grid' ? 'on' : ''}`} type="button" onClick={() => setView('grid')}>
              Grid
            </button>
            <button className={`tool-toggle ${view === 'list' ? 'on' : ''}`} type="button" onClick={() => setView('list')}>
              List
            </button>
            <button className="btn" type="button" onClick={onBack}>
              Back to chat
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>
          You don’t need to code — pick a template, then ask Tri Cass AI to customise it in plain English.
        </p>

        {!status?.installed || (status.count || 0) < 50 ? (
          <div className="banner">
            <p style={{ marginTop: 0 }}>
              Template library not installed yet. One-click download packs MIT/free GitHub collections
              (target ≥{status?.target || 1000}).
            </p>
            <button className="btn primary" type="button" onClick={() => void downloadPack()}>
              Download template library (~1000)
            </button>
            {progress && (
              <div style={{ marginTop: 12 }}>
                <div className="row-between">
                  <span>
                    {progress.status}
                    {progress.percent != null ? ` · ${progress.percent}%` : ''}
                  </span>
                  <button className="btn" type="button" onClick={() => void window.triCass.templatesCancelDownload()}>
                    Cancel
                  </button>
                </div>
                <div className="progress">
                  <i style={{ width: `${progress.percent || 0}%` }} />
                </div>
                {progress.error ? <p className="error-text">{progress.error}</p> : null}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="row-between" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
              <span className="pill">
                {status.count.toLocaleString()} / {status.target}+ indexed
              </span>
              <button className="btn" type="button" onClick={() => void downloadPack()}>
                Re-download / update pack
              </button>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const t = (await window.triCass.templatesRandom()) as TemplateMeta | null
                  if (t) {
                    onSelectTemplate(t.id)
                    flash(`Surprise: ${t.name}`)
                  }
                }}
              >
                Surprise me
              </button>
            </div>
            {progress && !progress.error && progress.percent != null && progress.percent < 100 && (
              <div style={{ marginBottom: 12 }}>
                <div className="progress">
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            )}
          </>
        )}

        <div className="template-filters">
          <input
            className="search"
            placeholder="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search templates"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryEntries.map(([c, n]) => (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            ))}
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag filter">
            <option value="">All tags</option>
            <option value="tailwind">Tailwind</option>
            <option value="bootstrap">Bootstrap</option>
            <option value="responsive">Responsive</option>
            <option value="dark">Dark</option>
          </select>
          <button
            className={`tool-toggle ${favoritesOnly ? 'on' : ''}`}
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            Favorites
          </button>
        </div>

        <div className="category-badges" aria-label="Category counts">
          {categoryEntries.slice(0, 12).map(([c, n]) => (
            <button
              key={c}
              type="button"
              className={`chip ${category === c ? 'on' : ''}`}
              onClick={() => setCategory(c === category ? 'all' : c)}
            >
              {c} · {n}
            </button>
          ))}
        </div>

        <div className={view === 'grid' ? 'template-grid' : 'template-list'} role="list">
          {items.map((t) => (
            <article
              key={t.id}
              className={`template-card ${selectedTemplateId === t.id ? 'selected' : ''}`}
              role="listitem"
              tabIndex={0}
              aria-label={`${t.name}, ${t.category}`}
              onClick={() => onSelectTemplate(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectTemplate(t.id)
              }}
            >
              <div className="template-thumb" aria-hidden>
                <span>{t.category.slice(0, 1).toUpperCase()}</span>
              </div>
              <div className="template-body">
                <h3>{t.name}</h3>
                <p>
                  {t.category} · {t.tags.slice(0, 3).join(', ')}
                </p>
                <div className="template-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onUseTemplate(t.id, t.name)}
                  >
                    Use
                  </button>
                  <button className="btn" type="button" onClick={() => onEditTemplate(t.id)}>
                    AI edit
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => void window.triCass.templatesPreview(t.id)}
                  >
                    Preview
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    title="Favorite"
                    onClick={async () => {
                      await window.triCass.templatesFavorite(t.id)
                      await refresh(true)
                    }}
                  >
                    {t.favorite ? '★' : '☆'}
                  </button>
                </div>
              </div>
            </article>
          ))}
          {!items.length && (
            <p style={{ color: 'var(--text-muted)' }}>
              {status?.count ? 'No matches.' : 'Download the library to browse offline.'}
            </p>
          )}
        </div>
        {items.length < total ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
            Showing {items.length} of {total} — scroll for more
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function AsciiPanel({ onBack, flash }: { onBack: () => void; flash: (m: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([])
  const [font, setFont] = useState('Standard')
  const [text, setText] = useState('Tri Cass')
  const [ascii, setAscii] = useState('')
  const [imagePath, setImagePath] = useState('')

  useEffect(() => {
    void window.triCass.asciiFonts().then((f) => {
      setFonts(f)
      if (f[0]) setFont(f[0])
    })
  }, [])

  async function renderText() {
    const res = (await window.triCass.asciiText(text, font)) as { ok: boolean; ascii: string; error?: string }
    if (res.ok) setAscii(res.ascii)
    else flash(res.error || 'Failed')
  }

  return (
    <div className="messages panel-page">
      <div className="messages-inner">
        <div className="row-between">
          <h2 style={{ fontFamily: 'var(--font-serif)', margin: 0 }}>ASCII studio</h2>
          <button className="btn" type="button" onClick={onBack}>
            Back to chat
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>
          Powered by <strong>figlet.js</strong> (text) and a local image→ASCII converter.
        </p>
        <div className="settings-grid">
          <div className="field">
            <label>
              <span>Text</span>
            </label>
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="ASCII text" />
          </div>
          <div className="field">
            <label>
              <span>Font</span>
            </label>
            <select value={font} onChange={(e) => setFont(e.target.value)} aria-label="Figlet font">
              {fonts.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" type="button" onClick={() => void renderText()}>
              Generate
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await window.triCass.clipboardWrite(ascii)
                flash('Copied')
              }}
              disabled={!ascii}
            >
              Copy
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const res = (await window.triCass.asciiSave(ascii, text)) as { ok: boolean; path?: string }
                if (res.ok) flash(`Saved ${res.path}`)
              }}
              disabled={!ascii}
            >
              Save .txt
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const res = (await window.triCass.asciiToPng(ascii, text)) as { ok: boolean; path?: string }
                if (res.ok) flash(`PNG ${res.path}`)
              }}
              disabled={!ascii}
            >
              Export PNG
            </button>
          </div>
          <div className="field">
            <label>
              <span>Image → ASCII</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="Path to PNG"
              />
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const files = await window.triCass.pickFiles()
                  if (files[0]) setImagePath(files[0])
                }}
              >
                Pick
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={async () => {
                  const res = (await window.triCass.asciiImage(imagePath)) as {
                    ok: boolean
                    ascii: string
                    error?: string
                  }
                  if (res.ok) setAscii(res.ascii)
                  else flash(res.error || 'Failed')
                }}
              >
                Convert
              </button>
            </div>
          </div>
          <pre className="ascii-out" aria-label="ASCII output">
            {ascii || 'Output appears here'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function AboutPanel({
  version,
  onBack,
  attribution
}: {
  version: string
  onBack: () => void
  attribution: string[]
}) {
  const [tools, setTools] = useState<string[]>([])
  useEffect(() => {
    void window.triCass.agentTools().then((t) => setTools(t || []))
  }, [])
  return (
    <div className="messages panel-page">
      <div className="messages-inner">
        <div className="panel-card about-card">
          <div className="about-hero">
            <img src="./brand/mascot-lg.png" alt="" width={120} height={120} />
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0, marginBottom: 6 }}>About Tri Cass AI</h2>
              <p style={{ margin: 0 }}>Version {version} · MIT License</p>
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>
            Standalone local coding assistant. You don’t need to code — just ask. Updates ship as GitHub
            Releases (portable zip / installer).
          </p>
          <h3>Agent tool allow-list</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Coding agent may only call these tools (one JSON call per step):
          </p>
          <ul>
            {tools.map((t) => (
              <li key={t}>
                <code>{t}</code>
              </li>
            ))}
            {!tools.length ? <li style={{ color: 'var(--text-muted)' }}>Loading…</li> : null}
          </ul>
          <h3>Attribution</h3>
          <ul>
            <li>figlet.js — FIGlet fonts for ASCII text</li>
            <li>pngjs — local PNG encode/decode</li>
            <li>Image backend: procedural-png@1 (built-in offline renderer)</li>
            {attribution.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            NSFW image prompts are blocked. Android release signing / Play credentials are refused.
            Telemetry is off. Knowledge stays under local userData/kb — no silent cloud upload.
          </p>
          <button className="btn" type="button" onClick={onBack}>
            Back to chat
          </button>
        </div>
      </div>
    </div>
  )
}

type Inspect = {
  ok?: boolean
  error?: string
  projectPath?: string
  kind?: string
  hasPackageJson?: boolean
  startCommand?: string | null
  installCommand?: string | null
  files?: string[]
  runtimes?: {
    node: { ok: boolean; version?: string; guidance?: string }
    python: { ok: boolean; version?: string; guidance?: string }
  }
}

export function ProjectRunPanel({
  projectPath,
  workspaceRoot,
  onPickProject,
  onBack,
  flash
}: {
  projectPath: string | null
  workspaceRoot: string
  onPickProject: (path: string) => void
  onBack: () => void
  flash: (msg: string) => void
}) {
  const [info, setInfo] = useState<Inspect | null>(null)
  const [log, setLog] = useState('')
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setInfo(null)
      return
    }
    void window.triCass.projectInspect(projectPath).then((r) => setInfo(r as Inspect))
  }, [projectPath])

  useEffect(() => {
    const offChunk = window.triCass.on('project:runChunk', (payload) => {
      const p = payload as { stream: string; text: string }
      setLog((prev) => (prev + p.text).slice(-180_000))
    })
    const offDone = window.triCass.on('project:runDone', (payload) => {
      const r = payload as { id?: string; running?: boolean; exitCode?: number | null }
      if (r.running === false) {
        setRunning(false)
        setRunId(null)
      }
    })
    return () => {
      offChunk()
      offDone()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  async function run(action: 'install' | 'start') {
    if (!projectPath) return
    setLog('')
    setRunning(true)
    const res = (await window.triCass.projectRun(projectPath, action)) as {
      ok: boolean
      error?: string
      run?: {
        id: string
        running: boolean
        stdout?: string
        stderr?: string
        exitCode?: number | null
      }
    }
    if (!res.ok) {
      setRunning(false)
      setLog((prev) => prev + `\nerror: ${res.error}\n`)
      flash(res.error || 'Run failed')
      return
    }
    setRunId(res.run?.id || null)
    if (res.run && !res.run.running) setRunning(false)
    if (action === 'install' && res.run) {
      setLog(
        (res.run.stdout || '') +
          (res.run.stderr ? `\n${res.run.stderr}` : '') +
          `\n[exit ${res.run.exitCode ?? '?'}]\n`
      )
      setRunning(false)
    }
  }

  const projects = useMemo(() => {
    if (!workspaceRoot) return [] as string[]
    // Prefer current path; workspace.projects names need joining in parent — keep simple
    return projectPath ? [projectPath] : []
  }, [projectPath, workspaceRoot])

  return (
    <div className="messages panel-page">
      <div className="messages-inner">
        <h2 style={{ fontFamily: 'var(--font-serif)', marginTop: 0 }}>Run · project</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          OpenHands-style panel: install, start, stop, and live stdout/stderr. Commands run with cwd locked to the
          project folder (sandbox env).
        </p>
        {!projectPath ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Create a project in chat first, then open <strong>Run panel</strong> from the success message — or paste a
            path under your workspace.
          </p>
        ) : null}
        <div className="field">
          <label>
            <span>Project path</span>
          </label>
          <input
            value={projectPath || ''}
            placeholder={`${workspaceRoot}/my-project`}
            onChange={(e) => onPickProject(e.target.value.trim())}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            className="btn"
            type="button"
            disabled={!projectPath}
            onClick={() =>
              projectPath &&
              void window.triCass.clipboardWrite(projectPath).then(() => flash('Copied project path'))
            }
          >
            Copy path
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!projectPath || running || !info?.installCommand}
            onClick={() => void run('install')}
          >
            npm install
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!projectPath || running || !info?.startCommand}
            onClick={() => void run('start')}
          >
            Start
          </button>
          <button
            className="btn danger"
            type="button"
            disabled={!running && !runId}
            onClick={() =>
              void window.triCass.projectStop(runId || undefined).then(() => {
                setRunning(false)
                setRunId(null)
                flash('Stopped')
              })
            }
          >
            Stop
          </button>
          <button className="btn" type="button" onClick={onBack}>
            Back to chat
          </button>
        </div>
        {info?.ok === false ? (
          <p style={{ color: 'var(--danger, #c44)' }}>{info.error}</p>
        ) : null}
        {info?.ok !== false && info?.projectPath ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Kind: {info.kind} · start: <code>{info.startCommand || 'n/a'}</code>
            {info.runtimes?.node?.ok === false ? ` · ${info.runtimes.node.guidance}` : ''}
            {info.runtimes?.python?.ok === false ? ` · ${info.runtimes.python.guidance}` : ''}
          </p>
        ) : null}
        <h3>Stdout / stderr</h3>
        <pre
          ref={logRef}
          className="ascii-out"
          style={{ minHeight: 160, maxHeight: 280, overflow: 'auto' }}
          aria-label="Run output"
        >
          {log || (running ? 'Running…' : 'Output appears here after install/start')}
        </pre>
        <h3>Files</h3>
        <ul style={{ maxHeight: 180, overflow: 'auto' }}>
          {(info?.files || []).map((f) => (
            <li key={f}>
              <button
                className="text-link"
                type="button"
                onClick={() => {
                  if (!projectPath) return
                  void window.triCass.projectReadFile(projectPath, f).then((r) => {
                    const res = r as { ok: boolean; text?: string; error?: string }
                    if (!res.ok) flash(res.error || 'Preview failed')
                    else setPreview({ path: f, text: res.text || '' })
                  })
                }}
              >
                {f}
              </button>
            </li>
          ))}
          {!info?.files?.length ? (
            <li style={{ color: 'var(--text-muted)' }}>No files listed yet</li>
          ) : null}
        </ul>
        {preview ? (
          <div style={{ marginTop: 12 }}>
            <div className="row-between">
              <strong>{preview.path}</strong>
              <button className="btn" type="button" onClick={() => setPreview(null)}>
                Close preview
              </button>
            </div>
            {/\.html?$/i.test(preview.path) ? (
              <iframe
                title="HTML preview"
                sandbox=""
                srcDoc={preview.text}
                style={{ width: '100%', height: 220, border: '1px solid var(--border)', marginTop: 8 }}
              />
            ) : (
              <pre className="ascii-out" style={{ maxHeight: 220, overflow: 'auto' }}>
                {preview.text.slice(0, 12_000)}
              </pre>
            )}
          </div>
        ) : null}
        {projects.length ? null : null}
      </div>
    </div>
  )
}
