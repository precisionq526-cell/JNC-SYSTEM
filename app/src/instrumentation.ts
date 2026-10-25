export async function register() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAutomaticKioskSync } = await import('@/lib/sync/automatic-sync')
    startAutomaticKioskSync()
    const {startSopMaintenance}=await import('@/lib/sop/maintenance')
    startSopMaintenance()
  }
}
