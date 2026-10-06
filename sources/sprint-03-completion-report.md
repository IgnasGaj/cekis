# Sprint 3 completion report — private receipt upload

Date: 2026-10-06. Repository: https://github.com/IgnasGaj/cekis.git. Starting branch: `feature/sprint-02-purchase-vault` at `74ab43cbb89dcac4736777a52c806982bef464c2`. Delivery branch: `feature/sprint-03-private-receipt-upload`. Verified implementation commit: `7ae63d04373cd3575d8b5b69ecf4826d083ba32e`. The delivery tip also contains this report; its full SHA and the matching remote SHA are recorded in the delivery response, since a committed file cannot contain its own Git SHA.

## Implemented

- Authenticated JPEG, PNG and PDF originals are validated, hashed and stored unchanged under opaque keys in a private S3-compatible bucket. Uploads accept one file up to 10 MiB. Images must decode within 6000 pixels per side and 16 million pixels; PDFs must parse in a bounded child process, have 1–50 pages and end with `%%EOF`. HEIC/HEIF is rejected with a Lithuanian alternative. No OCR, warranty entry, reminder or later-sprint feature was added.
- The `+ Čekis` screen offers camera, image, PDF and manual choices. A selected original is previewed locally; the user enters purchase fields before save. Existing purchases accept new uploads or a searchable owned receipt. Detail pages show owned ready receipts, authenticated preview/download, detach and confirmed delete-everywhere actions. The original bytes are returned with private/no-store and nosniff headers.
- Receipt reservations, owner-bound retry keys, cancellation tombstones, composite owner foreign keys, purchase links, leases and cleanup retries are recorded in forward migrations 0004 and 0005. A committed reservation precedes the object write. Owner advisory locks serialize upload retries across instances; transaction locks protect linking, deletion and cleanup. One original may support several purchases; deleting one purchase preserves shared evidence. The bounded cleanup command has a dry run, grace period and durable backoff on storage failure.
- Local and CI storage use a pinned multi-architecture local-s3 image in a test-only bucket. Runtime S3 credentials remain server-side. The limited database role has receipt/link/cancellation DML grants. The image service is for local integration, not production durability or permissions.

## Verification performed

| Area | Command or check | Result |
| --- | --- | --- |
| Install and dependencies | `npm ci` in the isolated browser checkout; `npm audit --audit-level=low`; `npm audit --omit=dev --audit-level=low` | Clean install and zero reported vulnerabilities. |
| Static checks | `npm run lint`; `npm run test:lint-rules`; `npm run typecheck`; `npm test` | Passed; 15 unit tests. |
| Production build | `npm run build` in the source checkout and after clean install in the isolated checkout | Passed; receipt API routes are dynamic. |
| Browser/integration | `npm run test:e2e` against disposable `cekis_test`, Mailpit and real local S3 at port 3101 | Final run passed 20/20. The original auth/purchase tests and Sprint 2 currency constraint and out-of-range pagination tests passed. |
| Migrations and role | Fresh `cekis_sprint3_fresh`, populated Sprint 2 clone `cekis_sprint3_upgrade`, repeated `CEKIS_ENV_FILE=.env.test.local npm run db:migrate`, `db:grant`, `db:check-role` | Six migrations on both isolated databases; populated upgrade retained one user and one purchase; rerun and limited-role check passed. |
| Storage and cleanup | `CEKIS_ENV_FILE=.env.test.local npm run storage:init`; `receipts:cleanup -- --dry-run`; injected failed delete followed by retry | Bucket setup and rerun passed. Cleanup retained retry state after failure, then removed the object and marked the row deleted. Final dry run had zero candidates. |
| Original and access | Real JPEG, PNG and PDF uploads, SHA-256 comparison on download, two email-link accounts, anonymous request, direct S3 GET | Original bytes matched. Other account and anonymous requests were denied; direct anonymous object access returned 403. Known foreign link insertion failed under the limited role. |
| Recovery and races | Concurrent same-key uploads behind a PostgreSQL advisory barrier; changed-content replay; cancellation while upload waited; receipt link versus delete under a row-lock barrier; injected final database failure and replay; missing object; isolated HTTP server with unreachable S3 endpoint | One receipt/link was created for retries; changed content and cancelled key were rejected. Delete left no live link. The committed reservation and object survived the injected finalization failure and replay completed it. Missing object returned an error. Unreachable storage returned HTTP 503, retained one `reserved` row and created no link. |
| Interface | Authenticated add and existing-purchase flows at 320/390 px, purchase/browser history account switch, file preview/download links | Passed in desktop Chromium viewport checks. These are browser simulations, not physical-device camera tests. |

One repeat full-suite run returned two magic-link `Too many requests` responses after several back-to-back runs from the same local IP within Better Auth's database-backed one-minute window. No code or data was reset to mask it. After the window elapsed, the full 20-test suite passed. This is a repeat-run test-environment limit, not an unresolved test failure.

After testing, 46 synthetic Sprint 3 accounts and 56 associated or reserved objects were removed or confirmed absent from the disposable test database and bucket. A check found zero remaining `receipt-...@example.test` accounts and zero `originals/` keys in that test bucket. Other test and local data were preserved.

## Skipped and remaining configuration

- Physical iPhone Safari and Android Chrome tests were unavailable. On each device, check rear-camera capture, gallery selection, PDF picker and preview/download, HEIC rejection and JPEG alternative, cancellation, large text, keyboard overlap, and 320/390 px readability. Viewport emulation does not establish native camera or HEIC behavior.
- No production S3 provider, EU region/bucket policy, backup and restore, cost review, external SMTP delivery or deployment was configured. Before deployment, provision private storage with object-scoped Put/Get/Delete credentials, HTTPS, operational cleanup scheduling and monitoring; verify the host accepts a 10 MiB body plus headers and permits the documented processing time and PDF child process. Local S3 permissions and durability do not prove those production properties.
- The local setup requires Docker or another compatible private S3 service. No real user data was reset.

The next product slice is Sprint 4 OCR with human review. This report records Sprint 3 only.
