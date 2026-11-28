# Changelog

## 0.1.4

Chat sessions + coherent scaffolds (HAP-148–151):

- **Sessions** — New chat / New website / New app, inline rename, archive restore, auto-save, session-bound project + template
- **Scaffolds** — coherence checks (no stub homepage, matching CSS/JS paths), polish rollback, favicon starter
- **Templates** — Use this template copies once; AI edits that folder in place

## 0.1.3

Coding-parity release for Lee test builds (HAP-139–144):

- **Create-on-disk** — website/app intents force real files; prose-only “done” fails closed; Open folder + verify-on-disk
- **Agent loop** — `apply_diff`, stuck×3 rollback, checkpoint hardening, post-write checks, plan/rules in scaffolds
- **Plan ↔ Act** — `/plan` / `/code`, mutating tools blocked in Plan; `save_plan` → `.tri-cass/plan.md`
- **Workspace search** — `search_content` / `search_files` with ignore files; shell exit/cwd/sandbox env
- **Per-chat KB** — AnythingLLM-style attach/folder/detach, overlap chunking, size gauge, SSRF + network master switch
- **Run panel** — npm install / start / stop, live stdout/stderr, copy path, file + HTML preview

## 0.1.2

Create-intent force real file writes (anti chat-theater).

## 0.1.0

First Tri Cass AI release:

- Electron + React shell — ChatGPT/Jan-class dark UI (Tri Cass AI brand only)
- Ollama local chat + streaming + model catalog (Qwen / Granite) with RAM guidance
- Agent coding loop: websites, Node/Python apps, **Android (Capacitor)**, Electron, games
- **Templates library** — one-click download of MIT pack (**≥1000** indexed, verified 1043), gallery search/categories, Use → workspace, AI edit
- **Image generation** — composer Image toggle; local `procedural-png@1` backend writes real PNGs (pngjs); NSFW blocked
- **ASCII studio** — figlet.js fonts + image→ASCII; `/ascii`; agent tools
- Per-chat knowledge base attach/retrieve
- Windows portable zip (+ NSIS installer when Wine available)
