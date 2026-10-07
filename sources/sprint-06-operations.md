# Sprint 6 reminder operations

## Schedule and data contract

`reminder_preference` starts disabled with a 30-day default. A purchase starts in `inherit` mode; `off` suppresses that purchase and `custom` selects one of 90, 30 or 7 days while the account remains enabled. The worker uses the account's stored `email_verified` field from Better Auth's magic-link flow. An address or verification-state change increments `user.reminder_recipient_version`, cancels unsent work and makes active purchases eligible for bounded reconciliation. There is no account-email-change UI in this sprint.

Only a confirmed `known` warranty end date can produce work. `due_date` is the PostgreSQL calendar date `end_date - offset_days`. The worker treats the end date as inclusive and uses the Europe/Vilnius calendar for today's date. New or newly enabled work already due is sent at the next eligible run if the warranty has not expired. It does not emit missed stages; each purchase has only one selected offset. The Lithuanian email reports the actual saved end date and current remaining days.

The send window is 09:00–20:59:59 Europe/Vilnius. The worker checks it independently of scheduler timezone. Outside the window, it reconciles durable work and defers sending. A hosted scheduler must invoke the protected worker at least hourly. This repository does not include a hosted scheduler or an in-process timer.

The logical identity hashes owner, purchase, confirmed end date, selected offset, recipient version and normalized verified address. It excludes purchase revision and opt-out toggles. Accepted identities remain in the outbox, so unrelated edits and off/on cycles cannot resend them. A changed/restored date or offset reuses the old accepted identity if restored. Migrations 0009 and 0010 add preferences, purchase overrides and reconciliation revision, delivery rows, constraints, indexes and the recipient invalidation trigger. Existing accounts stay disabled, and no old purchase creates mail during migration.

Purchase create, edit, OCR review and delete reconcile in their mutation transaction. Setting changes increment a revision, cancel obsolete unsent work immediately and let worker runs repair at most 50 purchases each. The worker always reloads the owned purchase, preference, verified recipient and matching identity before authorizing dispatch. It locks those records for a short transaction. A cancellation or edit committed before this final authorization transaction commits suppresses the old send. After authorization commits, the network send may proceed; it cannot be recalled. Database locks are released before SMTP I/O.

## Worker security and transport semantics

`POST /api/reminders/worker` requires the dedicated `REMINDER_WORKER_SECRET` as a Bearer authorization header. It has no browser-session bypass or GET side effect. Comparison uses fixed-length digests with constant-time comparison. The endpoint disables caching and handles at most 10 claimed messages per request, with a 60-second loop deadline and bounded reconciliation/housekeeping. It returns only `claimed`, `accepted`, `retried`, `failed`, `uncertain` and `cancelled` counters. Do not log the header, email address, product name, message body or receipt URLs.

Claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, a unique claim UUID and a 10-minute lease. The final update requires the same token. An expired claim before dispatch can be reclaimed. An expired claim after authorization is marked `uncertain`; it is never resent automatically. SMTP connection, greeting, DNS and socket timeouts are individually 15–20 seconds, below the lease. An interrupted process after SMTP acceptance but before its database acknowledgement is also `uncertain` on recovery.

There are at most five transport attempts, including the first. A definite SMTP 4xx rejection retries after 15 minutes, one hour, six hours and 24 hours, moved to the next send window. A definite SMTP 5xx recipient/configuration rejection is terminal. A connection loss or timeout whose acceptance is unknown is `uncertain` and has no automatic resend. Expiry or opt-out suppresses later attempts. The sanitized `error_class` is for operators; the UI does not expose raw provider responses.

`accepted` means the SMTP server accepted the message, not that it reached the recipient's inbox. [Nodemailer's SMTP documentation](https://nodemailer.com/smtp) describes connection timeouts and the SMTP transport; [its response documentation](https://nodemailer.com/) describes `accepted`, `rejected`, `messageId` and server response. SMTP does not supply a provider idempotency-key API or reliable acceptance lookup in this adapter. The database identity and one-recipient message reduce duplicates within this app, but cannot guarantee exactly one external delivery after a lost acknowledgement. There is no provider key-retention window to claim. Mailpit capture proves local SMTP handoff only.

## Local setup and verification

Use the existing disposable services. Never point test commands at production data.

```sh
npm ci
npm run setup:local
docker compose --env-file .env.local up -d postgres postgres_test mailpit local_s3
npm run db:migrate
npm run db:migrate
npm run db:grant
npm run db:check-role
CEKIS_ENV_FILE=.env.test.local npm run db:migrate
CEKIS_ENV_FILE=.env.test.local npm run db:grant
CEKIS_ENV_FILE=.env.test.local npm run test:db
npm run test:reminders
npm run test:e2e
```

For manual Mailpit use, set `REMINDER_TRANSPORT_ENABLED=true` and a new random 32-character-or-longer `REMINDER_WORKER_SECRET` in the ignored `.env.local`, then start `npm run dev`. Sign in through Mailpit, save a confirmed warranty and deliberately enable reminders in **Nustatymai**. Run `npm run reminders:run` in another terminal. The CLI reads the secret from the local environment file and calls the protected endpoint. Open `http://127.0.0.1:1080` or inspect Mailpit's `/api/v1/messages` and `/api/v1/message/{id}` endpoints. A send occurs only during the Vilnius window. The Playwright suite uses a disposable test configuration and controlled clock to exercise it at any real hour; its clock and transport hooks are disabled in production mode.

Authentication mail uses its existing SMTP configuration independently. Leaving `REMINDER_TRANSPORT_ENABLED=false` prevents reminder delivery while receipt capture and manual entry continue. Production needs a trusted HTTPS `APP_URL`, a working transactional SMTP sender, sender/domain verification, provider quotas and costs, and an at-least-hourly hosted scheduler. No external provider, sender/domain, region, quota, paid plan or hosted schedule was selected or activated here. Verify current official provider documentation for these values before provisioning.

To configure a scheduler, store `REMINDER_WORKER_SECRET` as a scheduler secret, POST to the trusted application's `/api/reminders/worker` at least hourly, and set `Authorization: Bearer <secret>`. Do not place the secret in a URL, command log or repository file. Restrict scheduler logs to HTTP status and aggregate counters. To rotate, pause the scheduler, update the application secret, update the scheduler header, test one authorized and one rejected request, then resume. The old secret stops working as soon as the application changes. Keep the ordinary sign-in SMTP configuration available through the rotation.

## Inspect and recover work

Use the migration-owner/operator connection for these read-only queries; restrict access to authorized operators. The first query has no personal fields.

```sql
SELECT status, count(*) FROM warranty_reminder GROUP BY status ORDER BY status;
SELECT id, status, attempts, due_date, end_date, next_attempt_at, error_class
FROM warranty_reminder WHERE status IN ('pending','failed','uncertain')
ORDER BY next_attempt_at, id LIMIT 100;
```

`pending` waits for due date, send window or backoff. `failed` needs a corrected configuration/recipient or exhausted-attempt review. `uncertain` requires independent provider or mailbox evidence. Check the saved account preference, verification version, purchase warranty and expiry before any manual state change. Do not treat an absent Mailpit message as proof that an external SMTP provider did not accept mail.

If independent provider evidence proves acceptance, an operator can record `accepted_at` and `accepted` for that one uncertain row in a reviewed transaction. If it proves definite rejection before acceptance, an operator may return that row to `pending` with the existing attempt count, cleared claim/lease/authorization fields and a next eligible attempt timestamp; the worker rechecks all current preferences before sending. Never do that for an unproven timeout or an already accepted identity. Leave unresolved cases `uncertain` and explain the status to the account owner. Do not create a new identity solely to force a retry.

The local tests cover database state and Mailpit message counts. They do not prove arrival in an external mailbox or behavior on a physical phone. External mailbox delivery requires approved credentials and a consenting test recipient; no such send is part of this local handoff. Browser viewport checks are simulations, not real iPhone/Android checks.
