# Phase 1: System Architecture Design

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. High-Level Architecture

The system uses a **3-tier hybrid architecture**: Cloud (Supabase) + Local (Kiosk PC) + Frontend (Next.js).

```
FRONTEND LAYER (Next.js + React + Tailwind)
├── /kiosk   → Touchscreen kiosk UI (walk-in)
├── /order   → Online ordering (mobile/tablet/desktop)
└── /admin   → Admin dashboard (operators)
        │
        ▼
CLOUD LAYER (Supabase)
├── PostgreSQL Database (orders, users, queue)
├── Auth (anonymous kiosk, email customers, admin RBAC)
├── Realtime (live order/queue updates via WebSocket)
├── Storage (uploaded files — temp cloud holding)
└── Edge Functions (queue optimization, cleanup cron)
        │
        ▼
LOCAL LAYER (Kiosk PC)
├── Sync Service (Node.js — pulls files from Supabase Storage)
├── Local File Storage (/pending /processing /completed /archived)
├── Printer Interface (system print commands)
└── Cleanup & Archiver (auto-delete after retention)
```

---

## 2. Frontend — Route Groups

| Interface | Route | Device | Auth |
|-----------|-------|--------|------|
| Kiosk UI | `(kiosk)/kiosk/*` | Touchscreen | Anonymous session |
| Online Ordering | `(customer)/order/*` | Any device | Email/guest |
| Admin Dashboard | `(admin)/admin/*` | Desktop/Tablet | Email + admin role |

Uses Next.js 14+ App Router with isolated layouts per route group.

---

## 3. Authentication Matrix

| User Type | Method | Supabase Role |
|-----------|--------|---------------|
| Walk-in (kiosk) | Anonymous auto-session | `anon` + device token |
| Online customer | Email/password or magic link | `authenticated` |
| Admin operator | Email/password | `authenticated` + `admin` claim |

Row-Level Security (RLS) on all tables. Admins see all; customers see own orders only.

---

## 4. Supabase Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `order-files` | Customer uploads (docs, images) | Auth users upload; admins read |
| `id-photos` | ID picture captures | Auth users upload; admins read |

Max upload: 50MB per file. Auto-cleanup after configurable retention (default 7 days).

---

## 5. Data Flow — Kiosk Order

```
Customer → Select Service → Upload File → Choose Options → Submit
  │
  ├─ File saved to local storage (immediate, kiosk is local)
  ├─ File uploaded to Supabase Storage (backup/sync)
  ├─ Order record → Supabase DB
  ├─ Queue entry generated
  └─ Queue number displayed
```

## 6. Data Flow — Online Order

```
Customer → Browse → Upload File → Options → Submit
  │
  ├─ File uploaded to Supabase Storage
  ├─ Order record → Supabase DB
  ├─ Queue entry generated
  └─ Customer gets queue # + realtime tracking
        │
        ▼
Kiosk Sync Service detects new order
  ├─ Downloads file from Supabase Storage
  ├─ Saves to local /pending/ directory
  └─ Updates order: local_synced = true
```

## 7. Data Flow — Admin Processing

```
Admin Dashboard → View Queue → Select Order → Process → Complete
  │
  ├─ Opens file from local storage
  ├─ Updates status: pending → processing → completed
  ├─ Realtime broadcast to customer
  └─ File moves to /completed/ → auto-cleanup
```

---

## 8. Local File Structure (Kiosk PC)

```
C:\KioskFiles\
├── uploads\
│   ├── pending\          # Newly synced, awaiting processing
│   │   └── ORD-20260513-001\
│   │       ├── document.pdf
│   │       └── order.json
│   ├── processing\       # Currently being worked on
│   ├── completed\        # Done, awaiting cleanup
│   └── archived\         # Compressed backups
├── temp\                 # Temporary processing files
├── logs\                 # Sync service logs
└── config\
    └── sync-config.json
```

---

## 9. Security Layers

1. **Supabase Auth** — JWT tokens for all API calls
2. **RLS Policies** — per-table, per-role access control
3. **Next.js Middleware** — route protection (admin requires role)
4. **Storage Policies** — upload size + file type validation
5. **Kiosk Mode** — fullscreen locked browser, device token auth

---

## 10. Deployment

| Component | Platform |
|-----------|----------|
| Next.js App | Vercel or self-hosted |
| Database + Auth + Realtime + Storage | Supabase Cloud |
| Kiosk Browser | Chrome Kiosk Mode or Electron |
| Sync Service | Node.js managed by PM2 (auto-restart) |
| Cleanup Tasks | node-cron or Windows Task Scheduler |

---

## 11. Tech Justification

| Tech | Reason |
|------|--------|
| Next.js 14+ | SSR + App Router + API routes in one framework |
| Tailwind CSS | Rapid responsive UI, consistent design tokens |
| Supabase | All-in-one BaaS: auth + DB + realtime + storage |
| PostgreSQL | Robust relational DB, JSON support, RLS |
| Node.js Sync | Lightweight pull service, shares JS ecosystem |
| PM2 | Production process manager with auto-restart |
