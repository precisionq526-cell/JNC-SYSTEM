import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

async function writeDurable(file:string,content:string,options:{flag?:string}={}) {
  const handle=await fs.open(file,options.flag ?? 'w')
  try{await handle.writeFile(content);await handle.sync()}finally{await handle.close()}
}

export class PrintUnconfirmedError extends Error {
  constructor(message: string, public requestId?: string) { super(message) }
}

async function readRecord(file: string) {
  return fs.readFile(file, 'utf8').then(text => JSON.parse(text)).catch(error => {
    if (error.code === 'ENOENT') return null
    throw new PrintUnconfirmedError('The previous print receipt could not be read. Check the Windows print queue before trying again.')
  })
}

function runPath(folder: string, fingerprint: string, reprintOf?: string) {
  const key = createHash('sha256').update(JSON.stringify([fingerprint, reprintOf ?? null])).digest('hex')
  return path.join(folder, 'runs', key + '.json')
}

export async function readPrintReceipt<T>(folder: string, requestId: string, fingerprint: string): Promise<T | null> {
  const existing = await readRecord(path.join(folder, requestId + '.json')).catch(error => {
    if (error instanceof PrintUnconfirmedError) error.requestId = requestId
    throw error
  })
  if (!existing) return null
  if (existing.fingerprint !== fingerprint) throw new Error('This print request belongs to different settings.')
  if (existing.status === 'submitted') return existing.receipt as T
  throw new PrintUnconfirmedError('A previous print submission could not be confirmed. Check the Windows print queue and printed sheets before creating another request.', requestId)
}

// Deduplicate across browser tabs, reloads and new request IDs, not just retries
// of the same HTTP request. A deliberate reprint is a run linked to its predecessor.
export async function readPrintRunReceipt<T>(folder: string, fingerprint: string, reprintOf?: string): Promise<T | null> {
  const run = await readRecord(runPath(folder, fingerprint, reprintOf))
  if (run) {
    if (run.fingerprint !== fingerprint || run.reprintOf !== (reprintOf ?? null) || typeof run.requestId !== 'string') {
      throw new PrintUnconfirmedError('This file has an unreadable print record. Check the Windows print queue before trying again.')
    }
    const receipt = await readPrintReceipt<T>(folder, run.requestId, fingerprint)
    if (!receipt) throw new PrintUnconfirmedError('This file is already being submitted. Check the print queue or retry the same request to read its receipt.', run.requestId)
    return receipt
  }
  // Preserve receipts created before run indexes were introduced.
  const names = await fs.readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const name of names.filter(name => name.endsWith('.json')).sort()) {
    const previous = await readRecord(path.join(folder, name))
    if (previous?.fingerprint === fingerprint && (previous.reprintOf ?? null) === (reprintOf ?? null)) {
      return readPrintReceipt<T>(folder, name.slice(0, -5), fingerprint)
    }
  }
  return null
}

async function validateReprint(folder: string, fingerprint: string, reprintOf?: string) {
  if (!reprintOf) return
  const previous = await readRecord(path.join(folder, reprintOf + '.json'))
  if (!previous || previous.fingerprint !== fingerprint) throw new Error('The previous print does not match this file and settings.')
  if (!['submitted', 'unconfirmed'].includes(previous.status)) {
    throw new PrintUnconfirmedError('The previous print is still being submitted. Wait and check the Windows queue before preparing another print.')
  }
}

// Claim the durable receipt before calling Windows. An uncertain outcome is never automatically repeated.
export async function submitPrintOnce<T>(folder: string, requestId: string, fingerprint: string, spool: () => Promise<void>, receipt: T, auditEvent?: Record<string, unknown>, reprintOf?: string): Promise<T> {
  await fs.mkdir(folder, { recursive: true })
  const ledger = path.join(folder, requestId + '.json')
  const cached = await readPrintReceipt<T>(folder, requestId, fingerprint)
  if (cached) return cached
  const priorRun = await readPrintRunReceipt<T>(folder, fingerprint, reprintOf)
  if (priorRun) return priorRun
  await validateReprint(folder, fingerprint, reprintOf)
  await fs.mkdir(path.join(folder, 'runs'), { recursive: true })
  try {
    await writeDurable(runPath(folder, fingerprint, reprintOf), JSON.stringify({ fingerprint, reprintOf: reprintOf ?? null, requestId }), { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const concurrent = await readPrintRunReceipt<T>(folder, fingerprint, reprintOf)
      if (concurrent) return concurrent
    }
    throw new PrintUnconfirmedError('This file is already being submitted. Check the print queue or retry the same request to read its receipt.', requestId)
  }
  try { await writeDurable(ledger, JSON.stringify({ fingerprint, reprintOf: reprintOf ?? null, status: 'submitting', createdAt: new Date().toISOString() }), { flag: 'wx' }) }
  catch { throw new PrintUnconfirmedError('This print submission is already being handled. Check the print queue or retry the same request to read its receipt.') }
  try { await spool() }
  catch {
    await writeDurable(ledger, JSON.stringify({ fingerprint, reprintOf: reprintOf ?? null, status: 'unconfirmed', createdAt: new Date().toISOString() })).catch(() => {})
    throw new PrintUnconfirmedError('Windows printing could not be confirmed. Check the printer queue and printed sheets before attempting this file again.')
  }
  try { await writeDurable(ledger, JSON.stringify({ fingerprint, reprintOf: reprintOf ?? null, status: 'submitted', receipt, auditEvent, auditSynced: false })) }
  catch { throw new PrintUnconfirmedError('Windows accepted the print job, but its receipt could not be saved. Check the queue and printed sheets before attempting this file again.') }
  return receipt
}
