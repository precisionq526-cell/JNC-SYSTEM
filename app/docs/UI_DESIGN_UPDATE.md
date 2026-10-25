# UI design update

The customer flow and six admin screens follow the positions and panel arrangement in the supplied 18-page JandC system design PDF. The PDF is a visual reference; the user's request determines the work.

## Changes

- Kept the navy header and sidebar, red actions, light background, centered customer forms, and admin panel order.
- Standardized font sizes, weights, spacing, borders, buttons, field labels, focus indicators, and mobile layouts.
- Removed the global margin and padding reset that was overriding Tailwind spacing.
- Bundled the existing Poppins font files locally, with their Open Font License, so builds do not need to fetch Google Fonts.
- Left the logo, services poster, and terminal QR image areas empty. User-uploaded document previews remain functional.
- Restored the missing review screens: preview/specifications, transaction choice, scheduled pickup, and confirmation. Moved every hook above the empty-draft return.
- Preserved selected options when returning to the upload page. Added actual drag-and-drop handling and enforced the displayed 200 MB upload limit.
- Updated ticket and tracking layouts, replaced hardcoded customer/date text with ticket details, and added polling for a linked cloud ticket.

## Verification

- Production build passed.
- TypeScript check passed.
- ESLint passed for all changed TypeScript components and the order draft types.
- Checked customer desktop and mobile layouts at 1440 × 900 and 390 × 844.
- Verified a local sample DOCX preview, retained paper size/copies, walk-in confirmation, scheduled confirmation, and pickup validation. Removed the sample draft afterward.
- Checked all six admin layouts and the ticket screen using static renders of the current components with sample data. Removed the temporary public preview pages afterward.

## Scope of verification

Live admin pages require authentication. Admin data, printer operations, analytics, and settings include existing illustrative values/controls; their backend behavior was not verified in this UI task. Scheduled pickup selections are included in order metadata, but payment processing and receipt upload are not implemented by this update. No order was submitted to the cloud during verification.

UI screenshots are in `D:/Kiosk System/output/ui/`. A copy of the source before these edits is in `D:/Kiosk System/tmp/ui-before/src/`.
