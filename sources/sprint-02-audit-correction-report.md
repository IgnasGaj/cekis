# Sprint 2 audit correction report

Date: 2026-10-06. Audited starting tip: `f5bb1f850dbcdfae22e74d9e8453acd84b4e2de3`. Correction implementation commit: `758ee833ae929ba5ec6c188e2bc3a5e46862c963` on `feature/sprint-02-purchase-vault` at [IgnasGaj/cekis](https://github.com/IgnasGaj/cekis). The owner-configured author and committer identity was retained. The correction commit was pushed normally, and `git ls-remote` returned the same full SHA. No merge or deployment occurred.

## Corrected findings

**F1 — price/currency integrity.** The original PostgreSQL CHECK accepted UNKNOWN when a priced row had null currency. The Drizzle schema now requires `currency IS NOT NULL` in the priced branch. New forward migration `drizzle/0003_lovely_leech.sql` checks for existing affected rows, then replaces the constraint. Applied migration 0002 was not edited. No currency is inferred or silently filled. Before migration, `cekis_test` had zero affected rows; the local app database had no purchase table yet. A disposable old-schema database with one synthetic invalid row correctly refused migration and kept all data and migration history unchanged. After that test row was explicitly assigned its known EUR value, migration succeeded.

**F2 — stale later pages.** A later page whose owner-scoped result becomes empty now counts purchases with the same owner/search predicate, then redirects toward a valid page while preserving search, sort and deletion feedback. The target page number strictly decreases, preventing redirect loops under concurrent changes. Page 1 still displays the genuine account or search empty state.

## Verification

| Check | Result |
| --- | --- |
| Fresh database | `cekis_sprint2_audit_fresh` applied migrations 0000–0003, grants and limited-role check; rerunning migration retained four journal entries. |
| Existing-schema upgrade | `cekis_sprint2_audit_upgrade` began with migrations 0000–0002 and existing auth/purchase rows; migration 0003 and rerun preserved both rows and ended with four entries. |
| Invalid-data preflight | `cekis_sprint2_audit_invalid` began at migration 0002 with one priced/null-currency fixture. Migration refused it with three journal entries and the row intact. After an explicit fixture correction, it applied migration 0003. |
| Schema/SQL consistency | `npm run db:generate` reported no schema changes after migration 0003. The generated snapshot and SQL include the explicit non-null currency condition. |
| Limited-role constraint cases | Real PostgreSQL 17 browser integration test used `cekis_app`: `(12.50,NULL)`, `(12.50,JPY)` and `(NULL,EUR)` were rejected with SQLSTATE 23514; `(12.50,EUR)` and `(NULL,NULL)` were accepted. |
| Pagination | Browser cases cover 51→50 deletion from page 2, filtered last-page deletion, `page=999` with records, empty account/search, preserved sort/search URL state, previous/next links and other-owner records. |
| Regressions | `npm ci`, lint, lint-rule fixtures, typecheck, 11 unit tests, 16 Playwright tests using Mailpit and real sessions, production build, full and production-only npm audits all passed locally. Both audits found zero vulnerabilities. |

The browser suite ran from an isolated copy on port 3101 because the checkout's existing development server occupied 3100. It used the dedicated `cekis_test` database and Mailpit. Repeated local runs can consume Better Auth's real one-minute test limit; only disposable test `rate_limit` rows were cleared before the final full run. Production auth configuration and limits were unchanged. Browser tests still do not substitute for physical iPhone/Android or external mailbox checks.

The corrected implementation triggered [GitHub Actions run 37426925853](https://github.com/IgnasGaj/cekis/actions/runs/37426925853); its final status is recorded in the delivery response after inspection. The code, migration and regression tests were reviewed again at the correction commit. This local recheck resolves the two reported cases; an independent external re-audit remains a separate activity before treating the sprint as externally signed off. Next planned feature work remains Sprint 3 private receipt upload.
