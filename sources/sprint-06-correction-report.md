# Sprint 6 correction and verification

Date: 2026-10-07 (Europe/Vilnius). Branch: `feature/sprint-06-warranty-email-reminders`. Corrected Sprint 5 base: `5473ed0b628a5bc51dccf041cd005257807a2f4b`. Initial Sprint 6 head: `f3656d6780524e8ee49b8136601f25c7e5a947e6` ([CI passed](https://github.com/IgnasGaj/cekis/actions/runs/37584771515)). The final correction commit and its exact-head CI status are reported after push in the delivery response.

## Corrections

- The worker reads a fresh clock after reconciliation, before each claim, during final authorization and immediately before transport. A closing window stops the batch. A token-matched claim that has not entered SMTP returns to pending, with no attempt charged, even if authorization committed. The next eligible run rechecks current purchase, account and recipient state. SMTP network I/O remains outside broad database locks. The ambiguous post-transport/acknowledgment path remains quarantined.
- Global and purchase reminder saves return the exact `revision` from `UPDATE ... RETURNING` in their transactions. Actions return that revision with their submitted values; they no longer read a possibly newer writer's revision after commit. Stale next saves conflict. Purchase and account owner checks remain in place.
- The SMTP classifier retries a verified TCP `connect` failure before the SMTP session, including Nodemailer's real refused-port `ESOCKET`/`CONN` error with `syscall: connect`. It does not retry a generic `ESOCKET`/`CONN` or timeout whose phase is unknown. SMTP 4xx remains transient, 5xx and known authentication/configuration rejection remain permanent. The five-attempt budget and acceptance-unknown quarantine remain intact. This phase distinction follows [Nodemailer's error reference](https://nodemailer.com/errors) and was checked against the installed Nodemailer 10 connection implementation, where `CONN` can also label a later socket error.
- Both reminder forms disable all editable controls during a pending action and use a synchronous submission guard against overlapping sends. Successful feedback corresponds to the submitted snapshot; failure and conflict keep entered choices for review.
- Forward migration `0011_glorious_hellcat.sql` replaces `purchase_reminder_check` with an explicit non-null custom offset condition. Migration 0009 was not edited.

## Verification

All local commands used Node 22.15.0 and disposable PostgreSQL/Mailpit/local S3 services. The browser and migration commands used `.env.test.local`, pointing at `cekis_test`; the build used a trusted loopback `APP_URL` and separate output directory.

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 470 packages installed, zero vulnerabilities reported during install |
| `npm audit`; `npm audit --omit=dev` | Passed; zero vulnerabilities each |
| `CEKIS_ENV_FILE=.env.test.local npm run db:migrate` twice; `db:grant`; `db:check-role` | Passed; repeat migration and limited runtime role |
| `CEKIS_ENV_FILE=.env.test.local npm run test:db` | Passed; populated Sprint 5 and Sprint 6 upgrades, valid inherit/off/custom rows preserved, direct invalid custom-null insert/update rejected under the runtime role |
| `CEKIS_ENV_FILE=.env.test.local npm run storage:init`; `receipts:cleanup -- --dry-run` | Passed; private test bucket ready; no objects deleted |
| `npm run lint`; `npm run test:lint-rules`; `npm run typecheck` | Passed |
| `npm test` | Passed; 42 unit tests in six files |
| `npm run test:reminders` | Passed; 21 live PostgreSQL integration cases, including summer/winter closing boundaries, authorization and batch timing, exact saved revisions, unrelated purchase edits, owner isolation and actual refused-port/recovered local SMTP capture |
| `npm run test:e2e -- tests/e2e/reminders.spec.ts` | Passed; five browser tests, including delayed success, failure and conflict responses for both reminder forms |
| `npm run test:e2e -- --workers=1` | Passed; 37 browser tests, including existing receipt, OCR and warranty creation/replay protections |
| `APP_URL=http://127.0.0.1:3100 CEKIS_NEXT_DIST_DIR=.next-build npm run build` | Passed; optimized production build and TypeScript |
| `git diff --check` | Passed before commit |

The SMTP recovery test starts with an actual Nodemailer send to a closed loopback port, verifies a persisted transient retry, then starts a local SMTP listener on the same port and advances to the saved retry time. It captures one real message and verifies one accepted row after recovery; another worker run captures no second message. No external email was sent.

The browser interleaving tests hold the first tab's completed server-action response, let another tab commit a newer value, then release the first response. Its saved revision remains its own, and its next edit conflicts. The tests also verify disabled checkbox, mode and offset controls while pending, retained input after delayed validation/conflict responses, and reload consistency. The database integration tests separately cover unrelated purchase edits and another account's ownership boundary.

An initial full browser run passed 36 cases and exposed an ambiguous assertion in an existing receipt test: text matching selected a hidden receipt-search `<option>` while the attached-receipt view refreshed. The assertion now targets the visible attached receipt item. A second concurrent full run passed 36 cases and hit the default 30-second total limit at the end of an existing long manual purchase cycle while the build and PostgreSQL suites ran. That test now has a 60-second total limit; its deletion assertion retains its own timeout. A two-worker run passed 36 cases but the existing receipt warranty-confirmation check interacted immediately after server rendering; the focused test passed three repeated runs, and the full test now waits for page loading to settle and asserts the changed-date prompt before checking that confirmation resets. Another two-worker run passed 36 cases but a receipt lock-contention probe did not observe its blocked query within 10 seconds; that test now allows 20 seconds for the database request to reach the lock. The final full browser run used one worker without competing build or database checks.

## Limits

Local SMTP acceptance does not prove delivery to an external inbox. No external sender credentials or consenting external test recipient were available. No physical iPhone/Android device, hosted scheduler, production migration, paid provider, merge or deployment was used. Browser viewport checks are simulations. Provider setup and operational recovery remain documented in [Sprint 6 operating notes](sprint-06-operations.md). Sprint 7 was not started.
