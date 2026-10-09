# Čekis — Whole-project audit before Sprint 9

Date: 2026-10-09 · Repository: https://github.com/IgnasGaj/cekis.git

Audited main commit: `d88330e04b71f03c5df2c3957440ea3a42a1d7bf`.

## Verdict

**Corrections recommended before Sprint 9. Not a clean audit pass, and not a production-release approval.**

The implemented foundation is working and its exact main CI is green. No critical cross-account exposure was found in the reviewed access paths. However, shared receipt metadata can be overwritten from a stale review, receipt selectors silently truncate results, and the current OCR review browser check still passes only after retry in main CI. Resolve the focused findings below before adding PWA behaviour. There is no reason to rebuild the app or add deferred features.

This was a read-only repository audit. No production database, real-user email, hosting setting, GitHub setting, remote branch or application source was changed. A separate disposable checkout was used. Next's build-generated tsconfig additions were restored with a narrow patch; tracked source matches the audited commit.

## 1. Baseline and scope

- `main` and `feature/sprint-08-simple-retrieval` both pointed to the audited SHA.
- GitHub's default branch still pointed to `feature/sprint-01-authentication-app-shell`, not main. The initial default clone therefore showed Sprint 1; the audit explicitly fetched and selected main.
- The repository's reduced `sources/sprint-8.md` supersedes the original roadmap's categories/date-range expansion. Their absence is intentional, not a defect.
- Current warranty behaviour follows the later owner-approved implementation: 24 months by default, with 6/12/24/36 choices and automatic end-date calculation. The original roadmap's no-default guidance is historical and must not be used to revert this feature.
- Reviewed application layers: authentication/session/origin checks; purchases and search; original-receipt upload, associations, download and deletion; OCR parser/image/worker/review; warranty helpers; reminder preferences, scheduling, worker and SMTP classification; home/settings/navigation/CSS; schema and migrations; runtime grants; cleanup scripts; tests, CI and operating documentation.
- The audit is source review plus available automated evidence, not a penetration test, production infrastructure audit or physical-device usability certification.

## 2. Verification evidence

### Fresh checks in this audit environment

| Check | Result | Qualification |
| --- | --- | --- |
| Lockfile install | Passed | `npm ci --ignore-scripts`; 477 packages. Install lifecycle scripts were intentionally not run; OCR preparation ran explicitly during build. |
| Unit tests | Passed | 60 tests in 8 files. |
| ESLint | Passed | `npm run lint`. |
| Lint negative fixtures | Passed | `npm run test:lint-rules`. |
| Route generation/typecheck | Passed | `npm run typecheck`. |
| Production build | Passed | `npm run build`, separate `.next-audit-build` output and disposable configuration; no live database connection required. |
| Full dependency audit | Passed | `npm audit --json`: 0 known vulnerabilities at audit time. |
| Shared receipt stale-review probe | Defect reproduced | Actual unchanged route with a mock SQL adapter; **not** a real PostgreSQL concurrency test. |
| Null JSON request probes | Defects reproduced | Actual unchanged route handlers with mocked auth; fail before database access. |

Local runtime was Node **24.19.0**, whereas this project declares Node 22 (`>=22 <23`). The successful local runs are supplementary, not a replacement for verification on the supported runtime. No dependency or engine change was made.

### Exact-main CI independently inspected

[Main CI run 37824588095](https://github.com/IgnasGaj/cekis/actions/runs/37824588095) completed successfully for the audited SHA on 2026-10-08. The job logs show Node **22.23.3**.

| CI check | Observed result |
| --- | --- |
| Clean install, full and production dependency audits | Passed; 0 known vulnerabilities. |
| Migrations twice, grants and limited-role check | Passed. |
| Disposable database migration/constraint test | Passed. |
| Storage initialisation and cleanup dry-run | Passed. |
| Lint, lint fixtures and typecheck | Passed. |
| Unit tests | 60 passed. |
| Reminder integration tests | 22 passed. |
| Chromium browser suite | **51 passed, 1 flaky**; flaky case passed on retry. Do not describe this as 52 clean first-attempt passes. |
| OCR asset preparation and production build | Passed. |

PostgreSQL, Docker, Mailpit and a disposable object store were not available as configured local services in this audit environment. Fresh authenticated browser, database and real SMTP integration runs were therefore not executed here; the exact-SHA CI logs were inspected instead. No tests were silently labelled passed locally.

## 3. Findings and acceptance for corrections

P2 = focused correctness/reliability issue worth resolving before Sprint 9. P3 = lower-priority robustness/documentation/configuration issue.

### F1 — P2: Stale review of a shared receipt can undo its corrected number

Evidence: `src/app/api/receipts/[id]/review/route.ts:34–62`; `src/app/pirkiniai/[id]/cekis/[receiptId]/page.tsx`; `src/lib/schema.ts`.

The review endpoint locks the purchase and receipt but checks only the **purchase revision**. Receipt number belongs to the shared receipt, and the receipt has no corresponding revision guard. Saving the review of purchase A increments A's revision, not B's. A stale B review therefore still passes its revision check and unconditionally overwrites the receipt number.

Reproduction:

1. Attach receipt R to purchases A and B.
2. Open both review pages while R's number is `ORIGINAL`.
3. Save A's review with `CORRECTED`.
4. Save B's older review, even if changing only B's product information.
5. R's number becomes `ORIGINAL` again, without a conflict warning.

The disposable route probe produced `firstStatus=200`, `afterFirst=CORRECTED`, `staleStatus=200`, `afterStale=ORIGINAL`. Its database adapter was mocked; source inspection confirms the missing receipt-version predicate. Row locking serializes writes but does not detect a stale user's snapshot.

Impact: lost reviewed shared metadata within one account. This does not establish cross-account access or loss of original file bytes.

Correction acceptance:

- Protect shared receipt metadata with its own optimistic concurrency check, or an equivalent server-verified original-value comparison.
- A stale review must not revert a newer receipt number merely because its purchase revision is still current.
- Define the conflict/reload message in Lithuanian and preserve entered purchase values.
- Add a real disposable PostgreSQL/two-review regression: A corrects the number, stale B saves, correction remains or B receives a conflict. Verify same-request replay and normal single-purchase review still work.
- If schema changes are necessary, use a forward migration, never edit applied migrations.

### F2 — P2: Receipt picker and attachment list have silent reachability limits

Evidence: `src/app/api/receipts/list/route.ts:12–17`; `src/app/pirkiniai/[id]/page.tsx:19–27`; `src/components/receipt-manager.tsx:31–40`.

The existing-receipt picker returns at most 50 files, searches filename only and has no next-page/cursor/load-more mechanism. The selector displays only filenames, so equal names are also indistinguishable. Separately, purchase detail fetches at most 100 attachments without a continuation path or a matching server-enforced association cap.

Deterministic reproduction from the query/UI contract:

- Give one account 51 ready receipts called `cekis.jpg`, with distinct creation times, none linked to the target purchase.
- The target purchase's picker and filename search both return the newest 50. Searching `cekis.jpg` cannot reveal the oldest receipt; no UI action fetches the next result set.
- More than 100 associations on a purchase similarly leave older attachments absent from its detail screen.

This was confirmed by source inspection, not a newly seeded database run. Existing 205-purchase traversal coverage verifies the **purchase list**, not these receipt limits.

Impact: a valid saved receipt may be impossible to select for a second product from the normal UI; attachments can appear absent without being deleted. Reuploading creates unnecessary duplicate originals.

Correction acceptance:

- Keep bounded queries but expose all eligible receipts/attachments through a small owner-scoped pagination or load-more mechanism.
- Use deterministic timestamp-plus-ID ordering and validate page/cursor input.
- Give repeated filenames a useful distinguishing label, such as upload date, without exposing object keys.
- Test at least 51 same-name eligible receipts and 101 attached receipts, or explicitly design and enforce a justified attachment cap with a clear message. Do not silently impose a cap on existing data.
- Preserve shared-receipt ownership, original bytes and the working purchase-list pagination.

### F3 — P2 verification gap: Exact-main OCR review test remains flaky after the reported fix

Evidence: main CI run 37824588095, job 113474014650; `tests/e2e/receipts.spec.ts:565`, particularly line 644; `sources/sprint-08-completion-report.md`.

The completion report describes correcting a heading/reload timing failure after a PDF manual review. The final main logs still show this case failing on its first attempt, now at the preceding **post-save URL assertion**:

`await expect(page).toHaveURL(...?busena=atnaujinta, { timeout: 15000 })`

The browser remained on `/pirkiniai/<purchase>/cekis/<receipt>` rather than reaching purchase detail. The retry passed, leaving CI's summary at `51 passed` and `1 flaky`.

Impact: green CI does not demonstrate reliable first-attempt review/save/navigation for this core flow. The evidence alone does **not** establish whether the cause is hydration, test synchronization, a failed POST or production application behaviour.

Correction acceptance:

- Reproduce the affected case with retries disabled and capture the save request/response, visible form errors, stored product value and navigation sequence.
- Distinguish an actual failed save from a successful save with delayed navigation or a premature test click.
- Repair the demonstrated cause. Keep both persistence and user-navigation assertions; do not merely increase retries, skip the case or remove the failing assertion.
- Run the affected case a small number of times after correction, then one required final suite. Update the completion report with actual first-attempt/retry results.

### F4 — P3: Valid JSON `null` causes unhandled errors in receipt mutations

Evidence: `src/app/api/receipts/[id]/links/route.ts:10`; `src/app/api/receipts/cancel/route.ts:8`.

Both handlers catch JSON parse failures but assume that successfully parsed JSON is a non-null object. Authenticated same-origin requests with body `null` throw before the intended validation and database try/catch:

- Links: `TypeError: Cannot read properties of null (reading 'purchaseId')`.
- Cancellation: `TypeError: Cannot destructure property 'key' ... as it is null`.

The actual handlers reproduced these exceptions with mocked authentication and no database connection. In the app this becomes a framework error response rather than the intended controlled Lithuanian client error.

Correction acceptance: validate a non-null plain object and required scalar fields before access/destructuring; return a controlled 4xx for null, arrays, strings, malformed JSON and missing/wrong-type IDs. No cross-owner state should change.

### F5 — P3: GitHub default branch is stale

The repository metadata reports `feature/sprint-01-authentication-app-shell` as default. Current source is on main, but default clones and branch-omitted file reads select Sprint 1. This audit encountered that behaviour directly and corrected only its local checkout selection.

Recommended action: have the owner set GitHub's default branch to `main`, then verify a fresh default clone resolves to current main. This is a repository setting change, not a code fix, and was **not** performed by this audit. Do not delete feature branches or bypass protections as part of changing the default.

### F6 — P3: Current README describes superseded warranty and scanning behaviour

Evidence: `README.md:82–86`, `README.md:100`, `README.md:112`; current `src/lib/warranty.ts`, `src/components/warranty-editor.tsx`, `src/components/receipt-upload.tsx`.

README still says warranty starts unknown with no default, users can enter dates/1–600 months with separate confirmation, and a selected receipt has no extracted information. Current code defaults new purchases to 24 months, presents 6/12/24/36 choices, preserves legacy date/custom-duration values and automatically scans supported selected images.

Recommended action: update current operating documentation to the implemented, owner-approved behaviour. Do not revert working code to match old prose. Historical sprint reports may remain historical if clearly labelled. Record Sprint 7/8 and exact final CI evidence in the progress/completion documentation.

## 4. What is sound in the reviewed implementation

| Area | Evidence-backed assessment |
| --- | --- |
| Auth and sessions | Email-link auth, hashed link tokens, database sessions, server-side session requirements and bounded email-send quotas. CI covers link expiry/replay, concurrent consumption, sign-out and rejected origins. |
| Owner isolation | Reviewed purchase, receipt and review queries bind the authenticated owner; upload/link operations validate owned parents. Composite owner foreign keys prevent cross-owner associations. No RLS guarantee is assumed. |
| Receipt originals | Private authenticated read/download, no-store headers, stored-size/SHA-256 verification and unchanged-byte storage. |
| Shared receipt preservation | Purchase deletion removes its links; cleanup skips receipts still linked elsewhere. Delete-everywhere is separately labelled and confirmed. |
| Upload recovery | Durable reservations, owner-bound submission keys, file hash comparison, cancellation tombstones and retry paths preserve completed originals. |
| Validation | Exact decimal prices, supported currency rules, bounded JPEG/PNG/PDF validation, isolated bounded PDF parse, and owner upload attempt limits. |
| OCR | Same-origin lit/eng assets, browser worker, alternate/footer passes, cancellation, manual fallback, editable suggestions and separate receipt total/product price. Existing CI exercises new-purchase automatic scanning. |
| Warranty | Per-purchase dates, month-end/leap-year handling, unknown/none distinction, inclusive expiry and Europe/Vilnius calendar semantics. Owner-approved defaults are preserved. |
| Reminders | Verified recipient, global/per-purchase choices, durable identities, claims/leases, bounded retry budget and uncertain-acceptance quarantine. Existing integration tests cover overlaps, edits and opt-out. |
| Purchase retrieval/home | Parameterized owner-scoped search, literal wildcard escaping, filters before pagination, stable purchase ordering, and consistent 30/90-day home predicates. |
| UI foundation | Lithuanian copy, labels, visible focus, safe-area padding, large controls and long-text wrapping are present in reviewed source. This is not new physical-device verification. |
| Dependencies/build | Fresh local checks and exact-main supported-runtime CI are green, subject to F3's browser flake qualification. |

Passing review/tests reduce risk; they do not prove absence of all defects. In particular, synthetic OCR coverage does not guarantee successful extraction from every real photo.

## 5. Later-sprint work and release blockers — not missing Sprint 8 features

Keep these explicit instead of declaring the application release-ready:

- **Sprint 9:** PWA manifest/icons/install guidance; safe cache policy excluding private files and authenticated responses; truthful offline behaviour; actual iPhone Safari and Android Chrome capture/upload/review/save/install tests, including image dimensions and HEIC fallback. Browser viewport tests do not replace these.
- **Sprint 10:** complete user-facing account deletion with recoverable object cleanup; production privacy/help and operational data controls; reviewed deployment, logging, limits, monitoring and credentials; backup-and-restore drill covering PostgreSQL **and** originals.
- **Before deployment:** verify chosen hosting supports the current 10 MiB upload request, validation child process and bounded request duration. The source does not configure a production host, and a successful Next build is not proof of provider compatibility.
- **Before reminder promise:** configure the real sender and protected external scheduler, verify external inbox delivery, and schedule receipt cleanup. Code and local SMTP evidence do not prove these are active in production.
- **Before public release:** check actual production migrations, private bucket permissions, operating quotas/costs, rollback and final production flows.

None of these future requirements authorises new categories, tags, analytics, legal workflows, automatic multi-item splitting or native applications.

## 6. Efficient next step

Recommended order: **F1/F2 correctness fixes → investigate F3 → small F4/F6 corrections → owner handles F5 → verify corrected head → Sprint 9**.

For a later authorised correction task, use this report as a focused checklist, not a reason for another whole-project audit. Start from the latest main, compare intervening changes against the audited SHA, preserve unrelated work and add targeted regression cases. Use disposable services, no real-user email or production data. Run affected checks while fixing, one final required validation pass, and inspect CI logs for the exact delivered SHA, including retry/flaky counts. The standing merge-after-passing-audit workflow still applies, subject to permissions and protections; this audit itself made no commits or merges.

Do not start Sprint 9 or implement corrections merely because this audit report exists; the current user request was to audit and report.
