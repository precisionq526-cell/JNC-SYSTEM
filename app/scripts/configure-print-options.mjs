import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const service = await client.from('services').select('id').eq('slug', 'printing').single()
if (service.error) throw new Error('The printing service could not be loaded.')
const existing = await client.from('service_options').select('name').eq('service_id', service.data.id)
if (existing.error) throw new Error('Print options could not be loaded.')
const definitions = [
  { name: 'Paper Size', option_type: 'select', choices: ['A4', 'Short', 'Long', 'Legal'], default_value: 'A4' },
  { name: 'Print Color', option_type: 'select', choices: ['B&W', 'Colored'], default_value: 'B&W' },
  { name: 'Back to back', option_type: 'toggle', choices: ['Yes', 'No'], default_value: 'No' },
  { name: 'Pages to print', option_type: 'text', choices: null, default_value: 'All' },
  { name: 'Copies', option_type: 'number', choices: null, default_value: '1' },
]
const missing = definitions.map((definition, index) => ({ ...definition, service_id: service.data.id, price_modifier: 0, is_required: true, display_order: index + 1 }))
  .filter(definition => !existing.data.some(option => option.name === definition.name))
if (missing.length) {
  const inserted = await client.from('service_options').insert(missing)
  if (inserted.error) throw new Error('Could not save print options: ' + inserted.error.message)
}
console.log(JSON.stringify({ added: missing.map(option => option.name), existingOptionsPreserved: existing.data.length, pricing: 'Existing service base price preserved; no additional rates invented.' }))
