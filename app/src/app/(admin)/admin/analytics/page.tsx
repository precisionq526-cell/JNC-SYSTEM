'use client'

import { Banknote, CheckCircle2, ClipboardList, Coins, Info, Wallet } from 'lucide-react'
import { getAdminAnalyticsAction } from '@/lib/actions/admin-data'
import { money } from '@/lib/admin/display'
import { useAdminData } from '@/components/admin/use-admin-data'
import DataStatus from '@/components/admin/data-status'

export default function AnalyticsPage() {
  const state = useAdminData(getAdminAnalyticsAction)
  const data = state.data, metrics = data?.queue.telemetry
  const fmt = (n: number | null | undefined, unit = '') => n != null && Number.isFinite(n) ? n.toFixed(2) + unit : 'Unavailable'
  const values = [
    ['Orders', data?.orders, ClipboardList], ['Completed orders', data?.completed, CheckCircle2],
    ['Recorded paid total', data ? money(data.paidTotal) : 'Unavailable', Wallet],
    ['Unpaid order total', data ? money(data.unpaidTotal) : 'Unavailable', Banknote],
    ['Material costs / net profit', 'Not recorded', Coins],
  ] as const
  const observations = [
    ['Active staff slots', data?.queue.settings.isConfigured ? metrics?.serverCount : null],
    ['Active orders', data?.queue.orders.length], ['Arrival rate (last 60 minutes)', fmt(metrics ? metrics.arrivalRatePerMinute * 60 : null, ' orders/hour')],
    ['Completed timing samples (last 7 days)', metrics?.serviceSampleCount],
    ['Mean observed service time', !data ? 'Unavailable' : data.meanServiceMinutes == null ? 'No observations' : fmt(data.meanServiceMinutes, ' min')],
    ['Mean observed waiting time', !data ? 'Unavailable' : data.meanWaitMinutes == null ? 'No observations' : fmt(data.meanWaitMinutes, ' min')],
    ['Estimated utilization', fmt(metrics?.utilization == null ? null : metrics.utilization * 100, '%')],
    ['Estimated mean queue wait', fmt(metrics?.averageWaitQueueMinutes, ' min')],
    ['Estimated mean queue length (Lq)', fmt(metrics?.averageQueueLength, ' orders')],
    ['Empty-system probability (M/M/c benchmark)', fmt(metrics?.emptySystemProbabilityMMc == null ? null : metrics.emptySystemProbabilityMMc*100, '%')],
    ['Observed waiting burden', fmt(data?.queue.empiricalWaitingBurdenRatio == null ? null : data.queue.empiricalWaitingBurdenRatio * 100, '%')],
  ]
  return <div className="admin-page ref-analytics-page">
    <div className="ref-page-heading"><div><h1>Database Analytics</h1><p className="ref-analytics-note"><Info size={14} />Order totals cover all recorded orders except cancelled and failed orders. Paid totals use the recorded payment flag.</p></div><DataStatus {...state} /></div>
    <div className="ref-analytics-metrics">{values.map(([label, value, Icon]) => <div key={label} className="ref-analytics-stat"><span><Icon size={27} /></span><div><h2>{label}</h2><strong>{value ?? 'Unavailable'}</strong></div></div>)}</div>
    <h2 className="ref-observations-title">Queue observations and estimates</h2>
    <p className="ref-observations-note">{!data ? 'Waiting for queue records.' : data.queue.settings.isConfigured ? 'Capacity comes from saved queue settings.' : 'Queue setup is missing. Staff capacity and wait estimates are unavailable.'} G/G/c values are model estimates. The empty-system probability is an M/M/c benchmark, not an exact G/G/c result. {metrics ? metrics.calibration === 'observed' ? 'Variability uses observed samples.' : 'There are too few recent samples; variability assumptions are provisional.' : 'Timing observations appear after a successful update.'}</p>
    <div className="ref-observation-panels">{[observations.slice(0, 5), observations.slice(5)].map((group, i) => <dl key={i}>{group.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></div>)}</dl>)}</div>
  </div>
}
