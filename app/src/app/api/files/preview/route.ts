import { prepareFilePdf } from '@/lib/printing/file-pdf'
import { PAPER_POINTS } from '@/lib/printing/print-plan'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  let sameOrigin = false
  try { sameOrigin = !!origin && !!host && ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === host } catch { /* Reject malformed origins. */ }
  if (!sameOrigin) return Response.json({ error: 'Preview requests must come from this app.' }, { status: 403 })
  if (Number(request.headers.get('content-length')) > 201 * 1024 * 1024) return Response.json({ error: 'This file is too large to preview.' }, { status: 413 })
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return Response.json({ error: 'Choose a document to preview.' }, { status: 400 })
    if (file.size < 1 || file.size > 200 * 1024 * 1024) return Response.json({ error: 'Choose a file up to 200 MB.' }, { status: 413 })
    const paperSize = String(form.get('paperSize') ?? 'A4')
    if (!PAPER_POINTS[paperSize]) return Response.json({ error: 'Choose a supported paper size.' }, { status: 400 })
    const pdf = await prepareFilePdf(Buffer.from(await file.arrayBuffer()), file.name, file.type, {
      'Paper Size': paperSize, 'Photo Size': form.get('photoSize') ?? undefined, 'Print margin (mm)': Number(form.get('printMargin') ?? 0),
    })
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Preview unavailable. Please upload a PDF version.' }, { status: 422 })
  }
}
