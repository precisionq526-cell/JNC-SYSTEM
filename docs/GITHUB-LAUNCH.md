# GitHub launch

Repository: https://github.com/precisionq526-cell/JNC-SYSTEM

Launch validation on 25 October 2026: an export of the staged source installed with `npm ci`, passed 167 tests and lint, and completed a production build with no `.env.local` or production credentials. The dependency audit reported zero known vulnerabilities. The publication scan found no credential patterns or private/runtime artifacts in the prepared Git index.

## What is published

Application source, ordered migrations, synthetic tests, shop design assets, the portable print engine with its license, setup instructions and a CI workflow. Production credentials, customer uploads/proofs, SQLite state, generated PDF.js assets, build output, local reports and workstation-specific settings remain excluded.

Keep the repository private if the project or included shop artwork is not intended for public distribution. This setup does not change repository visibility or grant a new software license.

## Before operating a fresh installation

1. Install Node 24.18+ within Node 24 and the Windows printer/Office prerequisites.
2. Run `npm ci` inside `app/`, copy `.env.example` to `.env.local`, then enter the correct Supabase/server configuration locally.
3. Apply only missing Supabase migrations in filename order. Verify `select public.kiosk_data_contract_version();` returns `3`.
4. Use normal sign-in and an explicitly provisioned admin account. There is no default password or offline admin access.
5. Configure real shop hours, rates, staff capacity and installed physical printers. Supply verified wallet details before enabling GCash/Maya.
6. Run tests/lint/build, then `npm run start`. Verify customer pages, admin access protection, a representative PDF/Word/Excel file and actual printer output on the shop PC.
7. Back up the persistent runtime folder and database/storage. The local signing key must survive restarts so existing pickup QR tickets remain verifiable.

## Hosting

The application needs a persistent Node server. Physical Windows printers, Office conversion and local buffer/recovery features require the shop Windows machine. GitHub Pages is static hosting and cannot run these server actions or local hardware integrations. A separate cloud frontend/backend split is not implemented by uploading the repository.

The default start command listens on loopback port 3100. Before LAN/public exposure, configure the binding, trusted origins, HTTPS/reverse proxy and Supabase Auth URLs deliberately. Environment changes require a rebuild when they affect `NEXT_PUBLIC_*` values.

## Automated checks

The `App checks` workflow runs on pushes to `main`, pull requests and manual dispatch. It uses pinned official checkout/setup-node actions, Node 24, Linux/Windows regression checks and a Windows build/audit. Production secrets are unnecessary and must not be added to CI for these checks. Native Office/printer/UPS integration remains a separate local validation.

Before a manual push, run `node scripts/check-repository.mjs` from the repository root after staging the intended files. It checks the exact Git index and reports file paths, never matched secret values. It rejects credential patterns, private/runtime artifacts, customer-document extensions outside an explicit fixture folder and files exceeding GitHub's per-file limit.

## Updates

Pull reviewed commits, install locked dependencies with `npm ci`, apply only new migrations, rebuild and restart during an appropriate operating window. Inspect runtime recovery status before and after a restart. Never delete local SQLite, proofs or print receipts to resolve a sync problem; reconcile the error first.

