/**
 * E2E evidence for Templates / Image / ASCII / Android scaffolds (checklist L).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.TRI_CASS_USER_DATA = join(tmpdir(), `tri-cass-v4-${Date.now()}`)
process.env.TRI_CASS_WORKSPACE = join(process.env.TRI_CASS_USER_DATA, 'projects')

async function main() {
  const { downloadTemplatePack, getPackStatus, searchTemplates, useTemplate } = await import(
    '../src/main/services/templatePack'
  )
  const { generateLocalImage } = await import('../src/main/services/imageGen')
  const { textToAscii, saveAscii, listAsciiFonts } = await import('../src/main/services/asciiArt')
  const { runScaffold, detectScaffoldIntent } = await import('../src/main/services/templates')
  const { setWorkspaceRoot } = await import('../src/main/services/workspace')

  const storeMedia = '/cursor/stores/bc-1081152d-a0ed-45d4-b2ac-7bfcd7b2851a/media/local-coder/v4'
  mkdirSync(storeMedia, { recursive: true })
  mkdirSync(process.env.TRI_CASS_WORKSPACE!, { recursive: true })
  setWorkspaceRoot(process.env.TRI_CASS_WORKSPACE!)

  const log: Record<string, unknown> = { startedAt: new Date().toISOString() }

  console.log('Downloading template pack…')
  await downloadTemplatePack((p) => {
    if (p.percent && p.percent % 20 === 0) console.log(p.status, p.percent)
  }, { extras: false })
  const status = getPackStatus()
  log.pack = status
  console.log('Pack count', status.count)

  const search = searchTemplates({ query: 'restaurant', limit: 5 })
  const pick = search.items[0] || searchTemplates({ limit: 1 }).items[0]
  if (!pick) throw new Error('No templates indexed')
  const applied = useTemplate(pick.id, 'Harbour Restaurant')
  log.templateUse = { id: pick.id, name: pick.name, ok: applied.ok, path: applied.projectPath, files: applied.files.length }

  const img = generateLocalImage('quiet harbour at dusk', '512')
  log.image = { ok: img.ok, path: img.path, backend: img.backend, bytes: img.path ? statSync(img.path).size : 0 }
  if (img.path) cpSync(img.path, join(storeMedia, 'generated-image.png'))

  const fonts = listAsciiFonts()
  const art = textToAscii('Tri Cass', fonts[0] || 'Standard')
  const saved = saveAscii(art.ascii, 'tri-cass')
  log.ascii = { ok: art.ok, fonts: fonts.length, path: saved.path }
  writeFileSync(join(storeMedia, 'ascii-tri-cass.txt'), art.ascii, 'utf8')

  const android = runScaffold('android', 'Notes Pocket')
  log.android = {
    intent: detectScaffoldIntent('make an Android notes app'),
    path: android.projectPath,
    files: android.files.length,
    sha: android.files.slice(0, 5).map((f) => ({
      f: f.replace(android.projectPath + '/', ''),
      sha256: createHash('sha256').update(readFileSync(f)).digest('hex'),
      bytes: statSync(f).size
    }))
  }

  const electron = runScaffold('electron', 'Desk Lite')
  const python = runScaffold('python', 'Line Tally Py')
  const website = runScaffold('website', 'Harbour Notes')
  log.scaffolds = {
    electron: electron.files.length,
    python: python.files.length,
    website: website.files.length
  }

  writeFileSync(join(storeMedia, 'evidence.json'), JSON.stringify(log, null, 2), 'utf8')
  writeFileSync(
    join(storeMedia, 'README.md'),
    `# Tri Cass AI — v4 evidence

- Template pack count: **${status.count}** (target ≥1000)
- Template use: ${pick.name} → \`${applied.projectPath}\`
- Image backend: \`${img.backend}\` → \`generated-image.png\`
- ASCII (figlet): \`ascii-tri-cass.txt\`
- Android scaffold files: ${android.files.length}
- Screenshots: captured separately via UI walk (\`ui-*.png\`)

Generated ${new Date().toISOString()}
`,
    'utf8'
  )

  console.log(JSON.stringify(log, null, 2))
  if (status.count < 1000) {
    console.error('WARNING: pack count below 1000')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
