import { createMaintenanceClient } from './lib/admin-client.mjs'

const supabase = createMaintenanceClient()
const email = process.env.KIOSK_ADMIN_EMAIL?.trim()
const password = process.env.KIOSK_ADMIN_PASSWORD
if (!email || !password) throw new Error('Set KIOSK_ADMIN_EMAIL and KIOSK_ADMIN_PASSWORD for the account you intend to create. No default administrator credentials are provided.')

const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw new Error(`Could not create the administrator: ${error.message}`)
const { error: profileError } = await supabase.from('profiles').upsert({ id: data.user.id, email, full_name: 'System Admin', role: 'admin' })
if (profileError) throw new Error(`The user was created, but its administrator profile could not be saved: ${profileError.message}`)
console.log('Administrator created successfully. The password is not printed or saved by this script.')
