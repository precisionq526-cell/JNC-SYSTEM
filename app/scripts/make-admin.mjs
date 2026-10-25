import { createMaintenanceClient } from './lib/admin-client.mjs'
import { promoteAdministrator } from './lib/maintenance-admin.mjs'

const supabase = createMaintenanceClient()
await promoteAdministrator(supabase, process.argv[2] || process.env.KIOSK_ADMIN_EMAIL)
console.log('Only the selected account was given the administrator role.')
