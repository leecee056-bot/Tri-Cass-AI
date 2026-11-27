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
  assert.equal(extractProjectTitle('make a website called Harbour Notes', 'x'), 'Harbour Notes')
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
