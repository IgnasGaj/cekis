# Sprint 2 completion report — purchase vault

Date: 2026-10-06. Starting baseline: `d5c0517a64dc96ca974b404ec132e7e56f6cde89` (completed Sprint 1 corrections). Final implementation commit: `f42e0093e15b1bee0ef2a045eaee500f76c0bd5f`. Branch: `feature/sprint-02-purchase-vault` at [IgnasGaj/cekis](https://github.com/IgnasGaj/cekis). The implementation commit was pushed normally and `git ls-remote` returned that same full SHA. The reporting commit follows this implementation commit; the remote branch tip is verified after the report push.

## Implemented

- Owner-scoped purchase table with versioned Drizzle SQL migration, required field and money constraints, owner/date index, and limited runtime-role grants.
- Lithuanian protected list, search, date sort, 50-record pagination, create, detail, edit and confirmed delete. Bottom navigation opens the list and an honest manual-add screen.
- Exact decimal-string price validation with EUR, USD, GBP and PLN; real calendar dates limited by the Europe/Vilnius day; trimmed bounded text; literal wildcard search; no unreviewed warranty inference.
- Per-owner submission keys prevent overlapping duplicate creates. Deleted purchase content is scrubbed, while the owner/key tombstone remains until account deletion to reject replay. Later edits are not overwritten by a replay.
- Dynamic authenticated pages, production `Cache-Control: private, no-store`, browser history refresh on restored pages, and page revalidation after mutations.
- Receipt and warranty sections accurately state `Čekis nepridėtas` and `Garantija nenurodyta`. No receipt upload or warranty workflow was added.

## Migration, startup and checks

Local startup: `npm ci`, `npm run setup:local` when environment files do not yet exist, `docker compose --env-file .env.local up -d postgres postgres_test mailpit`, `npm run db:migrate`, `npm run db:grant`, `npm run db:check-role`, `npm run dev`. The app listens at `http://127.0.0.1:3100`; Mailpit is at `http://localhost:1080`. Test preparation: `CEKIS_ENV_FILE=.env.test.local npm run db:migrate`, `CEKIS_ENV_FILE=.env.test.local npm run db:grant`, `CEKIS_ENV_FILE=.env.test.local npm run db:check-role`, then `npm run test:e2e` with Chromium installed. The browser suite ran in a separate disposable checkout on port 3101 because an existing server occupied 3100; it used the same dedicated `cekis_test` database and Mailpit. Production build output and the running server's development output remained separate.

| Check | Result and evidence |
| --- | --- |
| Sprint 1 baseline | Passed: existing eight authentication browser cases, eight unit cases, lint-rule fixtures and auth flow remained functional. |
| Fresh migration | Passed: empty disposable `cekis_sprint2_fresh` applied migrations 0000–0002, then migration rerun retained exactly three entries. `db:grant` and `db:check-role` passed. |
| Sprint 1 upgrade | Passed: existing `cekis_test` with auth users upgraded to three migrations; 58 users were present after upgrade, and a rerun did not add migration entries. Migration 0002 changes only the purchase table. |
| Limited role | Passed: `cekis_app` has purchase SELECT/INSERT/UPDATE/DELETE and no schema CREATE. Browser lifecycle and database value checks ran through `DATABASE_URL`, not the migration owner. |
| Validation | Passed: unit checks cover text limits, leap/invalid/future dates, Vilnius boundary, absent/zero/comma/point/negative/grouped/overprecision/overflow price, supported/non-EUR/unsupported currency. Browser checks cover inline errors and retained form content. |
| Purchase lifecycle and isolation | Passed: real email-link A/B browser flow creates, reloads, edits, signs out/in, deletes, and checks stored PostgreSQL values; B cannot list/search/view/edit/delete A's known ID, including replayed update/delete actions. Forged owner field cannot transfer ownership. Anonymous, signed-out and revoked sessions are denied. |
| Search, ordering and paging | Passed: product/seller OR, Lithuanian text, literal wildcard-like input, date order, URL state and a 51-record two-page traversal. |
| Mutation robustness | Passed: overlapping submissions with one key create one row, replay after edit does not overwrite, replay after delete cannot recreate, and cancel does not mutate. |
| Browser/layout | Passed locally in Chromium: 320 px, 390 px and desktop widths, plus 150% browser zoom at 320 px, without horizontal overflow; form/detail/list screenshots inspected. Focus, error association, bottom navigation and keyboard Tab movement were checked through browser interactions. |
| Build and dependencies | Passed: clean `npm ci`, `npm run lint`, `npm run test:lint-rules`, `npm run typecheck`, 11 unit cases, 14 browser cases, `npm run build`, `npm audit`, and `npm audit --omit=dev`. Both audits returned zero vulnerabilities. |

There were no remaining failed local checks. During repeated local browser runs, the disposable database's real Better Auth verification limit reached 30 requests in its one-minute window; clearing only that test database's `rate_limit` rows restored a fresh test window, and the full 14-case suite passed. An earlier browser rerun also exposed a sign-out button hydration race; the button is now disabled until hydrated, and the final suite passed. These test-environment events did not change production rate limits or authentication configuration.

## Delivery and limits

CI runs a fresh PostgreSQL and Mailpit service, applies migrations twice to check rerun safety, verifies the limited role, then runs unit, browser, lint, audit and build checks. The implementation push triggered [GitHub Actions run 37422042667](https://github.com/IgnasGaj/cekis/actions/runs/37422042667); it was queued when this report was drafted. The final remote CI result is checked after pushing this report and stated in the delivery response.

Skipped: external mailbox delivery (no external transport configured), physical iPhone/Android testing (no device run), and production deployment or data recovery testing (no production service was provisioned). Browser viewports are simulations, not device proof. Receipt upload, OCR, warranty tracking and reminder work remain outside Sprint 2. Next step: **Sprint 3 private receipt upload**.
