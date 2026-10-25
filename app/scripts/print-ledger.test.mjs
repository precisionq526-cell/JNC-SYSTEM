import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import ts from 'typescript'

const source = await fs.readFile('src/lib/printing/print-ledger.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { submitPrintOnce, readPrintReceipt, readPrintRunReceipt, PrintUnconfirmedError } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kiosk-print-ledger-test-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  return folder
}
test('lost network responses can be retried without submitting another physical print', async t => {
  const folder = await fixture(t), receipt = { printerName: 'Test runner only', pages: [1,2] }
  let calls = 0
  await submitPrintOnce(folder, 'request', 'settings', async () => { calls++ }, receipt)
  assert.deepEqual(await submitPrintOnce(folder, 'request', 'settings', async () => { calls++ }, receipt), receipt)
  assert.deepEqual(await readPrintReceipt(folder, 'request', 'settings'), receipt)
  assert.equal(calls, 1)
})
test('a failed or interrupted Windows submission is not automatically repeated', async t => {
  const folder = await fixture(t)
  let calls = 0
  await assert.rejects(submitPrintOnce(folder, 'request', 'settings', async () => { calls++; throw Error('timeout after spool') }, {}), PrintUnconfirmedError)
  await assert.rejects(submitPrintOnce(folder, 'request', 'settings', async () => { calls++ }, {}), PrintUnconfirmedError)
  assert.equal(calls, 1)
})
test('concurrent clicks claim only one durable request before calling the spooler', async t => {
  const folder = await fixture(t)
  let release, calls = 0
  const first = submitPrintOnce(folder, 'request', 'settings', async () => { calls++; await new Promise(resolve => { release = resolve }) }, { ok: true })
  while (!release) await new Promise(resolve => setTimeout(resolve, 5))
  await assert.rejects(submitPrintOnce(folder, 'request', 'settings', async () => { calls++ }, {}), PrintUnconfirmedError)
  release(); await first
  assert.equal(calls, 1)
})
test('a request cannot be reused for a different file, printer or phase', async t => {
  const folder = await fixture(t)
  await submitPrintOnce(folder, 'request', 'original-settings', async () => {}, {})
  await assert.rejects(submitPrintOnce(folder, 'request', 'changed-settings', async () => { throw Error('Must not run') }, {}), /different settings/)
})
test('an unreadable receipt blocks repeating a possibly submitted print', async t => {
  const folder = await fixture(t)
  await fs.writeFile(path.join(folder, 'request.json'), 'corrupt receipt')
  await assert.rejects(submitPrintOnce(folder, 'request', 'settings', async () => { throw Error('Must not run') }, {}), PrintUnconfirmedError)
})

test('new browser request IDs return the original receipt without another physical print', async t => {
  const folder = await fixture(t), receipt = { requestId: 'first-tab', copies: 1 }
  let calls = 0
  await submitPrintOnce(folder, 'first-tab', 'same-file-settings', async () => { calls++ }, receipt)
  assert.deepEqual(await submitPrintOnce(folder, 'reloaded-tab', 'same-file-settings', async () => { calls++ }, { requestId: 'reloaded-tab' }), receipt)
  assert.deepEqual(await readPrintRunReceipt(folder, 'same-file-settings'), receipt)
  assert.equal(calls, 1)
})

test('simultaneous tabs with different IDs claim only one print run', async t => {
  const folder = await fixture(t)
  let release, calls = 0
  const first = submitPrintOnce(folder, 'first-tab', 'same-file-settings', async () => { calls++; await new Promise(resolve => { release = resolve }) }, { requestId: 'first-tab' })
  while (!release) await new Promise(resolve => setTimeout(resolve, 5))
  await assert.rejects(submitPrintOnce(folder, 'second-tab', 'same-file-settings', async () => { calls++ }, {}), PrintUnconfirmedError)
  release(); await first
  assert.equal(calls, 1)
})

test('an interrupted print cannot be repeated using a new request ID', async t => {
  const folder = await fixture(t)
  let calls = 0
  await assert.rejects(submitPrintOnce(folder, 'original', 'same-file-settings', async () => { calls++; throw Error('interrupted after spool') }, {}), PrintUnconfirmedError)
  await assert.rejects(submitPrintOnce(folder, 'new-browser', 'same-file-settings', async () => { calls++ }, {}), error => error instanceof PrintUnconfirmedError && error.requestId === 'original')
  assert.equal(calls, 1)
})

test('receipts from before run indexes existed still prevent duplicate submissions', async t => {
  const folder = await fixture(t), receipt = { requestId: 'legacy', copies: 1 }
  await fs.writeFile(path.join(folder, 'legacy.json'), JSON.stringify({ fingerprint: 'same-file-settings', status: 'submitted', receipt }))
  const result = await submitPrintOnce(folder, 'new-browser', 'same-file-settings', async () => { throw Error('Must not reprint') }, {})
  assert.deepEqual(result, receipt)
})

test('a deliberate reprint runs once and repeated clicks or new tabs replay its receipt', async t => {
  const folder = await fixture(t)
  let calls = 0
  await submitPrintOnce(folder, 'original', 'same-file-settings', async () => { calls++ }, { requestId: 'original' })
  const receipt = { requestId: 'explicit-reprint' }
  await submitPrintOnce(folder, 'explicit-reprint', 'same-file-settings', async () => { calls++ }, receipt, undefined, 'original')
  assert.deepEqual(await submitPrintOnce(folder, 'other-tab-reprint', 'same-file-settings', async () => { calls++ }, {}, undefined, 'original'), receipt)
  await submitPrintOnce(folder, 'next-explicit-reprint', 'same-file-settings', async () => { calls++ }, {}, undefined, 'explicit-reprint')
  assert.equal(calls, 3)
})

test('a reprint must reference the same file and settings and cannot bypass an active submission', async t => {
  const folder = await fixture(t)
  await submitPrintOnce(folder, 'other-file', 'other-settings', async () => {}, {})
  const spool = async () => { throw Error('Must not run') }
  await assert.rejects(submitPrintOnce(folder, 'invalid-parent', 'same-file-settings', spool, {}, undefined, 'missing'), /does not match/)
  await assert.rejects(submitPrintOnce(folder, 'wrong-parent', 'same-file-settings', spool, {}, undefined, 'other-file'), /does not match/)
  await fs.writeFile(path.join(folder, 'active.json'), JSON.stringify({ fingerprint: 'same-file-settings', status: 'submitting' }))
  await assert.rejects(submitPrintOnce(folder, 'early-reprint', 'same-file-settings', spool, {}, undefined, 'active'), PrintUnconfirmedError)
})

test('manual fronts, backs and different copies remain independent print runs', async t => {
  const folder = await fixture(t)
  let calls = 0
  for (const fingerprint of ['copy1-front', 'copy1-back', 'copy2-front', 'copy2-back']) {
    await submitPrintOnce(folder, fingerprint, fingerprint, async () => { calls++ }, { phase: fingerprint })
    await submitPrintOnce(folder, fingerprint + '-reloaded', fingerprint, async () => { calls++ }, {})
  }
  assert.equal(calls, 4)
})
