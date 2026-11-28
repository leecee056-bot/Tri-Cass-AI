/**
 * Unit checks for coherent website scaffolds + stub detection.
 * Run: npx tsx scripts/unit-scaffold-coherence.ts
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkScaffoldCoherence,
  isStubHtml
} from '../src/main/services/scaffoldCoherence'
import { scaffoldWebsite, scaffoldApp } from '../src/main/services/templates'
import { setWorkspaceRoot } from '../src/main/services/workspace'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const root = mkdtempSync(join(tmpdir(), 'tri-cass-coh-'))
setWorkspaceRoot(root)

try {
  assert(isStubHtml('<html><body><h1>Hello</h1></body></html>'), 'tiny hello is stub')
  assert(
    !isStubHtml(
      `<!DOCTYPE html><html><head><link rel="stylesheet" href="assets/css/styles.css"/></head>` +
        `<body><header></header><main><section><h1>Real Site</h1>` +
        `<p>A complete local website with real layout, navigation, and interactive behaviour.</p>` +
        `</section></main><footer></footer></body></html>`
    ),
    'real homepage is not stub'
  )

  const site = scaffoldWebsite('Coherence Cafe')
  const coh = checkScaffoldCoherence(site.projectPath)
  assert(coh.ok, `fresh scaffold should be coherent: ${JSON.stringify(coh.issues)}`)
  assert(existsSync(join(site.projectPath, 'assets/css/styles.css')), 'styles.css exists')
  assert(existsSync(join(site.projectPath, 'assets/js/main.js')), 'main.js exists')
  assert(existsSync(join(site.projectPath, 'assets/favicon.svg')), 'favicon exists')
  const index = readFileSync(join(site.projectPath, 'index.html'), 'utf8')
  assert(index.includes('assets/css/styles.css'), 'index links styles.css')
  assert(index.includes('assets/js/main.js'), 'index links main.js')
  assert(!index.includes('href="style.css"'), 'no orphan style.css href')

  // Break coherence: rewrite index to stub + wrong css
  writeFileSync(
    join(site.projectPath, 'index.html'),
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"/></head><body><h1>Hello</h1></body></html>',
    'utf8'
  )
  writeFileSync(join(site.projectPath, 'style.css'), 'body{}', 'utf8')
  const broken = checkScaffoldCoherence(site.projectPath)
  assert(!broken.ok, 'broken scaffold must fail coherence')
  assert(
    broken.issues.some((i) => /stub|missing asset|orphan/i.test(i.problem)),
    `expected stub/missing/orphan issues, got ${JSON.stringify(broken.issues)}`
  )

  const app = scaffoldApp('Coherence CLI')
  assert(existsSync(join(app.projectPath, 'package.json')), 'app package.json')
  assert(existsSync(join(app.projectPath, 'src/cli.js')), 'app cli')
  const appCoh = checkScaffoldCoherence(app.projectPath)
  assert(appCoh.ok, 'app scaffold (no html) is coherent')

  console.log('unit-scaffold-coherence: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
