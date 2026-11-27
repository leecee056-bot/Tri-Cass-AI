import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, statSync, cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { scaffoldApp, scaffoldWebsite } from '../src/main/services/templates'
import { setWorkspaceRoot } from '../src/main/services/workspace'

async function main(): Promise<void> {
  const evidence =
    process.env.TRI_CASS_EVIDENCE ||
    '/cursor/stores/bc-1081152d-a0ed-45d4-b2ac-7bfcd7b2851a/media/local-coder/v3'
  mkdirSync(evidence, { recursive: true })
  const root = '/tmp/tri-cass-v3-evidence'
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  mkdirSync(root, { recursive: true })
  setWorkspaceRoot(root)

  const site = scaffoldWebsite('Harbour Notes')
  const app = scaffoldApp('Line Tally')

  const lines: string[] = [
    '# Tri Cass AI — created project evidence',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Website: Harbour Notes',
    '',
    `Path: \`${site.projectPath}\``,
    '',
    '| File | Bytes | SHA-256 |',
    '| --- | ---: | --- |'
  ]

  function addFiles(files: string[], section: string[]): void {
    for (const f of files) {
      const buf = readFileSync(f)
      const sha = createHash('sha256').update(buf).digest('hex')
      const rel = f.replace(root + '/', '')
      section.push(`| \`${rel}\` | ${buf.length} | \`${sha}\` |`)
    }
  }

  addFiles(site.files, lines)
  lines.push('', '### index.html (excerpt)', '', '```html')
  lines.push(readFileSync(join(site.projectPath, 'index.html'), 'utf8').slice(0, 1200))
  lines.push('```', '', '### styles.css size check', '')
  lines.push(`styles.css bytes: ${statSync(join(site.projectPath, 'assets/css/styles.css')).size}`)
  lines.push('', '## App: Line Tally', '', `Path: \`${app.projectPath}\``, '')
  lines.push('| File | Bytes | SHA-256 |', '| --- | ---: | --- |')
  addFiles(app.files, lines)
  lines.push('', '### src/lib.js', '', '```js')
  lines.push(readFileSync(join(app.projectPath, 'src/lib.js'), 'utf8'))
  lines.push('```')

  // copy site for static serve / browser shot
  const siteCopy = join(evidence, 'harbour-notes-site')
  if (existsSync(siteCopy)) {
    /* overwrite via cpSync */
  }
  cpSync(site.projectPath, siteCopy, { recursive: true })

  writeFileSync(join(evidence, 'evidence-files.md'), lines.join('\n') + '\n', 'utf8')
  writeFileSync(
    join(evidence, 'evidence-summary.json'),
    JSON.stringify(
      {
        website: { path: site.projectPath, files: site.files.length },
        app: { path: app.projectPath, files: app.files.length },
        minWebsiteFiles: site.files.length >= 5,
        minAppFiles: app.files.length >= 4,
        indexBytes: statSync(join(site.projectPath, 'index.html')).size,
        cssBytes: statSync(join(site.projectPath, 'assets/css/styles.css')).size,
        libBytes: statSync(join(app.projectPath, 'src/lib.js')).size
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(JSON.stringify({ siteFiles: site.files.length, appFiles: app.files.length, evidence }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
