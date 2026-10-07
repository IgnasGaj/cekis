# Čekis — priority receipt-scanning repair

## Task and authority

Pause future sprint features. Receipt scanning is the application's primary input flow and currently fails the owner's real use: newly added purchases do not scan automatically, and a readable photographed receipt produced no useful fields.

Repository: **https://github.com/IgnasGaj/cekis.git**. Work on Čekis, not the historical Pirkėjo Skydas repository. PostgreSQL/private object storage remain the backend. All user-facing content must be Lithuanian.

The owner authorises consolidating completed project work into `main`, repairing scanning, auditing the repair and merging the verified result into `main`. Complete this task; do not stop at an inspection report or leave a passing repair unmerged. Preserve user data, originals, unrelated work and credentials. Use descriptive commits with the configured author; no Codex/AI attribution or Co-authored-by trailers. Never force-push.

## Current handoff — inspect before changing anything

At preparation of this prompt:

- Sprint 7 and earlier feature work were already consolidated into `main` at `1e695bab30765d7f7b126aa617ca7998acac1f88`.
- An initial repair exists on `fix/immediate-receipt-scanning`. Its implementation commit is `8b76248f4492ab0703d4a2e6a2258cc8d1619ebe`; its test-correction commit is `5aec162d3be38570fac80863e6e5fc2c8a39671e`.
- The implementation's CI passed its new scanning/persistence cases, but an older cancellation test failed because its broad button selector matched both upload cancellation and OCR cancellation. An older PDF-review assertion passed only on retry. The follow-up commit makes cancellation selectors exact and waits for review navigation.
- The follow-up CI run is https://github.com/IgnasGaj/cekis/actions/runs/37654221296. Its result was still pending at handoff; **do not assume it passed**.
- `sources/receipt-scanning-repair-report.md` describes implementation and verification limits.
- Local real-photo recognition found useful seller, date, item price, receipt total, receipt number and product-description data, but one model-code character still required correction. This is improvement, not proof of complete accuracy or real-device readiness.
- Local component checks used real browser OCR but mocked HTTP save responses. CI used disposable services for persistence. Neither proves production deployment.

Fetch current refs, inspect the working tree and read the repair diff/report. These SHAs are checkpoints, not permission to overwrite newer work. **Continue and improve the existing repair; do not rebuild it blindly.** Check for additional completed local/remote changes not included in main. Merge relevant completed work using ordinary/fast-forward merges after resolving real conflicts and checking the affected code. Do not blindly merge obsolete experimental branches or replay already merged historical commits.

## Confirmed failure paths to investigate

Inspect at least:

- `src/components/receipt-upload.tsx`: `AddReceiptFlow`, `ExistingPurchaseUploader`, file selection, saving and retries.
- `src/components/receipt-review.tsx` and `src/components/receipt-scan.tsx`.
- `src/lib/scan-receipt.ts`, `src/lib/receipt-image.ts`, `src/lib/ocr-parser.ts`.
- `src/workers/receipt-ocr.worker.ts`, OCR asset preparation and actual asset requests.
- Purchase creation, receipt upload/review APIs and relevant browser tests.

Before the initial repair, new-receipt entry never called OCR and required manual purchase fields first. Recognition was confined to an already-saved purchase's separate review screen. The parser also mishandled seller names containing a telephone-label substring, tax letters after prices, wrapped product/model lines and Lithuanian payable/rounded totals. Entire unprepared photographs allowed background texture to interfere with recognition.

Verify what is actually fixed in the current checkout. Trace the full path from image selection through OCR, parsing, editable fields, purchase creation, original upload and reload. Separate wiring, image decoding, worker/asset failures, recognition quality and parsing failures; fix causes instead of treating every empty result as an unreadable receipt.

## Required behaviour

### 1. Automatic scanning before a purchase exists

The main flow must be:

**Photograph/select image → scanning starts immediately → editable review → explicit save.**

- Selecting/capturing a supported JPEG/PNG must start OCR without a scan-button press, previously saved purchase, purchase ID, page reload or navigation to an existing product.
- Scan the local selected image before purchase creation where that fits the existing contract. Do not require fictitious placeholder purchase values or a speculative server draft system just to start OCR.
- Automatically fill clear suggestions into the review form. Show missing/ambiguous fields meaningfully. Scanning must save typing, not merely display hidden suggestions elsewhere.
- Keep original preview, progress, retry, cancel and manual entry available. Editing during a scan must not be overwritten by a late result or a retry.
- Explicit owner confirmation still saves the purchase. Prevent duplicate saves/uploads and false saved confirmations.
- New receipts attached to existing purchases must also start scanning on selection. Preserve confirmed purchase fields; allow the owner to review/apply extracted changes instead of silently overwriting them. Reuse scan results where practical rather than making the owner repeat the same scan after upload.
- Existing receipt review/rescan must keep working with the same recognition/parsing pipeline.

### 2. Improve recognition on real photographs

Use the owner's supplied receipt photograph locally if available. Resolve its current path; do not hardcode stale ChatGPT scratch paths or claim to have tested an unavailable image. If it is missing, finish independent work and clearly identify the missing acceptance check.

- Measure recognition on the real photograph, not only perfectly rendered text images.
- Check decoding/orientation, practical resolution, shadows/fading, receipt/background separation and text layout. Preserve the original bytes; crop/rotate/enlarge/normalise only derived OCR images.
- Validate that preprocessing improves recognition rather than clipping receipt text or destroying faint characters. Account for photos that are already tightly cropped and for a detection failure.
- Use bounded, evidence-based alternate processing/segmentation when a first attempt yields too little useful data. Avoid unlimited scans, multiple simultaneous workers and repeated full passes on already successful images.
- Ensure worker/core/language files resolve in development and production. Handle startup, recognition, runtime and timeout errors in Lithuanian; a failed worker must not leave an infinite spinner.
- Test supported browser behaviour, especially the mobile capture path. Desktop Chromium success is not proof of iPhone Safari or Android camera success.
- Keep the repair free/freemium. Do not activate a paid OCR/AI service without the owner's explicit approval.

### 3. Extract useful, defensible fields

Support representative Lithuanian receipt layouts, including:

- Seller legal names and brand headers, quoted legal names and address/contact lines. Telephone-label filtering must use appropriate boundaries and must not reject legitimate words containing that substring.
- Valid purchase dates, including dates near the bottom alongside a time. Do not use card-expiry dates, impossible dates or future dates.
- Product names and models wrapping across adjacent lines, prices followed by VAT category letters and spacing around decimal separators.
- Labelled receipt identifiers; distinguish ordinary receipt numbers from barcode, VAT, terminal and security-module identifiers. Handle receipts containing more than one identifier without pretending they must be identical.
- Payable totals and cash rounding. **Product price and receipt/payment total are distinct.** Do not replace a single-item price with a rounded payment or copy a multi-item total into a product price.
- Currency supported by evidence. An explicitly shown UI default is not OCR proof of EUR. Do not silently reinterpret an unsupported currency.

Use recognition confidence and layout evidence where available; a matching regex alone does not prove the OCR characters are correct. Flag ambiguous model codes and let the owner correct them. Do not hardcode the supplied receipt's seller, model, numbers, date or price into production extraction.

Warranty fields remain separately entered/confirmed. Do not infer a legal warranty or default every scanned purchase to 24 months. Automatic line-item purchase splitting remains outside this repair unless essential to correctness; ambiguous multi-product input must stay reviewable.

### 4. Lifecycle, saving and original integrity

- Cancel and terminate active workers, including during language/worker startup. Ignore results from obsolete selections, cancelled attempts and unmounted screens.
- Rapid file changes and overlapping retries must not apply old suggestions to the new receipt, duplicate purchases or delete a receipt still linked to another purchase.
- Clearly distinguish OCR failure, upload failure and purchase-save failure. Preserve entered corrections and the selected original so the user can retry or enter manually.
- Preserve server validation, ownership checks, receipt associations, idempotency, upload limits and existing cleanup guarantees.
- Save reviewed fields, including a confirmed receipt number when supported, and verify persistence after reload/sign-out/sign-in as appropriate.
- Verify downloaded originals match selected bytes. Never replace an original with the preprocessed image.
- PDFs/HEIC need an explicit supported path or honest unsupported/manual copy; never show successful scanning with zero fields. Do not advertise PDF OCR unless extraction/rendering and the relevant tests actually work.

## Verification and completion gates

Use meaningful tests, not a larger test count as a completion criterion.

1. Reproduce or verify the original new-purchase failure. Scan through the **new purchase** entry point with no purchase ID. Demonstrate automatic start, visible suggestions and editable fields.
2. Test the supplied photograph locally and a small varied set of receipt inputs: wrapped item/model, tax suffix, cash rounding, multiple products, ambiguous dates/currency, background texture/fading and empty/unreadable input. Record correct, missing and incorrect fields rather than calling any non-empty text a successful scan.
3. Check cancellation during startup/recognition, immediate file replacement, retry, typed-field preservation, worker/asset failure, manual fallback and duplicate save prevention.
4. Run authenticated integration/browser checks against disposable PostgreSQL and private object storage: scan → review/correct → save → reload → original download; receipt-number persistence; new attachments to existing purchases; shared receipt protection and affected ownership checks. Label mocked checks honestly.
5. Fix affected existing test selectors for the new controls. Keep meaningful assertions; do not remove tests, weaken data checks or increase timeouts to hide a broken flow. Diagnose retries/flakes and wait for the actual operation when appropriate.
6. Verify a clean supported-runtime install when needed, lint, typecheck, focused tests, production build and exact-final-commit CI. Reuse valid unchanged checkpoints. Start with affected tests, then one final required CI run; do not repeat broad audits or unchanged suites without a new failure/change that justifies it.
7. Check mobile viewports. Perform real iPhone Safari/Android capture tests when devices are available. If unavailable, record that limit without representing viewport simulation as a physical-device pass.

**Do not declare the repair complete merely because the parser passes text-unit tests, the app compiles or an existing purchase can be rescanned.** The new-purchase capture/review/save path and actual OCR output are the acceptance target.

## Privacy and delivery

The repository is public. The owner's real receipt photo and extracted purchase data must remain in local/private testing unless the owner explicitly authorises publication. Use fictional generated/sanitised fixtures for committed tests; do not upload the original photograph or copy its private purchase data into public reports/prompts. Avoid raw OCR or file-content logging in production.

Keep progress concise. Store the repair prompt/report under the repository's `sources/` folder. Before committing this prompt itself, ensure it contains no private fixture data. Report:

- Exact root causes and final behaviour.
- Field-level results and remaining OCR mistakes; no perfect-recognition claim.
- Checks passed, failed or unavailable; real services versus mocks; physical devices actually tested.
- Commit, CI link and merge result.
- Any configuration or device check still required.

After resolving blockers and passing the final checks, commit/push normally and **merge the repair into `main` without asking again**: the owner has authorised it. Inspect current `main` before updating it, preserve newer work and verify the resulting remote head. Do not deploy production or reset production data as part of this prompt.

Stop new sprint feature work until this repair is verified. If execution is interrupted by a limit, leave one precise continuation checkpoint with branch/SHA, valid completed checks, outstanding failures and the next action, so continuation does not restart the entire audit.
