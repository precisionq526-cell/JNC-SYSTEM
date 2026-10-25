'use server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { requireAdmin } from '@/lib/admin/require-admin'
import { scanWindowsPrinters } from '@/lib/hardware/windows-printers'

export interface WindowsPrintJob { id: number; document: string; status: string; pages: number; printedPages: number; submittedAt: string }
export async function getWindowsPrintJobsAction(printerName: string) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  try {
    const printers = await scanWindowsPrinters()
    if (!printers.printers.some(printer => printer.name === printerName)) throw new Error('Choose an installed physical printer.')
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(process.cwd(), 'scripts', 'read-print-jobs.ps1'), '-PrinterName', printerName], { windowsHide: true, timeout: 15000, encoding: 'utf8' })
    const rows = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim() || '[]')
    return { ok: true as const, data: (Array.isArray(rows) ? rows : [rows]) as WindowsPrintJob[] }
  } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'The Windows print queue could not be read.' } }
}
