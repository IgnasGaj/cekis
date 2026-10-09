# Sprint 7 completion report

Date: 2026-10-07 (Europe/Vilnius). Repository: https://github.com/IgnasGaj/cekis.git. Branch: `feature/sprint-07-home-screen`. Base `origin/main`: `6e8c45e2033de87b3b9b4b84c81cecb61fe3e2c4`. The base contains the Sprint 6 correction fixture shutdown commit; its exact-head [main CI run](https://github.com/IgnasGaj/cekis/actions/runs/37611387719) completed successfully. No Sprint 6 audit or email suite was repeated to start this UI work.

## Scope and implementation

The authenticated `/pradzia` route now has a prominent link to the existing receipt capture/upload/manual flow, cumulative 30/90-day counts, up to five nearest confirmed warranty ends, and up to five most recently created purchases. Cards open existing owner-scoped details. `Visi pirkiniai` opens the existing list. Empty, loading and retrieval-error states are in Lithuanian. The error retry requests a fresh page. The existing bottom navigation and design tokens remain in use. The list adds only `upcoming90` to its validated warranty filter; unsupported values safely normalize to `all`. No dependency or migration was added, and no reminder work is dispatched from home.

Changed files: `src/lib/purchases.ts`, `src/app/pradzia/{page,loading,error}.tsx`, `src/app/pirkiniai/{page,actions}.tsx`, `src/app/globals.css`, `src/components/{purchase-shell,receipt-upload}.tsx`, `src/app/api/purchases/route.ts`, `src/app/api/receipts/[id]/review/route.ts`, `tests/e2e/{home,auth}.spec.ts`, this report, and `sources/sprint-7.md`.

A single Europe/Vilnius civil `today` is calculated per home request. The shared SQL predicate requires `warranty_state='known'` and a saved date from today through today + 30 or 90 PostgreSQL calendar days, inclusive. It matches the established `soon` and end-date-today rules; an end date today displays `Baigiasi šiandien`. Counts cover all eligible purchases, while rows are limited to five. The 90-day count includes the 30-day count. The home reads counts and both lists in one owner-scoped read-only repeatable-read transaction, without receipt joins or file fetches. Upcoming rows sort by saved warranty end date ascending, then creation timestamp and ID descending; recent rows sort by creation timestamp and ID descending, independently of purchase date. Summary links use `/pirkiniai?warranty=soon&sort=expiry` and `/pirkiniai?warranty=upcoming90&sort=expiry`, so the linked owner-scoped results have the same predicates. Server actions and purchase/review API mutations invalidate home and list; receipt-backed creation refreshes the client router. Dynamic rendering gets a new Vilnius date on a new request.

## Verification checkpoint

- Focused browser tests against disposable PostgreSQL and Mailpit passed for boundaries -1/0/1/2/3/30/31/90/91, cumulative counts beyond the five-row limit, deterministic ties, recent creation order, shared receipt associations, two-account isolation, matching summary result counts, detail/add/all-list links, unknown/none/expired exclusion, empty/no-upcoming states, representative create/edit/delete freshness, retry from a test-injected home read-path failure, keyboard focus and 320/390/1024 px overflow including 150% zoom. The simulated failure is gated by `CEKIS_TEST_WORKER` and a test-only request header; it checks the error UI and retry, not a real PostgreSQL outage.
- Existing unit warranty tests already cover Vilnius midnight versus UTC date, DST, leap day and civil-day phrases. The first focused browser run exposed an ambiguous PostgreSQL `date + parameter` operator and was fixed with an explicit integer cast. The error retry initially used the Next reset callback, which did not recover the initial server-render failure in the browser; a full reload was verified instead. A test fixture also needed a shorter seller value and fixed tie timestamps. The final focused runs passed after these fixes.
- The repository's home design reference `docs/F930517C-1FE1-449B-A78E-622A01A83407.PNG` was inspected. A populated 390 px browser screenshot showed a calm single-column layout, readable cards and long seller wrapping. Automated 320/390/1024 px and zoom checks found no horizontal overflow. These are browser viewports, not physical-device checks. The four original JPEG attachment paths were unavailable; the repository PNG copy was available and inspected.

Final code-state verification on Node 22.15.0, with existing dependencies and disposable local services:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run test:lint-rules` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed, 42 unit cases in six files |
| `APP_URL=http://127.0.0.1:3100 CEKIS_NEXT_DIST_DIR=.next-build npm run build` | Passed; `/pradzia` remains dynamic |
| `npm run test:e2e -- tests/e2e/home.spec.ts tests/e2e/purchases.spec.ts --workers=1` | Passed, 15 real PostgreSQL/browser cases |
| `npm run test:e2e -- tests/e2e/auth.spec.ts --workers=1` | Passed, eight affected authentication/browser cases after correcting stale home expectations |
| `git diff --check` | Passed before commit |

Dependencies were already installed and unchanged, so no install was run. There was no migration, so the migration/role checks were left to unchanged CI. The unchanged broad receipt/OCR/reminder suites, audits and complete browser matrix were not repeated locally; the existing CI workflow retains them. No physical iPhone/Android check, merge, production deployment or production data change was performed.

The first implementation [CI run](https://github.com/IgnasGaj/cekis/actions/runs/37613830847) failed only in `tests/e2e/auth.spec.ts`: its login lifecycle still asserted the removed `Labas` and old empty-card copy. CI passed all preceding steps, including audits, migrations/role checks, unit and reminder tests; the browser step passed 40 cases and failed the stale assertion on both attempts, so the build step was skipped. The affected authentication suite then passed locally, 8/8, after changing the assertion to the new `Pradžia` heading, truthful empty state and working add link. This correction and report are committed after the implementation commit; the next exact-head CI result is reported in the handoff.

## Delivery

Implementation commit: `e910b7724fe61bacf6c067804aedccc84839abab` (`Add useful home screen`), pushed to `feature/sprint-07-home-screen`. Its exact-head CI failure and correction are described above. The follow-up commit contains the affected authentication assertion correction and this report; its exact final pushed SHA and CI status are given in the handoff because a commit cannot contain its own hash.

## Later verification record (2026-10-09)

Sprint 7 is included in main commit `d88330e04b71f03c5df2c3957440ea3a42a1d7bf`, whose [CI run 37824588095](https://github.com/IgnasGaj/cekis/actions/runs/37824588095) passed on Node 22.23.3. The run recorded 60 unit tests, 22 reminder integration tests, and 51 browser tests passing first attempt with one OCR review case passing on retry. That OCR case is addressed in the [pre-Sprint 9 correction report](pre-sprint-09-correction-report.md); this later record does not change the historical Sprint 7 scope.
