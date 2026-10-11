# Čekis friends-and-family beta deployment report

Checked 2026-10-11. **Status: preparation only; no live URL. Do not invite testers yet.** This report records deployment preparation, not a new full project audit or Sprint 9 work.

## Baseline and changes

- Repository: `https://github.com/IgnasGaj/cekis.git`; `main` and remote default branch both point to `09ff4f5c87630697037318577f32954729bb676c` at inspection. The worktree was clean. The pre-Sprint 9 correction commits `38f589f`, `bc40aa1`, and `fb8c29c` are ancestors of `main`; no other feature branch was merged.
- Existing app: Next.js 16/Node 22, Better Auth email links, PostgreSQL/Drizzle, private S3-compatible originals, browser OCR, and a protected reminder worker. No architecture replacement.
- Prepared in this task: a Render Free web blueprint, a hosted `PORT` start command, an opt-in hourly GitHub Actions maintenance workflow, hosted SMTP TLS enforcement/timeouts, and secret-free environment/deployment notes. PR [#3](https://github.com/IgnasGaj/cekis/pull/3) passed CI and was merged into `main` as `2e881b014cd4ec1dcecfd6a21e6cf293edbb18a2`. The final branch [CI run](https://github.com/IgnasGaj/cekis/actions/runs/38129649072) passed migrations, role checks, audit, lint, unit tests, reminder integration, browser tests, and production build; one browser test passed on retry after an initial timeout. No provider resource, migration, email sender, or scheduler has been activated. Deployed commit and live URL: **not yet available**.

## Free-service fit and cost boundaries

| Role | Candidate and region | Verified allowance and limitation | Actual status |
| --- | --- | --- | --- |
| Web | Render Free, Frankfurt | Free Node web instance, 512 MiB RAM; 750 instance-hours/month. Sleeps after 15 idle minutes; first wake can take about a minute. Without a payment method, exhausted included bandwidth/build minutes suspend service/builds. Outbound SMTP 25/465/587 blocked, so use 2525. Current 10 MiB request and PDF child process still need deployed validation. | No Render account/session accessible; not created. |
| Database | Neon Free, Frankfurt preferred | Current Free announcement: 1 GB PostgreSQL/project, 100 CU-hours/project/month, 6-hour instant restore window. Use a separate beta project, direct migration owner connection and **direct** limited-role runtime connection. The app's session advisory lock rules out transaction pooling; one Render instance caps its own pool at 10. | No Neon account/session accessible; not created. |
| Private originals | Neon Object Storage on the beta branch if offered in the chosen EU region | Current Free announcement: 5 GB/project, S3-compatible, private bucket supported. Confirm `If-None-Match` conditional `PutObject`, private access, original bytes and cleanup in the actual account. If unavailable, choose another private S3-compatible free bucket only after verifying zero-cost controls. | Not created or compatibility-tested. Cloudflare R2 was **not** activated: its included free allowance sits in a billable R2 subscription. |
| Mail | Existing verified SMTP sender with port 2525; Brevo Free is a candidate if an owned sender domain exists | Brevo Free: 300 sends/day; it requires sender/domain setup and may add branding. Resend's shared testing sender cannot mail outside the account owner; external testers need an owned verified domain. | No verified sender or mailbox access; external sign-in and reminders untested. No domain purchased. |
| Maintenance | GitHub Actions scheduled workflow, default branch | Prepared for `23 * * * *` UTC: bounded receipt cleanup plus protected reminder call. Standard runners are free for this public repository. GitHub scheduled jobs can be delayed/dropped and are disabled on public repositories after 60 days of inactivity. The workflow remains off until `BETA_MAINTENANCE_ENABLED=true`. | Not enabled or run against a beta. |

Vercel Hobby was checked but not selected: its function request/response payload limit is 4.5 MB, below the app's 10 MiB original receipt support. Hobby also restricts use to personal, non-commercial projects and its cron minimum is daily, while this worker needs at least hourly invocation. Render avoids rewriting the established upload path. None of the free allowances is a promise of unlimited service. Do not add a payment method, accept a metered subscription, paid trial, or upgrade for this beta without owner approval.

Local preparation checks on the task changes: `npm run lint`, `npm test` (60 passed), `npm run typecheck`, and `APP_URL=http://127.0.0.1:3100 CEKIS_NEXT_DIST_DIR=.next-build npm run build` passed on Node 22.15.0. Both YAML files parsed, `git diff --check` passed, and `start:hosted` bound to `0.0.0.0` on an overridden `PORT`; `/prisijungti` returned HTTP 200. An initial build without the `APP_URL` override failed because the ignored local file uses a LAN HTTP origin disallowed in production mode; the documented local override passed. These checks do not verify a Render build or deployed flows.

Official sources checked 2026-10-11: [Render Free](https://render.com/docs/free), [Render regions](https://render.com/docs/regions), [Render blueprint spec](https://render.com/docs/blueprint-spec), [Neon current Free allowances](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Neon private S3 storage](https://neon.com/blog/building-neon-object-storage), [Cloudflare R2 billing](https://developers.cloudflare.com/r2/get-started/), [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Brevo SMTP setup](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP), [Resend sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [Vercel payload limit](https://vercel.com/docs/functions/limitations), [Vercel Hobby terms](https://vercel.com/docs/plans/hobby), [Vercel cron frequency](https://vercel.com/docs/cron-jobs/usage-and-pricing), [GitHub Actions public runner cost](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [GitHub schedule caveats](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## Settings and release sequence

1. In Neon, create a separate EU beta project and private bucket. Obtain a direct owner URL for versioned migrations and a separate **direct**, limited application URL. Store the owner URL only in an ignored local file as `MIGRATION_DATABASE_URL`; set `DATABASE_URL` there to the limited role. Apply `npm run db:migrate`, then `npm run db:grant` and `npm run db:check-role`. Do not migrate an existing unrelated database. The empty beta needs no imported receipts or seed users.
2. In Render, connect this repository's `main` to `render.yaml` on the Free plan, confirm the `onrender.com` subdomain, and enter `APP_URL` as its exact HTTPS origin. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `REMINDER_WORKER_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in Render environment settings. `BETTER_AUTH_SECRET` can be generated by Render. Keep `REMINDER_TRANSPORT_ENABLED=false` until external sign-in delivery works; set it to `true` for controlled reminder delivery testing. Runtime must not receive `MIGRATION_DATABASE_URL`. Auth uses `APP_URL` for callbacks/trusted origin and HTTPS cookies. Hosted SMTP requires STARTTLS on port 2525.
3. In GitHub Actions secrets, set `BETA_DATABASE_URL` (limited role), `BETA_S3_ENDPOINT`, `BETA_S3_REGION`, `BETA_S3_BUCKET`, `BETA_S3_ACCESS_KEY_ID`, `BETA_S3_SECRET_ACCESS_KEY`, and `BETA_REMINDER_WORKER_SECRET`. Set repository variable `BETA_APP_URL` to the same HTTPS origin. After live checks, manually dispatch Beta maintenance; then set `BETA_MAINTENANCE_ENABLED=true`. No credentials belong in git, logs, client bundles or this report.
4. Keep the receipt bucket private. The current app proxies originals through owner-scoped routes and does not need browser-to-bucket CORS or a public bucket. Same-origin OCR assets are copied into `public/ocr` by `prebuild`; verify `lit`/`eng` language and WASM loading from the deployed origin. Test JPEG, PNG, PDF, 10 MiB boundary, read/download, conditional S3 put, and cleanup on the chosen provider. Render's RAM and request duration need measurement.
5. For future changes, merge verified work into `main`; Render deploys that branch after its CI checks pass. Before each schema change, export the beta database and private objects, review the versioned migration SQL, apply with the direct migration role, then deploy the matching commit. Roll back application code with Render's earlier deployment or prior `main` commit only after checking schema compatibility; a code rollback does **not** undo database migrations.

## Verification ledger

| Flow | Status / evidence |
| --- | --- |
| CI on deployed commit | Unperformed; no deployed commit. |
| Public HTTPS access without host login | Unperformed; no URL. |
| Two external login emails, sign-out, returning sign-in | Unperformed; no sender/test mailbox. |
| Lithuanian receipt OCR, correction, upload/save, reload, original preview/download | Unperformed; no live backend. |
| Search/filter/edit/delete and linked-receipt persistence | Unperformed. |
| Account B and anonymous ownership isolation | Unperformed on deployment. |
| Authorized reminders, real email, retry deduplication, periodic cleanup | Unperformed. Workflow disabled. |
| Narrow-screen browser, real iPhone Safari/Android camera | Unperformed. Device checks require owner's phones. |

The existing CI and local reports cover development/test services, not a live beta. Do not label this ready until essential deployed auth, upload/save/retrieval and ownership isolation pass.

## Backups, recovery and deletion

Neon's Free instant restore window is only six hours; it is not a durable off-provider backup. On a schedule and before migrations, run `pg_dump` against the beta **direct** connection into an encrypted owner-controlled archive, and export every private original object from the beta bucket with an S3-compatible tool into a matching encrypted archive. Record database snapshot time, object inventory and deployed commit together; test restoring both into a disposable project and private bucket before relying on them. Do not expose receipt bytes in public GitHub artifacts or logs. On loss, restore the SQL and matching objects into a new isolated backend, validate hashes and owner links, then point Render at it. Free provider backups may be unavailable beyond the stated Neon restore window.

There is no complete self-service account deletion flow yet. For a deletion request, the owner should take the account email privately, authenticate the request, export data if requested, then use a reviewed operator procedure to remove that account's DB records and private receipt objects (including detached/linked originals), verify both stores, and keep a minimal completion record. Do not infer permission from an email address alone.

## Tester handoff after readiness

Send only the verified stable URL to about 5–10 friends. Ask each to sign in, save three varied receipts, correct one OCR result, retrieve one original after returning, edit and delete a disposable purchase, and report phone/browser, expected behaviour, actual behaviour and a screenshot. Do not send invitations from this task.

| Tester | Phone/browser | Flow | Expected | Actual | Screenshot/link | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

Known limitations: this precedes PWA polish and full production hardening; HEIC is unsupported; PDFs need manual review; Render Free may cold-start, Neon Free has quotas, and GitHub scheduled runs are not exact-time guarantees. Retain only disposable beta data until backup and deletion procedures are exercised.
