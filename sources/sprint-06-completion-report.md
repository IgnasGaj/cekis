# Sprint 6 completion and verification

Date: 2026-10-07 (Europe/Vilnius). Repository: https://github.com/IgnasGaj/cekis.git. Branch: `feature/sprint-06-warranty-email-reminders`.

Corrected Sprint 5 base: `feature/sprint-05-warranty-tracking` at `5473ed0b628a5bc51dccf041cd005257807a2f4b`. The repository default branch still points to Sprint 1, so this branch was created from the corrected Sprint 5 head. Implementation commit: `bbc49619a415c3a7f0c93a78a3f38316ad9b44e4`. This report is a later documentation commit. The exact final documentation-head SHA and its CI result are recorded in the delivery response after push; the [branch CI badge](https://github.com/IgnasGaj/cekis/actions/workflows/ci.yml/badge.svg?branch=feature%2Fsprint-06-warranty-email-reminders) follows the latest pushed head. CI was pending when this report was written; no earlier run is presented as final-head evidence.

## Corrected baseline

The fetched Sprint 5 head includes the F1 protection that disables warranty state/date/duration/confirmation edits during receipt-backed creation and handles cancellation and old responses. It also includes the F2 canonical manual-create replay comparison and recoverable changed-payload conflict. Both meaningful regressions passed in the full browser run: the delayed receipt-create control test in `tests/e2e/receipts.spec.ts` and the lost-response purchase/warranty replay test in `tests/e2e/purchases.spec.ts`. Existing owner-scoped uniqueness, deletion tombstones, optimistic revisions, omitted-warranty preservation, shared receipt integrity and OCR review tests passed. The Sprint 6 create/update changes retain the same owner/key replay check and route response comparison.

## Delivered behavior

Migrations 0009/0010 add disabled-by-default account preferences, one purchase override, durable outbox/delivery rows, recipient-version trigger, constraints and indexes. Account default offset is 30; only 90, 30 and 7 are valid. A purchase inherits, turns off or chooses one offset while global opt-out always wins. Settings use a revision to reject stale forms. The recipient is the account's Better Auth `email_verified` address, shown read-only; a changed or unverified address invalidates old unsent work. Reminder transport has a separate enable switch, leaving sign-in email and receipt/manual entry independent.

One reconciliation service runs inside manual purchase create/edit, receipt-backed create, OCR review, purchase reminder changes and deletion. Account setting or recipient changes cancel obsolete unsent rows and make purchases eligible for bounded repair by the worker. Logical identity depends on owner, purchase, saved end date, selected offset and verified recipient version/address. It does not depend on purchase revision, notes or an off/on toggle; accepted identities remain durable after schedule changes.

The calendar uses confirmed PostgreSQL dates and Europe/Vilnius today. Due date is end date minus offset in civil days, with inclusive expiry-day eligibility. Future due dates wait; already-due new or edited purchases get one catch-up reminder while unexpired; expired purchases create no new mail. The worker enforces 09:00–20:59:59 Vilnius time even if invoked outside the window. The email reports the saved date and actual remaining days, including `Baigiasi šiandien`, with escaped HTML, plain text, authenticated detail and settings links from validated `APP_URL`.

`POST /api/reminders/worker` requires a dedicated Bearer secret and returns aggregate counters. Work is claimed with `SKIP LOCKED`, a unique token and 10-minute lease. It reloads and locks current purchase, account preference, verified recipient and work before final dispatch authorization. Mutations committed before that authorization suppress the old work. Once authorization commits, the SMTP handoff cannot be recalled; network I/O holds no database lock. Only the current token can finalize. An expired pre-dispatch claim can retry; an expired post-authorization claim becomes `uncertain` without an automatic duplicate.

There are at most five transport attempts. Definite SMTP 4xx rejections use 15-minute, one-hour, six-hour and 24-hour backoff shifted to the send window; definite 5xx/configuration rejection is terminal. Unknown acceptance after timeout/crash stays `uncertain`. `accepted` means SMTP provider acceptance, not inbox arrival. Nodemailer's [SMTP transport](https://nodemailer.com/smtp) and [send response](https://nodemailer.com/) document timeouts and acceptance fields. This SMTP adapter has no provider idempotency-key API, lookup or retention window; exactly-once external delivery cannot be claimed. The safe operator inspection, evidence-based recovery and scheduler/secret rotation steps are in [Sprint 6 operating notes](sprint-06-operations.md).

## Verification

| Check | Result |
| --- | --- |
| Clean `npm ci` on Node 22.15.0 | Passed; zero audit findings during install |
| `npm audit` and `npm audit --omit=dev` | Passed; zero findings each |
| `npm run lint`, `npm run test:lint-rules`, `npm run typecheck` | Passed |
| `npm test` | Passed; 42 unit tests in six files |
| `CEKIS_ENV_FILE=.env.test.local npm run db:migrate` twice, `db:grant`, `db:check-role`, `test:db` | Passed; fresh/disposable Sprint 5 upgrade, repeated migrations, preserved purchase/receipt association, reminder defaults/constraints, recipient version and limited app-role rights |
| `npm run test:reminders` | Passed; 13 real PostgreSQL worker integration cases for inheritance, revisions, recipient changes, bounded repair, concurrency, leases, cancellation boundary, transient/permanent/uncertain outcomes, expiry, five-attempt limit and lost acknowledgement |
| `npm run test:e2e` | Passed; 35 browser cases, including real Mailpit sign-in and reminder capture, repeated/concurrent worker calls, opt-out, 320/390/1024 px layouts, keyboard focus, stale-form preservation, long text and two-account isolation |
| `APP_URL=http://127.0.0.1:3100 CEKIS_NEXT_DIST_DIR=.next-build npm run build` | Passed; production output separated from development output |
| `git diff --check` | Passed before the implementation commit |

The first production-build attempt used the developer's LAN-only `.env.local` `APP_URL`, which intentionally fails production URL validation. The synthetic trusted loopback origin above passed. An early browser run exposed a duplicate displayed address in Settings; the display was consolidated. A focused stale-form run then exposed React's form reset on conflict; explicit transition submission now preserves selected inputs. All affected focused checks and the final full 35-case browser suite passed after those fixes.

The Mailpit test created a known purchase, opted a verified account in, ran the actual protected worker at a controlled Vilnius send-window clock, fetched the actual SMTP message, checked recipient, escaped product text, saved end date and authenticated link, reran the worker and confirmed exactly one reminder message and one accepted row. It proves local SMTP handoff only. No approved external credentials or consenting external test recipient were available, so no external mailbox send was attempted. No physical iPhone/Android check or hosted scheduler run was performed. Browser viewports are simulations. No production migration, paid provider activation, merge or deployment occurred.

## Remaining production configuration

Select and verify an external transactional sender, sending domain, region, current quotas and costs from its official documentation. Configure a trusted HTTPS `APP_URL`, SMTP credentials/sender and `REMINDER_TRANSPORT_ENABLED=true` only after verification. Provision an at-least-hourly hosted scheduler with a secret header and follow the rotation procedure in the operating notes. These are deployment prerequisites, not local completion claims. Sprint 7 was not started.
