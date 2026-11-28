import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspaceRoot, resolveInWorkspace, runCommandDetailed, sandboxEnv } from '../src/main/services/workspace'
import { parseGrammarReply, PLAN_MODE_TOOLS, MUTATING_TOOLS } from '../src/main/services/grammar'
import { searchContent, searchFilenames } from '../src/main/services/searchWorkspace'
import { withProjectLock, isProjectBusy } from '../src/main/services/agentLock'
import { detectRuntimes } from '../src/main/services/runtimes'
import { createCheckpoint, rollbackCheckpoint } from '../src/main/services/checkpoints'
import { verifyFilesOnDisk } from '../src/main/services/agent'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'tri-plan-'))
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  process.env.TRI_CASS_WORKSPACE = join(root, 'ws')
  mkdirSync(process.env.TRI_CASS_WORKSPACE, { recursive: true })
  setWorkspaceRoot(process.env.TRI_CASS_WORKSPACE)

  // Plan tools vs mutating
  assert.equal(PLAN_MODE_TOOLS.has('save_plan'), true)
  assert.equal(PLAN_MODE_TOOLS.has('write_file'), false)
  assert.equal(MUTATING_TOOLS.has('write_file'), true)

  const savePlan = parseGrammarReply(
    JSON.stringify({ tool: 'save_plan', args: { content: '# Plan\n1. Do thing' } })
  )
  assert.equal(savePlan.kind, 'call')

  // Project with searchable files + ignore
  const proj = resolveInWorkspace('.', 'search-demo')
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(proj, 'src', 'app.ts'), 'export const harbour = 1\nconst x = harbour\n')
  writeFileSync(join(proj, 'readme.md'), 'Harbour notes\n')
  writeFileSync(join(proj, 'node_modules', 'pkg', 'index.js'), 'harbour secret\n')
  writeFileSync(join(proj, '.gitignore'), 'node_modules\n')

  const contentHits = searchContent(proj, 'harbour', 20)
  assert.ok(contentHits.some((h) => h.path.includes('app.ts')))
  assert.ok(!contentHits.some((h) => h.path.includes('node_modules')))
  assert.ok(contentHits[0].line >= 1 && contentHits[0].snippet)

  const nameHits = searchFilenames(proj, 'app', 20)
  assert.ok(nameHits.some((h) => h.name === 'app.ts'))

  // save_plan disk
  mkdirSync(join(proj, '.tri-cass'), { recursive: true })
  const planPath = join(proj, '.tri-cass', 'plan.md')
  writeFileSync(planPath, '# Plan\n1. Build site\n', 'utf8')
  assert.equal(verifyFilesOnDisk([planPath]).ok.length, 1)

  // project rules override file present
  writeFileSync(join(proj, '.tri-cass-rules'), 'Always use TypeScript.\n', 'utf8')
  assert.ok(existsSync(join(proj, '.tri-cass-rules')))

  // shell exit code + cwd + sandbox env
  const env = sandboxEnv()
  assert.equal(env.CI, '1')
  assert.ok(env.PATH)
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
  const okRun = await runCommandDetailed(proj, 'echo hello-tri', 10_000)
  assert.equal(okRun.exitCode, 0)
  assert.match(okRun.text, /\[exit 0\]/)
  assert.match(okRun.text, /\[cwd /)
  const badRun = await runCommandDetailed(proj, 'exit 7', 10_000)
  assert.equal(badRun.exitCode, 7)
  assert.match(badRun.text, /\[exit 7\]/)

  // concurrent lock reject
  let started = false
  const p1 = withProjectLock('demo', async () => {
    started = true
    await new Promise((r) => setTimeout(r, 80))
    return 1
  })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(isProjectBusy('demo'), true)
  let rejected = false
  try {
    await withProjectLock('demo', async () => 2, { rejectIfBusy: true })
  } catch (err) {
    rejected = /already active/i.test(String(err))
  }
  assert.equal(rejected, true)
  assert.equal(await p1, 1)

  // undo checkpoint
  writeFileSync(join(proj, 'readme.md'), 'v1\n')
  const cp = createCheckpoint(proj, 'ui-undo')
  writeFileSync(join(proj, 'readme.md'), 'v2\n')
  const rb = rollbackCheckpoint(cp.id)
  assert.equal(rb.ok, true)
  assert.equal(readFileSync(join(proj, 'readme.md'), 'utf8'), 'v1\n')

  const rt = detectRuntimes()
  assert.equal(typeof rt.node.ok, 'boolean')
  assert.equal(typeof rt.python.ok, 'boolean')

  console.log(
    JSON.stringify({
      ok: true,
      contentHits: contentHits.length,
      nameHits: nameHits.length,
      exit0: okRun.exitCode,
      exit7: badRun.exitCode,
      checkpoint: cp.id,
      node: rt.node.ok,
      python: rt.python.ok
    })
  )
  console.log('unit-agent-plan-search OK')
  rmSync(root, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
