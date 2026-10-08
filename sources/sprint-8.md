# Čekis — Sprint 8: Simple retrieval and core-flow stability

Date: 2026-10-08
Repository: https://github.com/IgnasGaj/cekis.git
Specification path: `sources/sprint-8.md`

## 1. Outcome and revised scope

Make saved purchases and their original receipts easy to find without expanding the app into a complex organiser. Preserve all implemented features. Verify the capture → automatic scan → review → save → retrieve flow remains usable.

This specification narrows the original roadmap's Sprint 8 following the owner's decision to trim future additions. It does **not** authorise removing, hiding or disabling working functionality.

| Area | Sprint 8 decision |
| --- | --- |
| Product/seller search | Keep and fix concrete usability or correctness defects. |
| Existing warranty filters and home 30/90-day destinations | Preserve their behaviour and matching results. |
| Newest/oldest purchase sorting | Preserve existing sorting. |
| Nearest warranty expiry | Reuse existing sorting; add one simple option only if absent. |
| Categories | Defer new category UI/schema; preserve any already implemented feature. |
| Advanced/combined filter builder and purchase-date range controls | Defer new additions; preserve existing controls. |
| Tags | Defer. |
| Pagination/incremental loading | Add only if the existing list cannot reliably expose all results or performs poorly with the representative dataset. |
| Receipt scanning | Focused regression verification and fixes for reproducible failures, not a new OCR architecture. |

The product promise remains: save receipts, find them easily, and know when the recorded warranty ends. PWA/mobile polish, production hardening, closed beta and release remain later milestones. Do not treat reduced feature scope as permission to omit security, backups, account deletion or release verification.

This is an implementation specification, not a repository audit or a claim that Sprint 7 or scanning repairs have passed. Establish their actual state before changing code.

## 2. Start from the actual baseline

1. Read applicable `AGENTS.md`, working-tree status, remote, package scripts and CI configuration. Preserve unrelated changes and use only the Čekis repository, not `pirkejo_skydas`.
2. Fetch normally. Check whether Sprint 7 and intended scanning corrections are already on `origin/main`, using their reports and commit history. Do not assume completion from a filename. If required work is unmerged, inspect its relevant diff and checks and bring verified intended work onto main before starting Sprint 8, following the owner's standing instruction to merge after audits. Do not sweep unrelated branches into main.
3. Create `feature/sprint-08-simple-retrieval` from the verified main baseline, or resume the existing branch. Record base SHA and any prerequisite merge.
4. Read the roadmap's scope and relevant Sprint 8 section, this specification, current purchase-list queries/UI, warranty helpers, home links, and relevant recent completion/correction reports. This specification supersedes the original Sprint 8 expansion requirements only.
5. Inventory existing search, filters, sort modes and loading behaviour in a few lines. Reuse them; do not build duplicate routes, services or components.
6. Preserve the current PostgreSQL/Drizzle/private-storage architecture and established Lithuanian UI. Do not introduce Supabase, paid OCR, new providers or dependencies without a demonstrated need.

Respect later owner-approved warranty behaviour and merged implementation. The original planning brief contains older warranty-default guidance; Sprint 8 must not revert warranty settings or date calculations to that older plan.

## 3. Search and retrieval

Use the existing **Pirkiniai** screen. Keep search by product name and seller, case-insensitive as supported by the current implementation, with sensible trimming of surrounding whitespace. Keep the Lithuanian accessible label and a reachable clear-search action.

All search/filter/sort operations must be server-authorised and owner-scoped. Apply active predicates and ordering to the full matching dataset before limiting rows. Never search only the currently loaded page, interpolate query text into SQL, or use browser filtering as the access-control boundary.

Preserve current query-parameter/back-navigation conventions. Opening a detail page and returning should retain a useful list state. Clearing search must retain any explicitly selected existing filter/sort; changing the result definition resets pagination if present. Validate unsupported filter/sort/page values using the established input handling.

Keep truthful states:

- Empty vault: **Dar neturite pirkinių**, with **Pridėti čekį**.
- No search matches: **Pagal paiešką pirkinių nerasta**, with an easy search-clear action.
- No filtered matches: explain the selected filter and provide its existing reset path.
- Query failure: Lithuanian error and retry; never show a successful empty state for a failed request.

Each result opens the existing purchase detail and its original receipt preview/download. Long product/seller names must remain readable on mobile. Do not introduce receipt galleries or fetch signed file URLs for every list row.

## 4. Minimal useful sorting

Preserve existing newest/oldest semantics and labels. Do not silently change purchase-date sorting into record-creation sorting; the home recent-purchase section keeps its separate creation-order rule.

Keep or add **Artimiausia garantijos pabaiga** as a single list option using existing warranty helpers. Confirmed known warranty dates sort ascending with a stable ID tie-breaker; unknown/none records follow dated records in an unfiltered list. Existing status filters determine whether expired warranties are included. Keep existing established semantics if they are already different and useful; record them rather than redesigning working behaviour.

Home 30/90-day links must retain their exact current date predicates, Europe/Vilnius calendar rules and nearest-first ordering. Counts cover all matching purchases even if results are paginated. Do not change reminder delivery, warranty defaults, calendar boundaries or shared-receipt ownership rules.

## 5. Loading only when needed

Use a disposable dataset of approximately 200 purchases for account A and a small distinct set for account B. Include repeated dates/names, different warranty states and shared receipt associations. No real-user seeding.

Check whether the existing list exposes every matching record, whether server limits silently truncate results, and whether search/sorting remain practical. Record the environment and observed response/UI behaviour; do not invent a universal performance threshold from one local run.

If the current implementation already handles the dataset reliably with bounded loading, preserve it and document why no pagination change was needed. If there is silent truncation, unbounded full-vault fetching or a demonstrated loading problem, add the smallest server-side pagination or **Rodyti daugiau** solution consistent with current UI.

When added, use a documented bounded page size, deterministic ordering, validated page/cursor input and the existing query/index patterns. Show loading/retry/end state without dropping already loaded results. Stable data must have no duplicate or skipped records across pages. After edits/deletions, refresh/reset the result sequence as needed; no snapshot-pagination framework is required. Avoid new schema migrations unless an evidenced query need requires a small index.

## 6. Focused scanning regression check

Scanning reliability matters more than extra organisation controls. Reuse recent repair evidence and regression fixtures; do not repeat a full OCR audit if the same code and exact checks already passed.

Verify one fresh supported receipt through the **new-purchase** path: upload/capture starts the existing automatic scan, scan progress appears, review receives supported suggestions, the user can correct them, and save/reopen preserves fields and original bytes. Do not accept scanning only an already saved purchase as proof of this flow.

Use representative existing fixtures for seller, product, purchase date, receipt number and price. Include a receipt-date case from the reported repairs and an ambiguous/multi-item price case. Assert expected fields only when supported by the fixture; uncertain values remain reviewable or blank. A receipt total must not silently become one product's price.

Verify retry/cancel/manual fallback and duplicate-save protection with existing checks. If a regression is reproducible, repair its narrow cause and add a meaningful regression test. Do not rewrite OCR, promise every receipt will scan, or introduce automatic line-item splitting. If a necessary repair is substantial, document its exact scope and continue toward fixing the core failure rather than adding deferred features.

Use synthetic or existing permissioned fixtures. Do not commit personal receipt images, raw OCR text containing private details, signed URLs or credentials.

## 7. Verification with limited usage

No parallel agents, whole-repository re-audit, repeated clean installs, unrelated dependency upgrades or repeated successful full-suite runs. Inspect focused code and retain checkpoints.

Use current tests; add coverage only for changed behaviour. Required evidence:

1. Product/seller search, whitespace/case behaviour, clear action, no matches, invalid parameters and retrieval errors.
2. Existing filters/home destinations preserved; expiry sorting handles ties and unknown/none states without changing calendar rules.
3. Every relevant record remains reachable with approximately 200 purchases. If pagination changes, search/sort across page boundaries and stable traversal have no omissions/duplicates.
4. Real disposable PostgreSQL verification that account B and anonymous requests cannot obtain account A's results/counts or original receipts. Reuse current isolation tests where sufficient; mocks alone do not prove query isolation.
5. A browser flow: search → detail → original receipt → back; fresh receipt → automatic scan → review → save → search and reopen. Reuse recent unchanged OCR regression results where applicable, identifying the tested SHA.
6. Viewport checks at 320/390 px and desktop: search/clear/sort remain reachable, keyboard/focus works, long names do not overflow, bottom navigation does not obscure actions. These are not claims of physical-device testing.

During development run affected checks. At final implementation state run the repository's required lint, typecheck, unit tests and production build once, plus relevant database/browser checks. Keep existing CI intact and inspect its result for the exact pushed commit. After a fix, repeat affected checks; broaden only when the change warrants it. Install from the lockfile only if needed.

Do not send email to real users, modify production databases, activate paid services or deploy. Record passed/failed/skipped/unavailable separately. A blocked external check must have a concrete reason and remaining action; do not call it passed.

## 8. Audit, commit, push and merge

The owner has instructed that completed work is merged after audits. Do not repeat Sprint 7's old blanket instruction to leave every sprint unmerged.

1. Perform a focused self-audit of the final diff for this sprint's acceptance, owner scoping, data preservation, query behaviour and scanning regressions. Fix findings before delivery.
2. Save this specification in repository `sources/sprint-8.md` and write `sources/sprint-08-completion-report.md` with baseline, implemented changes, preserved/deferred features, pagination decision/evidence, tests, audit findings/resolution and limitations.
3. Commit and push normally to https://github.com/IgnasGaj/cekis.git using the legitimate existing Git identity. Neutral commit messages; no AI/Codex attribution, agent trailers or co-author lines. Do not invent an identity, force-push, reset user work or rewrite history.
4. Observe required CI on the final candidate. After the focused audit passes and required checks are green, merge into `main` using the repository's supported process and push normally. Respect branch protections. If main advances, integrate normally and rerun checks affected by that integration.
5. Inspect CI for the resulting main SHA. If protection, missing permissions, failing checks or unavailable required verification blocks merging, leave the verified branch pushed and state the exact blocker. Never bypass protection or claim main was updated when it was not.
6. Return candidate/main SHAs, CI links/status and any pending checks. Distinguish implementation verification from documentation-only commits. Leave a precise continuation note if interrupted.

Updating main is source delivery; it does not authorise a separate production deployment. If repository pushes trigger an existing automatic deployment, identify that configured behaviour before pushing and use the established workflow without changing hosting settings or audience.

## 9. Definition of done

- Existing features and data are preserved.
- Search and useful sorting reliably locate saved purchases and their original receipts.
- Existing warranty filters and home links remain consistent.
- The representative dataset exposes no hidden truncation; pagination is implemented only when justified.
- The fresh-receipt automatic-scan flow has real verification evidence or a clearly reported unresolved blocker.
- Focused audit and required checks pass; completion evidence is recorded.
- Code is committed, pushed and merged after the passing audit, or a precise merge blocker is reported.
- New categories, advanced filters, tags and other deferred expansion have not been added.

## Copy-paste start prompt

Read `sources/sprint-8.md` and implement the reduced Sprint 8 in https://github.com/IgnasGaj/cekis.git. Preserve every existing feature. Focus on reliable purchase/receipt retrieval, existing search and warranty controls, simple expiry sorting, and a focused fresh-receipt automatic-scan regression check. Defer new categories, tags and advanced filters; add pagination only for an evidenced need. Verify the actual Sprint 7/repair baseline, follow the usage-saving checks, fix audit findings, update the completion report, commit and push without AI attribution or co-author trailers, and merge into main after the audit and required CI pass. Do not deploy or activate paid services. Report actual SHAs, CI results and any blockers.
