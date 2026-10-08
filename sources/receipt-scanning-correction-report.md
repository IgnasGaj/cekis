# Receipt scanning correction — 2026-10-08

## Scope and causes

This continues the existing receipt repair on `main`; it does not start another sprint. The new-purchase image selection already started local OCR before creating a purchase. The remaining code path could still lose seller, product and item price:

1. The first prepared image still included a narrow strip of textured background. Single-block Tesseract OCR read that texture as short prefixes and suffixes on the seller and product lines. In the owner's original failing run, raw OCR contained the legal seller and item amount, but the seller parser preferred unrelated noisy header lines and the item parser rejected the noisy price row. Date and receipt identifier happened to survive.
2. The alternate pass used the full uncropped image. On this photograph, its OCR was dominated by fabric texture and contributed no useful item fields. The scanner also chose one whole pass by overall score, which could discard complementary fields.
3. The parser required item description and amount on the same clean line and missed wrapped descriptions, VAT-letter suffixes and noisy legal-name prefixes. A noisy rounded-payment line could be mistaken for a product, turning the payment amount into an incorrect item price.
4. The new-purchase form applied only suggestions marked `strong`; plausible `uncertain` values and multiple alternatives were not actionable in the form.

## Correction

- Detect the largest paper region, crop it with a small margin and blank surrounding background by paper-row extents. The primary OCR uses automatic page segmentation; one sequential alternate uses a wider prepared crop with single-block segmentation. The original file is not modified.
- Use Tesseract's reported overall confidence as a review signal and merge complementary field candidates from both passes. Model-shaped codes always receive an alternate reading. A full receipt identifier can supersede its own short suffix as an uncertain suggestion; unrelated identifiers remain alternatives.
- Parse adjacent wrapped item/model lines and an amount-only VAT row while keeping item price separate from rounded receipt total. Preserve multiple product prices, dates and other ambiguous values as review candidates. Improve quoted legal-name recognition, including short OCR prefixes. Reject identifiers with no digits. If a rounded-payment label is present but its amount is unreadable, do not present the earlier unrounded amount as the final receipt total.
- Put a single plausible OCR value into the editable new-purchase field with a visible uncertainty notice. Show multiple alternatives as buttons that the owner can apply. Applying an option counts as a manual edit. Late OCR results do not overwrite typed or applied values.
- Keep the selected original `File` for private upload; preprocessing only creates derived OCR bytes. No owner photograph, raw OCR text or extracted owner values are committed.

## Verification status

- Owner's actual JPEG (2880 × 3840) was selected in the authenticated **new-purchase** browser UI, with no purchase record yet. The primary derived image was 1776 × 3144; Tesseract overall confidence was 59 and raw OCR contained the legal seller, full product model/description and item price, purchase date and a short identifier suffix. The wider alternate was 1865 × 3200; confidence was 57 and OCR supplied the full receipt identifier. Parser output and confidence review combined these into all five editable form fields. The legal seller was recognized; the store brand was not reliably read and was manually added during confirmation. Product description capitalization was also manually normalized. The rounded-payment amount did not populate product price.
- In that same private run, the owner-confirmed five fields were saved through the real disposable PostgreSQL/private object-storage backend, survived page reload, and the downloaded original matched the selected JPEG byte for byte by SHA-256. The raw OCR trace and derived test images are retained only under `/tmp` for local diagnosis.
- Fictional photographed JPEGs through real browser Tesseract: textured-background wrapped item/amount-only VAT price reached the editable form; ambiguous multi-item prices appeared as review choices; the receipt total stayed separate. The wrapped case saved to disposable services, survived reload, and downloaded original bytes matched the selected file.
- Existing-purchase image selection, scan, upload and review passed against disposable services. A browser regression confirmed late OCR and retry do not overwrite typed seller, product name or price. Focused parser/scan tests passed (19 cases).
- Final local verification: five focused real-browser OCR scenarios passed, including the private owner photograph, textured fictional receipt, multi-item ambiguity, existing-purchase scan and manual-edit preservation. Focused parser/scan tests passed (19 cases); lint, typecheck, production build and diff whitespace check passed. The final-commit CI result remains pending before merge.
- Physical iPhone/Android capture: unavailable; desktop browser file selection is the verified path.

## Delivery

Work remains on `fix/receipt-field-extraction` until exact-commit CI passes. After that, merge normally into `main` and record the final merge result. No production deployment was performed.
