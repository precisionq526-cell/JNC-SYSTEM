import test from 'node:test'
import assert from 'node:assert/strict'
import { promoteAdministrator } from './lib/maintenance-admin.mjs'

function fixture(pages, readError = null) {
  const calls = [], writes = []
  return { calls, writes, client: {
    auth: { admin: { listUsers: async ({ page }) => { calls.push(page); return { data: { users: pages[page - 1] ?? [] }, error: null } } } },
    from: table => {
      assert.equal(table, 'profiles')
      return { select: () => ({ eq: (_column, id) => ({ maybeSingle: async () => ({ data: { full_name: 'Existing display name for ' + id }, error: readError }) }) }),
        upsert: async row => { writes.push(row); return { error: null } } }
    },
  } }
}

test('maintenance cannot promote users when a target account is omitted', async () => {
  const { client, calls, writes } = fixture([[{ id: 'a', email: 'a@example.test' }]])
  for (const target of [undefined, '', 'all']) await assert.rejects(promoteAdministrator(client, target), /exactly one/)
  assert.deepEqual(calls, [])
  assert.deepEqual(writes, [])
})

test('only the named account is promoted and its display name is retained', async () => {
  const { client, writes } = fixture([[{ id: 'a', email: 'a@example.test' }, { id: 'b', email: 'b@example.test' }]])
  await promoteAdministrator(client, ' B@EXAMPLE.TEST ')
  assert.deepEqual(writes, [{ id: 'b', email: 'b@example.test', role: 'admin', full_name: 'Existing display name for b' }])
})

test('a target on a later auth page is found without changing the earlier accounts', async () => {
  const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: 'u' + index, email: `u${index}@example.test` }))
  const { client, calls, writes } = fixture([firstPage, [{ id: 'target', email: 'target@example.test' }]])
  await promoteAdministrator(client, 'target@example.test')
  assert.deepEqual(calls, [1, 2])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].id, 'target')
})

test('missing accounts and failed profile reads never change roles', async () => {
  const absent = fixture([[{ id: 'a', email: 'a@example.test' }]])
  await assert.rejects(promoteAdministrator(absent.client, 'missing@example.test'), /does not exist/)
  assert.deepEqual(absent.writes, [])
  const unreadable = fixture([[{ id: 'a', email: 'a@example.test' }]], { message: 'Database unavailable' })
  await assert.rejects(promoteAdministrator(unreadable.client, 'a@example.test'), /could not read/i)
  assert.deepEqual(unreadable.writes, [])
})
