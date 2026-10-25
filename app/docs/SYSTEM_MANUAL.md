> Queue update (2026-09-29): the G/G/c model, deadline dispatch, rollout requirements, and current limits are documented in [QUEUE_THEORY_APPLICATION.md](QUEUE_THEORY_APPLICATION.md). That document supersedes older queue descriptions below.

# PrintHub Kiosk System Manual

## 1. Complete App Description

PrintHub is a complete web-based kiosk and online ordering system for printing and digital services. It is designed for a print shop where customers can submit print jobs through a web app, while administrators manage the queue, monitor orders, and track available hardware such as printers and computers.

The application has three main areas:

- Public landing page: entry point for kiosk mode, online ordering, and admin login.
- Customer ordering system: service selection, file upload, print configuration, preview, submission, and order tracking.
- Admin management system: dashboard, orders, queue management, services, customers, hardware status, failover events, and notifications.

The system replaces manual paper-based queueing with a digital queue. Customers submit files and specifications online, and the system stores order data in Supabase. Admins see the submitted orders in realtime and process them through the admin panel.

The app also includes a queue model. Instead of using nonlinear priority optimization, the system now uses:

- FCFS, or First Come, First Served, as the default ordering rule.
- M/G/1 queueing model for queue telemetry and wait-time estimation.

This means the system keeps a fair order sequence by arrival, while still calculating useful operational metrics such as utilization, average wait time, and overload status.

## 2. Main System Functions

### 2.1 Customer Ordering Function

The customer ordering function allows customers to create an order without going directly to the counter first.

How it works:

1. The customer opens the web app.
2. The customer selects a service such as printing, ID picture, document editing, or photo editing.
3. The customer uploads supported files.
4. The app checks whether each file type is allowed.
5. The customer chooses print settings such as paper size, color, copies, and back-to-back printing.
6. The app shows a preview or file summary.
7. The app calculates an estimated queue wait using current queue data.
8. The customer submits the order.
9. The system saves the order, files, queue entry, and print job assignment.
10. The customer receives an order number and tracking screen.

The customer does not need to manually message the shop or physically line up just to submit files. The system handles submission, queue placement, and tracking.

### 2.2 File Upload And Validation Function

The upload function controls what files customers can submit.

Allowed file types:

- `.pdf`
- `.docx`
- `.xlsx`
- `.pptx`
- `.jpeg`
- `.jpg`
- `.png`

How it works:

1. The customer selects files from their device.
2. The browser checks the file extensions.
3. Invalid files are rejected.
4. Valid files are stored temporarily in the browser flow.
5. On order submission, files are uploaded to Supabase Storage or saved locally for kiosk mode.
6. Each file is recorded in the `order_files` table.
7. The system classifies each file as `document` or `image`.

This prevents unsupported files such as `.txt`, `.exe`, `.gif`, or `.webp` from entering the print workflow.

### 2.3 Print Configuration Function

The print configuration function records the customer print requirements.

Supported paper sizes:

- `A4`
- `Short`
- `Long`

Supported print color modes:

- `B&W`
- `Colored`

How it works:

1. Service options are loaded from Supabase or demo defaults.
2. The customer selects paper size and print color.
3. The app stores the choices inside the order draft.
4. The preview changes based on paper size and color mode.
5. When submitted, the selected options are saved in the order's `service_options` field.

These specifications are visible to the admin so the print job can be processed correctly.

### 2.4 Preview And Editing Function

The preview function helps customers check their file before final submission.

How it works:

1. The uploaded file is displayed as a preview or file summary.
2. The preview reflects selected paper size.
3. If `B&W` is selected, the preview visually reflects black-and-white output.
4. Supported images and documents can be edited in-app.
5. Edited files replace the original staged file before submission.

This reduces mistakes such as wrong orientation, wrong color mode, or wrong file version.

### 2.5 Queue Telemetry Function

The queue telemetry function estimates how busy the system is.

How it works:

1. The system counts recent order arrivals.
2. The system checks active queue length.
3. The system estimates service time using completed orders or fallback service duration.
4. The M/G/1 queue model computes utilization and wait metrics.
5. The customer sees a queue estimate before placing the order.
6. The admin sees utilization and queue load in the dashboard.

If utilization is below 1, the system may show an estimated wait time.

If utilization is 1 or higher, the system treats the queue as overloaded and avoids giving an exact wait promise.

### 2.6 Order Submission Function

The order submission function is the main transaction that creates the order.

How it works:

1. The app sends customer details, service details, selected options, total price, and files to a server action.
2. The server creates a row in `orders`.
3. The server uploads or stores the files.
4. The server creates rows in `order_files`.
5. The server creates a row in `queue_entries`.
6. The server assigns the job to an available printer if possible.
7. The app returns the order number, queue number, and wait estimate.
8. The customer is redirected to the queue tracking screen.

The server action uses the Supabase service role where needed so RLS does not block internal system operations.

### 2.7 Customer Tracking Function

The tracking function lets customers monitor the order after submission.

How it works:

1. The app stores the submitted order ID in the local ticket.
2. The tracking page loads the current order status.
3. The page subscribes to realtime updates for the order and queue entry.
4. The displayed wait estimate updates when data changes.
5. When the order status becomes `completed`, the app shows a completion message.
6. If browser notifications are allowed, the app also sends a browser notification.

This lets customers wait elsewhere and return only when the print job is ready.

### 2.8 Admin Dashboard Function

The dashboard gives admins a quick overview of system activity.

How it works:

1. The admin opens `/admin`.
2. Middleware checks if the user is logged in.
3. Middleware checks if the user's profile role is `admin`.
4. The dashboard loads order data through protected server actions.
5. It shows counts for total, pending, processing, and completed orders.
6. It displays revenue, rush count, and recent queue activity.

The dashboard is an overview screen for daily operations.

### 2.9 Admin Orders Function

The orders function lets admins view and update submitted jobs.

How it works:

1. The admin opens the Orders page.
2. The system loads order records from the server.
3. Each row displays customer, source, status, files, and queue number.
4. The admin can change order status.
5. Status changes update the database.
6. Queue entries and job assignments are updated based on the new status.

For example:

- Setting an order to `processing` marks the queue entry as serving.
- Setting an order to `completed` marks the queue entry as served and completes the print assignment.
- Cancelling or failing an order marks the queue entry as cancelled.

### 2.10 Admin Queue Management Function

The queue page focuses on active orders.

How it works:

1. The system loads active orders with status `pending`, `queued`, or `processing`.
2. The queue is displayed in FCFS order by default.
3. Admins can sort or filter the visible queue.
4. Admins can manually process or complete a job.
5. The M/G/1 telemetry card shows current utilization.
6. New orders trigger realtime refresh and toast alerts.

The admin can manually choose work, but the default mathematical queue basis remains FCFS plus M/G/1 telemetry.

### 2.11 Admin Notification Function

The notification function alerts admins about new activity.

How it works:

1. The Bell button in the admin header loads recent notifications.
2. Notifications include recent orders and hardware failover events.
3. The unread badge shows how many notifications have not been marked read.
4. Clicking the Bell opens the notification panel.
5. Admins can refresh notifications or mark all as read.
6. Realtime subscriptions listen for new orders and failover events.
7. If browser permission is granted, the app can show browser notifications.

This helps admins notice new orders without constantly refreshing the page.

### 2.12 Hardware Telemetry Function

The hardware telemetry function monitors shop devices.

How it works:

1. A Windows bridge script runs on the shop computer.
2. The script checks local computer and printer status.
3. It sends heartbeat data to `/api/hardware/heartbeat`.
4. The API records device state in `hardware_devices`.
5. The admin Hardware page displays device status.

Device statuses include:

- `online`
- `offline`
- `error`
- `busy`

### 2.13 Automatic Failover Function

The failover function handles device failure.

How it works:

1. A device reports `offline` or `error`.
2. The system checks if any pending or assigned jobs are linked to that device.
3. The system searches for another compatible online printer.
4. If another printer is found, the job is reassigned.
5. A failover event is saved.
6. If no device is available, the job remains unassigned for admin action.

This prevents one printer failure from stopping the entire queue when another printer is available.

### 2.14 Authentication And Role Function

Authentication is handled by Supabase Auth.

How it works:

1. Users register or log in through Supabase Auth.
2. User profile data is stored in the `profiles` table.
3. Admin access requires `role = 'admin'`.
4. Middleware blocks non-admin users from `/admin`.
5. Server actions also re-check admin role before returning protected data.

This protects admin operations from regular customer accounts.

### 2.15 Supabase Data Sync Function

Supabase stores and syncs system data.

Main database tables:

- `profiles`
- `services`
- `service_options`
- `orders`
- `order_files`
- `queue_entries`
- `hardware_devices`
- `print_job_assignments`
- `failover_events`

How it works:

1. Customer and admin actions create or update rows in Supabase.
2. Server actions use Supabase Admin client for protected internal operations.
3. Realtime subscriptions notify pages when important data changes.
4. Pages reload fresh data from server actions.

This is why orders can appear in the admin panel after customers submit them.

## 3. System Overview

The system uses:

- Next.js web application for customer, kiosk, and admin interfaces.
- Supabase for authentication, database, storage, and realtime updates.
- M/G/1 queueing model for queue telemetry and wait-time estimation.
- FCFS ordering as the default queue rule.
- Windows hardware bridge for printer/computer heartbeat reporting.

## 4. Main User Roles

### Customer

Customers access the system through the online order page or kiosk page. They can:

- Select a service.
- Upload supported files.
- Configure print settings.
- Preview uploaded files.
- Submit an order.
- Track queue and order status.
- Receive completion notifications.

### Admin or Moderator

Admins access the admin panel after login. They can:

- View all orders.
- Manage active queue items.
- Change order status.
- Sort and filter queue records.
- Monitor hardware devices.
- View failover events.
- Receive order and failover notifications.

### Hardware Bridge

The Windows hardware bridge runs on the kiosk/shop computer. It reports printer and computer status to Supabase through the app API.

## 5. Customer Workflow

### Step 1: Open The Web App

Customers open:

- `/order` for online ordering.
- `/kiosk` for local kiosk mode.

The system is web-centric. Customers submit files directly through the web app.

### Step 2: Select A Service

Available services include:

- Printing
- ID Picture
- Document Editing
- Photo Editing

The customer selects a service and proceeds to the configuration screen.

### Step 3: Upload Files

Allowed file formats:

- Documents: `.pdf`, `.docx`, `.xlsx`, `.pptx`
- Images: `.jpeg`, `.jpg`, `.png`

Invalid files are rejected before submission.

### Step 4: Configure Print Settings

For printing jobs, supported settings include:

- Paper Size: `A4`, `Short`, `Long`
- Print Color: `B&W`, `Colored`
- Copies
- Back-to-back option when available

The system classifies uploaded files as:

- `document`
- `image`

### Step 5: Preview And Edit

The app shows a preview that reflects paper size and color mode. Supported editing flows allow users to adjust files before submission.

### Step 6: Queue Estimate

Before submitting, the customer sees queue telemetry based on the current queue and M/G/1 model.

If utilization is below 1, the system can show a wait estimate.

If utilization is 1 or higher, the system warns that the queue is overloaded and avoids giving an exact wait promise.

### Step 7: Submit Order

After submission:

- An order row is created.
- Files are uploaded or saved locally depending on source.
- A queue entry is created.
- A print job assignment is attempted.
- The customer is sent to the tracking page.

### Step 8: Track Order

Customers can track:

- Order number
- Queue number
- Estimated wait
- Order status
- Completion status

When the order is completed, the app shows an in-app notification. Browser notifications are shown if permission is granted.

## 6. Admin Workflow

### Login

Admins log in at:

`/login?redirect=/admin`

Only users with `profiles.role = 'admin'` can access admin routes.

### Dashboard

The dashboard shows a summary of:

- Total orders
- Pending orders
- Processing orders
- Completed orders
- Revenue
- Recent queue activity

### Orders Page

The orders page shows order records with:

- Order number
- Customer name
- Source
- Date
- Status
- Attached files
- Queue number

Admins can update order status from the table.

Common statuses:

- `pending`
- `queued`
- `processing`
- `completed`
- `cancelled`
- `failed`

### Queue Page

The queue page focuses on active work:

- Pending orders
- Queued orders
- Processing orders

Admins can:

- Sort by arrival time, files, pages, paper size, or color mode.
- Filter by status.
- Mark an order as processing.
- Mark an order as completed.
- View utilization and average wait.

The default queue behavior is FCFS, based on queue number and arrival time.

### Hardware Page

The hardware page shows:

- Registered devices
- Online/busy devices
- Offline/error devices
- Recent failover events

Device types:

- `printer`
- `computer`
- `kiosk_terminal`

Device statuses:

- `online`
- `offline`
- `error`
- `busy`

### Notification Bell

The admin header Bell shows:

- Recent order notifications
- Failover notifications
- Unread count
- Refresh button
- Mark all read button

Clicking the Bell may ask for browser notification permission. If allowed, new order/failover events can trigger browser notifications.

## 7. Queue Model

The system uses an M/G/1 queue model for telemetry.

M/G/1 means:

- `M`: arrivals are modeled as random/Poisson-like arrivals.
- `G`: service time can follow a general distribution.
- `1`: one main service channel is modeled.

The system computes:

- Arrival rate per minute
- Average service time
- Second moment of service time
- Utilization
- Average waiting time in queue
- Average system time
- Average queue length
- System status

Utilization is:

```text
utilization = arrival_rate * average_service_time
```

Status bands:

- `normal`: utilization below 0.70
- `busy`: utilization below 0.90
- `near_capacity`: utilization below 1.00
- `overloaded`: utilization 1.00 or higher

When utilization reaches or exceeds 1, the system treats the queue as overloaded. In that case, exact waiting-time promises are unreliable, so the app shows overload messaging instead.

## 8. FCFS Queue Rule

The default processing order is FCFS:

```text
First Come, First Served
```

The system orders the queue by:

1. Queue number
2. Created time

Admins can still manually process or complete orders, but the mathematical model remains M/G/1 telemetry plus FCFS ordering. The old nonlinear priority model is no longer used for ordering.

## 9. Hardware Telemetry And Failover

### Hardware Bridge

Run the hardware bridge on the Windows kiosk/shop computer:

```bash
npm run bridge:hardware
```

The bridge reports:

- Computer heartbeat
- Printer names
- Printer status
- Error/offline state

The bridge sends data to:

```text
/api/hardware/heartbeat
```

### Failover Behavior

When a device goes offline or enters error status:

1. The system finds pending or assigned jobs on the failed device.
2. It searches for the first compatible online enabled printer.
3. If found, the job is reassigned.
4. A failover event is recorded.
5. If no compatible device exists, the job remains unassigned for admin action.

## 10. Supabase Requirements

Required Supabase features:

- Auth
- Database
- Storage
- Realtime

Important tables:

- `profiles`
- `services`
- `service_options`
- `orders`
- `order_files`
- `queue_entries`
- `hardware_devices`
- `print_job_assignments`
- `failover_events`

Admin access requires:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'YOUR_EMAIL_HERE';
```

Apply the latest migrations in the Supabase SQL Editor, especially:

- `20260529_mg1_hardware_failover.sql`
- `20260529_profiles_insert_policy.sql`

## 11. Environment Variables

The app expects these in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
KIOSK_DEVICE_TOKEN=
KIOSK_LOCAL_PATH=C:\KioskFiles
```

Do not expose the service role key in frontend code.

## 12. Running The System

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run production build:

```bash
npm run build
```

Run hardware bridge:

```bash
npm run bridge:hardware
```

## 13. Common Issues

### Admin Data Disappears When Changing Tabs

Cause:

Browser-side Supabase reads can fail if auth state or RLS is unstable.

Fix:

Admin reads are now handled through server actions with service-role reads after admin verification.

### `estimated_wait_minutes does not exist`

Cause:

The live Supabase database has not received the M/G/1 migration.

Fix:

Run the migration that adds:

```sql
estimated_wait_minutes
arrival_rate_snapshot
utilization_snapshot
```

The app also has fallback logic for older schemas.

### Email Not Verified

Cause:

Supabase email confirmation is enabled.

Fix:

The user must verify their email before logging in, or email confirmation must be disabled in Supabase Auth settings.

### Profile Creation Error

Cause:

Browser-side profile insert can be blocked by RLS.

Fix:

Profile creation now uses a server action with the service-role client.

### Notification Bell Does Nothing

Cause:

Earlier version only displayed a Bell icon without behavior.

Fix:

The Bell now opens an admin notification panel and can request browser notification permission.

### Hardware Page Shows No Devices

Cause:

The hardware bridge is not running or the hardware tables are not migrated.

Fix:

1. Apply hardware migration.
2. Run `npm run bridge:hardware`.
3. Check `KIOSK_DEVICE_TOKEN` and `NEXT_PUBLIC_APP_URL`.

## 14. Maintenance Checklist

Before demo or deployment:

- Run `npm run build`.
- Confirm Supabase migrations are applied.
- Confirm admin profile role is set.
- Confirm storage bucket exists.
- Confirm Realtime is enabled for required tables.
- Start the hardware bridge on the kiosk PC.
- Test one complete customer order.
- Test admin status update from pending to completed.
- Test notification Bell.
- Test hardware offline/failover behavior if devices are available.

## 15. System Summary

PrintHub uses web-based ordering, FCFS queue processing, M/G/1 queue telemetry, realtime status updates, admin-managed processing, and hardware heartbeat/failover support. Customers get clear upload, preview, ordering, and tracking flows. Admins get operational visibility over orders, queue load, devices, and notifications.
