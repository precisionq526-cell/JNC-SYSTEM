'use server'
import { randomUUID } from 'node:crypto'
import { analyzePrintFiles, filesFingerprint } from '@/lib/sop/page-analysis'
import { localDatabase } from '@/lib/sop/local-store'
import { loadSopSettings } from '@/lib/sop/settings-server'
import { quotePages, type PrintQuote } from '@/lib/sop/pricing'
import { validatePrintOptions } from '@/lib/kiosk/print-options'
import { getFileEditorKind } from '@/lib/editor/file-types'

export async function getPrintQuoteAction(form: FormData) {
  try {
    const raw = form.get('options'), files = form.getAll('files')
    if (typeof raw !== 'string' || raw.length > 15000 || !files.length || files.length > 20 || files.some(f => !(f instanceof File) || !getFileEditorKind(f.name) || f.size < 1)
      || files.reduce((n, f) => n + (f instanceof File ? f.size : 0), 0) > 200 * 1024 * 1024) throw new Error('Attach supported files within the 200 MB order limit.')
    const options = JSON.parse(raw) as Record<string, unknown>, student = form.get('student') === 'yes'
    const invalid = validatePrintOptions(options); if (invalid) throw new Error(invalid)
    const settings = await loadSopSettings()
    if (!settings.configured) throw new Error('Apply the SOP database migration before using per-page pricing.')
    const analyzed = await analyzePrintFiles(files as File[], options)
    const fingerprint = filesFingerprint(analyzed.hashes, options, student)
    const quote: PrintQuote = { version: 1, id: randomUUID(), fingerprint, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ...quotePages(analyzed.pages, options, student, settings.pricing) }
    localDatabase().prepare('INSERT INTO quotes VALUES(?,?,?)').run(quote.id, JSON.stringify({ quote, hashes: analyzed.hashes, options }), quote.expiresAt)
    return { ok: true as const, quote, finishingOptions: Object.keys(settings.pricing.finishing) }
  } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'The print quote could not be calculated.' } }
}
