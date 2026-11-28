import assert from 'node:assert/strict'
import { parseGrammarCall, extractJsonObject } from '../src/main/services/grammar'
import { detectScaffoldIntent, extractProjectTitle } from '../src/main/services/templates'
import { isDangerousCommand, setWorkspaceRoot } from '../src/main/services/workspace'
import { textToAscii, listAsciiFonts } from '../src/main/services/asciiArt'
import { generateLocalImage } from '../src/main/services/imageGen'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function main() {
  process.env.TRI_CASS_USER_DATA = mkdtempSync(join(tmpdir(), 'tri-unit-'))
  process.env.TRI_CASS_WORKSPACE = join(process.env.TRI_CASS_USER_DATA, 'projects')
  setWorkspaceRoot(process.env.TRI_CASS_WORKSPACE)

  assert.equal(detectScaffoldIntent('make an Android notes app'), 'android')
  assert.equal(detectScaffoldIntent('create a website called Harbour'), 'website')
  assert.equal(detectScaffoldIntent('make me a website in a folder'), 'website')
  assert.equal(extractProjectTitle('make a website called Harbour Notes', 'x'), 'Harbour Notes')
  assert.equal(extractProjectTitle('make a website called HarbourCafe in a folder', 'x'), 'HarbourCafe')
  const { isCreateFilesIntent } = await import('../src/main/services/templates')
  assert.equal(isCreateFilesIntent('make me a website in a folder'), true)
  const { verifyFilesOnDisk, runCodingAgent } = await import('../src/main/services/agent')
  const { DEFAULT_CONFIG } = await import('../src/main/services/paths')
  const created = await runCodingAgent({
    prompt: 'make a website called UnitSite in a folder',
    chatId: 'unit',
    model: 'n/a',
    config: { ...DEFAULT_CONFIG, streaming: false }
  })
  assert.equal(created.ok, true)
  assert.ok(created.filesCreated.length >= 3)
  const verified = verifyFilesOnDisk(created.filesCreated)
  assert.equal(verified.ok.length, created.filesCreated.length)
  assert.equal(verified.missing.length, 0)
  assert.ok(isDangerousCommand('rm -rf /'))
  assert.equal(isDangerousCommand('npm test'), false)

  const json = extractJsonObject('noise {"tool":"finish","args":{"message":"ok"}} trailing')
  assert.ok(json)
  const call = parseGrammarCall(json!)
  assert.equal(call?.tool, 'finish')

  const fonts = listAsciiFonts()
  assert.ok(fonts.length >= 10)
  const art = textToAscii('Tri', fonts[0])
  assert.ok(art.ok && art.ascii.length > 5)

  const img = generateLocalImage('unit test harbour', '512', undefined, 'detailed')
  assert.equal(img.ok, true)
  assert.ok(img.path?.endsWith('.png'))

  console.log('unit-agent-tools OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
