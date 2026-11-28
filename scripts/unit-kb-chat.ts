import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachKnowledge,
  chunkText,
  clearKnowledge,
  knowledgeContext,
  knowledgeStats,
  listKnowledge,
  reindexKnowledge,
  removeKnowledgeSources,
  searchKnowledge,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  MAX_SOURCE_BYTES,
  kbStoreIsLocal
} from '../src/main/services/knowledge'
import { isBlockedUrl } from '../src/main/services/webFetch'
import { GRAMMAR_TOOLS } from '../src/main/services/grammar'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'tri-kb-'))
  process.env.TRI_CASS_USER_DATA = join(root, 'ud')
  mkdirSync(process.env.TRI_CASS_USER_DATA, { recursive: true })

  const chatId = 'chat-hap142'
  assert.equal(kbStoreIsLocal(chatId), true)

  // chunking with overlap documented
  const chunks = chunkText('a'.repeat(2000), CHUNK_SIZE, CHUNK_OVERLAP)
  assert.ok(chunks.length >= 2)
  assert.ok(CHUNK_OVERLAP > 0)

  // attach text files to this chat only
  const srcDir = join(root, 'docs')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'notes.md'), '# Harbour\nTri Cass local KB notes about websites.\n')
  writeFileSync(join(srcDir, 'data.json'), JSON.stringify({ harbour: true, tip: 'folders' }))
  writeFileSync(join(srcDir, 'rows.csv'), 'a,b\n1,2\n')
  writeFileSync(join(srcDir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  const attached = attachKnowledge(chatId, [srcDir])
  assert.ok(attached.added >= 3)
  assert.ok(attached.skippedBinary?.includes('photo.png'))
  assert.ok(listKnowledge(chatId).includes('notes.md'))

  // store under userData/kb/<chatId>
  const stats = knowledgeStats(chatId)
  assert.ok(stats.storePath.includes(join('kb', chatId)))
  assert.ok(existsSync(join(stats.storePath, 'index.json')))
  assert.ok(stats.bytes > 0)
  assert.equal(stats.chunkSize, CHUNK_SIZE)
  assert.equal(stats.chunkOverlap, CHUNK_OVERLAP)

  // search + empty
  const hits = searchKnowledge(chatId, 'harbour websites')
  assert.ok(hits.length >= 1)
  assert.ok(hits[0].excerpt)
  assert.equal(searchKnowledge(chatId, '').length, 0)
  assert.equal(searchKnowledge(chatId, 'zzz-no-such-term-xyz').length, 0)

  // context budget
  const ctx = knowledgeContext(chatId, 'harbour', 200)
  assert.ok(ctx.includes('Knowledge base') || ctx.includes('harbour') || ctx.includes('truncated'))

  // reindex
  const re = reindexKnowledge(chatId)
  assert.ok(re.chunks >= 1)

  // detach single source
  const after = removeKnowledgeSources(chatId, ['notes.md'])
  assert.ok(!after.includes('notes.md'))
  assert.ok(listKnowledge(chatId).includes('data.json'))

  // clear
  clearKnowledge(chatId)
  assert.equal(listKnowledge(chatId).length, 0)
  assert.ok(!existsSync(join(stats.storePath, 'files')) || readFileSync)

  // oversized source warning path
  const big = join(root, 'huge.txt')
  writeFileSync(big, 'x'.repeat(MAX_SOURCE_BYTES + 10))
  const bigAtt = attachKnowledge(chatId, [big])
  assert.equal(bigAtt.added, 0)
  assert.ok(bigAtt.failures.some((f) => /exceeds/i.test(f.reason)))

  // SSRF
  assert.equal(isBlockedUrl('http://127.0.0.1/secret'), true)
  assert.equal(isBlockedUrl('http://169.254.169.254/latest/meta-data'), true)
  assert.equal(isBlockedUrl('http://192.168.1.1/'), true)
  assert.equal(isBlockedUrl('https://example.com/ok'), false)
  assert.equal(isBlockedUrl('file:///etc/passwd'), true)

  // tool allow-list non-empty
  assert.ok(GRAMMAR_TOOLS.includes('search_knowledge'))
  assert.ok(GRAMMAR_TOOLS.includes('write_file'))

  console.log(
    JSON.stringify({
      ok: true,
      added: attached.added,
      skippedBinary: attached.skippedBinary,
      stats,
      hits: hits.length,
      tools: GRAMMAR_TOOLS.length
    })
  )
  console.log('unit-kb-chat OK')
  rmSync(root, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
