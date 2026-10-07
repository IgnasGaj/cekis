# Čekis — Sprint 5 audit and correction handoff

Date: 2026-10-07, Europe/Vilnius.
Repository: https://github.com/IgnasGaj/cekis.git
Branch: `feature/sprint-05-warranty-tracking`.
Audited final head: `55666ae0d61ea9794d5ee5a0ec17a71868103eb2`.
Implementation commit: `81d1b1bfc19eb61232156c65063eae9950cfec1b`.
Corrected Sprint 4 base: `0bc2c3f0482e9602658166b14b451dc50023dbde`.

## Verdict

**CORRECTIONS REQUIRED before accepting Sprint 5 or starting Sprint 6.**

The implementation substantially follows the Sprint 5 contract. Date arithmetic, inclusive expiry, explicit confirmation, unknown/none distinction, server-side filtering/sorting, PostgreSQL constraints, ownership queries and ordinary edit/review revision checks are implemented. Existing checks and final-head CI pass.

Two save/retry defects nevertheless affect the new warranty information. F1 can discard an edit accepted while receipt-backed creation is pending. F2 can report an earlier manual creation as successfully saved after the user changes the confirmed warranty on a retry. Both are P2 correctness issues; neither demonstrates cross-account access or original-receipt corruption.

This audit changed no application code, commits, branches, remote refs or production data. Local diagnostic probes used controlled mocks; they are defect reproductions, not acceptance tests proving corrected behaviour. No merge, push or deployment was performed.

## Verification and limits

The audit used a fresh clone pinned to the final remote Sprint 5 head. Git ancestry confirms the corrected Sprint 4 base is present. No applicable `AGENTS.md` was found in the checkout. The repository default still points to the Sprint 1 branch; this audit did not change that configuration.

Reviewed the Sprint 5 specification and completion report; complete Sprint 5 source diff; warranty domain/editor; manual forms/actions; receipt-add and OCR-review paths; purchase creation/update/deletion; list/detail pages and SQL filtering; schema/migration; relevant tests; runtime configuration and CI. This is a source and executable-check audit, not proof of every possible runtime input or visual equivalence to the reference images.

| Check | Evidence/result |
| --- | --- |
| Fresh `npm ci` | Passed locally; engine warning because local Node is 24.19.0 and project targets Node 22 |
| `npm run lint` and `npm run test:lint-rules` | Passed locally |
| `npm run typecheck` | Passed locally |
| Existing `npm test` | 37 tests passed in 5 files locally |
| Production build and OCR asset preparation | Passed locally with synthetic build configuration and separate `.next-build` output |
| `npm audit` | Zero vulnerabilities locally |
| `npm audit --omit=dev` | Zero vulnerabilities locally |
| Additional diagnostic probes | 2 passed their defect-reproduction assertions; F1 component/hook harness and F2 real action/create code with mocked database conflict |
| Exact-final-head CI | Passed; run 37511034206 for `55666ae0d61ea9794d5ee5a0ec17a71868103eb2` |
| CI migration/grants/limited-role checks | Passed; migrations twice, `test:db`, storage init and cleanup dry-run |
| CI tests | Job logs confirm 37 unit cases and 30 Playwright cases passed |
| Local live PostgreSQL/SMTP/S3 browser suite | Not rerun here: no local service stack was available; live integration evidence comes from inspected exact-head CI |
| Physical iPhone/Safari, Android and production state | Not tested/inspected; remain separate pending checks |
| Tracked worktree and whitespace | No tracked changes; `git diff --check` passed |

Final-head CI: https://github.com/IgnasGaj/cekis/actions/runs/37511034206 . The job steps and decoded logs were inspected, not inferred from an earlier implementation run. CI uses the supported Node 22 runtime; local Node 24 results are recorded separately.

## F1 — Warranty changes remain enabled during receipt-backed save

Priority: **P2 — fix before acceptance**.

Files: `src/components/receipt-upload.tsx`, `src/components/warranty-editor.tsx`.

`AddReceiptFlow.save()` captures and submits the current warranty, then waits for `/api/purchases`. Existing purchase inputs and the submit button disable when `busy` is true. The newly added `WarrantyEditor` has neither a disabled prop nor a disabled fieldset ancestor. Its state/date/duration/confirmation controls continue accepting changes until the response sets `purchaseId`, at which point the entire editor disappears.

### Reproduction

1. Select an original receipt and fill valid purchase fields.
2. Enter and confirm a known end date, for example 2028-01-01.
3. Start saving and delay the purchase-create response.
4. While it is pending, select `Garantijos nėra`, or edit and confirm another end date.
5. Allow the original save to succeed.

The request contains the earlier warranty. The newly accepted edit disappears when the purchase is marked saved, and successful upload navigates away. `matchesSubmitted` compares the server result with the earlier request, so it does not detect changes made in the UI after the request started.

The diagnostic invoked the actual `AddReceiptFlow` save handler and actual warranty-control tree in a controlled React-hook harness with delayed fetch. It verified `busy=true`, an enabled warranty selector, a user change from known to none, submission of the old known value, removal of the editor, and success navigation. This is a component-level reproduction with mocked hooks/network, not a real-device or fresh live-browser result.

### Required correction

Make every editable warranty control follow the same pending-save protection as the other purchase fields. A disabled fieldset around the warranty editor, or a consistently implemented disabled prop, is sufficient. Keep cancellation reachable. Alternatively, implement edit-version reconciliation that preserves later edits without presenting them as saved; do not add that complexity unless necessary.

Prevent duplicate overlapping handler execution, and ensure cancellation/old-response completion cannot re-enable a newer pending attempt or discard its state. Preserve the existing upload recovery, original bytes, and saved-purchase retry behaviour.

Add a focused delayed-response regression covering state/date/duration/confirmation controls. Verify they cannot accept changes during save, or that accepted changes are retained and explicitly identified as unsaved. Test success, failed create and cancellation without duplicate purchases or lost warranty edits.

## F2 — Manual creation retries can acknowledge a different warranty

Priority: **P2 — fix before acceptance**.

Files: `src/lib/purchases.ts` (`createPurchase`), `src/app/pirkiniai/actions.ts` (`createAction`). Review the shared `/api/purchases` caller when changing the common helper.

`createPurchase` uses an owner/submission-key uniqueness constraint to avoid duplicates. On conflict, it selects only the existing ID and deletion state, then returns that ID without comparing submitted fields or warranty information. `createAction` treats any returned ID as success and redirects with `busena=issaugota`.

The underlying retry primitive predates Sprint 5. Sprint 5 now passes confirmed warranty values through it, so this existing mechanism can discard the newly supported warranty changes. The receipt-create JSON endpoint already checks `matchesSubmitted`; the manual server action does not.

### Reproduction

1. Submit a manual purchase with a confirmed end date of 2028-01-01.
2. The insertion commits, but simulate losing the response before the browser receives successful navigation.
3. On the retained form, change and explicitly confirm 2029-01-01, then retry using the same submission key.
4. The insertion conflicts, leaving the old record unchanged. The action nevertheless redirects to that earlier record with the saved-success state.

The second diagnostic ran the actual `createAction` and `createPurchase` code with an authenticated-session mock and a database adapter modelling the committed-key conflict. It confirmed a valid 2029-01-01 draft was submitted, no conflicting insert was performed, and the action still redirected with saved-success. Source inspection confirms the conflict path never loads or compares stored warranty fields. This was not a fresh live PostgreSQL/network-failure test.

### Required correction

Make manual creation retries truthful. Compare the canonical submitted purchase and warranty data against the existing result before acknowledging success, or retain a canonical request fingerprint/snapshot using the existing owner/key uniqueness guarantee. Prefer the smallest change consistent with the established receipt-create flow.

- Identical replay returns the existing purchase without creating a duplicate.
- Changed payload, including warranty state, end date, duration or source, returns a recoverable conflict instead of saved-success.
- Preserve the user's changed values and provide a clear way to inspect/edit the already-created purchase.
- Never automatically overwrite a previously committed purchase or silently rotate the key and create another purchase merely because the first response was lost.
- Preserve deletion tombstones and owner isolation.
- Keep the receipt-add endpoint's mismatch detection working if the shared helper's return type changes.

Add meaningful lost-response/changed-payload tests for the real manual action and disposable database boundary. Verify same-payload replay, changed confirmed date, known-to-none, and conflicting purchase fields. Include race coverage for overlapping identical submissions and account-scoped uniqueness. Do not change unrelated authentication or upload behaviour.

## Passing source observations

- New purchases default to unknown, without an automatic warranty duration. Unknown and none have distinct text and null date metadata.
- Direct dates and whole-month durations require explicit confirmation. Changing purchase date, mode, duration or end date clears confirmation; existing duration-based warranties move to direct-date review when purchase date changes.
- Month addition uses the original day with target-month clamping; tested month-end/leap-year examples and non-iterative addition pass.
- Vilnius calendar-date derivation, civil-day subtraction and inclusive end-day rules match the specification. Boundaries -1/0/1/30/31 are tested.
- List SQL scopes owner and active records, filters before pagination and preserves search. The valid filter includes soon-expiring purchases intentionally; expiry sorting has the required grouping and deterministic tie-breakers.
- Forward migration 0008 establishes state/date/source/duration and finite-date constraints, revision and index. Old purchases become unknown. Inspected CI confirms the disposable upgrade/repeat-migration/association checks passed.
- Ordinary updates use an atomic revision predicate. Review uses the owned purchase row lock and revision check, validates the linked ready receipt, and updates purchase/receipt number transactionally. Omitted warranty data is preserved; changed purchase dates with a stored known warranty require review.
- Warranty is purchase-level; sharing a receipt does not share warranty dates. Deletion clears warranty content in the existing tombstone workflow.
- Ownership predicates remain present in relevant read/write routes. No demonstrated cross-account access or receipt-original modification was found in this review. Existing isolation and receipt-integrity tests passed in exact-head CI; they were not independently rerun live locally.
- No reminder worker, reminder email, categories, legal feature or deployment was introduced.

These observations do not remove the F1/F2 save-path requirements.

## Correction instructions for Codex

Stay on `feature/sprint-05-warranty-tracking` and inspect current remote/local state before edits. Implement only F1 and F2, preserve unrelated work, and add focused acceptance regressions. Do not start Sprint 6.

Run the repository's lint, lint-rule checks, typecheck, unit tests, relevant integration/browser tests and production build. Use disposable PostgreSQL/test services for live checks; do not modify production. Keep audits truthful and preserve all existing CI requirements. Update `sources/sprint-05-completion-report.md` and add a correction section or report with exact commands, outcomes and unavailable checks.

Commit with a normal message such as `Harden warranty save and retry handling`, then push normally to `https://github.com/IgnasGaj/cekis.git`. Use the configured author identity; no AI/Codex attribution, co-author trailers or agent-identifying branch names. No force-push, merge or deployment.

Verify CI on the final pushed SHA and distinguish implementation from later documentation commits. Report final branch/SHA, CI status and actual remaining limitations. Do not assert a complete acceptance pass until F1/F2 regressions and existing checks succeed.

## Copy-paste prompt

Audit corrections are required for Sprint 5. Read `sources/sprint-05-audit-and-fixes.md` and implement F1 and F2 on `feature/sprint-05-warranty-tracking`. Fix receipt-add warranty editing during pending save and make changed-payload manual creation retries return a recoverable conflict instead of saved-success. Preserve existing data, ownership, private receipts, OCR and duplicate protections. Add meaningful regressions, run required checks, update the completion report, commit and push to `https://github.com/IgnasGaj/cekis.git` without AI/Codex attribution or co-author trailers. Do not merge, deploy or start Sprint 6. Report the final pushed SHA and its exact CI result.
