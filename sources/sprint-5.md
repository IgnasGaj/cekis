# Čekis — Sprint 05: Warranty tracking

## Instruction to Codex

Implement Sprint 5 of the Čekis roadmap on top of the completed and corrected Sprint 4. This is an implementation task: inspect the repository, implement the bounded scope, verify it, fix failures, document the result, commit and push to `https://github.com/IgnasGaj/cekis.git`.

Create/use `feature/sprint-05-warranty-tracking`. Do not merge into the default branch or deploy. Preserve unrelated local work. Use ordinary descriptive commits, the repository's configured author identity, and no AI/Codex attribution, co-author trailers, assistant signatures or agent-identifying branch names. Do not fabricate an author identity.

The owner reports Sprint 4 is complete and fixed. This specification is not a fresh repository audit or proof of the final correction commit. Confirm the actual corrected baseline before implementation; do not use the old pre-correction SHA as if it were the latest head.

## 1. Outcome and boundaries

A signed-in user can record whether a purchase's warranty is unknown, absent or has a confirmed end date; enter an end date directly or confirm a date suggested from a duration; edit this information; and find purchases by warranty status or next expiry.

All UI, validation, accessible labels and feedback must be Lithuanian. Documentation and code may be English.

Implement only:

- Explicit warranty states and persistence.
- Direct end-date entry or duration-based end-date suggestion with confirmation.
- Warranty editing in existing purchase and receipt-review flows.
- Warranty status, calendar dates and remaining days in purchase list/detail.
- Warranty filters and next-expiry sorting.
- Necessary migrations, ownership enforcement, tests and documentation.

Defer reminder emails, delivery records, scheduler jobs, notification controls, categories, expanded search, home dashboard summaries, PWA, analytics, retailer integrations, complaints, legal decision engines and native apps. These belong to later sprints or are outside the roadmap. No default 24-month period, statutory guarantee calculation or claim of legal entitlement.

## 2. Inspect the baseline first

Read applicable `AGENTS.md`, the Čekis roadmap, Sprint 4 specification, completion/correction reports, schema/migrations, purchase validation and mutations, OCR review save, auth/ownership helpers, private receipt endpoints, deletion coordinator and CI.

Verify `origin` is the Čekis repository. Fetch remote refs and identify the newest corrected Sprint 4 commit. If default branch already contains it, branch from that baseline; otherwise branch from the corrected Sprint 4 branch. Record the exact base SHA and branch. Do not reset, force-push, merge unrelated branches or overwrite dirty work.

The earlier Sprint 4 audit requested F1–F3: truthful delivery evidence, keyboard-only review coverage, and explicit ambiguous-OCR guidance coverage. Confirm the corrected baseline includes these changes without redoing working features. If a material missing dependency blocks this sprint, identify it and resolve only the necessary bounded defect; do not silently claim it passed.

Keep the established Next.js/React/TypeScript, PostgreSQL/Drizzle, current authentication, private S3-compatible storage and browser OCR architecture. Do not introduce Supabase or replace authentication. Preserve original receipt bytes, shared receipt associations, private downloads, upload cleanup/replay handling and conservative OCR.

## 3. Warranty data contract

Use the existing purchase warranty fields where compatible. Otherwise add a minimal versioned migration. Warranty belongs to each purchase, not its shared receipt: two products on one receipt can have different dates.

| State | Stored meaning | User-facing text |
| --- | --- | --- |
| `unknown` | No confirmed warranty information | `Garantija nenurodyta` |
| `none` | User explicitly records no warranty | `Pažymėta: garantijos nėra` |
| `known` | User-confirmed calendar end date | Calculated status and saved date |

Use a clear selector with options such as `Nežinau / nenurodyta`, `Garantijos nėra`, and `Nurodyti garantiją`. For `none`, a concise detail label `Pažymėta: garantijos nėra` is preferable if it avoids confusion with unknown. Keep this distinction everywhere, including filters and accessibility text.

Store the canonical end date as PostgreSQL `date`; events such as updates use timezone-aware timestamps. An optional confirmed duration in whole months and input source (`date`/`duration`) may be stored only if needed to support truthful editing. Persist neither remaining days nor computed status: both change as the date advances.

Enforce database and server invariants:

- State is one supported non-null value.
- `known` requires a valid, finite end date.
- `unknown` and `none` have null end date and null duration/source metadata.
- A duration, if stored, is an integer from 1 to 600 months; document this application limit.
- Known end date cannot precede the purchase date. Past expiry dates are valid when consistent with the purchase date; historical purchases must remain editable.
- Reject impossible dates, unrecognised states, fractional/negative/zero duration, Infinity, malformed strings and contradictory combinations with Lithuanian errors.
- Reuse established supported purchase-date ranges; define a compatible finite end-date range and enforce it consistently in inputs, server validation and SQL. Never accept PostgreSQL infinity as a date.

Backfill existing purchases as `unknown` without inventing dates or durations. If actual confirmed warranty data already exists, inspect and preserve it; do not overwrite it with the backfill. Empty legacy scaffolding must not become a confirmed warranty.

## 4. Calendar rules — explicit product decisions

Use `Europe/Vilnius` for the application's current calendar date. Browser locale/timezone and database session timezone must not alter the result. Derive one authoritative `today` per response/query and pass it through calculations; do not independently evaluate clocks for filters and rendered badges.

The saved end date is inclusive: the warranty is displayed as valid through that calendar day and expired beginning the next day in Vilnius. This is an application display rule for the user's recorded date, not a legal interpretation.

Define `remainingDays = endDate − today` using civil calendar days. Do not divide local-midnight timestamps by 86,400,000 because DST days vary. Do not parse a calendar date and shift it through the viewer's timezone. Use strict date-only helpers with an injectable clock/reference date.

| Condition | Status | Example feedback |
| --- | --- | --- |
| `unknown` | `Garantija nenurodyta` | No countdown or invented date |
| `none` | `Pažymėta: garantijos nėra` | No countdown or expiry badge |
| Known and remainingDays > 30 | `Galioja` | End date and remaining days |
| Known and 0 ≤ remainingDays ≤ 30 | `Greitai baigsis` | `Baigiasi šiandien` at 0; `Liko 1 diena` at 1 |
| Known and remainingDays < 0 | `Pasibaigė` | Saved end date; no negative remaining-days display |

The 30-day inclusive window is only a display/filter threshold. It does not enable email reminders. Use correct Lithuanian day forms, including 1/2/10/11/21/22, through a small tested formatter or suitable existing utility.

Duration suggestions use the purchase date as the base. Add the entire number of months once and clamp the original day to the target month's final day. Do not add months iteratively, and do not subtract an extra day afterward.

| Purchase date | Duration | Suggested end date |
| --- | --- | --- |
| 2026-01-31 | 1 month | 2026-02-28 |
| 2024-01-31 | 1 month | 2024-02-29 |
| 2026-01-31 | 2 months | 2026-03-31 |
| 2024-02-29 | 12 months | 2025-02-28 |
| 2024-02-29 | 48 months | 2028-02-29 |

Show the suggested date clearly and require explicit confirmation before persisting it as `known`. Directly entered dates also require explicit confirmation. A checkbox or equivalent deliberate confirmation control is sufficient; no extra wizard is needed. New records start unknown, with no preselected duration or checked confirmation.

## 5. Editing, confirmation and concurrency

Use the existing purchase create/edit forms and add a compact warranty section to OCR review. The existing read-only placeholder on purchase detail becomes real data and an edit destination. Manual entry without a receipt remains fully supported.

- Selecting known exposes direct-date or duration entry and the confirmation control.
- Changing mode, duration, direct date or the purchase date invalidates confirmation of a new candidate. Do not save an old confirmed candidate after changing its inputs.
- Loading unchanged existing saved known data preserves its confirmed status; unrelated edits do not require needless reconfirmation.
- Changing purchase date must not silently recompute a saved confirmed warranty. Show the existing end date and require deliberate review of the affected warranty; offer a new duration suggestion only explicitly. Allow a consistent already-expired date.
- Changing known to unknown/none clears obsolete end date/duration metadata atomically. Toggling back must not silently restore a confirmed date.
- OCR never suggests, infers, confirms or overwrites warranty information. Any OCR-applied purchase-date change must obey the same confirmation rules.
- Ordinary purchase/review saves that omit warranty fields must preserve existing warranty data. Explicit warranty changes must submit a complete validated state. Do not turn omitted fields into unknown.
- Review save continues updating the existing purchase and receipt number transactionally; it must not create a duplicate purchase or damage receipt links.

Reuse the repository's mutation/retry protections. Ensure a stale form cannot silently overwrite a newer warranty or purchase-date edit. If no concurrency guard exists, add a small expected-revision check appropriate to the existing purchase update path, including OCR review. Check and update atomically, return a recoverable conflict, preserve entered values and offer reload/review. Unrelated broad concurrency refactors are outside scope.

Pending saves must not erase edits made afterward. Lost-response retry and duplicate submission must not create extra purchases or attach receipt objects twice. Failed validation/save preserves inputs; session expiry and missing/deleted purchase states remain truthful.

## 6. List/detail, filters and expiry sorting

On purchase detail show state, saved end date and remaining days where applicable. On list cards show a compact text status with a date when known. Use existing design tokens and restrained status colours; never communicate status by colour alone.

Extend the existing purchase list with:

- `Visi`.
- `Galioja` — known dates today or later, including the soon-expiring subset.
- `Greitai baigsis` — known dates from today through today + 30 days inclusive.
- `Pasibaigė` — known dates before today.
- `Garantija nenurodyta` — unknown only.
- `Pažymėta: garantijos nėra` — none only.

The active filter semantics must be documented; `Galioja` intentionally includes `Greitai baigsis`. Do not imply these two counts are disjoint. No home counts/dashboard implementation is required.

Add `Pagal artimiausią garantijos pabaigą`: unexpired known dates first in ascending end-date order; expired known dates next, most recently expired first; unknown/none last. Resolve all ties deterministically using an existing creation timestamp and ID. Document this grouping. Existing newest/oldest sorting remains available.

Apply filtering and sorting before pagination/limits in owner-scoped server queries, never only to the visible page. Combine with existing product/seller search. Validate/allowlist URL filter/sort values and use parameterised queries. Search, list, detail and counts, if present, must share the same status/date rules. Persist filter/sort in the established URL/navigation pattern, with useful no-results and clear-filter states. Do not add categories, tags or Sprint 8 advanced filters.

Long product/seller names must wrap. Verify around 320/390 px and desktop widths, visible focus, labelled controls, touch targets and save-button visibility with mobile keyboard/safe areas. Preserve existing bottom navigation.

## 7. Access and migration safety

Authenticate every load/mutation and derive owner from the session. Independently scope the purchase query, update and any associated receipt access. Never trust a submitted owner, object key or client-calculated status as authority.

Account B and anonymous requests cannot read/mutate A's warranty through app routes, forms, OCR review or any exposed database path. Do not weaken the limited database role or established grants. If the architecture uses server-mediated database access, test through its real boundaries; do not invent direct-client database access.

Use a forward migration without rewriting applied migrations. Update Drizzle schema/snapshots and constraints through the established workflow. Verify both a fresh database and an upgrade populated with synthetic Sprint 4 purchases/receipt associations, using disposable PostgreSQL. Test rerunning the supported migration command safely and check app-role permissions.

No production database changes, object-storage reconfiguration, paid service activation or deployment are authorised by this sprint.

## 8. Required verification

Run existing checks and add meaningful tests for new behaviour. Keep auth, purchase CRUD/search, private receipts, shared attachments, upload cleanup, OCR cancellation/retry, ambiguous guidance, keyboard review and duplicate-save protections passing.

### Domain/validation tests

- Unknown and none remain distinct and have no countdown.
- Invalid dates and inconsistent state/date/duration combinations fail.
- Every month-end/leap-year example above passes, including non-iterative month addition.
- Confirmation resets correctly on changed inputs, including OCR-applied purchase date.
- A saved confirmed date is not recomputed on unrelated edits or silently overwritten by purchase-date changes.
- Remaining-day boundaries at -1, 0, 1, 30 and 31 yield exact statuses.
- Vilnius midnight, DST transitions, year change and leap day behave independently of process/browser timezone.
- Status/filter definitions and deterministic sort groups agree.
- Lithuanian day forms and finite duration/date limits are tested.

### Database/integration tests

- Migration upgrades existing data to truthful unknown states and preserves receipt associations/bytes.
- Confirmed data persists across reload/sign-out/sign-in.
- State transitions clear obsolete metadata and SQL rejects invalid combinations.
- Two ordinary test accounts and anonymous requests prove isolation, including direct mutation and OCR review endpoints.
- Stale edit/review saves return conflicts rather than replacing newer data.
- Omitted warranty fields preserve existing data; explicit changes are validated atomically.
- Search/filter/sort work on server-side results beyond a single loaded page, and exclude another account's records.

### Browser/component verification

- Manual create with unknown, none, direct date and confirmed duration.
- Attempted save of an unconfirmed candidate fails with actionable guidance.
- Edit each state, clear dates, reload and see consistent list/detail output.
- OCR review preserves known warranty and requires review when purchase date changes.
- Keyboard-only warranty entry, confirmation, filter selection and save with visible focus.
- Save failure/conflict preserves inputs; no-results filter can be cleared.
- Narrow/mobile layout and desktop layout remain usable.

Use a controlled clock for boundary scenarios; avoid tests that become wrong tomorrow. Physical iPhone/Safari and Android checks may be reported pending if actual devices are unavailable; browser emulation is separate evidence. Record the actual commands/results, including unavailable checks; do not invent passing tests.

Run the repository's actual equivalents of clean install, lint, lint-rule verification, typecheck, unit/component tests, PostgreSQL integration tests, relevant Playwright suite, production build and dependency audits. Keep separate dev/build outputs. Do not weaken CI or skip existing checks to get a green result. Audit findings must be reported accurately and any within-scope regression resolved.

## 9. Documentation and delivery

Keep all sprint specifications and reports in `sources/`.

Create `sources/sprint-05-completion-report.md` documenting:

- Base branch/SHA and what confirmed the corrected Sprint 4 baseline.
- Final schema/state model, migration/backfill and ownership boundaries.
- Vilnius date policy, inclusive end day, 30-day window, month clamping, input limits and sort/filter semantics.
- Confirmation, purchase-date editing, concurrency and omitted-field preservation behaviour.
- Features/screens changed, verification results, pending device checks and genuine limitations.
- Implementation commit, final remote branch and exact-head CI evidence with truthful distinctions.

Update existing setup/technical docs only where necessary. Commit verified code/migrations/tests/docs using normal messages, such as `Add confirmed warranty tracking`, then push the Sprint 5 branch to the Čekis repository. Verify the remote contains the intended final changes. Inspect CI for the final pushed SHA where available and resolve failures. If unavailable or still running, report that status instead of claiming it passed.

Avoid a self-referential report: a report committed afterward changes the head SHA. Distinguish the implementation SHA from later documentation commits and state final head/CI evidence in the final response. Never claim an earlier CI result proves a later commit passed.

Finish with the branch, implementation/final SHA, repository link, implemented behaviour, check results and any blockers. Do not merge, deploy or begin Sprint 6.

## 10. Definition of done

Sprint 5 is complete when all three warranty states persist correctly; end dates are explicitly confirmed; date/duration boundaries follow the rules above; list/detail/filter/sort agree; OCR and existing saves preserve warranty data safely; two-account access and stale-edit protection pass; migrations preserve existing purchases/receipts; required checks pass or genuine limitations are clearly identified; and the verified branch is pushed without merging.

## Copy-paste launch prompt

Implement `sources/sprint-5.md` completely on top of the corrected Sprint 4 baseline in the Čekis repository. Follow the specification, preserve existing authentication/private receipts/OCR, run meaningful checks, fix failures, write `sources/sprint-05-completion-report.md`, commit and push `feature/sprint-05-warranty-tracking` to `https://github.com/IgnasGaj/cekis.git`. Use normal commits without AI/Codex attribution or co-author trailers. Do not merge, deploy or start Sprint 6. Report the exact final head and its verification status.
