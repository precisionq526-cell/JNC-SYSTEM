import { requireAdmin } from '@/lib/admin/require-admin'
import { getOrderPrintPdf, getVerifiedOrderFile } from '@/lib/printing/order-renderer'

export const runtime = 'nodejs'
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string; fileId: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 403 })
  try {
    const { orderId, fileId } = await params
    const preview = new URL(request.url).searchParams.get('preview') === 'pdf'
    const rendered = preview ? await getOrderPrintPdf(orderId, fileId) : null
    const loaded = rendered ?? await getVerifiedOrderFile(orderId, fileId)
    const bytes = rendered?.pdf ?? loaded.bytes
    const name = preview ? loaded.file.file_name.replace(/\.[^.]+$/, '') + '-print.pdf' : loaded.file.file_name
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': preview ? 'application/pdf' : loaded.file.file_type,
      'Content-Disposition': `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'File unavailable.' }, { status: 422 }) }
}
