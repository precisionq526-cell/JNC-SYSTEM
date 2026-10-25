import fs from 'node:fs/promises'
import path from 'node:path'

// Only database history is retried. This worker never calls the printer.
export async function syncPrintHistory(client, folder) {
  const names = await fs.readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  let synced = 0, pending = 0
  for (const name of names.filter(name => /^[0-9a-f-]{36}\.json$/i.test(name))) {
    const file = path.join(folder, name)
    const ledger = await fs.readFile(file, 'utf8').then(text => JSON.parse(text)).catch(() => null)
    if (!ledger || ledger.status !== 'submitted' || ledger.auditSynced || !ledger.auditEvent) continue
    if (ledger.auditEvent.id !== name.slice(0, -5) || ledger.auditEvent.event_type !== 'print_submitted') { pending++; continue }
    let result
    try { result = await client.from('audit_log').upsert(ledger.auditEvent, { onConflict: 'id', ignoreDuplicates: true }) }
    catch { pending++; continue }
    if (result.error) { pending++; continue }
    // Re-read the latest receipt before updating it, preserving any newer server warning.
    const latest = await fs.readFile(file, 'utf8').then(text => JSON.parse(text)).catch(() => ledger)
    latest.auditSynced = true
    if (latest.receipt) latest.receipt.warning = null
    const temporary = file + '.sync-' + process.pid + '.tmp'
    try {
      await fs.writeFile(temporary, JSON.stringify(latest))
      await fs.rename(temporary, file)
      synced++
    } catch { pending++; await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  return { synced, pending }
}
