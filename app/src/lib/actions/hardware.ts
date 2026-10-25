import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import type { HardwareDeviceStatus, HardwareDeviceType } from '@/lib/types/database'

export interface HardwareHeartbeatInput {
  deviceName: string
  deviceType: HardwareDeviceType
  status: HardwareDeviceStatus
  location?: string | null
  capabilities?: Record<string, unknown>
  errorMessage?: string | null
}

export async function registerHardwareHeartbeatAction(input: HardwareHeartbeatInput): Promise<{ ok: boolean; error?: string; deviceId?: string }> {
  if (!hasServiceRoleConfig()) return { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('hardware_devices')
    .upsert({
      device_name: input.deviceName,
      device_type: input.deviceType,
      status: input.status,
      location: input.location ?? null,
      capabilities: input.capabilities ?? {},
      error_message: input.errorMessage ?? null,
      last_heartbeat: now,
    }, { onConflict: 'device_name' })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not register device' }

  if (input.status === 'offline' || input.status === 'error') {
    const reroute = await rerouteFailedDeviceJobsAction(data.id, input.errorMessage ?? `Device ${input.status}`)
    if (!reroute.ok) return { ok: false, deviceId: data.id, error: 'Heartbeat saved but failover tracking failed: ' + reroute.error }
  }

  return { ok: true, deviceId: data.id }
}

export async function rerouteFailedDeviceJobsAction(deviceId: string, reason = 'Device unavailable'): Promise<{ ok: boolean; rerouted: number; unassigned: number; error?: string }> {
  if (!hasServiceRoleConfig()) return { ok: false, rerouted: 0, unassigned: 0, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' }

  const { data: assignments, error } = await supabaseAdmin
    .from('print_job_assignments')
    .select('id, order_id')
    .eq('device_id', deviceId)
    .in('status', ['pending', 'assigned', 'rerouted'])

  if (error) return { ok: false, rerouted: 0, unassigned: 0, error: error.message }

  let rerouted = 0
  let unassigned = 0

  for (const assignment of assignments ?? []) {
    const result = await supabaseAdmin.rpc('reroute_hardware_assignment', {
      p_assignment_id: assignment.id, p_failed_device_id: deviceId, p_reason: reason,
    })
    if (result.error) return { ok:false,rerouted,unassigned,error:result.error.code==='PGRST202'
      ? 'Hardware failover migration is missing.' : result.error.message }
    if (result.data === 'rerouted') rerouted++
    else if (result.data === 'unassigned') unassigned++
  }

  return { ok: true, rerouted, unassigned }
}

