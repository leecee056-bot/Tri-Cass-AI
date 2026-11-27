import { existsSync } from 'node:fs'
import { createProjectDir, slugifyProject } from './workspace'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getWorkspaceRoot } from './workspace'

export type ScaffoldKind = 'website' | 'app' | null

export function detectScaffoldIntent(prompt: string): ScaffoldKind {
  const p = prompt.toLowerCase()
  if (
    /\b(make|create|build|scaffold|generate)\b.{0,40}\b(web\s*site|website|landing\s*page|webpage)\b/.test(
      p
    ) ||
    /\b(website|landing page)\b/.test(p)
  ) {
    return 'website'
  }
  if (
    /\b(make|create|build|scaffold|generate)\b.{0,40}\b(app|application|desktop\s*app|node\s*app|cli)\b/.test(
      p
    ) ||
    /\b(make that an? app|turn (it|that) into an? app)\b/.test(p)
  ) {
    return 'app'
  }
  return null
}

export function extractProjectTitle(prompt: string, fallback: string): string {
  const named = prompt.match(
    /(?:called|named|titled|for)\s+["']?([A-Za-z0-9][\w\s-]{1,48})["']?/i
  )
  if (named?.[1]) return named[1].trim()
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
