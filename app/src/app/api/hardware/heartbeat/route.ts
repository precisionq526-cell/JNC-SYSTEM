import { NextResponse } from 'next/server'
import { registerHardwareHeartbeatAction } from '@/lib/actions/hardware'
import type { HardwareDeviceStatus, HardwareDeviceType } from '@/lib/types/database'

const DEVICE_TYPES = new Set(['printer', 'computer', 'kiosk_terminal'])
const DEVICE_STATUSES = new Set(['online', 'offline', 'error', 'busy'])

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const headerToken = request.headers.get('x-kiosk-device-token') ?? ''
  const configuredToken = process.env.KIOSK_DEVICE_TOKEN
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (!configuredToken) return NextResponse.json({ error: 'Device authentication is not configured' }, { status: 503 })
  if (bearerToken !== configuredToken && headerToken !== configuredToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body.deviceName !== 'string' || !body.deviceName.trim() || body.deviceName.length > 200) {
    return NextResponse.json({ error: 'Invalid heartbeat payload' }, { status: 400 })
  }

  if (!DEVICE_TYPES.has(body.deviceType) || !DEVICE_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid device type or status' }, { status: 400 })
  }

  const result = await registerHardwareHeartbeatAction({
    deviceName: body.deviceName,
    deviceType: body.deviceType as HardwareDeviceType,
    status: body.status as HardwareDeviceStatus,
    location: typeof body.location === 'string' ? body.location : null,
    capabilities: typeof body.capabilities === 'object' && body.capabilities !== null ? body.capabilities : {},
    errorMessage: typeof body.errorMessage === 'string' ? body.errorMessage : null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deviceId: result.deviceId })
}
