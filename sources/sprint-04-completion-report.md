# Sprint 4 completion report

## Implemented

The owner can open an attached receipt from its purchase, view the original, scan a JPEG/PNG with Lithuanian and English OCR, cancel/retry, apply or ignore individual suggestions, enter data manually and save confirmed purchase fields. The receipt total is shown separately and never copied to the product price. PDF retains an authenticated preview/download and manual review, with a clear notice that automatic PDF scanning is unavailable. OCR failure and cancellation leave the original and receipt link unchanged.

The browser uses Tesseract.js **7.0.0**, locked `tesseract.js-core` **7.0.0**, and `@tesseract.js-data/lit`/`eng` **1.0.0** using `4.0.0_best_int` data. The script `npm run ocr:prepare` copies worker/core/language assets from installed packages to same-origin `public/ocr/`. They are prepared by local dev, build, Playwright and CI. The worker loads only on demand, reports progress, and terminates nested OCR work on cancel/unmount. No paid OCR, LLM or raw OCR-text persistence was added.

The parser (`src/lib/ocr-parser.ts`) proposes plausible seller, supported date, labeled total, labeled receipt number and a single priced product line. Multiple dates or products are uncertain. Unknown currency stays unset. All suggestions require user review or explicit application. Migration **0007** adds nullable `receipt.receipt_number` with a length/trim constraint. The owner-scoped review save validates existing purchase fields server-side, requires a ready linked receipt, and updates the existing purchase and receipt number transactionally. Replayed saves do not create another purchase.

## Verification

Final passing local commands on Node 22 and the dedicated PostgreSQL/Mailpit/S3 test services:

- `npm ci`
- `npm audit` — 0 vulnerabilities
- `npm audit --omit=dev` — 0 vulnerabilities
- `npm run ocr:prepare`
- `npm run lint`
- `npm run test:lint-rules`
- `npm run typecheck`
- `npm test` — 26 unit cases
- `APP_URL=http://127.0.0.1:3100 npm run build`
- `CEKIS_ENV_FILE=.env.test.local npm run db:migrate` (upgrade and repeat)
- `CEKIS_ENV_FILE=.env.test.local npm run db:grant`
- `CEKIS_ENV_FILE=.env.test.local npm run db:check-role`
- `npm run test:e2e` — 27 real-auth browser cases after audit corrections, including five synthetic OCR image variants and keyboard review

A separate empty `cekis_sprint4_fresh_*` database applied all migrations twice, then grants and the limited-role check; purchase, receipt and link tables were present. The existing test database upgraded without resetting users or receipts. The review browser flow used the Mailpit email-link sign-in, limited app DB role and private S3 emulator. It covered owner preview/OCR, cancellation, retry, editable confirmation, validation feedback, reload persistence, replay without duplicate purchase, PDF manual review, account B denial and anonymous denial. Existing receipt tests cover original byte hashes, links, cleanup and upload safety. A direct unauthenticated object GET returned **403**. No configured database, storage or authentication secret was found in the production client JavaScript files.

Synthetic image fixtures contained no personal data. A clear Lithuanian-style single-item PNG yielded a readable total and editable product/seller/date suggestions. Multi-item, blurred, two-date and unsupported-CZK images all completed browser OCR without copying the total into product price or assuming EUR. The multi-item browser case now directly checks the visible uncertainty message beside the product field, confirms the existing value remains, and saves a manually chosen product. Parser unit cases verify exact ambiguity handling, false receipt numbers, invalid/card dates, decimal separators, blank/noisy text and unsupported currency. At 320, 390 and 1024 px, the review page had no horizontal overflow; the 390 px screen was visually inspected. A 125% browser zoom check found no horizontal overflow. A focused keyboard-only flow reached review from the purchase, scanned, cancelled, retried, used the manual-entry link, traversed the fields, chose currency, entered a receipt number and saved with visible focus. Physical-device testing was not run.

Observed in local headless Chromium on this macOS workstation: clear PNG retry scan roughly **0.8 s**; multi-item **1.0 s**; blurred, ambiguous-date and CZK images around **1.2 s** each. Times include browser worker startup on each scan. The first clear attempt was cancelled, so these measurements do not isolate a cold language-data download. They are observations for small synthetic images, not a speed promise.

## Failed and skipped checks

Intermediate failures were fixed: Playwright initially used the separate unmigrated test DB; a React development remount kept the scan at 0%; generated OCR/Next files needed ESLint exclusions; a production build using the developer's LAN HTTP `APP_URL` failed existing production URL validation. A concurrent lint/browser run briefly hit Playwright removing its generated output directory; ESLint now excludes generated test output and the final gates ran sequentially. After these fixes, the final full browser suite and build passed. Physical phones, external SMTP delivery, production deployment and PDF OCR were skipped. GitHub Actions passed for the implementation commit.

## Limits and delivery

OCR accuracy varies with image quality. Unclear fields are left for manual review; the first product on a multi-item receipt is not chosen. PDFs use manual entry. Concurrent review saves serialize on the existing purchase row and update that one row; the last confirmed edit may replace an earlier concurrent edit. No warranty calculation, reminder, category, line-item splitting, analytics or production-readiness claim is included. Sprint 5 remains warranty tracking.

- Repository: `https://github.com/IgnasGaj/cekis.git`
- Branch: `feature/sprint-04-ocr-review`
- Implementation commit SHA: `cc95b621317693e031e7bc2e1e5d1add3d610c27`; [CI run 37494056979](https://github.com/IgnasGaj/cekis/actions/runs/37494056979) succeeded.
- Final Sprint 4 delivery head before this audit: `796d7f5bf82ccccfcb7082f834e0cc20af372d5a` (documentation commit). The remote branch pointed to this SHA at audit time; [CI run 37494584865](https://github.com/IgnasGaj/cekis/actions/runs/37494584865) succeeded for it.
- Audit corrections F1–F3: this report now distinguishes the two prior commits; the browser suite verifies keyboard-only review and rendered ambiguous-field guidance with manual save. The correction commit and its CI result are provided in the final handoff because this report is part of that commit.
