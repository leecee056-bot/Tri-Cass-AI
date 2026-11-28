/**
 * Smoke: create-intent must write real files under the workspace.
 * Evidence → media/local-coder/v7/
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { setWorkspaceRoot, getWorkspaceRoot } from '../src/main/services/workspace'
import { runCodingAgent } from '../src/main/services/agent'
import { DEFAULT_CONFIG } from '../src/main/services/paths'
import { detectScaffoldIntent, extractProjectTitle, isCreateFilesIntent } from '../src/main/services/templates'

const evidence =
  process.env.TRI_CASS_EVIDENCE_V7 ||
  '/cursor/stores/bc-1081152d-a0ed-45d4-b2ac-7bfcd7b2851a/media/local-coder/v7'

async function main(): Promise<void> {
  mkdirSync(evidence, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'tri-create-smoke-'))
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  mkdirSync(process.env.TRI_CASS_USER_DATA, { recursive: true })
  setWorkspaceRoot(join(root, 'projects'))

  const prompt = 'make a website called X in a folder'
  if (detectScaffoldIntent(prompt) !== 'website') throw new Error('intent')
  if (!isCreateFilesIntent(prompt)) throw new Error('create intent')
  if (extractProjectTitle(prompt, 'nope') !== 'X') throw new Error('title')

  const res = await runCodingAgent({
    prompt,
    chatId: 'smoke-v7',
    model: 'n/a',
    config: { ...DEFAULT_CONFIG, streaming: false }
  })
  if (!res.ok || !res.filesCreated.length) throw new Error('no files')
  if (!res.projectPath?.includes('/x')) throw new Error('folder name')

  const listing = res.filesCreated.map((f) => {
    if (!existsSync(f) || !f.startsWith(getWorkspaceRoot())) throw new Error(`bad ${f}`)
    return { path: f, bytes: statSync(f).size }
  })
  if (listing.some((l) => l.bytes <= 0)) throw new Error('empty file')

  writeFileSync(join(evidence, 'website-x-files.json'), JSON.stringify({ prompt, ...res, listing }, null, 2))
  writeFileSync(
    join(evidence, 'website-x-tree.txt'),
    listing.map((l) => `${l.bytes}\t${l.path}`).join('\n') + '\n'
  )
  writeFileSync(
    join(evidence, 'README.md'),
    `# v7 — real create-intent writes\n\nPrompt: \`${prompt}\`\n\n${listing.length} files under \`${res.projectPath}\`.\n`
  )
  console.log(JSON.stringify({ ok: true, projectPath: res.projectPath, files: listing.length, evidence }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
