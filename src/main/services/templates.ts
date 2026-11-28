import { existsSync } from 'node:fs'
import { createProjectDir, slugifyProject } from './workspace'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getWorkspaceRoot } from './workspace'

export type ScaffoldKind =
  | 'website'
  | 'app'
  | 'python'
  | 'android'
  | 'electron'
  | 'game'
  | null

export function detectScaffoldIntent(prompt: string): ScaffoldKind {
  const p = prompt.toLowerCase()
  if (
    /\b(android|apk|capacitor|cordova|kotlin|mobile\s*app)\b/.test(p) &&
    /\b(make|create|build|scaffold|generate|notes?\s*app)\b/.test(p)
  ) {
    return 'android'
  }
  if (/\b(electron|desktop\s*app)\b/.test(p) && /\b(make|create|build|scaffold|generate)\b/.test(p)) {
    return 'electron'
  }
  if (
    /\b(python|flask|fastapi|django)\b/.test(p) &&
    /\b(make|create|build|scaffold|generate|app)\b/.test(p)
  ) {
    return 'python'
  }
  if (
    /\b(game|snake|tetris|pong)\b/.test(p) &&
    /\b(make|create|build|scaffold|generate)\b/.test(p)
  ) {
    return 'game'
  }
  // "make me a website…", "create a site in a folder", etc.
  if (/\bmake\s+(that|this|it)\s+(a\s+|an\s+)?(web\s*site|website|site|app)\b/.test(p)) {
    return /\bapp\b/.test(p) && !/\b(web\s*site|website|site)\b/.test(p) ? 'app' : 'website'
  }
  if (
    /\b(make|create|build|scaffold|generate|spin\s*up|set\s*up)\b[\s\S]{0,60}\b(web\s*site|website|landing\s*page|webpage|site)\b/.test(
      p
    ) ||
    /\b(website|landing page|restaurant\s+site)\b/.test(p) ||
    /\b(make|create)\b[\s\S]{0,40}\b(in\s+a\s+folder|into\s+a\s+folder|as\s+a\s+folder)\b/.test(p)
  ) {
    // Prefer website when "site/website" present; bare "folder" create with site words → website
    if (/\b(app|application|node|cli)\b/.test(p) && !/\b(web\s*site|website|site|page)\b/.test(p)) {
      return 'app'
    }
    if (/\b(web\s*site|website|landing\s*page|webpage|site|page)\b/.test(p) || /\bfolder\b/.test(p)) {
      return 'website'
    }
  }
  if (
    /\b(make|create|build|scaffold|generate)\b[\s\S]{0,60}\b(app|application|node\s*app|cli)\b/.test(
      p
    ) ||
    /\b(make that an? app|turn (it|that) into an? app)\b/.test(p)
  ) {
    return 'app'
  }
  return null
}

/** True when the user clearly wants files/folders created on disk (not chat theater). */
export function isCreateFilesIntent(prompt: string): boolean {
  if (detectScaffoldIntent(prompt) !== null) return true
  const p = prompt.toLowerCase()
  return (
    /\b(make|create|build|scaffold|generate|write)\b[\s\S]{0,50}\b(file|files|folder|directory|project|repo)\b/.test(
      p
    ) ||
    /\b(put|save)\b[\s\S]{0,30}\b(on disk|in (my )?workspace|in a folder)\b/.test(p)
  )
}

export function extractProjectTitle(prompt: string, fallback: string): string {
  const patterns = [
    /(?:in|into)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:called|named)\s+["']?([A-Za-z0-9][\w\s-]{1,48})["']?/i,
    /(?:folder|directory|dir)\s+["']?([A-Za-z0-9][\w\s-]{1,48})["']?/i,
    /(?:called|named|titled)\s+["']?([A-Za-z0-9][\w\s-]{1,48})["']?/i,
    /\bfor\s+["']?([A-Za-z0-9][\w\s-]{1,48})["']?(?:\s+in\s+a\s+folder)?/i
  ]
  for (const re of patterns) {
    const m = prompt.match(re)
    if (m?.[1]) {
      const t = m[1].trim().replace(/\s+in\s+a\s+folder$/i, '').trim()
      if (t && !/^(a|an|the|my|website|site|app|folder|project)$/i.test(t)) return t
    }
  }
  return fallback
}

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return path
}

function uniqueProjectDir(title: string): string {
  const root = getWorkspaceRoot()
  let slug = slugifyProject(title)
  let path = join(root, slug)
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
    return path
  }
  let i = 2
  while (existsSync(join(root, `${slug}-${i}`))) i++
  path = join(root, `${slug}-${i}`)
  mkdirSync(path, { recursive: true })
  return path
}

/** Real multi-page static site with CSS, JS, and content pages. */
export function scaffoldWebsite(title = 'Tri Cass Site'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  const year = new Date().getFullYear()

  files.push(
    write(
      join(projectPath, 'index.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${title} — built locally with Tri Cass AI" />
  <title>${title}</title>
  <link rel="stylesheet" href="assets/css/styles.css" />
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="logo" href="index.html">${title}</a>
      <nav aria-label="Primary">
        <a href="index.html" aria-current="page">Home</a>
        <a href="about.html">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle colour theme">Theme</button>
    </div>
  </header>

  <main id="main">
    <section class="hero wrap">
      <p class="eyebrow">Built on your machine</p>
      <h1>${title}</h1>
      <p class="lede">A complete local website with real layout, navigation, and interactive behaviour — created by Tri Cass AI.</p>
      <div class="hero-actions">
        <a class="btn primary" href="about.html">Learn more</a>
        <button type="button" class="btn ghost" id="cta">Try the counter</button>
      </div>
      <p class="counter" id="counterLabel" hidden>Clicks: <strong id="counter">0</strong></p>
    </section>

    <section class="features wrap">
      <article>
        <h2>Clean structure</h2>
        <p>Semantic HTML, separated CSS/JS, and pages you can extend without rewriting everything.</p>
      </article>
      <article>
        <h2>Works offline</h2>
        <p>Open <code>index.html</code> or serve the folder — no cloud account required.</p>
      </article>
      <article>
        <h2>Ready to customise</h2>
        <p>Swap colours in <code>assets/css/styles.css</code> and wire new behaviour in <code>assets/js/main.js</code>.</p>
      </article>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>© ${year} ${title}. Created with Tri Cass AI.</p>
    </div>
  </footer>
  <script src="assets/js/main.js" type="module"></script>
</body>
</html>
`
    )
  )

  files.push(
    write(
      join(projectPath, 'about.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>About · ${title}</title>
  <link rel="stylesheet" href="assets/css/styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="logo" href="index.html">${title}</a>
      <nav aria-label="Primary">
        <a href="index.html">Home</a>
        <a href="about.html" aria-current="page">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle colour theme">Theme</button>
    </div>
  </header>
  <main class="wrap page">
    <h1>About</h1>
    <p>${title} was generated as a real multi-file static site so you can open it in a browser and keep building.</p>
    <ul>
      <li>Responsive layout with a shared stylesheet</li>
      <li>Theme toggle persisted in <code>localStorage</code></li>
      <li>Contact form validation on the next page</li>
    </ul>
  </main>
  <footer class="site-footer"><div class="wrap"><p>© ${year} ${title}</p></div></footer>
  <script src="assets/js/main.js" type="module"></script>
</body>
</html>
`
    )
  )

  files.push(
    write(
      join(projectPath, 'contact.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contact · ${title}</title>
  <link rel="stylesheet" href="assets/css/styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="logo" href="index.html">${title}</a>
      <nav aria-label="Primary">
        <a href="index.html">Home</a>
        <a href="about.html">About</a>
        <a href="contact.html" aria-current="page">Contact</a>
      </nav>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle colour theme">Theme</button>
    </div>
  </header>
  <main class="wrap page">
    <h1>Contact</h1>
    <form id="contactForm" class="card" novalidate>
      <label>Name
        <input name="name" required minlength="2" autocomplete="name" />
      </label>
      <label>Email
        <input name="email" type="email" required autocomplete="email" />
      </label>
      <label>Message
        <textarea name="message" rows="5" required minlength="8"></textarea>
      </label>
      <button class="btn primary" type="submit">Send message</button>
      <p class="form-status" id="formStatus" role="status" aria-live="polite"></p>
    </form>
  </main>
  <footer class="site-footer"><div class="wrap"><p>© ${year} ${title}</p></div></footer>
  <script src="assets/js/main.js" type="module"></script>
</body>
</html>
`
    )
  )

  files.push(
    write(
      join(projectPath, 'assets/css/styles.css'),
      `:root {
  --bg: #0f1218;
  --surface: #171b24;
  --text: #e8ecf3;
  --muted: #9aa3b5;
  --accent: #3d9a6a;
  --accent-ink: #04150c;
  --line: rgba(255,255,255,0.1);
  --radius: 14px;
  --shadow: 0 18px 50px rgba(0,0,0,0.35);
  --font: "Segoe UI", system-ui, sans-serif;
  color-scheme: dark;
}
[data-theme="light"] {
  --bg: #f5f7fb;
  --surface: #ffffff;
  --text: #161a22;
  --muted: #5c6678;
  --accent-ink: #ffffff;
  --line: rgba(16,22,32,0.1);
  --shadow: 0 14px 36px rgba(20,30,40,0.08);
  color-scheme: light;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font);
  color: var(--text);
  background:
    radial-gradient(ellipse at top, rgba(61,154,106,0.12), transparent 45%),
    var(--bg);
  line-height: 1.55;
}
.skip {
  position: absolute; left: -999px; top: 0;
}
.skip:focus { left: 12px; top: 12px; background: var(--surface); padding: 8px 12px; z-index: 10; }
.wrap { width: min(960px, calc(100% - 2rem)); margin-inline: auto; }
.site-header {
  position: sticky; top: 0; z-index: 5;
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  border-bottom: 1px solid var(--line);
}
.header-inner {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; min-height: 64px;
}
.logo { font-weight: 700; text-decoration: none; color: var(--text); letter-spacing: -0.02em; }
nav { display: flex; gap: 1rem; }
nav a { color: var(--muted); text-decoration: none; }
nav a[aria-current="page"], nav a:hover { color: var(--accent); }
.theme-toggle, .btn {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 0.55rem 1rem;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 650; }
.btn.ghost { background: transparent; }
.btn:hover, .theme-toggle:hover { filter: brightness(1.05); }
.hero { padding: 4.5rem 0 3rem; }
.eyebrow {
  text-transform: uppercase; letter-spacing: 0.16em;
  font-size: 0.75rem; color: var(--accent); margin: 0 0 1rem;
}
.hero h1 {
  font-size: clamp(2.4rem, 6vw, 3.6rem);
  line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 1rem;
}
.lede { color: var(--muted); font-size: 1.125rem; max-width: 40ch; margin: 0 0 1.5rem; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.counter { margin-top: 1rem; color: var(--muted); }
.features {
  display: grid; gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  padding: 0 0 4rem;
}
.features article, .card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.25rem;
  box-shadow: var(--shadow);
}
.features h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
.features p { margin: 0; color: var(--muted); }
.page { padding: 3rem 0 4rem; }
.page h1 { margin-top: 0; letter-spacing: -0.02em; }
.card { display: grid; gap: 0.85rem; max-width: 480px; }
label { display: grid; gap: 0.35rem; font-size: 0.92rem; }
input, textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 10px;
  background: var(--bg); color: var(--text); padding: 0.7rem 0.8rem; font: inherit;
}
input:focus, textarea:focus { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); border-color: var(--accent); }
.form-status { min-height: 1.25rem; color: var(--accent); margin: 0; }
.site-footer {
  border-top: 1px solid var(--line);
  padding: 1.25rem 0 2rem;
  color: var(--muted);
  font-size: 0.9rem;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: color-mix(in srgb, var(--surface) 70%, #000 10%);
  padding: 0.1em 0.35em; border-radius: 6px;
}
@media (max-width: 720px) {
  .header-inner { flex-wrap: wrap; padding: 0.75rem 0; }
  nav { width: 100%; }
}
`
    )
  )

  files.push(
    write(
      join(projectPath, 'assets/js/main.js'),
      `const root = document.documentElement;
const stored = localStorage.getItem('tri-cass-theme');
if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);

const themeToggle = document.getElementById('themeToggle');
themeToggle?.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  localStorage.setItem('tri-cass-theme', next);
});

const cta = document.getElementById('cta');
const counterEl = document.getElementById('counter');
const counterLabel = document.getElementById('counterLabel');
let count = Number(sessionStorage.getItem('tri-cass-clicks') || 0);
if (counterEl && count > 0) {
  counterLabel.hidden = false;
  counterEl.textContent = String(count);
}
cta?.addEventListener('click', () => {
  count += 1;
  sessionStorage.setItem('tri-cass-clicks', String(count));
  if (counterLabel) counterLabel.hidden = false;
  if (counterEl) counterEl.textContent = String(count);
});

const form = document.getElementById('contactForm');
const status = document.getElementById('formStatus');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.checkValidity()) {
    status.textContent = 'Please fill in every field correctly.';
    form.reportValidity();
    return;
  }
  const data = new FormData(form);
  status.textContent = \`Thanks, \${data.get('name')}. Message saved locally (no network send).\`;
  form.reset();
});
`
    )
  )

  files.push(
    write(
      join(projectPath, '.gitignore'),
      `.DS_Store
Thumbs.db
*.log
.idea/
.vscode/
`
    )
  )

  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Static multi-page website created by **Tri Cass AI**.

## Run

Open \`index.html\` in a browser, or from this folder:

\`\`\`bash
python3 -m http.server 4173
\`\`\`

Then visit http://127.0.0.1:4173

## Contents

- \`index.html\` — home
- \`about.html\` / \`contact.html\` — secondary pages
- \`assets/css/styles.css\` — layout, theme, components
- \`assets/js/main.js\` — theme toggle, counter, form validation
`
    )
  )

  return { projectPath, files }
}

/** Real Node CLI app with package entry, lib, tests, README. */
export function scaffoldApp(title = 'Tri Cass App'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  const pkgName = slugifyProject(title) || 'tri-cass-app'

  files.push(
    write(
      join(projectPath, 'package.json'),
      JSON.stringify(
        {
          name: pkgName,
          version: '0.1.0',
          private: true,
          description: `${title} — created by Tri Cass AI`,
          type: 'module',
          bin: { [pkgName]: './src/cli.js' },
          scripts: {
            start: 'node src/cli.js',
            test: 'node --test'
          },
          engines: { node: '>=18' }
        },
        null,
        2
      ) + '\n'
    )
  )

  files.push(
    write(
      join(projectPath, 'src/lib.js'),
      `/** Core logic for ${title} */

export function parseArgs(argv = []) {
  const flags = new Set();
  const positionals = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg.slice(2));
    else positionals.push(arg);
  }
  return { flags, positionals };
}

export function summarise(items) {
  const total = items.length;
  const chars = items.reduce((n, s) => n + String(s).length, 0);
  return { total, chars, average: total ? Number((chars / total).toFixed(2)) : 0 };
}

export function formatReport({ total, chars, average }, title = '${title}') {
  return [
    title,
    '────────────',
    \`Items:   \${total}\`,
    \`Chars:   \${chars}\`,
    \`Average: \${average}\`
  ].join('\\n');
}
`
    )
  )

  files.push(
    write(
      join(projectPath, 'src/cli.js'),
      `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs, summarise, formatReport } from './lib.js';

export function run(argv = process.argv.slice(2)) {
  const { flags, positionals } = parseArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    const help = \`Usage: node src/cli.js [--help] [file]

Reads lines from a file (or stdin args) and prints a short summary.
\`;
    console.log(help);
    return help;
  }

  let items = positionals;
  if (positionals.length === 1 && !flags.has('raw')) {
    try {
      const body = readFileSync(positionals[0], 'utf8');
      items = body.split(/\\r?\\n/).filter(Boolean);
    } catch {
      // treat as literal tokens when file missing
    }
  }
  if (!items.length) items = ['alpha', 'beta', 'gamma'];
  const report = formatReport(summarise(items));
  console.log(report);
  return report;
}

const isDirect = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\\\/g, '/'));
if (isDirect || process.argv[1]?.endsWith('cli.js')) {
  run();
}
`
    )
  )

  files.push(
    write(
      join(projectPath, 'test/lib.test.js'),
      `import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, summarise, formatReport } from '../src/lib.js';

test('parseArgs separates flags and positionals', () => {
  const { flags, positionals } = parseArgs(['--help', 'notes.txt']);
  assert.equal(flags.has('help'), true);
  assert.deepEqual(positionals, ['notes.txt']);
});

test('summarise averages character counts', () => {
  const stats = summarise(['ab', 'cdef']);
  assert.equal(stats.total, 2);
  assert.equal(stats.chars, 6);
  assert.equal(stats.average, 3);
});

test('formatReport is multi-line', () => {
  const text = formatReport({ total: 1, chars: 4, average: 4 }, 'Sample');
  assert.match(text, /Sample/);
  assert.match(text, /Items:\\s+1/);
});
`
    )
  )

  files.push(
    write(
      join(projectPath, '.gitignore'),
      `node_modules/
.DS_Store
*.log
coverage/
`
    )
  )

  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Node CLI created by **Tri Cass AI**.

## Run

\`\`\`bash
npm start
node src/cli.js --help
node src/cli.js path/to/file.txt
npm test
\`\`\`

## Layout

- \`src/lib.js\` — argument parsing + summary helpers
- \`src/cli.js\` — CLI entry
- \`test/lib.test.js\` — \`node --test\` suite
`
    )
  )

  // keep createProjectDir referenced for API compatibility
  void createProjectDir

  return { projectPath, files }
}

/** Python CLI / small app with requirements + tests. */
export function scaffoldPython(title = 'Tri Cass Python'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  const mod = slugifyProject(title).replace(/-/g, '_') || 'app'

  files.push(
    write(
      join(projectPath, 'requirements.txt'),
      `# ${title} — created by Tri Cass AI
# No third-party deps required for the starter.
`
    )
  )
  files.push(
    write(
      join(projectPath, `${mod}.py`),
      `#!/usr/bin/env python3
"""${title} — created by Tri Cass AI."""
from __future__ import annotations

import argparse
from pathlib import Path


def summarise(lines: list[str]) -> dict[str, float | int]:
    total = len(lines)
    chars = sum(len(s) for s in lines)
    return {"total": total, "chars": chars, "average": (chars / total) if total else 0.0}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="${title}")
    parser.add_argument("path", nargs="?", help="Optional text file to summarise")
    args = parser.parse_args(argv)
    if args.path and Path(args.path).is_file():
        lines = Path(args.path).read_text(encoding="utf-8").splitlines()
    else:
        lines = ["alpha", "beta", "gamma"]
    stats = summarise(lines)
    print("${title}")
    print("────────────")
    print(f"Items:   {stats['total']}")
    print(f"Chars:   {stats['chars']}")
    print(f"Average: {stats['average']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`
    )
  )
  files.push(
    write(
      join(projectPath, `test_${mod}.py`),
      `import unittest
from ${mod} import summarise


class TestSummarise(unittest.TestCase):
    def test_average(self):
        stats = summarise(["ab", "cdef"])
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["chars"], 6)
        self.assertEqual(stats["average"], 3.0)


if __name__ == "__main__":
    unittest.main()
`
    )
  )
  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Python app created by **Tri Cass AI**.

\`\`\`bash
python3 ${mod}.py
python3 -m unittest test_${mod}.py
\`\`\`
`
    )
  )
  files.push(write(join(projectPath, '.gitignore'), `__pycache__/\n*.pyc\n.venv/\n`))
  return { projectPath, files }
}

/**
 * Android-oriented scaffold via Capacitor-style web shell + Android project stubs.
 * Honest about toolchain: APK build needs Android SDK / Capacitor CLI on the machine.
 */
export function scaffoldAndroid(title = 'Tri Cass Android'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  const pkg = `ai.tricass.${slugifyProject(title).replace(/-/g, '') || 'app'}`
  const appId = slugifyProject(title) || 'tri-cass-android'

  files.push(
    write(
      join(projectPath, 'package.json'),
      JSON.stringify(
        {
          name: appId,
          version: '0.1.0',
          private: true,
          description: `${title} — Capacitor-ready Android scaffold by Tri Cass AI`,
          scripts: {
            start: 'npx --yes serve www -p 5177',
            'build:web': 'echo "Static www/ ready"',
            'cap:add': 'npx --yes @capacitor/cli add android',
            'cap:sync': 'npx --yes @capacitor/cli sync android',
            'cap:open': 'npx --yes @capacitor/cli open android'
          }
        },
        null,
        2
      ) + '\n'
    )
  )
  files.push(
    write(
      join(projectPath, 'capacitor.config.json'),
      JSON.stringify(
        {
          appId: pkg,
          appName: title,
          webDir: 'www',
          server: { androidScheme: 'https' }
        },
        null,
        2
      ) + '\n'
    )
  )
  files.push(
    write(
      join(projectPath, 'www/index.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p class="sub">Local notes — works in browser; wrap with Capacitor for Android.</p>
  </header>
  <main>
    <form id="form">
      <label>Note
        <textarea id="note" rows="4" placeholder="Type a note…" required></textarea>
      </label>
      <button type="submit">Save note</button>
    </form>
    <ul id="list" aria-live="polite"></ul>
  </main>
  <script src="app.js"></script>
</body>
</html>
`
    )
  )
  files.push(
    write(
      join(projectPath, 'www/styles.css'),
      `:root { font-family: "Segoe UI", system-ui, sans-serif; color: #e8ecf3; background: #0f1218; }
body { margin: 0; min-height: 100vh; }
header, main { width: min(640px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0; }
h1 { margin: 0 0 0.35rem; letter-spacing: -0.02em; }
.sub { color: #9aa3b5; margin: 0 0 1.5rem; }
textarea, button {
  width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12);
  background: #171b24; color: inherit; padding: 0.75rem; font: inherit;
}
button { background: #3d9a6a; color: #04150c; font-weight: 650; border: none; margin-top: 0.75rem; cursor: pointer; }
ul { list-style: none; padding: 0; display: grid; gap: 0.6rem; }
li { background: #171b24; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 0.85rem 1rem; }
`
    )
  )
  files.push(
    write(
      join(projectPath, 'www/app.js'),
      `const KEY = 'tri-cass-android-notes';
const list = document.getElementById('list');
const form = document.getElementById('form');
const note = document.getElementById('note');

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(items) { localStorage.setItem(KEY, JSON.stringify(items)); render(items); }
function render(items) {
  list.innerHTML = items.map((t, i) => \`<li data-i="\${i}">\${t} <button type="button" data-del="\${i}">Delete</button></li>\`).join('') || '<li>No notes yet.</li>';
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = note.value.trim();
  if (!text) return;
  const items = load();
  items.unshift(text);
  note.value = '';
  save(items);
});
list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const items = load();
  items.splice(Number(btn.getAttribute('data-del')), 1);
  save(items);
});
render(load());
`
    )
  )
  files.push(
    write(
      join(projectPath, 'android/README.md'),
      `# Android project placeholder

This folder is ready for **Capacitor** to generate a real Android Studio project.

## When Android SDK + Node are installed

\`\`\`bash
npm install
npx cap add android
npx cap sync android
npx cap open android
\`\`\`

Build an APK from Android Studio (**Build → Build Bundle(s) / APK(s)**), or:

\`\`\`bash
cd android && ./gradlew assembleDebug
\`\`\`

APK output (typical): \`android/app/build/outputs/apk/debug/app-debug.apk\`

## When toolchain is missing

You can still open \`www/index.html\` in a browser — the notes app works offline as a web shell.
Tri Cass AI will not sign release APKs or handle Play Store credentials.
`
    )
  )
  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Android-oriented notes app scaffold by **Tri Cass AI** (Capacitor web shell + Android instructions).

## Try now (no Android SDK)

Open \`www/index.html\` or run \`npm start\`.

## Build APK (when SDK present)

See \`android/README.md\`. Signing / Play Store upload is out of scope — ask only for local debug builds.
`
    )
  )
  files.push(write(join(projectPath, '.gitignore'), `node_modules/\nandroid/app/build/\n.idea/\n`))
  return { projectPath, files }
}

/** Electron desktop app scaffold. */
export function scaffoldElectron(title = 'Tri Cass Desktop'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  const name = slugifyProject(title) || 'tri-cass-desktop'

  files.push(
    write(
      join(projectPath, 'package.json'),
      JSON.stringify(
        {
          name,
          version: '0.1.0',
          private: true,
          main: 'main.js',
          scripts: { start: 'electron .', pack: 'electron .' },
          devDependencies: { electron: '^35.0.0' }
        },
        null,
        2
      ) + '\n'
    )
  )
  files.push(
    write(
      join(projectPath, 'main.js'),
      `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    title: '${title}',
    webPreferences: { contextIsolation: true }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`
    )
  )
  files.push(
    write(
      join(projectPath, 'index.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Desktop shell created by Tri Cass AI. Edit this page and restart Electron.</p>
    <button id="ping" type="button">Ping</button>
    <p id="out" role="status"></p>
  </main>
  <script src="renderer.js"></script>
</body>
</html>
`
    )
  )
  files.push(
    write(
      join(projectPath, 'styles.css'),
      `body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #10141c; color: #e8ecf3; }
main { padding: 2rem; max-width: 40rem; }
button { background: #3d9a6a; color: #04150c; border: 0; border-radius: 999px; padding: 0.6rem 1.1rem; font-weight: 650; cursor: pointer; }
`
    )
  )
  files.push(
    write(
      join(projectPath, 'renderer.js'),
      `document.getElementById('ping')?.addEventListener('click', () => {
  document.getElementById('out').textContent = 'Hello from ${title} at ' + new Date().toLocaleTimeString();
});
`
    )
  )
  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Electron desktop scaffold by **Tri Cass AI**.

\`\`\`bash
npm install
npm start
\`\`\`
`
    )
  )
  files.push(write(join(projectPath, '.gitignore'), `node_modules/\n`))
  return { projectPath, files }
}

/** Simple browser game (Snake). */
export function scaffoldGame(title = 'Tri Cass Game'): { projectPath: string; files: string[] } {
  const projectPath = uniqueProjectDir(title)
  const files: string[] = []
  files.push(
    write(
      join(projectPath, 'index.html'),
      `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Arrow keys / WASD to move. Space to pause.</p>
    <canvas id="game" width="400" height="400" aria-label="Game board"></canvas>
    <p id="score">Score: 0</p>
  </main>
  <script src="game.js"></script>
</body>
</html>
`
    )
  )
  files.push(
    write(
      join(projectPath, 'styles.css'),
      `body { margin: 0; background: #0f1218; color: #e8ecf3; font-family: "Segoe UI", system-ui, sans-serif; }
main { max-width: 440px; margin: 2rem auto; text-align: center; }
canvas { background: #171b24; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; }
`
    )
  )
  files.push(
    write(
      join(projectPath, 'game.js'),
      `const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const cell = 20;
let snake = [{ x: 8, y: 8 }];
let dir = { x: 1, y: 0 };
let food = { x: 12, y: 10 };
let score = 0;
let paused = false;
let timer;

function placeFood() {
  food = { x: Math.floor(Math.random() * 20), y: Math.floor(Math.random() * 20) };
}
function tick() {
  if (paused) return;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (head.x < 0 || head.y < 0 || head.x >= 20 || head.y >= 20 || snake.some((s) => s.x === head.x && s.y === head.y)) {
    snake = [{ x: 8, y: 8 }]; dir = { x: 1, y: 0 }; score = 0; placeFood();
  } else {
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) { score += 1; placeFood(); }
    else snake.pop();
  }
  scoreEl.textContent = 'Score: ' + score;
  ctx.fillStyle = '#171b24'; ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = '#3d9a6a'; snake.forEach((s) => ctx.fillRect(s.x * cell, s.y * cell, cell - 1, cell - 1));
  ctx.fillStyle = '#e8c56b'; ctx.fillRect(food.x * cell, food.y * cell, cell - 1, cell - 1);
}
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') dir = { x: 0, y: -1 };
  if (k === 'arrowdown' || k === 's') dir = { x: 0, y: 1 };
  if (k === 'arrowleft' || k === 'a') dir = { x: -1, y: 0 };
  if (k === 'arrowright' || k === 'd') dir = { x: 1, y: 0 };
  if (k === ' ') paused = !paused;
});
timer = setInterval(tick, 120);
`
    )
  )
  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Browser game created by **Tri Cass AI**. Open \`index.html\`.
`
    )
  )
  return { projectPath, files }
}

export function runScaffold(
  kind: Exclude<ScaffoldKind, null>,
  title: string
): { projectPath: string; files: string[] } {
  let result: { projectPath: string; files: string[] }
  switch (kind) {
    case 'website':
      result = scaffoldWebsite(title)
      break
    case 'app':
      result = scaffoldApp(title)
      break
    case 'python':
      result = scaffoldPython(title)
      break
    case 'android':
      result = scaffoldAndroid(title)
      break
    case 'electron':
      result = scaffoldElectron(title)
      break
    case 'game':
      result = scaffoldGame(title)
      break
    default:
      result = scaffoldApp(title)
  }
  // Cline-slim: plan + standing rules land with every create
  result.files.push(
    write(
      join(result.projectPath, '.tri-cass', 'plan.md'),
      `# Plan — ${title}\n\n` +
        `- [x] Create ${kind} project folder\n` +
        `- [x] Write starter files on disk\n` +
        `- [ ] Customise content when the user asks\n` +
        `- [ ] Open / run locally\n\n` +
        `Workspace path: \`${result.projectPath}\`\n`
    )
  )
  result.files.push(
    write(
      join(result.projectPath, '.tri-cass-rules'),
      `# Tri Cass project rules\n` +
        `- Prefer editing existing files over rewriting everything\n` +
        `- Keep paths inside this project folder\n` +
        `- After changes, leave the project runnable without a code editor\n` +
        `- Never claim files exist unless they are on disk\n`
    )
  )
  return result
}
