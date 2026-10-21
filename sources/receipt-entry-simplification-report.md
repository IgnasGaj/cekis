# Receipt entry simplification — 2026-10-21

## Delivered change

Receipt entry now offers camera or one JPEG/PNG/PDF upload action, then a compact three-field review and one save action. JPEG/PNG OCR starts on selection; PDF keeps an explicit manual fallback. Price, currency, receipt number and notes remain under **Daugiau informacijos**. Uncertain product prices and currencies require owner review. The selected or saved original has a small expandable preview. Manual creation also omits warranty controls.

An uploaded receipt can be saved with missing name, seller or purchase date. The database stores empty text and a null date rather than invented OCR values; list/detail screens show **Čekis be pavadinimo** when needed. The existing owned purchase and receipt records remain discoverable and editable. A successful upload remains `ready`, so abandoned-upload cleanup does not remove its original. Manual entry without an attachment still requires its existing minimum fields.

New purchases receive a 24-month duration automatically. When the purchase date is absent, the duration is retained without an end date or expiry reminder. Later date edits calculate the end date with month-end clamping. Saved product details contain the warranty editor (6/12/24/36/custom months or no warranty) and existing reminder controls. Existing fixed dates, warranty states and reminder preferences are preserved. The original receipt opens near the top of saved details through the existing private content route.

## Files and release steps

- Entry/review components and styling: `src/components/receipt-upload.tsx`, `src/components/receipt-review.tsx`, `src/app/globals.css`.
- Purchase, warranty, reminder integration and detail actions: `src/lib/{purchase-validation,purchases,warranty,schema}.ts`, `src/app/api/{purchases,receipts/[id]/review}/route.ts`, `src/app/pirkiniai/[id]/*`.
- Additive schema migration: `drizzle/0012_dazzling_alex_wilder.sql` makes purchase date nullable, permits incomplete receipt-backed metadata and records automatic/manual warranty origin. Existing rows are not backfilled.
- `vite` was pinned to the patched 8.3.5 dev release because the repository's CI `npm audit` gate flagged 8.3.2. No runtime service or credential configuration changed.

Before `main` deploys, run `npm run db:migrate` with the migration-owner URL, then `npm run db:grant` and `npm run db:check-role` for the limited app role. `render.yaml` automatically deploys passing `main` commits, so this migration must precede the merge/push. A code rollback does not reverse the schema migration.

## Verification

- Local disposable PostgreSQL migration test passed, including repeat migration, receipt association and limited-role checks.
- Lint, custom lint rules, typecheck, 61 unit tests, 22 reminder integration tests, 55 Chromium browser tests, production build with disposable test configuration, and both npm audit commands passed.
- Browser checks used Chromium at 390 px and 320 px emulated widths. The save action, expanded preview and validation/error states were inspected. The screenshot is generated under ignored `test-results/`.
- On 2026-10-21, an `age`-encrypted database and object backup was made under `~/.local/share/cekis-beta/backups/2026-10-21T17-42-16-191Z/`. The database dump restored into network-isolated PostgreSQL 18 with 13 public tables, 2 purchases, 1 receipt and 1 link. The encrypted original was decrypted and its SHA-256 matched the source; the restore container was removed. The decryption identity remains in the separate mode-0600 local file.

Physical iPhone/Android camera and keyboard behavior, live tester rerun, and production post-deploy flow remain unverified. The owner's next manual check is photograph/upload → correct only needed fields → save → open the same product/original; then edit its date and warranty and confirm reminder behavior. Record hesitation, correction effort, time to save and retrieval success with the same testers.
