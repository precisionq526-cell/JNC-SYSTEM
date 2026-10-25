const DB_NAME = 'printhub-staging'
const DB_VERSION = 1
const STORE = 'staged'

export type StagedFileChannel = 'kiosk' | 'online' | (string & {})

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

interface StagedPayload {
  items: { name: string; type: string; data: ArrayBuffer }[]
}

export async function saveStagedFiles(channel: StagedFileChannel, files: File[]): Promise<void> {
  const items = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      data: await file.arrayBuffer(),
    }))
  )
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put({ items } satisfies StagedPayload, channel)
  })
  db.close()
}

export async function loadStagedFiles(channel: StagedFileChannel): Promise<File[]> {
  const db = await openDb()
  const payload = await new Promise<StagedPayload | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(channel)
    req.onsuccess = () => resolve(req.result as StagedPayload | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  if (!payload?.items?.length) return []
  return payload.items.map(
    (row) => new File([row.data], row.name, { type: row.type })
  )
}

export async function clearStagedFiles(channel: StagedFileChannel): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(channel)
  })
  db.close()
}
