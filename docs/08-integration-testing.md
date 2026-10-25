# Phase 8: Integration & Testing Plan

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Integration Architecture

### 1.1 System Integration Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTEGRATION POINTS                           │
│                                                                 │
│  KIOSK UI ◄──────────► SUPABASE ◄──────────► ADMIN DASHBOARD   │
│     │                     ▲  ▲                     │            │
│     │                     │  │                     │            │
│     ▼                     │  │                     ▼            │
│  LOCAL FILES              │  │              FILE PREVIEW        │
│     │                     │  │                     │            │
│     ▼                     │  │                     │            │
│  SYNC SERVICE ◄───────────┘  └──────────► ONLINE ORDERING      │
│     │                                          │               │
│     ▼                                          │               │
│  PRINTER ◄─────────────────────────────────────┘               │
│                                                                 │
│  Integration Types:                                             │
│  ──────── = Supabase Realtime (WebSocket)                       │
│  ◄──────► = REST API (HTTPS)                                    │
│  ──────── = Local filesystem                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Integration Points Checklist

| # | Integration | From | To | Protocol | Priority |
|---|-------------|------|----|----------|----------|
| I-1 | Kiosk → Supabase DB | Kiosk UI | orders table | Supabase JS Client | P0 |
| I-2 | Kiosk → Supabase Storage | Kiosk UI | order-files bucket | Storage API | P0 |
| I-3 | Online → Supabase DB | Order pages | orders table | Supabase JS Client | P0 |
| I-4 | Online → Supabase Storage | Order pages | order-files bucket | Storage API | P0 |
| I-5 | Admin ← Supabase Realtime | orders table | Admin dashboard | WebSocket | P0 |
| I-6 | Sync ← Supabase Realtime | orders table | Sync service | WebSocket | P0 |
| I-7 | Sync → Local filesystem | Supabase Storage | Local /uploads/ | Node.js fs | P0 |
| I-8 | Sync → Supabase DB | Sync service | orders.local_synced | Supabase JS Client | P1 |
| I-9 | Admin → Local files | Admin UI | Local /uploads/ | File protocol | P1 |
| I-10 | Queue optimizer → DB | Scheduler | queue_entries | Supabase JS Client | P1 |
| I-11 | Auth middleware | Next.js | All routes | JWT / Cookies | P0 |
| I-12 | Health monitor → DB | Sync service | kiosk_stations | Supabase JS Client | P2 |

---

## 2. Development Phases (Implementation Order)

### Phase A — Foundation (Week 1-2)

```
Step A1: Project Setup
  ├── Initialize Next.js 14+ with App Router
  ├── Configure Tailwind CSS with design tokens
  ├── Set up Supabase project (database, auth, storage)
  ├── Configure environment variables
  ├── Set up TypeScript types (Supabase generated types)
  └── Install core dependencies

Step A2: Database Setup
  ├── Run all SQL migrations from Phase 2
  ├── Create tables, indexes, triggers
  ├── Set up RLS policies
  ├── Enable realtime on required tables
  ├── Create storage buckets with policies
  ├── Seed test data (services, service_options)
  └── Verify functions (order number, queue number generation)

Step A3: Authentication
  ├── Supabase Auth configuration
  ├── Admin user creation + role assignment
  ├── Next.js middleware for route protection
  ├── Auth context provider
  ├── Login / register pages
  ├── Anonymous session for kiosk
  └── Test auth flows for all user types
```

### Phase B — Core Features (Week 3-4)

```
Step B1: Kiosk Interface
  ├── Kiosk layout (fullscreen, touch-optimized)
  ├── Service selection grid
  ├── File upload component (drag-drop + file picker)
  ├── Service options selector
  ├── Order review + submission
  ├── Queue number display
  ├── Idle screen
  └── Integration test: kiosk → Supabase

Step B2: Online Ordering
  ├── Customer layout (responsive, mobile-first)
  ├── Service catalog page
  ├── Service detail + file upload
  ├── Order review / cart
  ├── Order submission
  ├── Queue number + tracking page
  ├── Realtime status tracking
  └── Integration test: online → Supabase

Step B3: Admin Dashboard (Basic)
  ├── Admin layout (sidebar + topbar)
  ├── Dashboard overview with stats
  ├── Orders list with filters
  ├── Order detail page
  ├── Status change actions
  ├── Realtime order feed
  └── Integration test: admin ← Supabase realtime
```

### Phase C — Advanced Features (Week 5-6)

```
Step C1: File Sync Service
  ├── Node.js sync service project setup
  ├── Realtime listener implementation
  ├── Polling fallback
  ├── File downloader
  ├── File organizer (lifecycle stages)
  ├── Health monitor
  ├── PM2 configuration
  └── Integration test: sync service full cycle

Step C2: Queue Optimization
  ├── Optimizer core (cost functions)
  ├── Queue scheduler
  ├── API endpoint for optimization
  ├── Admin queue management UI
  ├── Optimizer config panel
  ├── Priority score display
  └── Integration test: optimization cycle

Step C3: Admin Dashboard (Advanced)
  ├── File preview system
  ├── Analytics page with charts
  ├── Notification system
  ├── Kiosk station monitoring
  ├── Audit log viewer
  ├── Service management CRUD
  └── Settings page
```

### Phase D — Polish & Deploy (Week 7-8)

```
Step D1: Lifecycle & Cleanup
  ├── Lifecycle manager implementation
  ├── Auto-archive completed orders
  ├── Auto-delete expired archives
  ├── Supabase Storage cleanup
  ├── Temp file cleanup
  └── Test full lifecycle

Step D2: Polish
  ├── Loading states and skeletons
  ├── Error boundaries and error pages
  ├── Toast notifications
  ├── Animations and transitions
  ├── Accessibility audit
  ├── Mobile responsiveness testing
  └── Performance optimization

Step D3: Deployment
  ├── Vercel deployment (or self-hosted)
  ├── Supabase production project
  ├── Kiosk PC setup (Chrome kiosk mode)
  ├── PM2 sync service deployment
  ├── Environment configuration
  ├── SSL / domain setup
  └── Smoke tests in production
```

---

## 3. Testing Strategy

### 3.1 Testing Layers

```
┌─────────────────────────────────────────┐
│           TESTING PYRAMID               │
│                                         │
│              /\                         │
│             /  \     E2E Tests          │
│            / E2E\    (Playwright)       │
│           /──────\                      │
│          /        \  Integration Tests  │
│         / Integr.  \ (Vitest + Supabase)│
│        /────────────\                   │
│       /              \ Unit Tests       │
│      /    Unit Tests  \(Vitest)         │
│     /──────────────────\                │
│    /                    \               │
│   /    Component Tests   \ (Testing     │
│  /    (React Testing Lib) \ Library)    │
│ /────────────────────────────\          │
└─────────────────────────────────────────┘
```

### 3.2 Unit Tests

| Module | Test File | What to Test |
|--------|-----------|--------------|
| Queue Optimizer | `queue/optimizer.test.ts` | Priority calculations, edge cases |
| Cost Functions | `queue/cost-functions.test.ts` | Exponential waiting, rush decay |
| Order Service | `services/order-service.test.ts` | Price calculation, validation |
| File Service | `services/file-service.test.ts` | Path generation, type validation |
| Format Utils | `utils/format.test.ts` | Date, currency, file size formatters |
| Validation | `utils/validation.test.ts` | Zod schema edge cases |

**Example: Queue Optimizer Unit Test**

```typescript
// lib/queue/__tests__/optimizer.test.ts
import { describe, it, expect } from 'vitest'
import { QueueOptimizer } from '../optimizer'

describe('QueueOptimizer', () => {
  const optimizer = new QueueOptimizer()

  describe('waitingCost', () => {
    it('returns 0 for 0 wait time', () => {
      // C_wait(0) = α · (e^(β·0) - 1) = 1 · (1 - 1) = 0
      const orders = [mockOrder({ currentWaitMinutes: 0 })]
      const result = optimizer.optimize(orders)
      expect(result.queue[0].components.waitCost).toBe(0)
    })

    it('increases exponentially with wait time', () => {
      const order5min = mockOrder({ currentWaitMinutes: 5 })
      const order30min = mockOrder({ currentWaitMinutes: 30 })
      const order60min = mockOrder({ currentWaitMinutes: 60 })

      const r5 = optimizer.optimize([order5min])
      const r30 = optimizer.optimize([order30min])
      const r60 = optimizer.optimize([order60min])

      // 60min cost should be MUCH more than 2x the 30min cost
      const ratio = r60.queue[0].components.waitCost /
                    r30.queue[0].components.waitCost
      expect(ratio).toBeGreaterThan(5)
    })
  })

  describe('rush priority', () => {
    it('rush orders rank higher than non-rush', () => {
      const orders = [
        mockOrder({ id: 'normal', isRush: false, currentWaitMinutes: 5 }),
        mockOrder({ id: 'rush', isRush: true, currentWaitMinutes: 5 })
      ]
      const result = optimizer.optimize(orders)
      expect(result.queue[0].orderId).toBe('rush')
    })

    it('long-waiting non-rush eventually beats new rush', () => {
      const orders = [
        mockOrder({ id: 'old', isRush: false, currentWaitMinutes: 90 }),
        mockOrder({ id: 'rush', isRush: true, currentWaitMinutes: 1 })
      ]
      const result = optimizer.optimize(orders)
      // After 90min, exponential wait cost should surpass rush bonus
      expect(result.queue[0].orderId).toBe('old')
    })
  })

  describe('duration efficiency', () => {
    it('shorter jobs get higher duration scores', () => {
      const orders = [
        mockOrder({ id: 'short', estimatedDurationMinutes: 3 }),
        mockOrder({ id: 'long', estimatedDurationMinutes: 15 })
      ]
      const result = optimizer.optimize(orders)
      const short = result.queue.find(q => q.orderId === 'short')!
      const long = result.queue.find(q => q.orderId === 'long')!
      expect(short.components.durationScore)
        .toBeGreaterThan(long.components.durationScore)
    })
  })

  describe('full optimization', () => {
    it('handles empty queue', () => {
      const result = optimizer.optimize([])
      expect(result.queue).toHaveLength(0)
      expect(result.metrics.totalOrders).toBe(0)
    })

    it('assigns sequential positions', () => {
      const orders = Array.from({ length: 5 }, (_, i) =>
        mockOrder({ id: `order-${i}` })
      )
      const result = optimizer.optimize(orders)
      const positions = result.queue.map(q => q.position)
      expect(positions).toEqual([1, 2, 3, 4, 5])
    })
  })
})
```

---

### 3.3 Integration Tests

| Test Suite | What to Test |
|------------|--------------|
| Order Creation Flow | Create order → verify DB record + queue entry + file linkage |
| Status Transitions | Pending → Processing → Completed with audit trail |
| File Upload Flow | Upload → verify Storage + order_files record + metadata |
| Sync Service | New order → realtime detection → file download → local save |
| Queue Optimization | Insert orders → run optimizer → verify position updates |
| Auth & RLS | Customer can't see other orders, admin sees all |
| Realtime | Status change → verify WebSocket broadcast received |

**Example: Order Creation Integration Test**

```typescript
// __tests__/integration/order-creation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

describe('Order Creation Flow', () => {
  let supabase: any
  let testOrderId: string

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  })

  it('creates order with auto-generated order number', async () => {
    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        source: 'online',
        service_id: testServiceId,
        customer_name: 'Test User',
        service_options: { paper_size: 'A4', copies: 1 }
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(order.order_number).toMatch(/^ORD-\d{8}-\d{3}$/)
    expect(order.status).toBe('pending')
    testOrderId = order.id
  })

  it('auto-creates queue entry with sequential number', async () => {
    const { data: queue } = await supabase
      .from('queue_entries')
      .select()
      .eq('order_id', testOrderId)
      .single()

    expect(queue).not.toBeNull()
    expect(queue.queue_number).toBeGreaterThan(0)
    expect(queue.status).toBe('waiting')
  })

  it('enforces valid status transitions', async () => {
    // Can't go directly from pending to completed
    const { error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', testOrderId)

    // Should either error or we validate in application layer
  })

  afterAll(async () => {
    // Cleanup test data
    if (testOrderId) {
      await supabase.from('orders').delete().eq('id', testOrderId)
    }
  })
})
```

---

### 3.4 End-to-End Tests (Playwright)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Kiosk Full Flow | Select service → Upload file → Choose options → Submit → See queue # | Order in DB, queue number displayed |
| Online Full Flow | Browse → Upload → Submit → Track | Order created, tracking page shows status |
| Admin Process | Login → See order → Start processing → Complete | Status changes reflected everywhere |
| Realtime Sync | Submit online order → Check admin dashboard | Order appears within 3 seconds |
| Queue Optimizer | Add 5 orders → Trigger optimize → Check positions | Rush orders prioritized, positions updated |
| File Sync | Submit online → Check kiosk local storage | File exists in /pending/ |
| Mobile Responsive | Run online flow on mobile viewport | All elements usable at 375px width |

**Example: E2E Kiosk Flow**

```typescript
// e2e/kiosk-flow.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Kiosk Order Flow', () => {
  test('complete kiosk order submission', async ({ page }) => {
    // Navigate to kiosk
    await page.goto('/kiosk')
    await expect(page.getByText('Select a Service')).toBeVisible()

    // Select Printing service
    await page.getByTestId('service-card-printing').click()
    await expect(page).toHaveURL(/\/kiosk\/service\/printing/)

    // Upload file
    const fileInput = page.getByTestId('file-upload-input')
    await fileInput.setInputFiles('test-fixtures/sample.pdf')
    await expect(page.getByText('sample.pdf')).toBeVisible()

    // Choose options
    await page.getByTestId('option-paper-size').selectOption('A4')
    await page.getByTestId('option-copies').fill('3')
    await page.getByTestId('option-color').click()

    // Proceed to review
    await page.getByTestId('btn-review').click()
    await expect(page.getByText('Order Summary')).toBeVisible()
    await expect(page.getByText('₱15.00')).toBeVisible()

    // Submit order
    await page.getByTestId('btn-submit').click()

    // Verify queue number displayed
    await expect(page.getByTestId('queue-number')).toBeVisible()
    const queueNumber = await page.getByTestId('queue-number').textContent()
    expect(parseInt(queueNumber!)).toBeGreaterThan(0)
  })
})
```

---

## 4. Test Environment Setup

### 4.1 Local Development

```json
// package.json scripts
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "lint": "next lint",
    "type-check": "tsc --noEmit",
    "db:generate-types": "npx supabase gen types typescript --project-id $PROJECT_ID > src/lib/types/database.ts",
    "sync:dev": "tsx src/sync-service/index.ts"
  }
}
```

### 4.2 CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Type Check
        run: npm run type-check

      - name: Lint
        run: npm run lint

      - name: Unit & Integration Tests
        run: npm run test:coverage
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Build
        run: npm run build

      - name: E2E Tests
        run: npx playwright install --with-deps && npm run test:e2e
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

---

## 5. Performance Benchmarks

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Page load (kiosk) | < 1.5s | Lighthouse / Web Vitals |
| Page load (online, mobile) | < 2.5s on 3G | Lighthouse throttled |
| Order submission | < 500ms (excl. upload) | API response time |
| Realtime delivery | < 1s | Timestamp diff (created → received) |
| File sync (10MB) | < 15s | Sync service logs |
| Queue optimization (50 orders) | < 200ms | API response time |
| Admin dashboard render | < 1s | React Profiler |
| File upload (5MB) | < 10s on 4G | Upload progress tracking |

---

## 6. Security Testing Checklist

| Test | Method | Tool |
|------|--------|------|
| RLS policy validation | Attempt cross-user data access | Supabase client with different JWTs |
| Admin route protection | Access /admin without auth | Playwright |
| File upload validation | Upload .exe, oversized files | Manual + automated |
| SQL injection | Inject via search/filter params | OWASP ZAP |
| XSS | Inject scripts in customer notes | Manual + automated |
| CSRF | Verify Supabase token validation | Manual |
| Storage access | Direct URL access to other users' files | Signed URL expiry test |
| Rate limiting | Rapid fire order creation | Load test script |

---

## 7. Deployment Checklist

### Pre-Deployment

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All E2E tests passing
- [ ] Build succeeds without errors
- [ ] Type checking passes
- [ ] Lint rules satisfied
- [ ] Performance benchmarks met
- [ ] Security checklist complete
- [ ] Database migrations reviewed
- [ ] RLS policies verified
- [ ] Environment variables set in production
- [ ] Supabase production project configured
- [ ] Storage buckets created with correct policies
- [ ] SSL certificate configured

### Kiosk PC Setup

- [ ] Node.js 20+ installed
- [ ] PM2 installed globally
- [ ] Sync service deployed and configured
- [ ] `C:\KioskFiles\` directory structure created
- [ ] `sync-config.json` configured
- [ ] PM2 startup configured (auto-boot)
- [ ] Chrome installed and configured for kiosk mode
- [ ] Printer drivers installed and tested
- [ ] Firewall rules: allow outbound HTTPS to Supabase
- [ ] Test full kiosk flow end-to-end

### Post-Deployment Verification

- [ ] Kiosk UI loads in kiosk mode
- [ ] Online ordering works on mobile
- [ ] Admin dashboard receives realtime updates
- [ ] File upload succeeds from all sources
- [ ] Sync service downloads files correctly
- [ ] Queue numbers generate correctly
- [ ] Queue optimizer produces valid results
- [ ] File lifecycle (archive/delete) works
- [ ] Kiosk heartbeat appears in admin

---

## 8. Monitoring & Observability

| What | Tool | Alert Threshold |
|------|------|-----------------|
| Sync service uptime | PM2 + kiosk_stations heartbeat | No heartbeat > 3 min |
| API response times | Vercel Analytics / custom logging | p95 > 2s |
| Error rates | Sentry or Supabase logs | > 5 errors/min |
| Supabase usage | Supabase Dashboard | 80% of plan limits |
| Storage usage | Supabase Dashboard | 80% of storage limit |
| Queue health | Custom: avg wait time metric | Avg wait > 30 min |
| Disk space (kiosk) | Sync service health check | < 5GB free |

---

## 9. Rollback Plan

| Issue | Rollback Action |
|-------|----------------|
| Frontend bug | Revert Vercel deployment to previous version |
| Database migration issue | Run down migration SQL |
| Sync service crash | PM2 auto-restarts; manual: `pm2 restart kiosk-sync` |
| Supabase outage | Kiosk operates on local files; queue paused |
| Data corruption | Restore from Supabase daily backups |
