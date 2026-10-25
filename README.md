# JNC System

Printing orders, payment verification, queue management and counter collection for JandC Internet Cafe and Services.

The customer interface supports file uploads, source-preserving document editing, print previews, itemized page pricing, scheduled pickup and order tracking. The staff dashboard provides payment/student verification, production stages, signed pickup tickets, collection, reports and recovery tools. Operational screens use saved records rather than demonstration orders.

## Requirements

- Node.js **24.18 or newer within Node 24** and npm. Node's built-in SQLite stores the local recovery buffer.
- A Supabase project with Auth, PostgreSQL and private Storage.
- Windows for physical printer discovery, Windows print queues, local Office conversion and printer recovery. Install the required printer drivers and a compatible local Microsoft Office/conversion engine.
- This repository includes the portable SumatraPDF print engine and its license. See [third-party notices](app/THIRD_PARTY_NOTICES.md).

GitHub hosts the source and automated checks. Running the complete app requires a persistent Windows/Node server with its local storage and printers; GitHub Pages cannot run that backend.

## Local setup

```powershell
git clone https://github.com/precisionq526-cell/JNC-SYSTEM.git
cd JNC-SYSTEM/app
npm ci
Copy-Item .env.example .env.local
```

Fill in `.env.local` on the shop server. Keep the service-role key, device token and any administrative credentials out of Git. The example contains placeholders only.

For a **new Supabase project**, apply the files in `app/supabase/migrations/` in filename order using the project's SQL Editor. Supabase migrations require the Supabase-provided Auth/Storage schemas. The latest SOP migration is `20261025_sop_operations.sql`; an existing installation should apply only unapplied migrations. Do not rerun older migrations blindly. Configure Auth URLs for the actual app address and create/promote an administrator through the project's approved account process; there is no default admin password.

```powershell
npm run build
npm run start
```

Open [customer ordering](http://127.0.0.1:3100/order) or [staff sign-in](http://127.0.0.1:3100/login?redirect=/admin). For development, use `npm run dev`. Commands run from `app/`. The supplied launcher is for local development; use the build/start commands for a production process.

## Configuration and operation

- Print files, private proofs, SQLite state and print receipts live outside Git. Back up the persistent runtime folder, including its signed-ticket key, together with the database/storage configuration.
- Staff capacity is independent of physical printer count. Set shop hours, intake, dispatch policy, prices and finishing options in **Admin → Settings**.
- Wallet payments require verified `PAYMENT_GCASH_*` / `PAYMENT_MAYA_*` account details and manual staff approval before ticket release. Leaving account details blank keeps those methods unavailable. Scheduled cash requests also require counter prepayment approval.
- Submitted wallet receipts stay pending until reviewed. Only expired unpaid counter requests without a receipt are eligible for automatic cancellation.
- Reconnection automatically synchronizes accepted buffered files and proofs to the configured Supabase project. Normal admin sign-in remains required; uncertain physical print outcomes require staff inspection.
- The default server binds to `127.0.0.1`. LAN/public hosting requires an explicitly configured host, trusted origin, HTTPS/reverse proxy and authentication/storage configuration. Never put the service-role key in a `NEXT_PUBLIC_*` variable.

See [launch instructions](docs/GITHUB-LAUNCH.md) and the [SOP implementation record](docs/SOP-IMPLEMENTATION.md). The earlier numbered design documents record the initial architecture; the implementation record and current source describe the latest workflow.

## Validation

```powershell
cd app
npm test
npm run lint
npm run build
npm audit
```

The automated tests create synthetic local fixtures and mock printer/payment actions. Native Office, real printer jams, camera hardware and UPS/power-loss behavior require separate shop-PC checks. Live read-only smoke checks are available through `node scripts/sop-live-smoke.integration.mjs` after configuring the environment and starting the app. Do not run account-maintenance or migration utilities against production without reviewing their purpose.

GitHub Actions runs tests/lint on Linux and Windows, plus a Windows production build, without production credentials. No live order, payment approval or physical print is required by CI.

## Repository layout

| Folder | Contents |
| --- | --- |
| `app/src` | Next.js UI, server actions, printing, queue and recovery logic |
| `app/supabase/migrations` | Ordered database migrations |
| `app/scripts` | Tests, local hardware bridges and reviewed maintenance utilities |
| `app/vendor` | Portable print runtime and third-party license texts |
| `docs` | Setup, architecture and verification records |

Customer files, credentials, runtime databases, generated builds and local test output are excluded by `.gitignore`. See [security reporting](SECURITY.md) and [third-party notices](app/THIRD_PARTY_NOTICES.md). No new open-source license is assigned to the application code by this repository setup.

