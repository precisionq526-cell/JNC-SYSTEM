export interface SchedulingJob {
  setupMinutes?: number
  id: string
  createdAt: string
  serviceMinutes: number
  dueAt: string | null
  pageCount: number | null
  weight: number
  status: string
  startedAt: string | null
}

export interface DispatchSettings {
  dispatchMode?: 'walkins-first' | 'deadline-aware'
  completionBufferMinutes?: number
  activeServers: number
  atcLookahead: number
  pagePenalty: number
  maxWaitMinutes: number
}

export interface PlannedJob {
  id: string
  position: number | null
  atcScore: number | null
  reason: string
  estimatedWaitMinutes: number | null
  estimatedCompletionMinutes: number | null
}

export function pickupDeadline(options: Record<string, unknown>): string | null {
  if (options['Transaction Type'] !== 'schedule') return null
  const explicit = options['Pickup At']
  if (typeof explicit === 'string' && Number.isFinite(Date.parse(explicit))) return new Date(explicit).toISOString()
  const date = options['Pickup Date'], time = options['Pickup Time']
  if (typeof date !== 'string' || typeof time !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const timestamp = Date.parse(`${date}T${time}:00+08:00`)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

/** SOP ATC-P: separate setup/print duration and a dimensionless print-duration penalty. */
export function atcPriority(job: SchedulingJob, now: number, meanService: number, meanPages: number, settings: DispatchSettings): number {
  if (!job.dueAt) return 0
  const setup = Math.max(0, job.setupMinutes ?? 0)
  const duration = Math.max(0.1, job.serviceMinutes)
  const printDuration = Math.max(0.1, duration-setup)
  const slack = Math.max(0, (Date.parse(job.dueAt) - now) / 60_000 - duration)
  const density = 1 / (1 + settings.pagePenalty * printDuration / Math.max(0.1, meanService))
  return Math.max(1, job.weight) / duration * Math.exp(-slack / (settings.atcLookahead * Math.max(0.1, meanService))) * density
}

export function rankWaitingJobs(jobs: SchedulingJob[], settings: DispatchSettings, now: number) {
  const waiting = jobs.filter(job => job.status === 'pending' || job.status === 'queued')
  const chronological = (a: SchedulingJob, b: SchedulingJob) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
  const scheduled = waiting.filter(job => job.dueAt)
  const meanService = scheduled.length ? scheduled.reduce((sum, job) => sum + Math.max(.1,job.serviceMinutes-(job.setupMinutes ?? 0)), 0) / scheduled.length : 5
  const pages = scheduled.flatMap(job => job.pageCount === null ? [] : [job.pageCount])
  const meanPages = pages.length ? pages.reduce((sum, value) => sum + value, 0) / pages.length : 1
  const score = (job: SchedulingJob) => atcPriority(job, now, meanService, meanPages, settings)
  const priority = (a: SchedulingJob, b: SchedulingJob) => score(b) - score(a) || chronological(a, b)
  if(settings.dispatchMode==='walkins-first')return [...waiting.filter(job=>!job.dueAt).sort(chronological),...scheduled.sort(priority)].map((job,index)=>({job,position:index+1,atcScore:job.dueAt?score(job):null,reason:job.dueAt?'Scheduled ATC-P priority after walk-ins':'Walk-in: first come, first served'}))
  const aged = waiting.filter(job => (now - Date.parse(job.createdAt)) / 60_000 >= settings.maxWaitMinutes).sort(chronological)
  const agedIds = new Set(aged.map(job => job.id))
  const urgent = scheduled.filter(job => !agedIds.has(job.id) && (Date.parse(job.dueAt!) - now) / 60_000 <= job.serviceMinutes).sort(priority)
  const urgentIds = new Set(urgent.map(job => job.id))
  const walkIns = waiting.filter(job => !job.dueAt && !agedIds.has(job.id)).sort(chronological)
  const remaining = scheduled.filter(job => !agedIds.has(job.id) && !urgentIds.has(job.id)).sort(priority)
  return [...aged, ...urgent, ...walkIns, ...remaining].map((job, index) => ({
    job, position: index + 1, atcScore: job.dueAt ? score(job) : null,
    reason: agedIds.has(job.id) ? 'Waiting limit reached - oldest first'
      : urgentIds.has(job.id) ? 'Pickup deadline needs attention'
      : job.dueAt ? 'Scheduled priority: pickup slack and processing time' : 'Walk-in: first come, first served',
  }))
}

/** Finite backlog projection. Never add the statistical Wq to this workload again. */
export function planQueue(jobs: SchedulingJob[], settings: DispatchSettings, now = Date.now()): PlannedJob[] {
  if (![settings.activeServers, settings.atcLookahead, settings.pagePenalty, settings.maxWaitMinutes, settings.completionBufferMinutes ?? 0].every(Number.isFinite) || (settings.completionBufferMinutes ?? 0)<0 || !Number.isInteger(settings.activeServers) || settings.activeServers < 0 || settings.activeServers > 2
    || settings.atcLookahead <= 0 || settings.pagePenalty < 0 || settings.maxWaitMinutes <= 0) throw new Error('Invalid dispatch settings')
  if(jobs.some(job=>!Number.isFinite(job.serviceMinutes) || job.serviceMinutes<=0 || !Number.isFinite(job.setupMinutes ?? 0) || (job.setupMinutes ?? 0)<0 || (job.setupMinutes ?? 0)>=job.serviceMinutes))throw new Error('Invalid service or setup duration')
  const serving = jobs.filter(job => job.status === 'processing' || job.status === 'finishing')
  const ranked = rankWaitingJobs(jobs, settings, now)
  if (!settings.activeServers) return [
    ...serving.map(job => ({ id: job.id, position: null, atcScore: null, reason: 'Processing', estimatedWaitMinutes: 0, estimatedCompletionMinutes: null })),
    ...ranked.map(row => ({ id: row.job.id, position: row.position, atcScore: row.atcScore, reason: row.reason, estimatedWaitMinutes: null, estimatedCompletionMinutes: null })),
  ]
  const slots = Array<number>(Math.max(settings.activeServers, serving.length)).fill(0)
  const processing = serving.map((job, index) => {
    const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 60_000) : 0
    // Once a duration is exceeded, the remaining time is unknown. Don't invent a one-minute promise.
    const remaining = job.startedAt && elapsed < job.serviceMinutes ? job.serviceMinutes - elapsed : Infinity
    slots[index] = remaining
    return { id: job.id, position: null, atcScore: null, reason: Number.isFinite(remaining) ? job.status==='finishing'?'Finishing':'Processing' : 'Processing time needs an update', estimatedWaitMinutes: 0, estimatedCompletionMinutes: Number.isFinite(remaining) ? Math.ceil(remaining+(settings.completionBufferMinutes ?? 0)) : null }
  })
  // Extra jobs already in progress drain first after a reduction in staff capacity.
  const available = slots.slice(0, settings.activeServers)
  for (const overflow of slots.slice(settings.activeServers)) {
    const slot = available.indexOf(Math.min(...available)); available[slot] += overflow
  }
  const waiting = ranked.map(row => {
    const slot = available.indexOf(Math.min(...available)), wait = available[slot]
    available[slot] += Math.max(0.1, row.job.serviceMinutes)
    return { id: row.job.id, position: row.position, atcScore: row.atcScore, reason: row.reason, estimatedWaitMinutes: Number.isFinite(wait) ? Math.ceil(wait) : null, estimatedCompletionMinutes: Number.isFinite(available[slot]) ? Math.ceil(available[slot]+(settings.completionBufferMinutes ?? 0)) : null }
  })
  return [...processing, ...waiting]
}
