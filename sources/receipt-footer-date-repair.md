# Receipt footer date repair — 2026-10-08

## Cause traced through the new-purchase UI

Both supplied JPEGs were selected in the authenticated `/prideti` form before any purchase existed. Their printed footer timestamps were visible in the originals and in the full-page derived OCR images (2400 × 3200). The original upload bytes were not changed.

| Private photo | Full-page OCR | Parser and confidence review | Form before correction | Targeted footer OCR after correction |
| --- | --- | --- | --- | --- |
| LG refrigerator | Primary and alternate OCR stopped before the timestamp (overall confidence 63 and 50). | No date candidate; confidence review kept it absent. | Purchase date empty. | Lower-strip OCR read the timestamp (confidence 74); the validated calendar date filled the form. |
| Samsung washing machine | Primary and alternate OCR also missed the timestamp (overall confidence 67 and 43). | No date candidate; confidence review kept it absent. | Purchase date empty. | Lower-strip OCR read the timestamp (confidence 73); the validated calendar date filled the form. |

The loss was at full-page Tesseract segmentation, not image cropping, date rejection or form state. Both timestamps were immediately above the verification footer. The full-page processed images retained that content, but neither raw OCR result contained a usable date. Consequently the parser, confidence filter and form all had an absent date. The earlier Electrolux image continued to yield its date through the existing full-page passes.

## Correction

- When full-page OCR has no date candidate, run local Tesseract on one narrow lower strip, then at most one overlapping bottom strip if still absent. The strips use the detected paper bounds when available; otherwise they use the image bounds. No whole-image retry was added. Only a date candidate is taken from these footer passes, avoiding unrelated footer text becoming a seller or product.
- Search every OCR line for dates, including lines beyond the first 150 used for other receipt fields. Accept valid year-first timestamps and Lithuanian day-first dates with conservative spaces and separator variations. Missing separators require an adjacent clock time. Calendar validation rejects impossible or future dates; warranty and card-expiry lines are excluded. Distinct plausible dates remain review choices.
- Preserve the existing editable form behavior: no current-date substitution, low-confidence or conflicting candidates stay reviewable, and later OCR does not overwrite a manually entered date. Date values remain calendar strings through save and reload.
- Keep the original `File` for private upload. The new OCR images are derived in memory using the existing free Lithuanian/English Tesseract stack; no paid service or UI language change was introduced.

## Verification

- Real LG and Samsung photos: each user-specified date appeared in the actual new-purchase date input. Each was saved through the disposable PostgreSQL and private object-storage backend, survived reload in the edit form, and the downloaded uploaded file matched the original bytes by SHA-256. Other required fields that OCR did not reliably provide in these two runs were manually confirmed before saving; this verification does not claim they were automatically recognized.
- Earlier Electrolux photo: seller, product, item price, date and receipt identifier appeared in the new-purchase form. The item price stayed separate from the rounded payment amount. Its confirmed data survived save and reload, and the original bytes matched by SHA-256.
- Nine focused real-browser OCR scenarios passed, including all three private photos, a fictional footer with two reviewable date candidates, late manual-date preservation, wrapped products, price ambiguity, new-purchase scanning before creation and existing-purchase scanning. Only fictional fixtures were committed.
- Twenty-six focused parser/scan tests passed, including full-text footer search, timestamp spacing, calendar rejection and unrelated-date exclusion. Lint, typecheck and production build passed with the disposable test configuration. An initial local build without that configuration stopped at the existing `APP_URL` environment validation; rerunning with the test configuration succeeded.
- Exact implementation commit [`410f5eb7e1d32e62bed6f2f5dc920fcbdc5e22f3`](https://github.com/IgnasGaj/cekis/commit/410f5eb7e1d32e62bed6f2f5dc920fcbdc5e22f3) passed the complete [GitHub CI run](https://github.com/IgnasGaj/cekis/actions/runs/37752348431), including the full browser suite and build.
- Physical phone camera capture was unavailable. Desktop browser file selection was verified for the supplied photos. No production deployment was performed.

## Delivery and privacy

The verified repair was fast-forward merged into `main` and pushed without force. **Final merge commit: `410f5eb7e1d32e62bed6f2f5dc920fcbdc5e22f3`.** The report contains no supplied photo, raw OCR text or extracted private purchase values. Diagnostic traces and derived images were kept outside the repository during testing.
