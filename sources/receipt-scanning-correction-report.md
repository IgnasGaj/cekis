# Receipt scanning correction — 2026-10-07

## Scope and causes

This continues the existing receipt repair on `main`; it does not start another sprint. The new-purchase image selection already started local OCR before creating a purchase. The remaining code path could still lose seller, product and item price:

1. The scanner's overall score counted date, receipt number and rounded payment total as enough to skip the alternate image pass, even when seller, product and item price were missing.
2. The parser required an item description and price on the same line. A wrapped description/model followed by an amount-only row with a VAT letter therefore produced no item candidate. Seller detection also searched too few header lines and handled quoted Lithuanian legal names narrowly.
3. The new-purchase form applied only suggestions marked `strong`. A plausible value marked `uncertain` was present in the parser result but was not put in the editable field or shown as an actionable option. Multiple OCR alternatives were represented by an empty string and silently lost in review.
4. The fallback pass selected one whole scan by total score, so useful fields from the other pass could be discarded.

The attached owner's photograph is not currently available in the local attachment directory. These causes are established from the current code and fictional real-OCR browser cases; the exact field-by-field point of loss for that photograph remains to be measured before completion.

## Correction

- Trigger the one bounded alternate OCR pass when a core item field is missing or uncertain, then merge candidates field by field. Conflicting recognition remains uncertain with alternatives visible for owner review.
- Parse adjacent wrapped item/model lines and an amount-only VAT row while keeping item price separate from rounded receipt total. Preserve multiple product prices, dates and other ambiguous values as review candidates. Improve quoted legal-name recognition.
- Put a single plausible OCR value into the editable new-purchase field with a visible uncertainty notice. Show multiple alternatives as buttons that the owner can apply. Applying an option counts as a manual edit. Late OCR results do not overwrite typed or applied values.
- Keep the selected original `File` for private upload; preprocessing only creates derived OCR bytes. No owner photograph or raw OCR text is committed.

## Verification status

- Fictional photographed JPEGs through the real new-purchase browser UI and Tesseract: wrapped item/amount-only VAT price reached the editable form; ambiguous multi-item prices appeared as review choices; the receipt total stayed separate. The wrapped case saved to disposable PostgreSQL/private object storage, survived reload, and downloaded original bytes matched the selected file.
- Existing-purchase image selection, scan, upload and review passed against disposable services.
- A browser regression confirmed late OCR and retry do not overwrite typed seller, product name or price. Focused parser/scan tests passed (16 cases). Typecheck and lint passed after deleting temporary generated browser build files.
- Owner's actual photograph: **pending; file unavailable**. No claim is made that its five fields appear or persist. The final real-photo pipeline trace, final verification pass, exact-commit CI, push and merge to `main` must follow that check.
- Physical iPhone/Android capture: unavailable; desktop browser file selection is the verified path.

## Delivery

Work remains local on `fix/receipt-field-extraction` pending the owner's photograph and final acceptance run. No production deployment was performed.
