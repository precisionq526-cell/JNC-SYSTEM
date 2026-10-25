import 'server-only'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const state = globalThis as typeof globalThis & { kioskSyncStarted?: boolean }
const runtimeFolder = () => process.env.KIOSK_RUNTIME_PATH || path.join(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles', '.runtime')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
export function startAutomaticKioskSync() {
  if (state.kioskSyncStarted || process.platform !== 'win32' || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  state.kioskSyncStarted = true
  let checking = false
  const ensureWorker = async () => {
    if (checking) return
    checking = true
    try {
      const lock = JSON.parse(await readFile(path.join(runtimeFolder(), 'kiosk-sync.lock'), 'utf8').catch(() => '{}'))
      if (lock.pid && alive(Number(lock.pid))) return
      const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'kiosk-pull-sync.mjs'), '--parent-pid', String(process.pid)],
        { cwd: process.cwd(), windowsHide: true, stdio: 'ignore', env: process.env })
      child.on('error', () => {})
    } catch { /* The next scheduled check retries startup. */ } finally { checking = false }
  }
  void ensureWorker()
  const timer = setInterval(() => void ensureWorker(), 15000)
  timer.unref()
}

export async function readAutomaticSyncStatus() {
  try {
    const data = JSON.parse(await readFile(path.join(runtimeFolder(), 'sync-status.json'), 'utf8'))
    return { running: alive(Number(data.pid)) && Date.now() - Date.parse(data.checkedAt) < 90000, checkedAt: data.checkedAt as string,
      orders: Number(data.orders), synced: Number(data.synced), missing: Number(data.missing), error: typeof data.error === 'string' ? data.error : null }
  } catch { return { running: false, checkedAt: null, orders: 0, synced: 0, missing: 0, error: 'Automatic file sync has not reported a result yet.' } }
}
