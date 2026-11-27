# Tri Cass AI

Standalone **local coding assistant** for household ~8 GB RAM PCs. Chat with a local LLM, attach a knowledge base to the current chat, and say **“make a website”** / **“make an app”** to create real project folders on disk.

Separate product from Tri-Cass Desk (living-world companion). Brand: **Tri Cass AI** / **Tri-Cass** only.

## Features

- Local chat via **Ollama** (streaming)
- Curated **model catalog** (Qwen + Granite; 1.5B–30B-class) with RAM guidance + one-click pull
- **Agent coding loop** (Cline-slim JSON tools) with template-first website/app scaffolds
- **Per-chat knowledge base** (attach files/folders, retrieve into the session)
- Dark mechanical **matrix-green** desktop UI
- Windows **NSIS installer + portable** builds (`electron-builder`)

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Requirements

- Node.js 20+
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- Recommended first model: `qwen2.5-coder:3b` (fits ~8 GB)

## Develop

```bash
npm install
npm run typecheck
npm run smoke
npm run dev
```

## Package (Windows)

```bash
npm run pack:win
```

Artifacts land in `release/` (`Tri-Cass-AI-*-win-x64.exe` installer + portable).

## Smoke test

`npm run smoke` verifies website/app scaffolds on disk, KB attach/search, and (when Ollama is up) model pull + chat. Logs go to the project evidence folder when `TRI_CASS_EVIDENCE` is set.

## Windows artifacts

On Linux CI hosts without full Wine/NSIS, ship the **portable zip** built from `release/win-unpacked` (`Tri-Cass-AI-*-win-x64-portable.zip`). Unzip on Windows and run `Tri Cass AI.exe`. NSIS installers can be produced on a Windows builder with `npm run pack:win`.
