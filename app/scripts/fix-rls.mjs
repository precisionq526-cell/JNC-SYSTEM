import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('❌ Missing env vars')
  process.exit(1)
}

const supabase = createClient(url, key)

const policies = [
  {
    name: 'Admins full access to order_files',
    sql: `CREATE POLICY "Admins full access to order_files" ON public.order_files FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));`
  },
  {
    name: 'Customers read own order files',
    sql: `CREATE POLICY "Customers read own order files" ON public.order_files FOR SELECT USING (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_files.order_id AND orders.customer_id = auth.uid()));`
  },
  {
    name: 'Kiosk insert order files',
    sql: `CREATE POLICY "Kiosk insert order files" ON public.order_files FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_files.order_id AND orders.source = 'kiosk'));`
  },
  {
    name: 'Users insert own order files',
    sql: `CREATE POLICY "Users insert own order files" ON public.order_files FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_files.order_id AND orders.customer_id = auth.uid()));`
  }
]

async function applyPolicies() {
  console.log('🔧 Applying RLS policies for order_files...\n')

  for (const policy of policies) {
    console.log(`  → ${policy.name}...`)
    const { error } = await supabase.rpc('exec_sql', { sql: policy.sql }).maybeSingle()
    
    if (error) {
      // Policy might already exist, which is fine
      if (error.message?.includes('already exists')) {
        console.log(`    ✅ Already exists (skipped)`)
      } else {
        console.log(`    ⚠️  RPC not available: ${error.message}`)
        console.log(`    📋 You need to run this SQL manually in Supabase Dashboard → SQL Editor:`)
        console.log(`       ${policy.sql}\n`)
      }
    } else {
      console.log(`    ✅ Applied!`)
    }
  }

  console.log('\n📋 If any policies failed above, run this SQL in Supabase Dashboard → SQL Editor:\n')
  console.log('-- Fix: Add missing RLS policies for order_files')
  for (const p of policies) {
    console.log(p.sql)
  }
  console.log('\nDone!')
}

applyPolicies()
