# Phase 4: API & Data Flow Design

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. API Route Overview

All API routes use Next.js App Router route handlers (`route.ts`).

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| POST | `/api/orders` | Create new order | Auth/Anon |
| GET | `/api/orders` | List orders (filtered) | Admin |
| GET | `/api/orders/[id]` | Get order detail | Owner/Admin |
| PATCH | `/api/orders/[id]` | Update order status | Admin |
| DELETE | `/api/orders/[id]` | Cancel order | Owner/Admin |
| POST | `/api/files/upload` | Upload file to Supabase Storage | Auth/Anon |
| GET | `/api/files/download/[id]` | Get signed download URL | Admin |
| GET | `/api/queue` | Get current queue state | Any |
| POST | `/api/queue/optimize` | Run queue optimization | Admin |
| GET | `/api/sync/pending` | Get unsynced orders for kiosk | Kiosk |
| PATCH | `/api/sync/confirm` | Mark files as locally synced | Kiosk |
| GET | `/api/services` | List available services | Any |
| GET | `/api/analytics/summary` | Dashboard stats | Admin |

---

## 2. API Route Details

### 2.1 `POST /api/orders` — Create Order

**Request:**
```json
{
  "service_id": "uuid",
  "source": "kiosk" | "online",
  "kiosk_station_id": "uuid (if kiosk)",
  "service_options": {
    "paper_size": "A4",
    "color": true,
    "copies": 3,
    "double_sided": false
  },
  "file_ids": ["uuid", "uuid"],
  "customer_name": "Juan Dela Cruz",
  "customer_email": "juan@email.com",
  "customer_notes": "Rush please",
  "is_rush": false
}
```

**Server Logic:**
1. Validate input (Zod schema)
2. Calculate total price (base + option modifiers)
3. Estimate duration from service type + options
4. Insert into `orders` table
5. Link uploaded files via `order_files`
6. Create `queue_entries` record (auto-generates queue number)
7. Insert `audit_log` entry
8. Return order with queue number

**Response:**
```json
{
  "id": "uuid",
  "order_number": "ORD-20260513-001",
  "queue_number": 15,
  "status": "pending",
  "total_price": 15.00,
  "estimated_wait_minutes": 12,
  "created_at": "2026-05-13T14:30:00Z"
}
```

---

### 2.2 `PATCH /api/orders/[id]` — Update Order

**Request:**
```json
{
  "status": "processing",
  "admin_notes": "Printing now"
}
```

**Server Logic:**
1. Validate status transition (pending→processing→completed)
2. Update `orders` table
3. Update `queue_entries` status
4. Set timestamps (started_at, completed_at)
5. Log in `audit_log`
6. Realtime broadcast triggers automatically via Supabase

**Valid Status Transitions:**
```
pending → processing → completed
pending → cancelled
processing → completed
processing → failed
any → cancelled (admin only)
```

---

### 2.3 `POST /api/files/upload` — Upload File

**Request:** `multipart/form-data`
- `file`: Binary file
- `service_type`: string (for bucket organization)

**Server Logic:**
1. Validate file type and size (max 50MB)
2. Generate unique filename: `{uuid}/{original_name}`
3. Upload to Supabase Storage bucket `order-files`
4. Create `order_files` record with metadata
5. Return file record

**Response:**
```json
{
  "id": "uuid",
  "file_name": "document.pdf",
  "file_size": 2048576,
  "file_type": "application/pdf",
  "storage_path": "order-files/abc123/document.pdf",
  "page_count": 5
}
```

---

### 2.4 `GET /api/sync/pending` — Kiosk Sync Endpoint

**Auth:** Device token (kiosk)

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "order_number": "ORD-20260513-005",
      "source": "online",
      "status": "pending",
      "files": [
        {
          "id": "uuid",
          "file_name": "thesis.pdf",
          "storage_path": "order-files/xyz/thesis.pdf",
          "download_url": "https://...signed-url...",
          "file_size": 5242880
        }
      ]
    }
  ]
}
```

### 2.5 `POST /api/queue/optimize` — Run Queue Optimizer

**Auth:** Admin only

**Request:**
```json
{
  "strategy": "nonlinear",
  "constraints": {
    "max_concurrent": 2,
    "rush_boost": 2.5,
    "congestion_threshold": 0.8
  }
}
```

**Response:**
```json
{
  "optimized_queue": [
    { "order_id": "uuid", "position": 1, "priority_score": 9.82 },
    { "order_id": "uuid", "position": 2, "priority_score": 8.45 },
    { "order_id": "uuid", "position": 3, "priority_score": 6.21 }
  ],
  "metrics": {
    "avg_wait_time": 8.5,
    "max_wait_time": 22,
    "efficiency_score": 0.87
  }
}
```

---

## 3. Data Flow Sequences

### 3.1 Online Order → Kiosk Sync → Admin Process

```
CUSTOMER                SUPABASE                KIOSK PC               ADMIN
   │                       │                       │                     │
   │  1. Upload file       │                       │                     │
   │──────────────────────►│                       │                     │
   │                       │  Store in bucket      │                     │
   │  2. Submit order      │                       │                     │
   │──────────────────────►│                       │                     │
   │                       │  Insert order + queue │                     │
   │                       │                       │                     │
   │  3. Get queue #       │                       │                     │
   │◄──────────────────────│                       │                     │
   │                       │                       │                     │
   │                       │  4. Realtime: new order                     │
   │                       │──────────────────────►│                     │
   │                       │                       │  5. Download file   │
   │                       │◄──────────────────────│                     │
   │                       │  Return file data     │                     │
   │                       │──────────────────────►│                     │
   │                       │                       │  6. Save locally    │
   │                       │  7. Mark synced       │                     │
   │                       │◄──────────────────────│                     │
   │                       │                       │                     │
   │                       │  8. Realtime: new order                     │
   │                       │──────────────────────────────────────────►  │
   │                       │                       │  9. View order      │
   │                       │                       │                     │
   │                       │                       │  10. Open local file│
   │                       │                       │◄────────────────────│
   │                       │                       │                     │
   │                       │  11. Update: processing                    │
   │                       │◄─────────────────────────────────────────── │
   │  12. Realtime: status │                       │                     │
   │◄──────────────────────│                       │                     │
   │                       │                       │                     │
   │                       │  13. Update: completed                     │
   │                       │◄─────────────────────────────────────────── │
   │  14. Realtime: done   │                       │                     │
   │◄──────────────────────│                       │  15. Move to        │
   │                       │                       │  /completed/        │
```

### 3.2 Kiosk Order (simplified — file already local)

```
CUSTOMER (Kiosk)        LOCAL PC                SUPABASE               ADMIN
   │                       │                       │                     │
   │  1. Select service    │                       │                     │
   │──────────────────────►│                       │                     │
   │  2. Insert USB/Upload │                       │                     │
   │──────────────────────►│  3. Save locally      │                     │
   │                       │  /pending/ORD-xxx/    │                     │
   │                       │                       │                     │
   │                       │  4. Upload to Storage  │                     │
   │                       │──────────────────────►│                     │
   │                       │  5. Create order       │                     │
   │                       │──────────────────────►│                     │
   │                       │                       │  6. Realtime        │
   │  7. Queue number      │                       │──────────────────► │
   │◄──────────────────────│                       │                     │
```

---

## 4. Supabase Client Configuration

### Browser Client (customer/kiosk pages)
```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### Server Client (API routes, server components)
```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

### Admin/Service Role Client (privileged operations)
```typescript
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // Server-side only!
)
```

---

## 5. Environment Variables

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # Server-side only

# Kiosk config
KIOSK_STATION_ID=uuid
KIOSK_DEVICE_TOKEN=secret-token
KIOSK_LOCAL_PATH=C:\KioskFiles

# App config
NEXT_PUBLIC_APP_NAME=PrintHub
NEXT_PUBLIC_APP_URL=https://printhub.example.com
```

---

## 6. Middleware (Route Protection)

```
middleware.ts checks:
  /admin/*    → must be authenticated + admin role
  /kiosk/*    → must have valid device token or anon session
  /order/*    → public (optional auth)
  /api/admin/* → must be admin
  /api/sync/*  → must be valid kiosk device
```

---

## 7. Error Handling Strategy

| Layer | Strategy |
|-------|----------|
| API Routes | Try/catch → structured JSON errors with status codes |
| Server Components | error.tsx boundary per route group |
| Client Components | React Error Boundary + toast notifications |
| File Upload | Retry with exponential backoff (3 attempts) |
| Realtime | Auto-reconnect with fallback to polling |
| Sync Service | Retry queue with dead-letter logging |
