// Never promote a list of users: the caller must name one existing account.
export async function promoteAdministrator(client, requestedEmail) {
  const email = requestedEmail?.trim().toLowerCase()
  if (!email || !email.includes('@')) throw new Error('Specify exactly one existing account: node scripts/make-admin.mjs person@example.com')
  let target = null
  for (let page = 1; !target; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`Could not find the account: ${error.message}`)
    target = data.users.find(user => user.email?.toLowerCase() === email) ?? null
    if (data.users.length < 200) break
  }
  if (!target) throw new Error('That account does not exist. No profiles were changed.')
  const existing = await client.from('profiles').select('full_name').eq('id', target.id).maybeSingle()
  if (existing.error) throw new Error(`Could not read the existing profile: ${existing.error.message}`)
  const { error } = await client.from('profiles').upsert({ id: target.id, email: target.email,
    role: 'admin', full_name: existing.data?.full_name || target.user_metadata?.full_name || 'Admin User' })
  if (error) throw new Error(`Could not update the selected administrator: ${error.message}`)
}
