import 'server-only'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { OrderFile } from '@/lib/types/database'

export async function readOrderFile(file: OrderFile): Promise<{ bytes: Buffer; source: 'local' | 'cloud' }> {
  const verify = (bytes: Buffer) => bytes.length === Number(file.file_size) && (!file.metadata?.sha256 || createHash('sha256').update(bytes).digest('hex') === file.metadata.sha256)
  if (file.local_path) {
    try {
      const root = await fs.realpath(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles')
      const target = await fs.realpath(file.local_path)
      const relative = path.relative(root, target)
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        const bytes = await fs.readFile(target)
        if (verify(bytes)) return { bytes, source: 'local' }
      }
    } catch { /* Try the retained cloud source. */ }
  }
  const downloaded = await supabaseAdmin.storage.from(file.storage_bucket).download(file.storage_path)
  if (downloaded.error || !downloaded.data) throw new Error('This file is unavailable on this PC and in cloud storage. Restore the original upload or backup before printing.')
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  if (!verify(bytes)) throw new Error('The file failed its size or checksum check. Printing was stopped.')
  return { bytes, source: 'cloud' }
}

export { prepareFilePdf } from './file-pdf'
