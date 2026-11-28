import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspaceRoot, editText, writeText, resolveInWorkspace } from '../src/main/services/workspace'
import {
  parseGrammarReply,
  parseGrammarCall,
  resolveMaxAgentSteps,
  STUCK_ERROR_LIMIT
} from '../src/main/services/grammar'
import { applyUnifiedDiff } from '../src/main/services/applyDiff'
import {
  createCheckpoint,
  rollbackCheckpoint,
  listCheckpoints,
  MAX_CHECKPOINTS
} from '../src/main/services/checkpoints'
import {
  verifyFilesOnDisk,
  postWriteCheck,
  noteStuck,
  clearStuck,
  type StuckState
} from '../src/main/services/agent'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'tri-loop-'))
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  process.env.TRI_CASS_WORKSPACE = join(root, 'ws')
  mkdirSync(process.env.TRI_CASS_WORKSPACE, { recursive: true })
  setWorkspaceRoot(process.env.TRI_CASS_WORKSPACE)

  // --- parse: unknown tool continues as structured error ---
  const unk = parseGrammarReply('{"tool":"explode","args":{}}')
  assert.equal(unk.kind, 'unknown_tool')

  // --- parse: missing args ---
  const miss = parseGrammarReply('{"tool":"write_file","args":{}}')
  assert.equal(miss.kind, 'missing_args')
  if (miss.kind === 'missing_args') assert.ok(miss.missing.includes('path'))

  // --- parse: valid call still works via legacy helper ---
  const ok = parseGrammarCall('{"tool":"finish","args":{"message":"done"}}')
  assert.equal(ok?.tool, 'finish')

  // --- max steps configurable ---
  assert.equal(resolveMaxAgentSteps(undefined), 12)
  assert.equal(resolveMaxAgentSteps(8), 8)
  process.env.TRI_CASS_MAX_AGENT_STEPS = '20'
  assert.equal(resolveMaxAgentSteps(8), 20)
  delete process.env.TRI_CASS_MAX_AGENT_STEPS

  // --- edit_file uniqueness ---
  const proj = 'loop-proj'
  mkdirSync(join(process.env.TRI_CASS_WORKSPACE, proj), { recursive: true })
  const file = resolveInWorkspace('note.txt', proj)
  writeText(file, 'aa aa aa')
  let threw = false
  try {
    editText(file, 'aa', 'bb')
  } catch (err) {
    threw = true
    assert.match(String(err), /matches 3 times/)
  }
  assert.equal(threw, true)
  editText(file, 'aa', 'bb', { replaceAll: true })
  assert.equal(readFileSync(file, 'utf8'), 'bb bb bb')

  // --- apply_diff ---
  writeText(file, 'hello world\n')
  const diff = [
    '--- a/note.txt',
    '+++ b/note.txt',
    '@@ -1,1 +1,1 @@',
    '-hello world',
    '+hello tri cass'
  ].join('\n')
  const applied = applyUnifiedDiff(
    resolveInWorkspace('.', proj),
    (rel) => resolveInWorkspace(rel, proj),
    diff
  )
  assert.equal(applied.ok, true)
  assert.equal(readFileSync(file, 'utf8').trim(), 'hello tri cass')
  const verifiedDiff = verifyFilesOnDisk(applied.paths)
  assert.equal(verifiedDiff.missing.length, 0)
  assert.match(postWriteCheck(file), /^ok /)

  // --- checkpoints: empty project, exclude node_modules, restore exact, prune ---
  const emptyPath = resolveInWorkspace('.', 'empty-cp')
  mkdirSync(emptyPath, { recursive: true })
  const emptyCp = createCheckpoint(emptyPath, 'empty')
  assert.equal(emptyCp.fileCount, 0)
  assert.ok(emptyCp.id)

  const rich = resolveInWorkspace('.', 'rich-cp')
  mkdirSync(join(rich, 'src'), { recursive: true })
  mkdirSync(join(rich, 'node_modules', 'x'), { recursive: true })
  writeFileSync(join(rich, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(rich, 'node_modules', 'x', 'big.js'), 'skip-me\n')
  writeFileSync(join(rich, 'readme.md'), 'v1\n')
  const cp1 = createCheckpoint(rich, 'baseline')
  assert.ok(!cp1.files.some((f) => f.includes('node_modules')))
  assert.ok(cp1.files.includes('src/a.ts'))
  assert.equal(cp1.fileCount, cp1.files.length)

  writeFileSync(join(rich, 'readme.md'), 'v2-mutated\n')
  writeFileSync(join(rich, 'extra.txt'), 'new\n')
  const rb = rollbackCheckpoint(cp1.id)
  assert.equal(rb.ok, true)
  assert.equal(readFileSync(join(rich, 'readme.md'), 'utf8'), 'v1\n')
  assert.equal(existsSync(join(rich, 'extra.txt')), false)

  // corrupt checkpoint
  const badId = 'cp-corrupt-test'
  mkdirSync(join(process.env.TRI_CASS_USER_DATA!, 'checkpoints', badId), { recursive: true })
  writeFileSync(join(process.env.TRI_CASS_USER_DATA!, 'checkpoints', badId, 'meta.json'), '{not-json', 'utf8')
  const bad = rollbackCheckpoint(badId)
  assert.equal(bad.ok, false)
  assert.match(String(bad.error), /Corrupt/)

  // escape path rejected
  let escapeThrew = false
  try {
    createCheckpoint('/tmp/outside-workspace-tri', 'nope')
  } catch {
    escapeThrew = true
  }
  assert.equal(escapeThrew, true)

  // prune policy constant documented
  assert.ok(MAX_CHECKPOINTS >= 10)
  assert.ok(listCheckpoints().length >= 1)
  assert.ok(STUCK_ERROR_LIMIT === 3)

  // stuck×3 → restore baseline (disk)
  const stuckProj = resolveInWorkspace('.', 'stuck-proj')
  mkdirSync(stuckProj, { recursive: true })
  writeFileSync(join(stuckProj, 'app.js'), 'const n = 1\n')
  const stuckBase = createCheckpoint(stuckProj, 'stuck-baseline')
  writeFileSync(join(stuckProj, 'app.js'), 'const n = 999\n')
  const stuck: StuckState = { lastError: '', count: 0 }
  assert.equal(noteStuck(stuck, 'edit_file: old string not found', 3), false)
  assert.equal(noteStuck(stuck, 'edit_file: old string not found', 3), false)
  assert.equal(noteStuck(stuck, 'edit_file: old string not found', 3), true)
  clearStuck(stuck)
  assert.equal(stuck.count, 0)
  const stuckRb = rollbackCheckpoint(stuckBase.id)
  assert.equal(stuckRb.ok, true)
  assert.equal(readFileSync(join(stuckProj, 'app.js'), 'utf8'), 'const n = 1\n')

  console.log(
    JSON.stringify({
      ok: true,
      apply_diff: applied.paths,
      checkpoint: cp1.id,
      restored: rb.ok,
      stuckRestored: stuckRb.ok,
      listed: listCheckpoints().length
    })
  )
  console.log('unit-agent-loop OK')
  rmSync(root, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
