import 'server-only'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

let queue: Promise<void> = Promise.resolve()
let pending = 0

export async function exportOfficePreview(file: File): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('Office previews require the local Windows print server. Export this document to PDF to preview it here.')
  const extension = file.name.toLowerCase().split('.').pop()
  if (!['docx', 'xlsx', 'pptx'].includes(extension ?? '') || file.size < 1 || file.size > 200 * 1024 * 1024) throw new Error('Choose a DOCX, XLSX or PPTX document up to 200 MB.')
  if (pending >= 4) throw new Error('The preview server is busy. Please try again shortly.')
  pending++
  const previous = queue
  let release!: () => void
  queue = new Promise<void>(resolve => { release = resolve })
  try {
    await previous
    const bytes = Buffer.from(await file.arrayBuffer())
    const zip = await JSZip.loadAsync(bytes)
    const parts = Object.values(zip.files)
    // Macros, embedded programs and workbook connections are not needed for a print preview.
    if (parts.length > 5000 || parts.some(part => /vbaProject|embeddings\/|externalLinks\/|connections\.xml/i.test(part.name))) {
      throw new Error('Export this document to PDF first. It contains embedded content or connections that cannot be previewed here.')
    }
    const folder = await mkdtemp(path.join(os.tmpdir(), 'printhub-preview-'))
    const input = path.join(folder, 'document.' + extension)
    const output = path.join(folder, 'preview.pdf')
    try {
      await writeFile(input, bytes, { flag: 'wx' })
      await new Promise<void>((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File',
          path.join(process.cwd(), 'scripts', 'export-office-preview.ps1'), '-InputPath', input, '-OutputPath', output],
        { windowsHide: true, timeout: 60000, maxBuffer: 65536 }, (error, stdout) => {
          if (!error) { resolve(); return }
          if (error.killed) {
            const pid = /^OFFICE_PID:(\d+)\s*$/m.exec(stdout)?.[1]
            // Stop only the new application created by this conversion, never all Office processes.
            if (pid && Number(pid) > 0) execFile('taskkill.exe', ['/PID', pid, '/T', '/F'], { windowsHide: true }, () => {})
          }
          reject(new Error('This document could not be rendered by Office. Retry the preview. If Office is showing a dialog, dismiss it and try again, or upload a PDF version.'))
        })
      })
      const pdf = await readFile(output)
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Office did not create a valid PDF preview.')
      return pdf
    } finally {
      // mkdtemp supplies this exact request directory; no upload names become filesystem paths.
      await rm(input, { force: true }).catch(() => {})
      await rm(output, { force: true }).catch(() => {})
      await rmdir(folder).catch(() => {})
    }
  } finally { pending--; release() }
}
