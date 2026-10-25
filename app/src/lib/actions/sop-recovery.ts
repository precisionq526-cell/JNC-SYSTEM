'use server'
import {requireAdmin} from '@/lib/admin/require-admin'
import {localDatabase,cachedValue} from '@/lib/sop/local-store'
import {runSopMaintenance} from '@/lib/sop/maintenance'
import type {BufferedOrder} from '@/lib/sop/offline-buffer'
export async function getRecoverySnapshotAction() {
  const auth=await requireAdmin();if(!auth.ok)return auth
  const rows=localDatabase().prepare('SELECT payload,pending,updated_at FROM local_orders ORDER BY pending DESC,updated_at DESC LIMIT 200').all()
  return {ok:true as const,data:{status:cachedValue<{connected:boolean;checkedAt:string;pending?:number;mirrored?:number;error?:string|null}>('sop-sync')?.value ?? null,
    rows:rows.map(row=>{const order=JSON.parse(String(row.payload)) as BufferedOrder;return {id:order.id,number:order.order_number,status:order.status,service:order.services?.name,customer:order.customer_name,total:order.total_price,fileCount:order.order_files?.length ?? 0,pending:row.pending===1,error:order.offlineError,updatedAt:String(row.updated_at)}})}}
}
export async function retryRecoverySyncAction(){const auth=await requireAdmin();if(!auth.ok)return auth;await runSopMaintenance();return getRecoverySnapshotAction()}
