# Security

Do not put service-role keys, authentication codes, `.env.local`, runtime databases, customer documents, receipts or student-ID proofs into issues, commits or pull requests.

Report a vulnerability privately to the repository owner or use GitHub private vulnerability reporting when available. Include affected versions and a minimal reproduction made from synthetic files; never attach customer data. If a credential is exposed, revoke/rotate it at its provider before removing it from the repository/history.

Run `npm audit`, tests, lint and a production build before a release. Keep Node and native image/PDF/printer dependencies patched. Supabase service-role credentials must remain on the server, private proof routes must require admin authentication, and public hosting must use HTTPS with explicit trusted origins.

Physical print submission is consequential. Never automatically repeat a print whose Windows outcome is uncertain; inspect the queue and printed output first. Reconnection sync and a QR pickup ticket do not grant administrator access.

