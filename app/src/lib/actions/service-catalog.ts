'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasServiceRoleConfig } from '@/lib/supabase/env-server'
import type { Service, ServiceOption } from '@/lib/types/database'
import {cacheValue,cachedValue} from '@/lib/sop/local-store'

export async function getServiceConfigurationAction(slug: string) {
  if (!hasServiceRoleConfig()) return { ok: false as const, error: 'The database connection is not configured.' }
  const { data: service, error } = await supabaseAdmin.from('services').select('*').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (error) {const cached=cachedValue<{service:Service;options:ServiceOption[]}>('catalog:'+slug);return cached?{ok:true as const,data:cached.value}:{ok:false as const,error:'Service configuration could not be loaded. Please retry.'}}
  if (!service) return { ok: false as const, error: 'This service is unavailable.' }
  const { data: options, error: optionsError } = await supabaseAdmin.from('service_options').select('*').eq('service_id', service.id).order('display_order')
  if (optionsError) return { ok: false as const, error: 'Service options could not be loaded. Please retry.' }
  const data={ service: service as Service, options: (options ?? []) as ServiceOption[] }
  cacheValue('catalog:'+slug,data)
  return { ok: true as const, data }
}
