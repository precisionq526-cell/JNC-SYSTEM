'use client'
import { checkAdminDataHealthAction } from '@/lib/actions/admin-data'
import { useAdminData } from './use-admin-data'
import DataStatus from './data-status'
import { Database, ChevronDown } from 'lucide-react'

export default function DataHealthPanel() {
  const state = useAdminData(checkAdminDataHealthAction, 60000)
  const data = state.data
  const needsAttention = !!state.error || !!data && (data.missingEverywhere > 0 || data.storageErrors > 0 || data.ordersWithoutQueue > 0 || data.queueStatusMismatches > 0 || !data.queueConfigured || !data.atomicSubmissionAvailable || !data.automaticSync.running)
  return <section className="sync-health surface">
    <div className="sync-health-title"><Database size={19} /><h2>Database & file sync</h2></div>
    <DataStatus {...state} />
    <p className="sync-health-summary">{!data ? 'Checking order records and file availability…' : needsAttention ? 'Some sync or configuration checks need attention. Open the details below.' : 'Order records, queue settings, and automatic file sync are connected.'}</p>
    <details className="sync-health-details" open={needsAttention || undefined}><summary>View sync details <ChevronDown size={14} /></summary>
    <p className="text-sm text-gray-500">Orders are saved to the database immediately. Local files sync automatically while the app is running.</p>
    {data && <div className="text-sm mt-3 space-y-2">
      <p className={data.automaticSync.running ? 'text-green-700' : 'text-red-700'}>{data.automaticSync.running
        ? 'Automatic file sync is running.' : 'Automatic file sync has not reported a recent result.'} {data.automaticSync.error}</p>
      <p>{data.orders} orders · {data.files} file records · {data.ordersWithoutQueue} active orders missing a queue entry · {data.queueStatusMismatches} queue state mismatches</p>
      <p>{data.localAvailable} files verified on this PC · {data.cloudAvailable} cloud files available · {data.missingEverywhere} files missing from both locations</p>
      <p className={data.queueConfigured && data.atomicSubmissionAvailable ? 'text-green-700' : 'text-red-700'}>{data.queueConfigured ? 'Queue settings available.' : 'Queue database setup is missing.'} {data.atomicSubmissionAvailable ? 'Atomic order submission available.' : 'Order transaction setup is missing.'}</p>
      {data.missingEverywhere > 0 && <p className="text-red-700">Missing historical files need their original upload or backup. Automatic sync retries available sources and keeps cloud copies.</p>}
      {data.storageErrors > 0 && <p className="text-red-700">{data.storageErrors} storage checks failed; file availability is unknown.</p>}
    </div>}
    </details>
  </section>
}
