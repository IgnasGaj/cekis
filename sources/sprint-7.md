# Čekis — Sprint 7: Useful home screen

## Goal and baseline

Replace the initial **Pradžia** shell with a useful, compact home screen: a prominent receipt-add action, accurate upcoming-warranty information and recent purchases.

The owner confirms Sprint 6 and its corrections are complete and pushed to `main`. Start from current `origin/main` in `https://github.com/IgnasGaj/cekis.git`. This specification is based on the Čekis roadmap and that confirmation; it is not a fresh repository audit. Čekis uses PostgreSQL, Drizzle and private object storage, not the old Pirkėjo Skydas/Supabase architecture.

All product text, accessible names and errors must be Lithuanian. Keep discussions and technical documentation in English. Implement only Sprint 7.

## 1. Brief inspection and usage budget

1. Inspect working-tree state, remote, applicable `AGENTS.md`, package scripts and CI. Preserve unrelated changes; never reset or overwrite them.
2. Fetch normally and create `feature/sprint-07-home-screen` from current `origin/main`. Record its base SHA. Reuse an existing Sprint 7 branch if this task is being resumed.
3. Read the roadmap's scope/design/Sprint 7 sections, relevant Sprint 5/6 completion/correction reports and the current home, purchase queries/list/detail, warranty helpers and mutation invalidation. Inspect only files needed for this change.
4. Briefly confirm that merged Sprint 6 correction evidence is present and the current baseline's CI status. Do not repeat the Sprint 6 audit or email delivery suite merely to start this UI sprint. If a concrete blocker exists, report its evidence and resolve only what is necessary; do not silently claim missing acceptance.
5. Reuse current design tokens, components, authentication, routes and calendar rules. Avoid new dependencies and database migrations unless the actual implementation needs them.

Save usage: no parallel agents, whole-repository re-audit, repeated clean installs, redundant full-suite runs or long log dumps. Use focused tests while implementing, then one final required verification pass. After a failure, rerun affected checks; repeat broader checks only when the fix affects them. Keep concise checkpoints in the completion report so a resumed session continues from the last verified state.

## 2. Home layout

Keep the current authenticated home route and bottom navigation: **Pradžia**, **Pirkiniai**, **+ Čekis**, **Nustatymai**. Do not create a second dashboard route.

In reading order:

- A simple **Pradžia** heading and prominent **Pridėti čekį** action linking to the existing capture/upload/manual-entry flow.
- A compact upcoming-warranty summary for the next 30 and 90 days.
- **Artimiausios garantijų pabaigos**: at most five eligible purchases, nearest end date first; product name, seller where useful, saved warranty end date and clear remaining-days/status text. Each item opens its existing detail page.
- **Naujausi pirkiniai**: at most five purchases, most recently created first, with product name, seller and purchase date. Label this section by record creation order; do not accidentally sort it by purchase date. Reuse the existing card language and optional warranty status.
- **Visi pirkiniai** leads directly to the existing purchase list. Summary links lead to matching owner-scoped warranty results as specified below.

Use deterministic tie-breakers, such as creation timestamp and ID, for equal expiry dates or creation timestamps. Do not show price totals, charts, spending analytics, generic widgets or receipt thumbnails requiring extra file fetches. Warranty and recent sections may include the same purchase because they serve different purposes.

## 3. Exact warranty semantics

Reuse the existing warranty/calendar helpers and expiry boundary from Sprints 5/6. Calculate one Europe/Vilnius civil `today` per home request; use calendar dates rather than elapsed 24-hour milliseconds or browser-local timezone. PostgreSQL dates must not shift through JavaScript UTC conversions.

Only purchases with a confirmed known warranty end date qualify. Unknown, none, expired and other users' purchases never enter upcoming totals or rows. Email reminder enablement/delivery state does not affect warranty visibility.

Define `daysRemaining` as the existing calendar-day difference between `today` and the saved end date. If expiry remains inclusive through the end date, an end date of today qualifies with zero days and displays **Baigiasi šiandien**. Preserve the merged baseline's established semantics; if they differ, document and reconcile the discrepancy rather than adding a second rule.

Use cumulative windows:

| Label | Included calendar-day range |
| --- | --- |
| Per artimiausias 30 dienų | 0–30 inclusive |
| Per artimiausias 90 dienų | 0–90 inclusive |

The 90-day count includes the 30-day count. Add concise clarification, **Į 90 dienų skaičių įtrauktos ir artimiausios 30 dienų.** Never sum these counts or present them as exclusive groups. Count purchases, not receipts, attachment links or reminder delivery rows. Shared/multiple attachments must not multiply totals.

The upcoming list contains the nearest five qualifying purchases within 90 days. Its heading/copy must make this horizon clear. Summary counts cover the full eligible dataset, not only these five rows.

## 4. Matching destinations and data freshness

Each summary count must open results using exactly its date predicate and timezone. Reuse existing list filters if they express those windows accurately. If necessary, add only a small validated upcoming-window parameter (30/90) to the current purchase list. Do not implement Sprint 8 categories, advanced search or a new filtering framework. Reject or safely normalize unsupported parameters using the existing validation style; never interpolate input into SQL.

A purchase in a summary result opens its detail page in one tap. Add and all-purchase links use existing routes and must work when a user returns from those destinations.

Use server-side authenticated, owner-scoped queries with bounded row limits and aggregate counts. Do not download the entire vault to the browser, perform per-item database/file requests, or duplicate warranty business logic. Prefer a coherent query/snapshot for counts and rows where practical. No cross-user global caching, sensitive static generation or shared authenticated-response cache.

After create, edit, delete or warranty-state/date changes, revisiting the home must reflect saved data using existing mutation invalidation/refresh patterns. Ensure date-dependent content refreshes on a new request after Vilnius midnight. No polling infrastructure is required. Home rendering is read-only: it must not enqueue, dispatch or change email reminders.

## 5. Empty, loading and error states

- No purchases: **Dar neturite pirkinių**, a short explanation and **Pridėti čekį**. Show honest zero counts or omit irrelevant warranty blocks consistently.
- Purchases but none upcoming: **Per artimiausias 90 dienų garantijos nesibaigia.** Continue showing recent purchases and the add action.
- Only unknown/no/expired warranties: use the same truthful no-upcoming state; do not suggest a default warranty period.
- Loading: use existing lightweight loading/skeleton patterns and accessible status where appropriate.
- Retrieval failure: a Lithuanian error with a retry path. Never render failed queries as successful zero counts or an empty vault.

Do not imply that an unknown warranty is expired. Reuse existing Lithuanian date formatting and status language.

## 6. Mobile and accessibility

Follow the established calm mobile design: light background, restrained accent, subtle borders, simple icons and 12–16 px corners. Keep content centred on desktop and actions around 44 px or larger.

Check 320 px and approximately 390 px widths, desktop, long product/seller names, large text, focus visibility and bottom safe-area spacing. Cards must not cause horizontal overflow; bottom navigation must not hide the last action. Use semantic links/headings, accurate accessible names and readable status text rather than colour alone.

Inspect existing repository design references if available. The four original JPEG attachment paths were unavailable when this prompt was prepared; do not claim they were inspected. If they remain unavailable, proceed using established application components and the written design brief, recording this visual-reference limitation without blocking implementation.

## 7. Focused verification

Use existing test tools and disposable fixtures. Add meaningful tests for new query/filter behavior; avoid snapshot tests that merely mirror markup.

Required coverage:

1. Calendar boundaries: yesterday, today, +1, +30, +31, +90 and +91; unknown and none excluded. Include a Vilnius-midnight/UTC-date difference and reuse existing DST/leap-year calendar tests where suitable.
2. Counts over more than five eligible purchases, nearest-first limit/order, deterministic ties, recent-by-creation order, and no multiplication from shared/multiple receipts.
3. Two-account isolation of totals, rows and linked filtered results; anonymous home access follows existing authentication rules. Use real disposable PostgreSQL for query acceptance, not mocks alone.
4. Browser flows for empty/populated/no-upcoming home, summary links matching their counts, detail/add/all-purchase navigation and freshness after representative create/edit/delete changes.
5. A retrieval-failure state and mobile overflow/focus checks. Record automated viewports separately from physical-device checks; physical phones are not a new acceptance gate for this limited sprint.

Run focused new tests during implementation. At final code state, run existing lint (including lint-rule checks if provided), typecheck, unit tests and production build once. Run relevant database/browser integration coverage once; retain existing CI checks without weakening them. Let unchanged broad receipt/OCR/email suites run through existing CI rather than duplicating the whole stack locally unless a change or failure justifies it. If CI is unavailable, report the gap and run the affected existing checks locally where possible.

Install with the lockfile only if dependencies are absent or changed. Do not upgrade dependencies or conduct a separate security audit without a concrete need. Do not weaken tests, skip failing checks to obtain green status, or represent unavailable checks as passed.

## 8. Scope and delivery

No PWA/service-worker work, push notifications, categories, tags, advanced search, legal features, VVTAT packages, price comparison, analytics, provider activation or production deployment. Preserve original receipts, owner isolation, OCR review, warranty edits and the corrected reminder behavior. Do not send test email to real users or mutate production data.

Save this specification as `sources/sprint-7.md` in the repository. Update `sources/sprint-07-completion-report.md` with:

- Base SHA, final scope and changed files.
- Calendar predicates, list ordering and destination/filter behavior.
- Exact validation commands/results and unavailable checks.
- Short visual findings and any remaining blocker.
- Final pushed SHA and exact-head CI URL/status in the final handoff; distinguish implementation commits from later documentation-only commits.

Commit using the legitimate existing configured author/committer. Use neutral messages and branch names; no AI/Codex attribution, agent trailers or co-author lines. Do not invent an identity if Git is unconfigured. Push normally to `https://github.com/IgnasGaj/cekis.git`; no force-push, merge to main or deployment in this sprint. Observe CI for the exact final pushed head without rerunning successful workflows unnecessarily. Report pending CI honestly if it cannot be observed.

Acceptance: the home gives an accurate private summary, correct matching destinations, recent purchases and a reachable add action; new behavior passes focused verification and required existing checks, and the work is committed and pushed for review.

## Copy-paste start prompt

Read `sources/sprint-7.md` and implement Sprint 7 from current `origin/main` in `https://github.com/IgnasGaj/cekis.git`. Build the Lithuanian useful home screen with cumulative 30/90-day warranty counts, nearest upcoming warranties, recent purchases and existing add/navigation links. Reuse established calendar, owner-scoping and UI logic. Follow the usage-saving verification plan, update the completion report, commit and push without AI attribution or co-author trailers. Do not merge or deploy. Report the final SHA, exact-head CI result and any remaining blockers.
