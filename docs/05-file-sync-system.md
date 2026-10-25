# Phase 5: File Sync System (Pull-Based Mechanism)

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Overview

The sync system is a **Node.js background service** running on the kiosk PC. It pulls files from Supabase Storage when new online orders are detected, saves them locally, and manages the file lifecycle through processing to cleanup.

```
┌──────────────────────────────────────────────────────────┐
│                 SYNC SERVICE ARCHITECTURE                │
│                                                          │
│  ┌────────────┐    ┌────────────┐    ┌───────────────┐   │
│  │  Realtime  │───►│   File     │───►│   Local File  │   │
│  │  Listener  │    │  Downloader│    │   Organizer   │   │
│  └────────────┘    └────────────┘    └───────────────┘   │
│        │                                     │           │
│        ▼                                     ▼           │
│  ┌────────────┐                      ┌───────────────┐   │
│  │  Polling   │                      │   Lifecycle   │   │
│  │  Fallback  │                      │   Manager     │   │
│  └────────────┘                      └───────────────┘   │
│        │                                     │           │
│        ▼                                     ▼           │
│  ┌────────────┐                      ┌───────────────┐   │
│  │  Health    │                      │   Cleanup &   │   │
│  │  Monitor   │                      │   Archiver    │   │
│  └────────────┘                      └───────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Sync Service Implementation

### 2.1 Service Entry Point — `sync-service/index.ts`

```typescript
import { createClient } from '@supabase/supabase-js'
import { RealtimeListener } from './realtime-listener'
import { PollingFallback } from './polling-fallback'
import { FileDownloader } from './file-downloader'
import { FileOrganizer } from './file-organizer'
import { LifecycleManager } from './lifecycle-manager'
import { HealthMonitor } from './health-monitor'
import { loadConfig } from './config'
import { logger } from './logger'

async function main() {
  const config = loadConfig()
  logger.info('Starting Kiosk Sync Service', { stationId: config.stationId })

  // Initialize Supabase client with service role for full access
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)

  // Initialize components
  const downloader = new FileDownloader(supabase, config)
  const organizer = new FileOrganizer(config)
  const lifecycle = new LifecycleManager(config, supabase)
  const health = new HealthMonitor(supabase, config)

  // Start realtime listener (primary)
  const realtime = new RealtimeListener(supabase, config, async (order) => {
    logger.info('New order detected via realtime', { orderId: order.id })
    await processNewOrder(order, downloader, organizer, supabase)
  })

  // Start polling fallback (catches missed realtime events)
  const polling = new PollingFallback(supabase, config, async (orders) => {
    for (const order of orders) {
      logger.info('Unsynced order found via polling', { orderId: order.id })
      await processNewOrder(order, downloader, organizer, supabase)
    }
  })

  // Start lifecycle manager (cleanup, archiving)
  lifecycle.start()

  // Start health monitor (heartbeat to Supabase)
  health.start()

  // Start listeners
  await realtime.start()
  polling.start()

  logger.info('Sync service fully initialized and running')

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down sync service...')
    realtime.stop()
    polling.stop()
    lifecycle.stop()
    health.stop()
    process.exit(0)
  })
}

async function processNewOrder(order, downloader, organizer, supabase) {
  try {
    // Step 1: Download all files for this order
    const localPaths = await downloader.downloadOrderFiles(order)

    // Step 2: Organize files into /pending/{order_number}/
    await organizer.organizeFiles(order, localPaths)

    // Step 3: Mark order as locally synced in Supabase
    await supabase
      .from('orders')
      .update({
        local_synced: true,
        local_path: organizer.getOrderPath(order)
      })
      .eq('id', order.id)

    // Step 4: Mark individual files as downloaded
    for (const file of order.files) {
      await supabase
        .from('order_files')
        .update({
          is_downloaded: true,
          downloaded_at: new Date().toISOString(),
          local_path: localPaths[file.id]
        })
        .eq('id', file.id)
    }

    logger.info('Order synced successfully', {
      orderId: order.id,
      orderNumber: order.order_number,
      fileCount: order.files.length
    })
  } catch (error) {
    logger.error('Failed to sync order', { orderId: order.id, error })
    // Will be retried by polling fallback
  }
}

main().catch((err) => {
  logger.fatal('Sync service crashed', { error: err })
  process.exit(1)
})
```

---

### 2.2 Realtime Listener — `sync-service/realtime-listener.ts`

```typescript
export class RealtimeListener {
  private channel: any
  private isConnected = false

  constructor(
    private supabase: any,
    private config: SyncConfig,
    private onNewOrder: (order: Order) => Promise<void>
  ) {}

  async start() {
    this.channel = this.supabase
      .channel('new-orders')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: 'source=eq.online'  // Only online orders need syncing
        },
        async (payload) => {
          const order = payload.new
          
          // Fetch full order with files
          const { data: fullOrder } = await this.supabase
            .from('orders')
            .select('*, order_files(*)')
            .eq('id', order.id)
            .single()

          if (fullOrder) {
            await this.onNewOrder(fullOrder)
          }
        }
      )
      .subscribe((status) => {
        this.isConnected = status === 'SUBSCRIBED'
        logger.info('Realtime status', { status })
      })
  }

  stop() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel)
    }
  }

  get connected() { return this.isConnected }
}
```

---

### 2.3 Polling Fallback — `sync-service/polling-fallback.ts`

```typescript
export class PollingFallback {
  private intervalId: NodeJS.Timeout | null = null

  constructor(
    private supabase: any,
    private config: SyncConfig,
    private onUnsyncedOrders: (orders: Order[]) => Promise<void>
  ) {}

  start() {
    // Poll every 30 seconds for unsynced orders
    this.intervalId = setInterval(async () => {
      try {
        const { data: unsyncedOrders } = await this.supabase
          .from('orders')
          .select('*, order_files(*)')
          .eq('source', 'online')
          .eq('local_synced', false)
          .in('status', ['pending', 'queued'])
          .order('created_at', { ascending: true })

        if (unsyncedOrders && unsyncedOrders.length > 0) {
          logger.info(`Polling found ${unsyncedOrders.length} unsynced orders`)
          await this.onUnsyncedOrders(unsyncedOrders)
        }
      } catch (error) {
        logger.error('Polling check failed', { error })
      }
    }, this.config.pollingIntervalMs || 30000)
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }
}
```

---

### 2.4 File Downloader — `sync-service/file-downloader.ts`

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'

export class FileDownloader {
  constructor(
    private supabase: any,
    private config: SyncConfig
  ) {}

  async downloadOrderFiles(order: Order): Promise<Record<string, string>> {
    const localPaths: Record<string, string> = {}
    const orderDir = path.join(
      this.config.localBasePath,
      'uploads',
      'pending',
      order.order_number
    )

    // Create order directory
    await fs.mkdir(orderDir, { recursive: true })

    // Save order metadata locally
    await fs.writeFile(
      path.join(orderDir, 'order.json'),
      JSON.stringify({
        id: order.id,
        order_number: order.order_number,
        service_id: order.service_id,
        service_options: order.service_options,
        status: order.status,
        is_rush: order.is_rush,
        customer_name: order.customer_name,
        created_at: order.created_at,
        synced_at: new Date().toISOString()
      }, null, 2)
    )

    // Download each file
    for (const file of order.order_files || []) {
      try {
        const { data, error } = await this.supabase.storage
          .from(file.storage_bucket)
          .download(file.storage_path)

        if (error) throw error

        const localFilePath = path.join(orderDir, file.file_name)
        const buffer = Buffer.from(await data.arrayBuffer())
        await fs.writeFile(localFilePath, buffer)

        localPaths[file.id] = localFilePath
        logger.info('File downloaded', {
          fileName: file.file_name,
          size: file.file_size,
          path: localFilePath
        })
      } catch (error) {
        logger.error('File download failed', {
          fileId: file.id,
          fileName: file.file_name,
          error
        })
        throw error // Fail entire order sync if any file fails
      }
    }

    return localPaths
  }
}
```

---

### 2.5 File Organizer — `sync-service/file-organizer.ts`

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'

export class FileOrganizer {
  constructor(private config: SyncConfig) {}

  getOrderPath(order: Order): string {
    return path.join(this.config.localBasePath, 'uploads', 'pending', order.order_number)
  }

  /**
   * Move order folder between lifecycle stages
   */
  async moveOrder(orderNumber: string, from: Stage, to: Stage): Promise<string> {
    const sourcePath = path.join(this.config.localBasePath, 'uploads', from, orderNumber)
    const destPath = path.join(this.config.localBasePath, 'uploads', to, orderNumber)

    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.rename(sourcePath, destPath)

    logger.info('Order moved', { orderNumber, from, to })
    return destPath
  }

  /**
   * List all orders in a specific stage
   */
  async listOrders(stage: Stage): Promise<string[]> {
    const stagePath = path.join(this.config.localBasePath, 'uploads', stage)
    try {
      const entries = await fs.readdir(stagePath, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
  }
}

type Stage = 'pending' | 'processing' | 'completed' | 'archived'
```

---

### 2.6 Lifecycle Manager — `sync-service/lifecycle-manager.ts`

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'
import * as zlib from 'zlib'

export class LifecycleManager {
  private intervalId: NodeJS.Timeout | null = null

  constructor(
    private config: SyncConfig,
    private supabase: any
  ) {}

  start() {
    // Run lifecycle checks every 5 minutes
    this.intervalId = setInterval(() => this.runCycle(), 5 * 60 * 1000)
    // Also run immediately on start
    this.runCycle()
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async runCycle() {
    try {
      await this.syncStatusChanges()  // Sync status changes from Supabase
      await this.archiveCompleted()   // Archive old completed orders
      await this.deleteExpired()      // Delete expired archives
      await this.cleanupTemp()        // Clean temp directory
    } catch (error) {
      logger.error('Lifecycle cycle failed', { error })
    }
  }

  /**
   * Listen for status changes and move files accordingly
   */
  private async syncStatusChanges() {
    // Check for orders that changed status in Supabase
    // Move local files to match: pending→processing, processing→completed
    const { data: processingOrders } = await this.supabase
      .from('orders')
      .select('order_number, status, local_path')
      .eq('local_synced', true)
      .eq('status', 'processing')

    for (const order of processingOrders || []) {
      const pendingPath = path.join(
        this.config.localBasePath, 'uploads', 'pending', order.order_number
      )
      const processingPath = path.join(
        this.config.localBasePath, 'uploads', 'processing', order.order_number
      )

      if (await this.exists(pendingPath) && !(await this.exists(processingPath))) {
        await fs.mkdir(path.dirname(processingPath), { recursive: true })
        await fs.rename(pendingPath, processingPath)
        logger.info('Moved to processing', { orderNumber: order.order_number })
      }
    }

    // Same for completed orders
    const { data: completedOrders } = await this.supabase
      .from('orders')
      .select('order_number, status, completed_at')
      .eq('local_synced', true)
      .eq('status', 'completed')

    for (const order of completedOrders || []) {
      const processingPath = path.join(
        this.config.localBasePath, 'uploads', 'processing', order.order_number
      )
      const completedPath = path.join(
        this.config.localBasePath, 'uploads', 'completed', order.order_number
      )

      if (await this.exists(processingPath) && !(await this.exists(completedPath))) {
        await fs.mkdir(path.dirname(completedPath), { recursive: true })
        await fs.rename(processingPath, completedPath)
        logger.info('Moved to completed', { orderNumber: order.order_number })
      }
    }
  }

  /**
   * Archive completed orders older than retention period
   */
  private async archiveCompleted() {
    const completedPath = path.join(this.config.localBasePath, 'uploads', 'completed')
    const archivePath = path.join(this.config.localBasePath, 'uploads', 'archived')
    const retentionHours = this.config.archiveAfterHours || 24

    try {
      const entries = await fs.readdir(completedPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const orderPath = path.join(completedPath, entry.name)
        const stat = await fs.stat(orderPath)
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)

        if (ageHours >= retentionHours) {
          // Move to archived (or compress)
          const archiveOrderPath = path.join(archivePath, entry.name)
          await fs.mkdir(archivePath, { recursive: true })
          await fs.rename(orderPath, archiveOrderPath)
          logger.info('Archived order', { orderNumber: entry.name, ageHours })
        }
      }
    } catch { /* directory may not exist yet */ }
  }

  /**
   * Delete archived orders older than delete threshold
   */
  private async deleteExpired() {
    const archivePath = path.join(this.config.localBasePath, 'uploads', 'archived')
    const deleteAfterDays = this.config.deleteAfterDays || 7

    try {
      const entries = await fs.readdir(archivePath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const orderPath = path.join(archivePath, entry.name)
        const stat = await fs.stat(orderPath)
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)

        if (ageDays >= deleteAfterDays) {
          await fs.rm(orderPath, { recursive: true, force: true })
          logger.info('Deleted expired archive', {
            orderNumber: entry.name, ageDays
          })

          // Also delete from Supabase Storage
          const { data: order } = await this.supabase
            .from('orders')
            .select('id, order_files(storage_path, storage_bucket)')
            .eq('order_number', entry.name)
            .single()

          if (order) {
            for (const file of order.order_files) {
              await this.supabase.storage
                .from(file.storage_bucket)
                .remove([file.storage_path])
            }
          }
        }
      }
    } catch { /* directory may not exist yet */ }
  }

  /**
   * Clean temp directory
   */
  private async cleanupTemp() {
    const tempPath = path.join(this.config.localBasePath, 'temp')
    try {
      const entries = await fs.readdir(tempPath, { withFileTypes: true })
      for (const entry of entries) {
        const filePath = path.join(tempPath, entry.name)
        const stat = await fs.stat(filePath)
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)
        if (ageHours >= 2) {
          await fs.rm(filePath, { recursive: true, force: true })
        }
      }
    } catch { /* directory may not exist yet */ }
  }

  private async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true } catch { return false }
  }
}
```

---

### 2.7 Health Monitor — `sync-service/health-monitor.ts`

```typescript
export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null

  constructor(
    private supabase: any,
    private config: SyncConfig
  ) {}

  start() {
    // Send heartbeat every 60 seconds
    this.intervalId = setInterval(() => this.sendHeartbeat(), 60 * 1000)
    this.sendHeartbeat() // immediate first heartbeat
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async sendHeartbeat() {
    try {
      await this.supabase
        .from('kiosk_stations')
        .update({
          is_online: true,
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', this.config.stationId)
    } catch (error) {
      logger.error('Heartbeat failed', { error })
    }
  }
}
```

---

### 2.8 Configuration — `sync-service/config.ts`

```typescript
export interface SyncConfig {
  // Supabase
  supabaseUrl: string
  supabaseServiceKey: string

  // Kiosk identity
  stationId: string
  deviceToken: string

  // Local paths
  localBasePath: string        // e.g. C:\KioskFiles

  // Timing
  pollingIntervalMs: number    // default: 30000 (30s)
  heartbeatIntervalMs: number  // default: 60000 (60s)
  lifecycleIntervalMs: number  // default: 300000 (5min)

  // Retention
  archiveAfterHours: number    // default: 24
  deleteAfterDays: number      // default: 7

  // Limits
  maxConcurrentDownloads: number // default: 3
  maxRetries: number             // default: 3
}

export function loadConfig(): SyncConfig {
  // Load from sync-config.json or environment variables
  const configPath = path.join(
    process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles',
    'config',
    'sync-config.json'
  )

  let fileConfig = {}
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch { /* use defaults */ }

  return {
    supabaseUrl: process.env.SUPABASE_URL || fileConfig.supabaseUrl,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || fileConfig.supabaseServiceKey,
    stationId: process.env.KIOSK_STATION_ID || fileConfig.stationId,
    deviceToken: process.env.KIOSK_DEVICE_TOKEN || fileConfig.deviceToken,
    localBasePath: process.env.KIOSK_LOCAL_PATH || fileConfig.localBasePath || 'C:\\KioskFiles',
    pollingIntervalMs: fileConfig.pollingIntervalMs || 30000,
    heartbeatIntervalMs: fileConfig.heartbeatIntervalMs || 60000,
    lifecycleIntervalMs: fileConfig.lifecycleIntervalMs || 300000,
    archiveAfterHours: fileConfig.archiveAfterHours || 24,
    deleteAfterDays: fileConfig.deleteAfterDays || 7,
    maxConcurrentDownloads: fileConfig.maxConcurrentDownloads || 3,
    maxRetries: fileConfig.maxRetries || 3,
  }
}
```

---

## 3. File Lifecycle State Machine

```
                    ┌──────────┐
                    │ UPLOADED  │  (Supabase Storage only)
                    └────┬─────┘
                         │ Sync service detects
                         ▼
                    ┌──────────┐
                    │ PENDING   │  (Local: /pending/{order}/)
                    └────┬─────┘
                         │ Admin starts processing
                         ▼
                    ┌──────────┐
                    │PROCESSING │  (Local: /processing/{order}/)
                    └────┬─────┘
                         │ Admin completes order
                         ▼
                    ┌──────────┐
                    │ COMPLETED │  (Local: /completed/{order}/)
                    └────┬─────┘
                         │ After archiveAfterHours (24h)
                         ▼
                    ┌──────────┐
                    │ ARCHIVED  │  (Local: /archived/{order}/)
                    └────┬─────┘
                         │ After deleteAfterDays (7d)
                         ▼
                    ┌──────────┐
                    │ DELETED   │  (Local + Supabase Storage removed)
                    └──────────┘
```

---

## 4. Error Handling & Recovery

| Scenario | Strategy |
|----------|----------|
| Download failure | Retry 3x with exponential backoff (1s, 4s, 16s) |
| Realtime disconnects | Auto-reconnect + polling fallback catches gaps |
| Partial download | Atomic: all files must download or order stays unsynced |
| Disk full | Log critical error, alert admin via Supabase, pause downloads |
| Supabase outage | Queue operations locally, sync when connection restored |
| Duplicate detection | Check `local_synced` flag before downloading |
| Corrupt file | Verify file size matches metadata, re-download if mismatch |

---

## 5. PM2 Process Management

```json
// ecosystem.config.js
{
  "apps": [{
    "name": "kiosk-sync",
    "script": "./dist/index.js",
    "cwd": "C:\\KioskSync",
    "instances": 1,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "env": {
      "NODE_ENV": "production",
      "SUPABASE_URL": "https://xxx.supabase.co",
      "KIOSK_LOCAL_PATH": "C:\\KioskFiles",
      "KIOSK_STATION_ID": "uuid"
    },
    "log_file": "C:\\KioskFiles\\logs\\sync.log",
    "error_file": "C:\\KioskFiles\\logs\\sync-error.log",
    "log_date_format": "YYYY-MM-DD HH:mm:ss"
  }]
}
```

**Start:** `pm2 start ecosystem.config.js`
**Monitor:** `pm2 monit`
**Auto-boot on Windows:** `pm2 startup` + `pm2 save`
