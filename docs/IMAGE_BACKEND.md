# Local image generation backend

Tri Cass AI ships **`procedural-png@1`** — a tiny offline renderer using **pngjs**.

## What it does

- Always writes a **real PNG** into the workspace (`generated-images/`).
- Prompt text seeds palette, soft orbs, and a label.
- Size presets: 512 / 768 / 1024.
- NSFW / adult prompts are blocked locally.
- No cloud API and no Stable Diffusion / ONNX weights required.

## What it is not

This is **not** Stable Diffusion. It is an honest local fallback so Image mode works offline on household PCs. Settings expose the backend id (`imageBackend`) for a future ONNX/SD path.

## Agent tool

`generate_image` — args `prompt`, optional `size`.
