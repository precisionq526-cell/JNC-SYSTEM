import { inspectPdfLayout, savePdfLayoutEdits } from '@/lib/editor/pdf-layout-server'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host')
  try { if (!origin || !host || new URL(origin).host !== host || !['http:', 'https:'].includes(new URL(origin).protocol)) return Response.json({ error: 'Editing requests must come from this app.' }, { status: 403 }) }
  catch { return Response.json({ error: 'Invalid request origin.' }, { status: 403 }) }
  if (Number(request.headers.get('content-length')) > 51 * 1024 * 1024) return Response.json({ error: 'Edit PDFs up to 50 MB here.' }, { status: 413 })
  try {
    const form = await request.formData(), file = form.get('file')
    if (!(file instanceof File) || !/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 50 * 1024 * 1024) return Response.json({ error: 'Choose a PDF up to 50 MB.' }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer()), action = form.get('action')
    if (action === 'inspect') return Response.json(inspectPdfLayout(bytes), { headers: { 'Cache-Control': 'no-store' } })
    if (action !== 'save') return Response.json({ error: 'Unknown editor action.' }, { status: 400 })
    const raw = form.get('edits')
    if (typeof raw !== 'string' || raw.length > 1000000) return Response.json({ error: 'Invalid PDF edits.' }, { status: 400 })
    const edited = await savePdfLayoutEdits(bytes, JSON.parse(raw))
    return new Response(new Uint8Array(edited), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'PDF editing failed. The original file is kept.' }, { status: 422 }) }
}
