const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
// Load the production TypeScript model with the project's existing compiler.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { computeGGCMetrics, sampleMoments, interArrivalMinutes, queueRefreshMilliseconds } = require('../src/lib/queue/ggc-model.ts')
const { computeMG1Metrics } = require('../src/lib/queue/mg1-model.ts')
const { pickupDeadline, atcPriority, rankWaitingJobs, planQueue } = require('../src/lib/queue/scheduling.ts')
const input = { arrivalRatePerMinute: .1, averageServiceMinutes: 5, arrivalScv: 1, serviceScv: 1, serverCount: 1 }
const now = Date.parse('2026-09-29T02:00:00Z')
const settings = { activeServers: 1, atcLookahead: 2, pagePenalty: 0, maxWaitMinutes: 60 }
const job = (id, offset = 0, changes = {}) => ({ id, createdAt: new Date(now - 10 * 60_000 + offset * 60_000).toISOString(), serviceMinutes: 5, dueAt: null, pageCount: null, weight: 1, status: 'pending', startedAt: null, ...changes })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('single-server Poisson case agrees with Pollaczek-Khinchine', () => {
  const g = computeGGCMetrics({ ...input, serviceScv: 2 })
  const m = computeMG1Metrics({ arrivalRatePerMinute: .1, averageServiceMinutes: 5, secondMomentServiceMinutes: 75 })
  close(g.averageWaitQueueMinutes, m.averageWaitQueueMinutes)
})
test('known M/M/1 case and Little law', () => {
  const metric = computeGGCMetrics(input)
  close(metric.utilization, .5); close(metric.averageWaitQueueMinutes, 5)
  close(metric.averageSystemMinutes, 10); close(metric.averageQueueLength, .5); close(metric.averageSystemLength, 1)
  close(metric.waitingBurdenRatio, .5)
})
test('additional servers reduce wait and utilization', () => {
  const one = computeGGCMetrics(input), two = computeGGCMetrics({ ...input, serverCount: 2 })
  assert.ok(two.averageWaitQueueMinutes < one.averageWaitQueueMinutes); close(two.utilization, .25)
})
test('bursty arrivals and variable service increase expected wait', () => {
  const base = computeGGCMetrics(input)
  close(computeGGCMetrics({ ...input, arrivalScv: 3 }).averageWaitQueueMinutes, base.averageWaitQueueMinutes * 2)
  close(computeGGCMetrics({ ...input, serviceScv: 3 }).averageWaitQueueMinutes, base.averageWaitQueueMinutes * 2)
})
test('zero staff and overload never produce finite stationary waits', () => {
  for (const changes of [{ serverCount: 0 }, { arrivalRatePerMinute: .2 }, { arrivalRatePerMinute: .3 }]) {
    const metric = computeGGCMetrics({ ...input, ...changes }); assert.equal(metric.isStable, false); assert.equal(metric.averageWaitQueueMinutes, null)
  }
})
test('empty and deterministic queues have zero expected waiting', () => {
  assert.equal(computeGGCMetrics({ ...input, arrivalRatePerMinute: 0 }).averageWaitQueueMinutes, 0)
  assert.equal(computeGGCMetrics({ ...input, arrivalScv: 0, serviceScv: 0 }).averageWaitQueueMinutes, 0)
})
test('invalid inputs fail instead of leaking NaN', () => {
  for (const changes of [{ arrivalRatePerMinute: NaN }, { serviceScv: Infinity }, { serverCount: 1.5 }, { averageServiceMinutes: 0 }, { arrivalScv: -1 }]) assert.throws(() => computeGGCMetrics({ ...input, ...changes }))
})
test('sample variance uses n minus one; invalid samples excluded', () => {
  const result = sampleMoments([2, 4, 6, NaN, -1]); assert.equal(result.count, 3); close(result.mean, 4); close(result.variance, 4); close(result.scv, .25)
})
test('simultaneous arrivals are retained; overnight gaps excluded', () => {
  const intervals = interArrivalMinutes(['2026-09-28T01:00:00Z', '2026-09-29T01:00:00Z', '2026-09-29T01:00:00Z', '2026-09-29T01:05:00Z'])
  assert.deepEqual(intervals, [0, 5])
})
test('pickup parsing uses Manila offset and accepts stored UTC', () => {
  assert.equal(pickupDeadline({ 'Transaction Type': 'schedule', 'Pickup Date': '2026-09-29', 'Pickup Time': '10:00' }), '2026-09-29T02:00:00.000Z')
  assert.equal(pickupDeadline({ 'Transaction Type': 'walk-in' }), null)
  assert.equal(pickupDeadline({ 'Transaction Type': 'schedule', 'Pickup Date': 'bad', 'Pickup Time': '10:00' }), null)
})
test('walk-ins preserve FCFS even when a newer job is shorter', () => {
  const ranked = rankWaitingJobs([job('new', 1, { serviceMinutes: 1 }), job('old', 0, { serviceMinutes: 30 })], settings, now)
  assert.deepEqual(ranked.map(row => row.job.id), ['old', 'new'])
})
test('urgent pickup moves ahead of walk-ins; a future pickup waits', () => {
  const jobs = [job('walk'), job('urgent', 1, { dueAt: new Date(now + 3 * 60_000).toISOString() }), job('future', 2, { dueAt: new Date(now + 60 * 60_000).toISOString() })]
  assert.deepEqual(rankWaitingJobs(jobs, settings, now).map(row => row.job.id), ['urgent', 'walk', 'future'])
})
test('waiting limit protects large orders from starvation', () => {
  const aged = job('large', -61, { serviceMinutes: 100 }), urgent = job('urgent', 0, { dueAt: new Date(now).toISOString() })
  const ranked = rankWaitingJobs([urgent, aged], settings, now); assert.equal(ranked[0].job.id, 'large'); assert.match(ranked[0].reason, /Waiting limit/)
})
test('ATC uses separate setup and print duration with a normalized duration penalty', () => {
  const due = job('scheduled', 0, { dueAt: new Date(now).toISOString(), pageCount: 100 })
  close(atcPriority(due, now, 5, 50, settings), .2)
  close(atcPriority(due, now, 5, 50, { ...settings, pagePenalty: .5 }), .2 / 1.5)
})
test('parallel backlog projections exclude target service from its wait', () => {
  const jobs = [job('a'), job('b', 1), job('c', 2)]
  assert.deepEqual(planQueue(jobs, settings, now).map(row => row.estimatedWaitMinutes), [0, 5, 10])
  assert.deepEqual(planQueue(jobs, { ...settings, activeServers: 2 }, now).map(row => row.estimatedWaitMinutes), [0, 0, 5])
})
test('processing residuals occupy slots; closed orders excluded', () => {
  const jobs = [job('active', 0, { status: 'processing', serviceMinutes: 10, startedAt: new Date(now - 4 * 60_000).toISOString() }), job('waiting'), job('done', 0, { status: 'completed' })]
  const plan = planQueue(jobs, settings, now); assert.equal(plan.length, 2); assert.equal(plan.find(row => row.id === 'waiting').estimatedWaitMinutes, 6)
})
test('overdue or untimed active work has unknown remaining time', () => {
  const active = job('active', 0, { status: 'processing', startedAt: new Date(now - 20 * 60_000).toISOString() })
  const plan = planQueue([active, job('waiting')], settings, now)
  assert.equal(plan[0].estimatedCompletionMinutes, null); assert.equal(plan[1].estimatedWaitMinutes, null)
  const parallel = planQueue([active, job('waiting')], { ...settings, activeServers: 2 }, now)
  assert.equal(parallel[1].estimatedWaitMinutes, 0)
})
test('paused queue returns unavailable estimates; IDs and ticket order stable', () => {
  const plan = planQueue([job('a'), job('b', 1)], { ...settings, activeServers: 0 }, now)
  assert.deepEqual(plan.map(row => row.id), ['a', 'b']); assert.ok(plan.every(row => row.estimatedWaitMinutes === null))
})
test('server metadata does not invalidate dispatch settings', () => {
  assert.equal(planQueue([job('a')], { ...settings, isConfigured: false }, now)[0].estimatedWaitMinutes, 0)
  assert.throws(() => planQueue([job('a')], { ...settings, atcLookahead: NaN }, now))
})
test('refresh cadence follows load within the supported 15-30 second band', () => {
  assert.equal(queueRefreshMilliseconds('normal'), 30000); assert.equal(queueRefreshMilliseconds('overloaded'), 15000)
})
