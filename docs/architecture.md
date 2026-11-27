# Tri Cass AI — Architecture

Standalone local coding assistant for household ~8 GB RAM PCs. Separate product from Tri-Cass Desk; does not share runtime or UI with the living-world companion.

## Chosen stack

| Layer | Choice | Why |
|-------|--------|-----|
| Desktop shell | **Electron + electron-vite + React + TypeScript** | Proven Windows installer/portable path (NSIS); fast React UI matching the mechanical matrix-green mockup |
| Inference | **Ollama** (`/api/chat`, `/api/pull`, `/api/tags`) | One-click model pull, streaming, wide GGUF catalog; no cloud |
| Optional runtime | llama.cpp / Jan-compatible OpenAI-ish base URL | Future adapter; primary path is Ollama |
| Agent loop | **In-process Cline-slim grammar** | Plan → one JSON tool call → observe → iterate (write/edit/read/list/run/search_knowledge/finish); templates for “make a website/app” so small models succeed |
| Knowledge base | **Per-chat local store** (JSON index + keyword/FTS-style scoring) | AnythingLLM-inspired attach-to-session UX without running a second heavy server on 8 GB machines |
| Packaging | **electron-builder** NSIS + portable x64 | Typical home-PC installers; GitHub Releases |

## Rejected / deferred

- **Forking Jan wholesale** — heavy; we reuse its model-hub *ideas* (catalog + pull progress) in our shell.
- **Embedding full OpenHands / RAGFlow / AnythingLLM servers** — too much RAM for the 8 GB target; patterns only.
- **Browser Use by default** — optional tool behind a toggle; off by default for local-first safety.

## Process layout

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React)                                       │
│  Left nav · Chat · Config/tools · Model catalog modal   │
└───────────────────────┬─────────────────────────────────┘
                        │ preload IPC
┌───────────────────────▼─────────────────────────────────┐
│  Main                                                   │
│  ollama.ts · agent.ts · knowledge.ts · workspace.ts     │
│  catalog.ts · chatStore.ts                              │
└───────────┬─────────────────────────────┬───────────────┘
            │ HTTP                        │ fs / child_process
            ▼                             ▼
     Ollama (local)              User workspace root
                                 + projects/<name>/
                                 + kb/<chatId>/
```

## Model catalog (curated)

Defaults favour **Q4/Q5** quantizations for ~8 GB RAM systems:

| ID | Display | Approx RAM | Notes |
|----|---------|------------|-------|
| `qwen2.5-coder:1.5b` | Qwen2.5 Coder 1.5B | ~2 GB | Fastest agent loop on 8 GB |
| `qwen2.5-coder:3b` | Qwen2.5 Coder 3B | ~3 GB | **Recommended default** |
| `qwen2.5:3b` | Qwen2.5 3B | ~3 GB | General chat |
| `granite3.1-dense:2b` | Granite 3.1 Dense 2B | ~2 GB | IBM Granite family |
| `granite3.3:8b` | Granite 3.3 8B | ~6–8 GB | Stretch on 8 GB (close apps) |
| `qwen2.5-coder:7b` | Qwen2.5 Coder 7B/8B-class | ~6–8 GB | Stronger code |
| `qwen2.5:14b` | Qwen2.5 14B | >10 GB | Listed; not for 8 GB |
| `qwen2.5:32b` | Qwen2.5 30B-class | >>16 GB | Catalog only / desktop with headroom |

Pull progress streams from Ollama; UI shows percent + RAM guidance badges (`fits-8gb` / `stretch` / `needs-more-ram`).

## Agent coding path

1. User picks a **workspace root** (default `~/TriCassAI/projects`).
2. Prompt like “make a website” / “make an app” enters **build mode**.
3. Agent writes a short plan file, then executes grammar tools under the project folder.
4. **Template-first**: known intents seed HTML/CSS/JS site or Electron/Node app scaffolds, then the model fills/edits.
5. Post-write checks (syntax / file exists); stuck detection after repeated identical errors.
6. `finish` returns the created path; UI offers **Open folder**.

## Knowledge base

- Attach files/folders to the **current chat**.
- Chunk text files; store under app userData `kb/<chatId>/`.
- On each send, retrieve top snippets by keyword overlap and inject into the system context (capped).

## Brand

User-facing strings: **Tri Cass AI** / **Tri-Cass** only. Never “Nexus” in UI, installer, or release notes.

## Verification

Smoke tests cover: Ollama status + chat stream, model pull, website scaffold on disk, app scaffold on disk, KB attach/retrieve, Windows pack scripts. Evidence lives in the project store under `media/local-coder/`.
