# Čekis friends-and-family beta deployment report

Checked 2026-10-12. The beta is live on **Render Free** at [https://cekis-beta.onrender.com](https://cekis-beta.onrender.com). Deployed application commit: `f5564af` on `main`, from reviewed [PR #4](https://github.com/IgnasGaj/cekis/pull/4). The final [main CI run](https://github.com/IgnasGaj/cekis/actions/runs/38153969970) passed on attempt 2 after a flaky home-page browser test failed on attempt 1. The most recent Render configuration deployment was Live. This report is the deployment ledger, not a Sprint 9 implementation.

## Configuration and cost

The Render blueprint defines one Frankfurt Node web service on the Free plan. The service uses the owner's direct Neon PostgreSQL connection through a limited `cekis_app` role, a private Neon Object Storage bucket for originals, and Brevo SMTP on port 2525 with STARTTLS. Render has the 17 runtime settings required by the app and does **not** have the migration-owner URL. The ignored `.env.local` holds local credentials; Git ignores it, and no credential is in this report or the committed changes. The verified sender is `ignas.gajauskas@icloud.com`.

`REMINDER_TRANSPORT_ENABLED` is enabled in the live Render environment. The blueprint entry was changed from a hardcoded `false` to `sync: false` so a future blueprint sync preserves the dashboard value. Render's [Blueprint specification](https://render.com/docs/blueprint-spec) documents this behavior. No paid plan, trial, payment method, or Sprint 9 work was activated.

The scheduled [beta maintenance workflow](../.github/workflows/beta-maintenance.yml) is still disabled. It needs seven GitHub Actions secrets for the limited database role, private storage and protected reminder worker, plus `BETA_APP_URL` and `BETA_MAINTENANCE_ENABLED`. Granting those persistent CI credentials is a separate access decision. Until authorized and successfully dispatched, receipt cleanup and reminders require an operator run; the live reminder test below was manual.

## Live verification ledger

| Flow | Result |
| --- | --- |
| Public HTTPS | The home route redirects to sign-in; sign-in returns 200. Lithuanian OCR language data and Tesseract WASM assets load over the live origin. |
| Login and email | A deployed magic-link sign-in to the owner's iCloud address worked. After signing out, a second magic link returned to the same account and the test purchase remained on the home screen. Both messages reached iCloud **Junk**. A prior direct SMTP test from that sender to the owner's Gmail address was accepted with SMTP 250 and the owner showed inbox delivery. |
| Receipt scan and save | Browser OCR extracted seller, product, date and price from a synthetic PNG; corrected product and seller persisted after save/reload. A synthetic JPEG also scanned and saved. |
| Private originals and upload limit | PNG preview and download worked; downloaded SHA-256 matched the source. An exact 10 MiB PDF uploaded and downloaded byte-for-byte. A PDF one byte over the limit was rejected by the client. |
| Purchase controls | A disposable purchase was created and edited; search and warranty filters behaved as expected; the linked receipt remained after the purchase edit. |
| Anonymous access | Anonymous receipt listing and original-content requests returned 401. The purchase detail redirected to sign-in; unauthenticated worker POST returned 401. |
| Reminder | The owner opted in with a 30-day offset and set a disposable warranty due 2026-11-10. The protected worker reported one accepted send; the reminder appeared in iCloud Junk. A second run reported zero sends, confirming deduplication. The purchase UI showed accepted delivery status. |
| Other account isolation | Not yet verified with a second signed-in account. |
| Scheduled maintenance | Not yet enabled or tested in GitHub Actions. |
| Physical devices | iPhone Safari, Android camera capture and an actual phone viewport have not been verified. |

The disposable purchase and receipt originals created for these checks should be deleted after any second-account isolation check. The absence of account B testing and an enabled scheduler limits readiness for an unattended tester invitation.

## Operations and recovery

The service can sleep after idle time on Render Free. Free provider quotas and GitHub schedule delivery are not guarantees; see [Render Free](https://render.com/docs/free), [Neon Free](https://neon.com/blog/neon-free-plan-1-gb-per-project), and [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). The Neon beta project's separation from other owner projects has not been independently confirmed in the provider dashboard.

Before a schema change or broad tester invitation, export the direct beta database and all private originals to matching encrypted owner-controlled archives, record the deployed commit and object inventory, and exercise a restore into a disposable project. Neon's short instant-restore window is not a durable off-provider backup. Apply migrations with `MIGRATION_DATABASE_URL`, then check grants for the limited runtime role; never give the migration owner credential to Render or GitHub Actions. An application code rollback does not reverse schema migrations.

Account deletion is still an operator procedure: authenticate the request, export data if requested, remove database records and all linked or detached private objects, verify both stores, and keep a minimal completion record. HEIC is unsupported, PDF fields need manual review, and phone-camera behavior still needs device checks.

## Tester handoff

Once account isolation, scheduled maintenance and recovery checks are complete, share only the verified URL with about 5–10 friends. Ask each to save three varied receipts, correct one OCR result, retrieve an original after returning, edit and delete a disposable purchase, and report phone/browser plus expected and actual behavior. No tester invitations were sent during this deployment.
