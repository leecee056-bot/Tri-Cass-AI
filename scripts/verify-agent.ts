import { mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCodingAgent } from '../src/main/services/agent'
import { setWorkspaceRoot } from '../src/main/services/workspace'
import { attachKnowledge } from '../src/main/services/knowledge'

async function main(): Promise<void> {
  const root = '/tmp/tri-cass-agent-verify'
  process.env.TRI_CASS_USER_DATA = join(root, 'user-data')
  mkdirSync(root, { recursive: true })
  setWorkspaceRoot(root)

  const kb = join(root, 'notes.md')
  writeFileSync(kb, 'Prefer plain HTML websites. Brand as Tri Cass AI.\n')
  attachKnowledge('verify-chat', [kb])

  const config = {
    temperature: 0.2,
    topP: 0.9,
    maxTokens: 512,
    streaming: false,
    webSearch: false,
    codeInterpreter: true,
    imageGeneration: false,
    fileAnalysis: true,
    appearance: 'system' as const,
    fontSize: 15,
    systemPrompt: 'You are Tri Cass AI.',
    enterToSend: true,
    autoApproveCommands: true
  }

  const site = await runCodingAgent({
    prompt: 'Make a website called Agent Verify Site',
    chatId: 'verify-chat',
    model: 'qwen2.5-coder:1.5b',
    config,
    forceKind: 'website'
  })
  const app = await runCodingAgent({
    prompt: 'Make an app called Agent Verify App',
    chatId: 'verify-chat',
    model: 'qwen2.5-coder:1.5b',
    config,
    forceKind: 'app'
  })

  const evidence =
    process.env.TRI_CASS_EVIDENCE ||
    '/cursor/stores/bc-1081152d-a0ed-45d4-b2ac-7bfcd7b2851a/media/local-coder'
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, 'agent-verify.json'), JSON.stringify({ site, app }, null, 2))
  if (site.projectPath && existsSync(join(site.projectPath, 'index.html'))) {
    cpSync(join(site.projectPath, 'index.html'), join(evidence, 'sample-website-index.html'))
  }
  console.log(
    JSON.stringify(
      {
        siteOk: site.ok,
        appOk: app.ok,
        sitePath: site.projectPath,
        appPath: app.projectPath,
        siteFiles: site.filesCreated.length,
        appFiles: app.filesCreated.length
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
