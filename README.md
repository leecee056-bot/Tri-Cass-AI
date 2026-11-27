# Tri Cass AI

Standalone **local coding assistant** for household ~8 GB RAM PCs. Chat with a local LLM, attach a knowledge base, download a **1000+ template library**, generate **local images** and **ASCII art**, and ask in plain English to create websites, Node/Python apps, **Android** scaffolds, or Electron desktops — **you don’t need to code**.

Separate product from Tri-Cass Desk. Brand: **Tri Cass AI** only.

## Features

- Local chat via **Ollama** (streaming)
- Curated **model catalog** (Qwen + Granite) with RAM guidance + one-click pull
- **Templates** sidebar — MIT pack from GitHub (≥1000 usable entries), search, categories, Use + AI edit
- **Image** composer toggle — offline `procedural-png@1` writes real PNGs ([docs/IMAGE_BACKEND.md](docs/IMAGE_BACKEND.md))
- **ASCII studio** — figlet.js + image→ASCII
- **Agent scaffolds** — website, Node, Python, Android (Capacitor), Electron, simple games
- **Per-chat knowledge base**
- Dark Tri Cass AI desktop UI
- Windows **portable** (+ NSIS when available)

## Docs

- [Architecture](docs/architecture.md)
- [Templates pack](docs/TEMPLATES.md)
- [Image backend](docs/IMAGE_BACKEND.md)

## Requirements

- Node.js 20+
- [Ollama](https://ollama.com) locally (`ollama serve`)
- Recommended first model: `qwen2.5-coder:3b` (fits ~8 GB)

## Develop

```bash
npm install
npm run typecheck
npm run smoke
npx tsx scripts/evidence-v4.ts   # templates/image/ascii/android evidence
npm run dev
```

## Package (Windows)

```bash
npm run pack:win
```

Artifacts land in `release/`.

## Smoke test

`npm run smoke` verifies website/app/Android scaffolds, local image PNG, ASCII fonts, KB, and (when Ollama is up) chat. Template pack count is reported when the library is installed under user data (`Templates → Download template library`).
