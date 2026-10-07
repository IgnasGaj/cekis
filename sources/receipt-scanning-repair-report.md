# Receipt scanning repair — 2026-10-07

## Confirmed causes

- `AddReceiptFlow` never invoked OCR. It required manual fields before creating a purchase and uploading the receipt; its copy explicitly said automatic scanning was unavailable.
- Saved-purchase review was the only OCR entry point and required a separate button press.
- The parser excluded Avitelos as a seller because `tel` matched inside its name, did not accept tax letters after item prices, did not join wrapped model/description lines, and did not recognise `Mokėti` / rounded payable totals.
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
