import { sendOrderToPrinter } from '@/lib/printing/send-to-printer'
import { PrintUnconfirmedError } from '@/lib/printing/print-ledger'
import { requireAdmin } from '@/lib/admin/require-admin'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 403 })
  const origin = request.headers.get('origin'), host = request.headers.get('host')
  try { if (!origin || new URL(origin).host !== host) return Response.json({ error: 'Print requests must come from this app.' }, { status: 403 }) }
  catch { return Response.json({ error: 'Invalid request origin.' }, { status: 403 }) }
  try { return Response.json({ ok: true, receipt: await sendOrderToPrinter(await request.json()) }) }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Print submission unavailable.', code: error instanceof PrintUnconfirmedError ? 'PRINT_UNCONFIRMED' : 'INVALID_PRINT', requestId: error instanceof PrintUnconfirmedError ? error.requestId : undefined }, { status: error instanceof PrintUnconfirmedError ? 409 : 422 }) }
}
