# Phase 7: Admin Dashboard Workflow

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Dashboard Overview

The admin dashboard is the central command center for operators. It provides real-time visibility into all orders (kiosk + online), queue management, file access, and analytics.

```
┌────────────────────────────────────────────────────────────────┐
│ ADMIN DASHBOARD LAYOUT                                         │
│                                                                │
│ ┌──────┐ ┌──────────────────────────────────────────────────┐  │
│ │      │ │ Topbar: Search │ Notifications 🔔3 │ Admin ▼    │  │
│ │  S   │ ├──────────────────────────────────────────────────┤  │
│ │  I   │ │                                                  │  │
│ │  D   │ │              PAGE CONTENT                        │  │
│ │  E   │ │                                                  │  │
│ │  B   │ │                                                  │  │
│ │  A   │ │                                                  │  │
│ │  R   │ │                                                  │  │
│ │      │ │                                                  │  │
│ └──────┘ └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Sidebar Navigation

| Icon | Label | Route | Purpose |
|------|-------|-------|---------|
| 📊 | Dashboard | `/admin` | Overview stats + live queue |
| 📋 | Orders | `/admin/orders` | All orders list |
| 🔄 | Queue | `/admin/queue` | Queue management + optimizer |
| 📈 | Analytics | `/admin/analytics` | Reports and statistics |
| ⚙️ | Services | `/admin/services` | Manage services + pricing |
| 🖥️ | Kiosks | `/admin/kiosks` | Kiosk station monitoring |
| 🔧 | Settings | `/admin/settings` | System configuration |

---

## 2. Page Workflows

### 2.1 Dashboard Home (`/admin`)

The landing page shows a real-time snapshot of operations.

```
┌─────────────────────────────────────────────────────────┐
│  STATS ROW (Real-time counters)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 📥 12    │ │ ⏳ 5     │ │ 🔄 3     │ │ ✅ 24    │   │
│  │ Today's  │ │ Pending  │ │ Process- │ │ Completed│   │
│  │ Orders   │ │          │ │ ing      │ │ Today    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  LIVE QUEUE BOARD (Kanban view)                 │    │
│  │                                                 │    │
│  │  Pending      │ Processing    │ Completed       │    │
│  │  ┌─────────┐  │ ┌─────────┐  │ ┌─────────┐     │    │
│  │  │ #15     │  │ │ #12     │  │ │ #10     │     │    │
│  │  │ Print   │  │ │ ID Pic  │  │ │ Print   │     │    │
│  │  │ 🟡 5min │  │ │ 🔵 3min │  │ │ ✅ Done │     │    │
│  │  │ Online  │  │ │ Kiosk   │  │ │ 14:20   │     │    │
│  │  └─────────┘  │ └─────────┘  │ └─────────┘     │    │
│  │  ┌─────────┐  │              │ ┌─────────┐     │    │
│  │  │ #16 🔥  │  │              │ │ #11     │     │    │
│  │  │ DocEdit │  │              │ │ PhotoEd │     │    │
│  │  │ 🔴 RUSH │  │              │ ✅ Done  │     │    │
│  │  └─────────┘  │              │ └─────────┘     │    │
│  └────────────────┴──────────────┴─────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  RECENT ACTIVITY FEED                           │    │
│  │  • 14:32 — ORD-013 submitted (Online, Print)    │    │
│  │  • 14:30 — ORD-012 completed by Admin1          │    │
│  │  • 14:28 — ORD-011 started processing           │    │
│  │  • 14:25 — New kiosk order ORD-010              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Real-time updates:**
- Stats counters animate when values change
- New orders slide into Pending column with highlight animation
- Cards move between columns when status changes
- Activity feed auto-scrolls with new entries
- 🔥 indicator for rush orders
- Sound notification on new orders (optional, toggleable)

---

### 2.2 Orders Page (`/admin/orders`)

Full order management with filtering, sorting, and batch operations.

```
┌─────────────────────────────────────────────────────────┐
│  FILTERS BAR                                            │
│  [All ▼] [Status ▼] [Service ▼] [Source ▼] [Date 📅]   │
│  [🔍 Search order # or customer...]                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  ORDER TABLE                                    │    │
│  │  ☐ │ Order #    │ Customer  │ Service │ Status  │    │
│  │  ──┼────────────┼───────────┼─────────┼─────────│    │
│  │  ☐ │ ORD-016 🔥 │ Juan D.   │ Print   │ ⏳ Pend │    │
│  │  ☐ │ ORD-015    │ Maria S.  │ ID Pic  │ ⏳ Pend │    │
│  │  ☐ │ ORD-014    │ Kiosk     │ DocEdit │ 🔄 Proc │    │
│  │  ☐ │ ORD-013    │ Pedro R.  │ Print   │ ✅ Done │    │
│  │                                                 │    │
│  │  ◄ 1 2 3 ... 10 ►    Showing 1-20 of 156       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  BATCH ACTIONS: [Mark Processing] [Mark Completed]      │
└─────────────────────────────────────────────────────────┘
```

**Table Columns:**
| Column | Details |
|--------|---------|
| Checkbox | Batch selection |
| Order # | `ORD-YYYYMMDD-NNN` + rush icon |
| Queue # | Daily queue number |
| Customer | Name or "Walk-in (Kiosk)" |
| Service | Service type with icon |
| Source | `🖥️ Kiosk` or `🌐 Online` badge |
| Status | Color-coded badge |
| Files | File count + sync indicator |
| Created | Relative time ("5 min ago") |
| Priority | Priority score from optimizer |
| Actions | Quick action buttons |

**Sortable by:** Order #, Created, Status, Priority Score, Wait Time

---

### 2.3 Order Detail Page (`/admin/orders/[id]`)

Full order view with file access and status management.

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Orders                                       │
│                                                         │
│  ORD-20260513-016                    Status: ⏳ Pending  │
│  Queue #16 · Created 14:32 · Source: 🌐 Online          │
│                                                         │
│  ┌────────────────────┐  ┌────────────────────────┐     │
│  │ CUSTOMER INFO      │  │ SERVICE DETAILS        │     │
│  │ Name: Juan Dela C. │  │ Service: Printing      │     │
│  │ Email: juan@mail   │  │ Paper: A4              │     │
│  │ Phone: 0917...     │  │ Color: Yes             │     │
│  │ Notes: "Rush pls"  │  │ Copies: 5              │     │
│  └────────────────────┘  │ Double-sided: No       │     │
│                          │ Est. Duration: 3 min   │     │
│                          │ Total: ₱25.00          │     │
│                          └────────────────────────┘     │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │ FILES (2)                      Sync: ✅ Local│       │
│  │ ┌────────────────────────────────────────┐   │       │
│  │ │ 📄 thesis.pdf  │ 2.4 MB │ [Preview] [📂]│  │       │
│  │ │ 📄 cover.docx  │ 156 KB │ [Preview] [📂]│  │       │
│  │ └────────────────────────────────────────┘   │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │ STATUS ACTIONS                               │       │
│  │                                              │       │
│  │  ⏳ Pending ──→ [▶ Start Processing]         │       │
│  │                                              │       │
│  │  Admin Notes: [________________________]     │       │
│  │                                              │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │ TIMELINE                                     │       │
│  │  ● 14:32  Order created (Online)             │       │
│  │  ● 14:32  File uploaded: thesis.pdf          │       │
│  │  ● 14:33  Queue #16 assigned                 │       │
│  │  ● 14:33  Files synced to local              │       │
│  │  ○ —:——   Processing started                 │       │
│  │  ○ —:——   Completed                          │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

**Status Action Buttons (contextual):**

| Current Status | Available Actions |
|----------------|-------------------|
| Pending | `▶ Start Processing` · `✕ Cancel` |
| Processing | `✅ Mark Completed` · `⚠ Mark Failed` · `✕ Cancel` |
| Completed | `📁 Archive` · `🔄 Reopen` |
| Cancelled | `🔄 Reopen` |

**File Actions:**
- **Preview**: Opens file preview modal (PDF viewer, image viewer)
- **📂 Open Local**: Opens the file in the local filesystem (for printing)
- **⬇ Download**: Download from Supabase Storage

---

### 2.4 Queue Management (`/admin/queue`)

Live queue with optimization controls.

```
┌─────────────────────────────────────────────────────────┐
│  QUEUE MANAGEMENT                   [🔄 Re-optimize]    │
│                                                         │
│  Optimizer Status: ✅ Active (last run: 30s ago)        │
│  Efficiency Score: 87%  │  Avg Wait: 8 min              │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │  OPTIMIZED QUEUE ORDER                       │       │
│  │  Pos │ Queue# │ Order      │ Service  │ Wait │       │
│  │  ────┼────────┼────────────┼──────────┼──────│       │
│  │  1   │ #16 🔥 │ ORD-016    │ Print    │ 0m   │       │
│  │  2   │ #14    │ ORD-014    │ Print    │ 3m   │       │
│  │  3   │ #15    │ ORD-015    │ ID Pic   │ 5m   │       │
│  │  4   │ #13    │ ORD-013    │ DocEdit  │ 10m  │       │
│  │  5   │ #17    │ ORD-017    │ PhotoEd  │ 15m  │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │  OPTIMIZER CONFIG                            │       │
│  │  Wait Weight:     [████████░░] 0.40          │       │
│  │  Rush Weight:     [██████░░░░] 0.25          │       │
│  │  Duration Weight: [█████░░░░░] 0.20          │       │
│  │  Congestion Wt:   [████░░░░░░] 0.15          │       │
│  │  Rush Multiplier: [2.5]                      │       │
│  │  Max Concurrent:  [2]                        │       │
│  │                          [Save & Re-optimize]│       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Drag-and-drop manual reordering (overrides optimizer)
- Priority score breakdown tooltip on hover
- Visual heat map: red = long wait, green = short wait
- Config sliders to tune optimizer weights live

---

### 2.5 Analytics Page (`/admin/analytics`)

```
┌─────────────────────────────────────────────────────────┐
│  ANALYTICS          Period: [Today ▼] [This Week] [Mon] │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │  ORDERS OVER TIME (Line Chart)                 │     │
│  │  📈 Orders per hour/day with trend line        │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────────────┐     │
│  │ SERVICE BREAKDOWN│  │ SOURCE SPLIT             │     │
│  │ (Pie Chart)      │  │ (Donut Chart)            │     │
│  │ Print: 45%       │  │ Kiosk: 60%               │     │
│  │ ID Pic: 25%      │  │ Online: 40%              │     │
│  │ DocEdit: 18%     │  │                          │     │
│  │ PhotoEd: 12%     │  │                          │     │
│  └──────────────────┘  └──────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │  KEY METRICS                                   │     │
│  │  Avg Processing Time: 6.2 min (↓ 8% vs last)  │     │
│  │  Avg Wait Time: 11.3 min (↑ 3%)               │     │
│  │  Peak Hour: 2:00 PM - 3:00 PM (18 orders)     │     │
│  │  Rush Order %: 12%                             │     │
│  │  Queue Efficiency: 87%                         │     │
│  │  Revenue Today: ₱2,450.00                      │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │  AUDIT LOG (Recent)                            │     │
│  │  14:35 Admin1 — completed ORD-012              │     │
│  │  14:30 System — optimized queue (eff: 87%)     │     │
│  │  14:28 Admin1 — started processing ORD-011     │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**Analytics Queries (server-side):**

```typescript
// Today's summary
const todayStats = await supabase.rpc('get_daily_summary', {
  target_date: today
})

// Orders by service (for pie chart)
const byService = await supabase
  .from('orders')
  .select('service_id, services(name), count')
  .gte('created_at', todayStart)

// Hourly distribution
const hourly = await supabase.rpc('get_hourly_distribution', {
  target_date: today
})

// Average processing time
const avgProcessing = await supabase.rpc('get_avg_processing_time', {
  target_date: today
})
```

---

## 3. Admin Processing Workflow (Step-by-Step)

```
ADMIN DAILY WORKFLOW:

1. LOGIN
   └─ Navigate to /admin
   └─ Authenticate with admin credentials

2. REVIEW DASHBOARD
   └─ Check pending count
   └─ Note any rush orders (🔥)
   └─ Review queue optimization order

3. PROCESS NEXT ORDER
   └─ Click top-priority order from queue
   └─ Review order details + service options
   └─ Click "Start Processing"
      └─ Status: pending → processing
      └─ File moves: /pending/ → /processing/
      └─ Customer notified via realtime

4. WORK ON FILES
   └─ Click "Open Local" to open file on PC
   └─ For printing: send to printer
   └─ For editing: open in appropriate software
   └─ For ID photo: process and format

5. COMPLETE ORDER
   └─ Click "Mark Completed"
      └─ Status: processing → completed
      └─ File moves: /processing/ → /completed/
      └─ Customer notified: "Your order is ready!"
      └─ Queue position freed

6. REPEAT from step 3

7. END OF DAY
   └─ Check Analytics for daily summary
   └─ Completed files auto-archive after 24h
   └─ Queue numbers reset next day
```

---

## 4. Real-Time Notification System

### Notification Types

| Event | Notification | Sound | Visual |
|-------|-------------|-------|--------|
| New order (any) | "New order: ORD-016 (Print)" | 🔔 Ding | Toast + badge |
| New rush order | "🔥 RUSH: ORD-017 (Doc Edit)" | 🔔🔔 Double | Red toast + flash |
| File sync complete | "Files synced for ORD-016" | None | Subtle indicator |
| Kiosk offline | "⚠ Kiosk 1 offline" | ⚠ Alert | Warning banner |
| Queue optimized | "Queue re-optimized (eff: 87%)" | None | Subtle toast |

### Implementation

```typescript
// Admin layout subscribes to realtime channels
useEffect(() => {
  const channel = supabase
    .channel('admin-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'orders'
    }, (payload) => {
      const order = payload.new
      showNotification({
        title: order.is_rush ? '🔥 RUSH ORDER' : 'New Order',
        message: `${order.order_number} — ${order.service_name}`,
        type: order.is_rush ? 'urgent' : 'info',
        sound: order.is_rush ? 'double-ding' : 'ding'
      })
      // Invalidate React Query cache to refresh data
      queryClient.invalidateQueries(['orders'])
      queryClient.invalidateQueries(['queue'])
      queryClient.invalidateQueries(['stats'])
    })
    .subscribe()

  return () => supabase.removeChannel(channel)
}, [])
```

---

## 5. File Preview System

| File Type | Preview Method |
|-----------|---------------|
| PDF | Embedded PDF.js viewer in modal |
| Images (JPG, PNG) | Native `<img>` with zoom/pan |
| Word (DOCX) | Convert to PDF server-side, then PDF.js |
| Excel (XLSX) | Table preview using SheetJS |
| Others | Show metadata + download button |

```typescript
// File preview component logic
function FilePreview({ file }: { file: OrderFile }) {
  const previewUrl = file.local_path
    ? `file://${file.local_path}`   // Local file (kiosk admin)
    : file.storage_url              // Signed URL (remote admin)

  switch (getFileCategory(file.file_type)) {
    case 'pdf':
      return <PDFViewer url={previewUrl} />
    case 'image':
      return <ImageViewer url={previewUrl} />
    case 'document':
      return <DocumentPreview url={previewUrl} />
    default:
      return <FileMetadata file={file} />
  }
}
```

---

## 6. Role-Based Access

| Feature | Admin | Operator | Viewer |
|---------|-------|----------|--------|
| View dashboard | ✅ | ✅ | ✅ |
| View orders | ✅ | ✅ | ✅ |
| Change order status | ✅ | ✅ | ❌ |
| Access files | ✅ | ✅ | ❌ |
| Manage queue config | ✅ | ❌ | ❌ |
| Manage services | ✅ | ❌ | ❌ |
| View analytics | ✅ | ✅ | ✅ |
| Manage kiosks | ✅ | ❌ | ❌ |
| System settings | ✅ | ❌ | ❌ |

> Roles stored in `profiles.role` and enforced via RLS + middleware.
