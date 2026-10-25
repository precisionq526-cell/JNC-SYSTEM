# JandC UI refresh - 20 October 2026

The 26-page design reference was treated as visual source material. The user's request defines the work.

## Applied design

- Kept the navy and red JandC identity, white panels, service poster, customer order sequence, ticket layout, and admin navigation structure.
- Restored the existing shop logo and services poster, added customer navigation and staff sign-in access, and updated the homepage hierarchy, typography, spacing, and footer.
- Used consistent form controls across upload and review: color choices, two-sided printing, paper size, page selection, and a working copy counter.
- Added an accessible expanded preview using a native modal dialog, including Escape-to-close and focus restoration. Uploaded images and supported documents use the existing preview pipeline.
- Updated tracking with readable statuses, queue ticket and wait information, loading/error/empty states, and repeat searches/retries for the same order number. Ticket links now carry their order number to tracking.
- Added request guarding and error handling to saved-ticket polling so a failed refresh does not cause an unhandled promise rejection.
- Updated admin navigation, order lanes, summary cards, filters, status colors, analytics, settings, and printer styling. Settings now links to the existing services, hardware, and customer management pages.
- Made the database sync details expandable, automatically opening when checks need attention.
- Applied the shared branding to sign-in and registration and repaired the missing page containers and responsive grids on the hardware/customer pages.

## Verification

- `npm run build`: passed. The sandboxed compile stalled; the production build completed outside the sandbox. Existing middleware deprecation and dynamic filesystem tracing warnings remain.

- `npx tsc --noEmit`: passed.
- `npx eslint src`: passed.
- All 92 existing regression tests: passed. These cover database atomicity and authorization, file edits, file sync, print options, scheduling, queue estimates, printer parsing, print receipts, and spooling through isolated fixtures/mocks.
- Browser walkthrough passed: empty-upload validation, real TXT upload/staging, print controls, retained options, edit/save/preview of replacement content, expanded preview, Sunday pickup validation, scheduled/walk-in confirmation, file removal, repeated tracking retry, password visibility, and anonymous admin redirect.
- Eleven actual admin component layouts rendered with explicitly generated sample data at 1440px and 390px. All had no page-level horizontal overflow. Table contents retain horizontal scrolling where needed.
- Customer desktop and mobile screenshots and machine-readable check results are in `output/ui-refresh/` at the workspace root.

## Verification limits

The browser walkthrough uses the real read-only service catalogue but stops before submitting an order. Admin screenshots use local sample data; live admin sessions and physical printer operation were not exercised. No production order, customer account, payment, or physical print job was created by verification.

The GCash/Maya payment-proof screen and theme/logo/poster editing controls depicted in the PDF were not existing implemented features and were not introduced as decorative controls. This refresh retains the current cash/pickup flow and scheduled pickup behavior. Adding online payment collection requires verified shop payment details and a separate payment-recording implementation.

The whole-repository `npm run lint` still reports pre-existing CommonJS lint errors in `rewrite.js`, `rewrite_orders.js`, and `scripts/queue-model.test.cjs`, plus unused-variable warnings in existing bridge/maintenance scripts. The complete application source passes lint.

An isolated print-history test initially failed because its temporary receipt rename was restricted in the filesystem sandbox. It passed outside that sandbox, as did the final complete 92-test run. No printer or database production operation was needed.

A copy of the source before this refresh is in `tmp/ui-refresh-before/src/` at the workspace root. The changed-source inventory is `output/ui-refresh/changed-files.txt`.
