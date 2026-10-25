# Phase 3: Frontend UI Structure (Next.js)

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Project Structure

```
src/
├── app/
│   ├── layout.tsx                     # Root layout (providers, fonts, metadata)
│   ├── page.tsx                       # Landing page / redirect
│   ├── globals.css                    # Tailwind + custom styles
│   │
│   ├── (kiosk)/                       # Route group: Kiosk interface
│   │   ├── layout.tsx                 # Fullscreen kiosk layout (no nav)
│   │   └── kiosk/
│   │       ├── page.tsx               # Main kiosk home (service selection)
│   │       ├── service/[slug]/
│   │       │   └── page.tsx           # Service config + file upload
│   │       ├── review/
│   │       │   └── page.tsx           # Order review before submit
│   │       ├── queue/
│   │       │   └── page.tsx           # Queue number display
│   │       └── status/
│   │           └── page.tsx           # Order status tracking
│   │
│   ├── (customer)/                    # Route group: Online ordering
│   │   ├── layout.tsx                 # Responsive layout (header + footer)
│   │   └── order/
│   │       ├── page.tsx               # Service catalog
│   │       ├── [slug]/
│   │       │   └── page.tsx           # Service detail + file upload
│   │       ├── cart/
│   │       │   └── page.tsx           # Order review / cart
│   │       ├── track/
│   │       │   └── page.tsx           # Order tracking page
│   │       └── track/[orderId]/
│   │           └── page.tsx           # Individual order status
│   │
│   ├── (admin)/                       # Route group: Admin dashboard
│   │   ├── layout.tsx                 # Dashboard layout (sidebar + topbar)
│   │   └── admin/
│   │       ├── page.tsx               # Dashboard overview
│   │       ├── orders/
│   │       │   ├── page.tsx           # All orders list
│   │       │   └── [id]/
│   │       │       └── page.tsx       # Order detail + processing
│   │       ├── queue/
│   │       │   └── page.tsx           # Queue management + optimizer
│   │       ├── analytics/
│   │       │   └── page.tsx           # Reports and stats
│   │       ├── services/
│   │       │   └── page.tsx           # Manage services + options
│   │       ├── kiosks/
│   │       │   └── page.tsx           # Kiosk station management
│   │       └── settings/
│   │           └── page.tsx           # System settings
│   │
│   ├── (auth)/                        # Route group: Auth pages
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── register/
│   │       └── page.tsx
│   │
│   └── api/                           # API routes
│       ├── orders/
│       │   ├── route.ts               # GET all, POST create
│       │   └── [id]/
│       │       └── route.ts           # GET one, PATCH update
│       ├── queue/
│       │   ├── route.ts               # GET queue, POST optimize
│       │   └── optimize/
│       │       └── route.ts           # POST run optimizer
│       ├── files/
│       │   ├── upload/
│       │   │   └── route.ts           # POST upload file
│       │   └── download/
│       │       └── route.ts           # GET download file
│       ├── sync/
│       │   └── route.ts               # GET pending files for sync
│       └── webhooks/
│           └── route.ts               # External webhooks
│
├── components/
│   ├── ui/                            # Reusable base components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── modal.tsx
│   │   ├── badge.tsx
│   │   ├── progress.tsx
│   │   ├── skeleton.tsx
│   │   ├── toast.tsx
│   │   ├── file-upload.tsx
│   │   └── data-table.tsx
│   │
│   ├── kiosk/                         # Kiosk-specific components
│   │   ├── service-grid.tsx           # Big touch-friendly service cards
│   │   ├── file-uploader.tsx          # USB + drag-drop upload
│   │   ├── option-selector.tsx        # Touch-friendly option picker
│   │   ├── queue-display.tsx          # Large queue number display
│   │   ├── idle-screen.tsx            # Screensaver / attract screen
│   │   └── keyboard.tsx              # On-screen keyboard
│   │
│   ├── order/                         # Online ordering components
│   │   ├── service-card.tsx
│   │   ├── service-detail.tsx
│   │   ├── file-dropzone.tsx
│   │   ├── order-summary.tsx
│   │   ├── order-tracker.tsx
│   │   └── status-badge.tsx
│   │
│   ├── admin/                         # Admin dashboard components
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   ├── order-table.tsx
│   │   ├── order-detail-panel.tsx
│   │   ├── queue-board.tsx            # Kanban-style queue view
│   │   ├── file-preview.tsx
│   │   ├── stats-card.tsx
│   │   ├── analytics-chart.tsx
│   │   └── realtime-indicator.tsx
│   │
│   └── shared/                        # Shared across interfaces
│       ├── logo.tsx
│       ├── theme-provider.tsx
│       ├── loading-spinner.tsx
│       └── error-boundary.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  # Browser Supabase client
│   │   ├── server.ts                  # Server-side Supabase client
│   │   ├── middleware.ts              # Auth middleware helper
│   │   └── admin.ts                   # Service role client (server only)
│   │
│   ├── hooks/
│   │   ├── use-orders.ts              # Order CRUD + realtime
│   │   ├── use-queue.ts               # Queue state + realtime
│   │   ├── use-file-upload.ts         # File upload with progress
│   │   ├── use-realtime.ts            # Generic realtime subscription
│   │   └── use-auth.ts               # Auth state hook
│   │
│   ├── services/
│   │   ├── order-service.ts           # Order business logic
│   │   ├── queue-service.ts           # Queue management logic
│   │   ├── file-service.ts            # File upload/download logic
│   │   └── analytics-service.ts       # Stats computation
│   │
│   ├── queue/
│   │   ├── optimizer.ts               # Nonlinear queue optimization
│   │   ├── cost-functions.ts          # Penalty/cost calculations
│   │   └── scheduler.ts              # Queue scheduling engine
│   │
│   ├── utils/
│   │   ├── format.ts                  # Date, currency, file size formatters
│   │   ├── validation.ts              # Input validation schemas (Zod)
│   │   └── constants.ts              # App-wide constants
│   │
│   └── types/
│       ├── database.ts                # Supabase generated types
│       ├── order.ts                   # Order-related types
│       ├── queue.ts                   # Queue-related types
│       └── service.ts                # Service-related types
│
├── middleware.ts                       # Next.js middleware (auth protection)
└── tailwind.config.ts                 # Tailwind configuration
```

---

## 2. Page Layouts

### 2.1 Kiosk Layout — `(kiosk)/layout.tsx`

```
┌─────────────────────────────────────────────┐
│  FULLSCREEN — NO BROWSER CHROME             │
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │          HEADER BAR (minimal)           ││
│  │  Logo    Current Time    Queue Count    ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │                                         ││
│  │          MAIN CONTENT AREA              ││
│  │         (full height, touch)            ││
│  │                                         ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │  FOOTER: Back | Home | Help             ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

- Large touch targets (min 48px)
- High contrast colors
- Big fonts (18px+ base)
- No scrolling where possible
- Idle screen after 60s inactivity

### 2.2 Online Ordering Layout — `(customer)/layout.tsx`

```
Mobile (< 768px)             Desktop (≥ 1024px)
┌──────────────┐             ┌──────────────────────────┐
│  ☰  Logo     │             │  Logo   Services   Track │
├──────────────┤             ├──────────────────────────┤
│              │             │                          │
│   Content    │             │       Content            │
│   (scroll)   │             │       (centered max-w)   │
│              │             │                          │
├──────────────┤             ├──────────────────────────┤
│  Nav  Nav    │             │       Footer             │
└──────────────┘             └──────────────────────────┘
```

- Mobile-first responsive
- Bottom nav on mobile
- Top nav on desktop
- Max content width: 1280px

### 2.3 Admin Dashboard Layout — `(admin)/layout.tsx`

```
┌────┬───────────────────────────────────────┐
│    │  Topbar: Search | Notifications | User│
│ S  ├───────────────────────────────────────┤
│ I  │                                       │
│ D  │         Main Content Area             │
│ E  │                                       │
│ B  │   ┌──────────┐  ┌──────────┐         │
│ A  │   │ Widget 1 │  │ Widget 2 │         │
│ R  │   └──────────┘  └──────────┘         │
│    │                                       │
│ □  │   ┌───────────────────────────┐       │
│ □  │   │     Data Table            │       │
│ □  │   │                           │       │
│ □  │   └───────────────────────────┘       │
└────┴───────────────────────────────────────┘
```

- Collapsible sidebar
- Responsive: sidebar → bottom sheet on tablet
- Dark mode support
- Realtime notification badges

---

## 3. Key Screen Designs

### 3.1 Kiosk Home Screen

```
┌─────────────────────────────────────────┐
│           Welcome to PrintHub           │
│         Select a Service Below          │
│                                         │
│  ┌─────────┐  ┌─────────┐              │
│  │  🖨️     │  │  📷     │              │
│  │         │  │         │              │
│  │Printing │  │ID Photo │              │
│  │  ₱5+    │  │  ₱50    │              │
│  └─────────┘  └─────────┘              │
│                                         │
│  ┌─────────┐  ┌─────────┐              │
│  │  📝     │  │  🎨     │              │
│  │         │  │         │              │
│  │Doc Edit │  │Photo Ed │              │
│  │  ₱30    │  │  ₱40    │              │
│  └─────────┘  └─────────┘              │
│                                         │
│  [          View My Queue          ]    │
└─────────────────────────────────────────┘
```

### 3.2 Admin Dashboard Home

```
┌─────────────────────────────────────────────┐
│ Stats Row:                                  │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ │ 24   │ │ 8    │ │ 3    │ │ 13   │        │
│ │Total │ │Pend  │ │Proc  │ │Done  │        │
│ └──────┘ └──────┘ └──────┘ └──────┘        │
│                                             │
│ ┌─── Queue Board (Kanban) ─────────────────┐│
│ │ Pending    │ Processing  │ Completed     ││
│ │ ┌───────┐  │ ┌───────┐   │ ┌───────┐    ││
│ │ │ORD-001│  │ │ORD-003│   │ │ORD-005│    ││
│ │ │Print  │  │ │ID Pic │   │ │Print  │    ││
│ │ └───────┘  │ └───────┘   │ └───────┘    ││
│ │ ┌───────┐  │             │ ┌───────┐    ││
│ │ │ORD-002│  │             │ │ORD-004│    ││
│ │ └───────┘  │             │ └───────┘    ││
│ └────────────┴─────────────┴──────────────┘│
└─────────────────────────────────────────────┘
```

---

## 4. Component Library Plan

### Base UI Components (built with Tailwind)

| Component | Variants | Used In |
|-----------|----------|---------|
| Button | primary, secondary, ghost, danger, touch-lg | All |
| Card | default, elevated, interactive | All |
| Input | text, number, file, search | All |
| Modal | default, fullscreen (kiosk), sheet (mobile) | All |
| Badge | status colors (pending/processing/completed) | Admin, Order |
| Progress | bar, circular, steps | Upload, Queue |
| Toast | success, error, info | All |
| FileUpload | dropzone, button, USB-detect | Kiosk, Order |
| DataTable | sortable, filterable, paginated | Admin |
| Skeleton | card, table-row, text | All |

### Kiosk-Specific Components

| Component | Purpose |
|-----------|---------|
| ServiceGrid | 2x2 grid of large touch-friendly service cards |
| FileUploader | USB detection + drag-drop + file picker |
| OptionSelector | Large toggle/select controls for service options |
| QueueDisplay | Full-screen queue number with animations |
| IdleScreen | Attract screen with branding |
| OnScreenKeyboard | Virtual keyboard for text input |

---

## 5. State Management

| Scope | Solution |
|-------|----------|
| Server state | React Server Components + Supabase queries |
| Client cache | React Query (TanStack Query) for client-side data |
| Realtime | Supabase Realtime subscriptions → React Query invalidation |
| Form state | React Hook Form + Zod validation |
| UI state | React useState/useReducer (local) |
| Auth state | Supabase Auth context provider |
| File upload | Custom hook with progress tracking |

---

## 6. Design System Tokens (Tailwind Config)

```
Colors:
  primary:    Blue (#2563EB → gradient)
  secondary:  Purple (#7C3AED)
  accent:     Amber (#F59E0B)
  success:    Emerald (#10B981)
  warning:    Orange (#F97316)
  danger:     Rose (#F43F5E)
  surface:    Slate (dark mode support)

Typography:
  Font: Inter (Google Fonts)
  Kiosk base: 18px
  Online base: 16px
  Admin base: 14px

Spacing:
  Kiosk touch targets: min 48px
  Standard padding: 16/24/32px
  
Border Radius:
  Default: 12px (rounded-xl)
  Cards: 16px (rounded-2xl)
  Buttons: 12px (rounded-xl)

Shadows:
  Elevation system: sm/md/lg/xl
  Glass effect for kiosk cards
```
