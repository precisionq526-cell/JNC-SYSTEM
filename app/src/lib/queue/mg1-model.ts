export type QueueSystemStatus = 'normal' | 'busy' | 'near_capacity' | 'overloaded'

export interface MG1Inputs {
  arrivalRatePerMinute: number
  averageServiceMinutes: number
  secondMomentServiceMinutes: number
}

export interface MG1Metrics {
  arrivalRatePerMinute: number
  averageServiceMinutes: number
  secondMomentServiceMinutes: number
  utilization: number
  averageWaitQueueMinutes: number | null
  averageSystemMinutes: number | null
  averageQueueLength: number | null
  averageSystemLength: number | null
  systemStatus: QueueSystemStatus
  isStable: boolean
}

export interface QueueEstimateInputs {
  workloadAheadMinutes: number
  fallbackServiceMinutes: number
  metrics: MG1Metrics
}

export function computeMG1Metrics(input: MG1Inputs): MG1Metrics {
  const arrivalRate = Math.max(0, input.arrivalRatePerMinute)
  const averageService = Math.max(0.1, input.averageServiceMinutes)
  const secondMoment = Math.max(averageService * averageService, input.secondMomentServiceMinutes)
  const utilization = arrivalRate * averageService
  const systemStatus = getQueueSystemStatus(utilization)
  const isStable = utilization < 1

  if (!isStable) {
    return {
      arrivalRatePerMinute: round(arrivalRate, 4),
      averageServiceMinutes: round(averageService, 2),
      secondMomentServiceMinutes: round(secondMoment, 2),
      utilization: round(utilization, 4),
      averageWaitQueueMinutes: null,
      averageSystemMinutes: null,
      averageQueueLength: null,
      averageSystemLength: null,
      systemStatus,
      isStable,
    }
  }

  const averageWaitQueue = arrivalRate === 0
    ? 0
    : (arrivalRate * secondMoment) / (2 * (1 - utilization))
  const averageSystem = averageWaitQueue + averageService

  return {
    arrivalRatePerMinute: round(arrivalRate, 4),
    averageServiceMinutes: round(averageService, 2),
    secondMomentServiceMinutes: round(secondMoment, 2),
    utilization: round(utilization, 4),
    averageWaitQueueMinutes: round(averageWaitQueue, 2),
    averageSystemMinutes: round(averageSystem, 2),
    averageQueueLength: round(arrivalRate * averageWaitQueue, 2),
    averageSystemLength: round(arrivalRate * averageSystem, 2),
    systemStatus,
    isStable,
  }
}

export function estimateMG1WaitMinutes(input: QueueEstimateInputs): {
  estimatedWaitMinutes: number | null
  label: string
} {
  if (!input.metrics.isStable) {
    return {
      estimatedWaitMinutes: null,
      label: 'High demand - wait time may increase',
    }
  }

  const queueAdjustment = input.metrics.averageWaitQueueMinutes ?? 0
  const wait = Math.max(input.fallbackServiceMinutes, input.workloadAheadMinutes + queueAdjustment)
  return {
    estimatedWaitMinutes: Math.ceil(wait),
    label: `${Math.ceil(wait)} min`,
  }
}

export function getQueueSystemStatus(utilization: number): QueueSystemStatus {
  if (utilization >= 1) return 'overloaded'
  if (utilization >= 0.9) return 'near_capacity'
  if (utilization >= 0.7) return 'busy'
  return 'normal'
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
