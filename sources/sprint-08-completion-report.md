# Sprint 8 completion report — simple retrieval and core-flow stability

Date: 2026-10-08 (Europe/Vilnius). Branch: `feature/sprint-08-simple-retrieval`. Base: `c642281c01d52eff80153f50e66adc3b60214d26` on `origin/main`.

## Baseline and scope

The checkout was clean. A normal fetch found that Sprint 7 and all three intended scanning-fix branch tips were already ancestors of `origin/main`; each had zero commits unique to its branch. No duplicate prerequisite merge was needed. The exact base main commit passed [CI run 37775375955](https://github.com/IgnasGaj/cekis/actions/runs/37775375955). This repository's sole workflow runs CI on pushes and pull requests; it has no deployment job. GitHub's public deployments endpoint returned an empty list at this checkpoint.

The existing **Pirkiniai** screen already had PostgreSQL `ILIKE` product/seller search with whitespace trimming and literal wildcard handling, validated `newest`/`oldest` purchase-date and `expiry` sorting, seven warranty filter values including home 30/90-day destinations, and deterministic server-side 50-row pages. The expiry sort intentionally groups unexpired known dates ascending, then expired known dates most-recent first, then unknown/none, with creation time and ID tie-breakers. This useful established behavior, the Europe/Vilnius calendar predicates, reminder behavior, warranty defaults and home creation-order rule were preserved.

## Changes

- Added a keyboard-reachable **Išvalyti paiešką** action beside the search field. It keeps the chosen warranty filter and sort, and resets to page 1.
- Distinguished an empty vault (**Dar neturite pirkinių**, **Pridėti čekį**) from a failed search (**Pagal paiešką pirkinių nerasta**) and a filter with no matches. The filter state names the selected warranty filter. The search and filter reset actions retain other selected controls. An extra owner-scoped count runs only when an empty filtered/search result needs to distinguish these states.
- Changed purchase-list error retry to a full reload, matching the already verified home retry pattern. A disposable test-only header makes the error state reproducible during browser tests.
- Saved the reduced specification as `sources/sprint-8.md`. No new route, provider, dependency, migration, category, tag, date-range filter or OCR architecture was added.

## Pagination decision and disposable dataset

The existing 50-row server limit and next/previous links already expose all results, so no pagination code was added. PostgreSQL applies the owner predicate, search/filter conditions and deterministic ordering before `LIMIT 51 OFFSET`. A later empty page redirects toward a valid page. No signed receipt URLs are fetched for list rows.

On local macOS Node 22.15.0, disposable PostgreSQL 17, local object storage and Chromium, a dedicated browser case seeded 205 purchases for account A and seven distinct purchases for account B. It used repeated names/dates, known future and expired warranties, unknown/none states, long product/seller names, and one original receipt attached to two A purchases. All 205 A IDs were reached exactly once under each of newest, oldest and expiry ordering; a case-insensitive search reached the expected 204 IDs across pages. The four traversals took about 3.4 seconds in this local development run. This observation is not a production latency guarantee or a universal threshold. B saw only its seven IDs and no A search result or upcoming count; B and anonymous requests could not fetch A's original. The original download matched the uploaded synthetic PNG by SHA-256.

## Verification and audit

| Check | Result |
| --- | --- |
| `npm run lint`; `npm run test:lint-rules` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed, 60 cases in eight files |
| `APP_URL=http://127.0.0.1:3101 CEKIS_NEXT_DIST_DIR=.next-build npm run build` | Passed; `/pirkiniai` remains dynamically rendered |
| Focused Chromium/PostgreSQL `retrieval.spec.ts` | Passed, 2 cases: 205-row traversal, search, owner isolation, shared receipt, empty/error states, URL/clear behavior and 320/390/1024 px keyboard/overflow checks |
| Existing purchase/home browser cases | 16 passed; one old assertion initially expected a search-empty state for an account with no purchases. It was corrected and its affected case passed separately. |
| Focused purchase and OCR browser cases | Passed, 6 cases: affected manual cycle plus fresh new-purchase automatic scan, correction/save/reload/original bytes, footer-date candidates, ambiguous prices, wrapped item, and cancel/retry/manual fallback |
| Existing exact-head OCR repair CI | [Footer repair CI 37752348431](https://github.com/IgnasGaj/cekis/actions/runs/37752348431) and [field correction CI 37739887344](https://github.com/IgnasGaj/cekis/actions/runs/37739887344) passed on unchanged OCR code before Sprint 8. |
| `git diff --check` and focused self-audit | Passed before commit |

The focused audit inspected the owner predicate, parameterized `ILIKE`, allowlisted filter/sort/page inputs, count fallback, pagination order and link state, receipt authorization, and all changed UI copy. The first new traversal test raced the framework loading fallback and read only the first 50 cards; it now waits for the expected page count and next link. A purchase test then exposed the old empty-vault assertion described above. Both findings were fixed and their affected checks passed. The unchanged core OCR logic was not re-audited or rewritten.

Physical-device capture was unavailable; the verified paths use browser file selection and simulated 320/390 px viewports. No real-user data, email, production database or deployment was touched. Final candidate and main CI results are inspected at delivery; they are not claimed by this pre-push report.
