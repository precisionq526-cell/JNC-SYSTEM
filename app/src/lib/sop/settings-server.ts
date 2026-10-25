import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { cacheValue, cachedValue } from './local-store'
import { DEFAULT_SHOP_POLICY, type ShopPolicy } from './policy'
import { SOP_PRICING, type PricingPolicy } from './pricing'
export interface SopSettings { policy: ShopPolicy; pricing: PricingPolicy; configured: boolean; offline: boolean; cachedAt?: string }
export async function loadSopSettings(): Promise<SopSettings> {
  try {
    const result = await supabaseAdmin.from('sop_settings').select('policy,pricing').eq('id', 1).abortSignal(AbortSignal.timeout(5000)).single()
    if (result.data && !result.error) {
      const settings = { policy: result.data.policy as ShopPolicy, pricing: result.data.pricing as PricingPolicy, configured: true, offline: false }
      cacheValue('sop-settings', settings); return settings
    }
    if (['PGRST205', '42P01', 'PGRST116'].includes(result.error?.code ?? '')) {
      return { policy: DEFAULT_SHOP_POLICY, pricing: SOP_PRICING, configured: false, offline: false }
    }
  } catch {}
  const cache = cachedValue<SopSettings>('sop-settings')
  if (!cache) throw new Error('Shop policy is unavailable. Connect the server before accepting new requests.')
  return { ...cache.value, offline: true, cachedAt: cache.updatedAt }
}
