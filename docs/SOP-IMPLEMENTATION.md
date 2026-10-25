# SOP implementation and verification — 25 October 2026

The SOP updates are implemented in the local JandC app. The owner applied the corrected migration in Supabase. Read-only checks independently confirmed contract version 3, saved policy/pricing, and a working dispatch query. No sample orders were inserted into the live database during verification.

## Owner decisions

- Keep normal administrator sign-in. Do not introduce one-use admin QR credentials or offline admin sessions. The existing sign-in QR is only a link to normal sign-in.
- Automatically synchronize locally buffered print files, payment receipts, and student-ID proofs to this app's existing Supabase project after reconnection. Create their cloud order records idempotently and expire only unpaid counter requests without a submitted receipt.
- GCash/Maya account details are still pending. Online methods stay unavailable until verified account details are configured; screenshot account details are never used.
- Preserve the existing source-preserving PDF/Office editors. The surrounding preview supports derived print margins and selected paper dimensions.

## Implemented behavior

| Area | Behavior and corrections |
| --- | --- |
| Pricing | Actual pages, selected ranges and copies determine an itemized quote. Short/A4/Long/Legal have separate BW, colored accent and image rates. Verified student discounts follow the SOP's 50% coverage thresholds. Finishing is charged once per order and only when configured. Server fingerprints bind the quote to the file bytes and choices. |
| Payment | Wallet receipts require manual administrator approval. Scheduled counter-cash requests require prepayment approval. The customer sees a waiting screen with no released order/queue number until every required payment and student check is approved. Submitted receipts are never cancelled merely because staff take time to review them. |
| Student review | Private ID proof, explicit staff approval/decline, audit history and a hold when declined. No automatic extra charge or refund is made after a decline. |
| Production | Printing → finishing/quality checks → ready for pickup → collected. Active staff capacity is 0–2 and remains independent of the real installed physical printer count. Held requests are excluded from production dispatch and arrival observations. |
| Dispatch | Default walk-ins FIFO followed by scheduled ATC-P. Optional deadline-aware mode protects urgent pickups and long waits. ATC-P uses separate setup and print duration; waiting-order estimates can be adjusted explicitly by staff and are audited. Printer telemetry never silently changes an existing job estimate or bill. |
| Estimates | G/G/c approximation, observed arrival gaps and service timings, provisional variability below 10 samples. The empty-system probability is explicitly an M/M/c benchmark. Finite-backlog completion projections include the configured buffer without adding the statistical wait twice. |
| Collection | Signed pickup QR, QR image decoding, camera/USB scanner inputs, manual identity-check reason, actual cash received, change calculation, and duplicate collection prevention. Archive follows verified collection. |
| Shop policy | Central ONLINE/OFFLINE/CLOSED intake, Manila working days/hours, independent processing capacity, configurable completion buffer, prepayment window and physical uncollected-print retention. Footer and pickup controls use the saved hours. |
| Printers | Installed physical printers and driver-reported capabilities/counts; manually recorded paper/ink observations and maintenance. No fixed six/ten printer count or invented hardware status. |
| Print recovery | Explicit staff confirmation of completed sides and the original Windows job. Only the identified original job is cancelled; remaining sides come from the exact retained spool PDF. Duplex recovery requires an even sheet boundary and compatible target. Retries are deduplicated; uncertain outcomes stop for inspection. |
| Continuity | SQLite WAL/FULL durable buffer, fsynced accepted files/proofs and print claims, stable LAN ticket aliases, reconnect synchronization and visible reconciliation errors. Proof paths match the private receipt reader and hashes detect changed buffered proofs. Normal admin sign-in remains required after reconnection. |
| Retention | Only generated spool snapshots older than 30 days belonging to confirmed closed orders are pruned. Originals, private proofs, transaction receipts, active jobs and uncertain print runs are retained. The 48-hour physical uncollected-print procedure requires explicit staff confirmation. |
| Reports | Daily orders, receipts by payment approval timestamp, printer spool submissions and timing exports. Spool submissions are not represented as hardware-confirmed successful output; unrecorded costs/profit are not fabricated. |

## Verification completed

- `npm test`: **167 passing, 0 failing**. Includes 14 migration/SQL cases, real PDF page analysis and margin/rotation tests, signed QR encode/decode, cash/student/payment holds, recovery replay after a lost commit response, receipt/student-proof synchronization, retention safeguards and mocked partial printer re-routing.
- `npm run lint`: no errors or warnings.
- `npm run build`: successful production build with TypeScript validation. Webpack is the default because the initial Turbopack build stalled in this Windows environment.
- Native Word header integration: 31 pages preserved; only `word/document.xml` changed; only the intended first-page logo pixels changed; all other pages remained identical; no-op save was byte-identical.
- Native Excel integration: formulas recalculated, dates and blank cells saved, merged title/styles/print area/images retained, untouched sheet pixel-identical and no-op save byte-identical.
- Isolated browser checks: customer waiting screen withheld numbers, administrator review required its confirmation checkbox, approval released the customer number, cash collection calculated change and blocked repeats, QR image decoding reached the correct lookup. No real payments were approved.
- Patched PDF browser check: worker and two-page preview loaded without console errors; changing A4 to Long changed the canvas ratio; original header/table text remained available in the PDF editor; editing one cell updated the preview successfully. Browser use was subsequently disabled in Work settings, so the final browser save click could not be repeated. Automated PDF save/layout tests passed.
- Read-only live smoke: customer pages/assets available; protected admin routes redirect to normal sign-in; unauthorized payment/student proof requests return 403; Supabase contract is 3, policy is configured and dispatch can read existing orders.
- Recovery worker was observed connected with zero pending requests and no synchronization error after a transient DNS failure recovered.
- Security updates: Next.js/eslint-config-next 16.4.3, pdfjs-dist 6.4.299, sharp 0.35.5 and Zod 4.6.6, plus compatible transitive patches. The unused SuperDoc package was removed to resolve its obsolete PDF.js peer requirement. **npm audit reports zero known vulnerabilities** at verification time. Active editor implementation remains unchanged.

Verification artifacts are in `output/sop-*.log`, `output/sop-live-smoke.json`, `output/sop-collection-browser-check.png`, and the existing editor integration output folders. Repeat the app smoke check with `node scripts/sop-live-smoke.integration.mjs` while the app is running.

## Activation and practical limits

- Migration: `app/supabase/migrations/20261025_sop_operations.sql`. The payment-hold predicate uses an explicit composite/table alias and CASE expression after the SQL Editor reported a syntax error in the earlier predicate. The whole migration is transactional and repeatable.
- The app runs locally at `http://127.0.0.1:3100/order`; staff use `/login?redirect=/admin`.
- Verified e-wallet account names/numbers must still be supplied by the owner. Configure `PAYMENT_GCASH_NAME`, `PAYMENT_GCASH_NUMBER`, `PAYMENT_MAYA_NAME`, and `PAYMENT_MAYA_NUMBER` only with confirmed shop details, then restart.
- Physical printing, real jams/re-routing, camera hardware, power-loss/UPS switching and driver ink sensors were not exercised. Mocked printer tests do not certify hardware behavior. Staff must inspect actual output and never automatically resend an uncertain print.
- PDF color/coverage classification and queue timings are estimates. Unsupported content must be reviewed; formatting preservation tests cannot guarantee every arbitrary document. Office rendering still depends on the local installed Office/conversion engine.
- No new offline administrator authentication, automatic financial approval, historical payment backfill, silent telemetry-based recalibration, fabricated operational data, or claim of formal ISO compliance was introduced.

Security references checked: [Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [PDF.js advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j), and the local npm audit reports.
