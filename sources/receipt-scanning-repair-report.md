# Receipt scanning repair — 2026-10-07

## Confirmed causes

- `AddReceiptFlow` never invoked OCR. It required manual fields before creating a purchase and uploading the receipt; its copy explicitly said automatic scanning was unavailable.
- Saved-purchase review was the only OCR entry point and required a separate button press.
- The parser excluded a legitimate seller name because `tel` matched inside a word, did not accept tax letters after item prices, did not join wrapped model/description lines, and did not recognise `Mokėti` / rounded payable totals.
- Recognition ran on the entire unprepared photograph. Cloth/background texture polluted segmentation. Earlier OCR browser coverage primarily used generated text images, not this real thermal receipt.

## Changes

New JPEG/PNG selections start scanning immediately in both new-purchase and existing-purchase upload flows. New purchases receive editable suggestions before a purchase exists. Strong item prices are distinct from full receipt totals; multi-item totals are never copied into product price. Typed fields survive late OCR and retries. Save remains an explicit owner action. Existing-purchase uploads show suggestions without silently overwriting saved purchase data.

A shared scanner prepares a derived image with bounded dimensions, paper-region detection, background cropping, enlargement and grayscale contrast. It retains the original File for upload. It bounds worker time, aborts nested workers, and ignores obsolete completions after cancellation/file replacement/unmount. Saved-receipt review uses the same scanner.

Receipt numbers are editable in new-purchase review and validated/persisted through the upload API. No migration or dependency change. PDF scanning remains unavailable with explicit manual entry; this repair does not claim PDF OCR support.

## Evidence

- Remaining Sprint 7 commits were fast-forwarded to main: `1e695bab30765d7f7b126aa617ca7998acac1f88`. Earlier sprint branches are retained.
- Real Chromium + real browser Tesseract on the supplied photograph extracted seller, date, item price, receipt total, receipt number and the wrapped product description without a scan-button click. One model character still requires correction; this is explicitly not a perfect-recognition claim. The original photograph and its extracted purchase data are excluded from this commit.
- The same component browser harness verified typed seller preservation during recognition, cancellation, and one creation + one upload handoff. HTTP persistence responses were mocked in that harness; it does not prove live database/storage persistence.
- Repository lockfile restored after temporary browser tooling: lint, TypeScript, 44 unit cases, production build on Next 16.3.8 and diff whitespace checks passed locally. Local Node was 24; configured CI uses Node 22.
- Added anonymous generated photo-style authenticated browser regressions for immediate scan, review/save/reload, receipt-number persistence and original-byte equality; cancellation, edit preservation and image-to-PDF replacement. These require CI/disposable PostgreSQL, mail and object storage and were not run against production here. Exact CI outcome is provided in the delivery handoff.
- Physical iPhone/Android checks were not performed. No production data changes or deployment.

## Release criterion

Only merge the repair after exact-commit CI passes, including the new authenticated scanning cases. Continue to show user review and honest failure/manual fallback; do not claim every receipt is perfectly recognised.

Automatic approval review rejected a proposed tree containing the owner’s real receipt photo and derived purchase data. The published repair excludes those items and uses fictional generated receipt data for committed regression tests. Real-photo testing evidence remains local.

Initial repair CI: 41 browser cases passed (including both new scanning cases); the existing shared-receipt cancellation case failed because its broad Cancel selector matched the new OCR Cancel action. It now targets the exact upload Cancel button. An existing PDF review navigation assertion passed on retry; it now waits explicitly for the completed navigation before checking the heading. All preceding CI checks passed. The corrected exact-commit run is the merge gate.

## Follow-up audit

The corrected checkpoint `5aec162d3be38570fac80863e6e5fc2c8a39671e` passed [CI](https://github.com/IgnasGaj/cekis/actions/runs/37654221296). A remaining existing-purchase gap was found: after automatic scanning, upload discarded the suggestions and review required another scan. The upload now keeps the finished suggestions in tab-local temporary storage keyed to the saved receipt, exposes a direct review link, and the review form offers the item-price suggestion while preserving confirmed purchase fields. If storage is unavailable, normal rescanning remains possible. A detected paper crop now includes an outward margin to avoid trimming edge text. Weak first-pass results get at most one sequential OCR pass on a resized image without cropping or contrast adjustment; stronger results do not incur another pass. These changes require the final commit's CI result before merge.

Local disposable PostgreSQL/private object storage browser checks covered existing-purchase scan → upload → review → explicit item-price and currency confirmation → save → reload, plus original-byte checks and owner separation. The new-purchase photo-style scan → editable suggestions → save → reload and original-byte equality also passed. Lint, typecheck and focused parser checks passed after the follow-up. The image fixture was generated for tests and contains no owner receipt data. The owner's real receipt image was not found in the current attachments or workspace, so its prior local recognition result could not be repeated after the crop-margin change. No physical iPhone or Android capture test was available.
