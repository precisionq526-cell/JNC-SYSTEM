import test from 'node:test'
import assert from 'node:assert/strict'
import { firstRelation, relationList } from '../src/lib/supabase/relations.ts'
test('unique queue relationships retain their actual queue number',()=>{
  const queue={queue_number:42,status:'waiting'}
  assert.deepEqual(relationList(queue),[queue])
  assert.equal(firstRelation(queue).queue_number,42)
})
test('to-many and absent relationships stay distinct from a fabricated entry',()=>{
  const queue={queue_number:43}
  assert.deepEqual(relationList([queue]),[queue])
  assert.equal(firstRelation([queue]).queue_number,43)
  assert.deepEqual(relationList(null),[])
  assert.equal(firstRelation(undefined),null)
})
