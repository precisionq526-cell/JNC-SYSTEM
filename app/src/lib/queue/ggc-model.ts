import { getQueueSystemStatus, type QueueSystemStatus } from './mg1-model'

export interface GGCInputs {
  arrivalRatePerMinute: number
  averageServiceMinutes: number
  arrivalScv: number
  serviceScv: number
  serverCount: number
}

export interface GGCMetrics extends GGCInputs {
  /** Erlang empty-system benchmark. Not an exact G/G/c probability. */
  emptySystemProbabilityMMc: number | null
  utilization: number | null
  averageWaitQueueMinutes: number | null
  averageSystemMinutes: number | null
  averageQueueLength: number | null
  averageSystemLength: number | null
  waitingBurdenRatio: number | null
  systemStatus: QueueSystemStatus | 'paused'
  isStable: boolean
  arrivalSampleCount: number
  serviceSampleCount: number
  calibration: 'observed' | 'provisional'
}

/** Sakasegawa / multi-server Kingman approximation, not an exact promise. */
export function computeGGCMetrics(input: GGCInputs): GGCMetrics {
  for (const value of Object.values(input)) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Queue parameters must be finite and non-negative')
  }
  if (input.averageServiceMinutes <= 0 || !Number.isInteger(input.serverCount)) {
    throw new Error('Service time must be positive and server count must be an integer')
  }
  const { arrivalRatePerMinute: lambda, averageServiceMinutes: service, serverCount: c } = input
  const utilization = c === 0 ? null : lambda * service / c
  const isStable = utilization !== null && utilization < 1
  const wait = !isStable ? null : lambda === 0 ? 0
    : ((input.arrivalScv + input.serviceScv) / 2)
      * utilization! ** (Math.sqrt(2 * (c + 1)) - 1) * service / (c * (1 - utilization!))
  const total = wait === null ? null : wait + service
  let emptySystemProbabilityMMc: number | null = null
  if (isStable && c > 0) {
    const offered = lambda * service
    let term = 1, sum = 1
    for(let k=1;k<c;k++){term*=offered/k;sum+=term}
    term*=offered/c
    emptySystemProbabilityMMc=1/(sum+term/(1-utilization!))
  }
  return {
    emptySystemProbabilityMMc,
    ...input, utilization, isStable,
    averageWaitQueueMinutes: wait,
    averageSystemMinutes: total,
    averageQueueLength: wait === null ? null : lambda * wait,
    averageSystemLength: total === null ? null : lambda * total,
    waitingBurdenRatio: wait === null || total === null ? null : wait / total,
    systemStatus: utilization === null ? 'paused' : getQueueSystemStatus(utilization),
    arrivalSampleCount: 0, serviceSampleCount: 0, calibration: 'provisional',
  }
}

export function sampleMoments(values: number[]) {
  const samples = values.filter(value => Number.isFinite(value) && value >= 0)
  const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0
  const variance = samples.length > 1
    ? samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1) : 0
  return { count: samples.length, mean, variance, scv: mean > 0 ? variance / mean ** 2 : 0 }
}

/** Don't mix overnight closure gaps into within-session arrival variability. */
export function interArrivalMinutes(timestamps: string[]): number[] {
  const sorted = timestamps.map(value => Date.parse(value)).filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.slice(1).flatMap((time, index) => {
    const previous = sorted[index]
    const day = (value: number) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
    return day(time) === day(previous) ? [(time - previous) / 60_000] : []
  })
}

export function queueRefreshMilliseconds(status?: GGCMetrics['systemStatus']): number {
  return status === 'busy' || status === 'near_capacity' || status === 'overloaded' ? 15_000 : 30_000
}
