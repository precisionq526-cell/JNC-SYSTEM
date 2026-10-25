import { createMaintenanceClient } from './lib/admin-client.mjs'

const supabase = createMaintenanceClient()
let failed = false
for (const table of ['orders', 'profiles']) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) { console.error(`${table}: ${error.message}`); failed = true }
  else console.log(`${table}: ${count} records; connection successful.`)
}
if (failed) process.exitCode = 1
