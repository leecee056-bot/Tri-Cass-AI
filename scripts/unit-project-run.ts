import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspaceRoot } from '../src/main/services/workspace'
import {
  getLastRun,
  inspectProject,
  readProjectFile,
  startProjectRun,
  stopProjectRun
} from '../src/main/services/projectRun'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'tri-run-'))
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  process.env.TRI_CASS_WORKSPACE = join(root, 'ws')
  mkdirSync(process.env.TRI_CASS_WORKSPACE, { recursive: true })
  setWorkspaceRoot(process.env.TRI_CASS_WORKSPACE)

  const proj = join(process.env.TRI_CASS_WORKSPACE, 'demo-app')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(
    join(proj, 'package.json'),
    JSON.stringify({
      name: 'demo-app',
      scripts: { start: 'node -e "console.log(\'hello-start\'); setTimeout(()=>{}, 5000)"' }
    })
  )
  writeFileSync(join(proj, 'src', 'index.js'), 'console.log(1)\n')
  writeFileSync(join(proj, 'index.html'), '<!doctype html><html><body>Hi</body></html>\n')

  const info = inspectProject(proj)
  assert.equal(info.kind, 'node')
  assert.equal(info.hasPackageJson, true)
  assert.equal(info.installCommand, 'npm install')
  assert.ok(info.startCommand)
  assert.ok(info.files.includes('package.json'))
  assert.ok(info.files.some((f) => f.includes('index.js')))

  // cwd locked — escape rejected
  let escaped = false
  try {
    inspectProject('/tmp')
  } catch {
    escaped = true
  }
  assert.equal(escaped, true)

  // custom short command with timeout (disk output)
  const chunks: string[] = []
  const run = await startProjectRun(proj, 'custom', {
    command: 'echo run-panel-ok && echo err-line 1>&2',
    timeoutMs: 15_000,
    onChunk: (c) => chunks.push(c.text)
  })
  assert.equal(run.exitCode, 0)
  assert.match(run.stdout, /run-panel-ok/)
  assert.ok(getLastRun()?.id === run.id)
  assert.ok(chunks.join('').includes('run-panel-ok'))

  // start then stop
  const start = await startProjectRun(proj, 'start', { timeoutMs: 0 })
  assert.equal(start.running, true)
  const stopped = stopProjectRun(start.id)
  assert.equal(stopped.ok, true)
  // allow process to die
  await new Promise((r) => setTimeout(r, 200))
  const last = getLastRun()
  assert.ok(last && last.running === false)

  // file preview
  const preview = readProjectFile(proj, 'index.html')
  assert.equal(preview.ok, true)
  assert.match(preview.text || '', /<!doctype html>/i)

  // npm install (opt-in) — may be slow; skip if no network? use local package.json only
  // Still exercise install path when node present
  if (info.runtimes.node.ok) {
    const install = await startProjectRun(proj, 'install', { timeoutMs: 120_000 })
    assert.ok(install.exitCode === 0 || install.exitCode === 1) // network may fail offline
    assert.ok(existsSync(join(proj, 'package.json')))
    // if success, node_modules may exist
  }

  console.log(
    JSON.stringify({
      ok: true,
      kind: info.kind,
      start: info.startCommand,
      runId: run.id,
      stopped: stopped.stopped,
      preview: preview.ok
    })
  )
  console.log('unit-project-run OK')
  rmSync(root, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
