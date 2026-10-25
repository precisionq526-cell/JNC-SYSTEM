import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syncPrintHistory } from './lib/print-history-sync.mjs'
const id = '12345678-1234-1234-1234-123456789abc'
async function fixture(t, status = 'submitted') {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kiosk-print-history-test-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  await fs.writeFile(path.join(folder, id + '.json'), JSON.stringify({ status, fingerprint: 'test', auditSynced: false,
    receipt: { warning: 'History pending' }, auditEvent: { id, event_type: 'print_submitted' } }))
  return folder
}
test('successful print history sync records one database event and clears the pending warning', async t => {
  const folder = await fixture(t), calls = []
  // Supabase query builders are thenable, rather than Promises with a catch method.
  const client = { from: table => ({ upsert: (event, options) => { calls.push({ table, event, options }); return { then: resolve => resolve({ error: null }) } } }) }
  assert.deepEqual(await syncPrintHistory(client, folder), { synced: 1, pending: 0 })
  assert.deepEqual(await syncPrintHistory(client, folder), { synced: 0, pending: 0 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'audit_log')
  assert.deepEqual(calls[0].options, { onConflict: 'id', ignoreDuplicates: true })
  const saved = JSON.parse(await fs.readFile(path.join(folder, id + '.json')))
  assert.equal(saved.auditSynced, true); assert.equal(saved.receipt.warning, null)
})
test('database outages retain pending history for an automatic retry', async t => {
  const folder = await fixture(t)
  assert.deepEqual(await syncPrintHistory({ from: () => ({ upsert: async () => ({ error: true }) }) }, folder), { synced: 0, pending: 1 })
  assert.equal(JSON.parse(await fs.readFile(path.join(folder, id + '.json'))).auditSynced, false)
})
test('unconfirmed or unfinished Windows jobs never become successful database print records', async t => {
  const folder = await fixture(t, 'unconfirmed')
  assert.deepEqual(await syncPrintHistory({ from: () => { throw Error('Must not record an uncertain print') } }, folder), { synced: 0, pending: 0 })
})
