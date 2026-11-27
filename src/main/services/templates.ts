import { createProjectDir } from './workspace'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return path
}

export function scaffoldWebsite(title = 'Tri Cass Site'): { projectPath: string; files: string[] } {
  const projectPath = createProjectDir(title)
  const files: string[] = []

  files.push(
    write(
      join(projectPath, 'index.html'),
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="hero">
    <p class="brand">Tri Cass AI</p>
    <h1>${title}</h1>
    <p class="lede">Built locally by Tri Cass AI on your machine.</p>
    <button id="cta" type="button">Get started</button>
  </main>
  <script src="app.js"></script>
</body>
</html>
`
    )
  )

  files.push(
    write(
      join(projectPath, 'styles.css'),
      `:root {
  --bg: #0b120e;
  --panel: #121a16;
  --green: #39ff14;
  --text: #e8f5e9;
  --muted: #8fa898;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: var(--text);
  background:
    radial-gradient(ellipse at 20% 10%, #1a3d28 0%, transparent 50%),
    linear-gradient(160deg, #070b09, #0f1a14 60%, #0a100c);
}
.hero {
  max-width: 720px;
  margin: 0 auto;
  padding: 18vh 1.5rem 4rem;
}
.brand {
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--green);
  font-size: 0.75rem;
  margin: 0 0 1rem;
}
h1 {
  font-size: clamp(2.4rem, 6vw, 3.6rem);
  line-height: 1.05;
  margin: 0 0 1rem;
}
.lede { color: var(--muted); font-size: 1.15rem; max-width: 36ch; }
button {
  margin-top: 1.75rem;
  background: var(--green);
  color: #041006;
  border: 0;
  padding: 0.85rem 1.4rem;
  font-weight: 700;
  cursor: pointer;
}
button:hover { filter: brightness(1.08); }
`
    )
  )

  files.push(
    write(
      join(projectPath, 'app.js'),
      `document.getElementById('cta')?.addEventListener('click', () => {
  alert('Tri Cass AI — local site is live.');
});
`
    )
  )

  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Static website scaffolded by **Tri Cass AI**.

Open \`index.html\` in a browser, or serve the folder with any static server.
`
    )
  )

  return { projectPath, files }
}

export function scaffoldApp(title = 'Tri Cass App'): { projectPath: string; files: string[] } {
  const projectPath = createProjectDir(title)
  const files: string[] = []
  const pkgName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'tri-cass-app'

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
          scripts: {
            start: 'node src/index.js',
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
      join(projectPath, 'src/index.js'),
      `#!/usr/bin/env node
/** ${title} — Tri Cass AI local app */

export function greet(name = 'world') {
  return \`Hello, \${name}! From Tri Cass AI.\`;
}

export function main(argv = process.argv.slice(2)) {
  const name = argv[0] || 'builder';
  const message = greet(name);
  console.log(message);
  return message;
}

if (import.meta.url === \`file://\${process.argv[1]}\` || process.argv[1]?.endsWith('index.js')) {
  main();
}
`
    )
  )

  files.push(
    write(
      join(projectPath, 'README.md'),
      `# ${title}

Node app scaffolded by **Tri Cass AI**.

\`\`\`bash
npm start
\`\`\`
`
    )
  )

  return { projectPath, files }
}
