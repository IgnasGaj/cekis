import { expect, it } from "vitest";
import { mergeReceiptSuggestions, needsAlternateScan } from "../../src/lib/scan-receipt";
import { parseReceiptText } from "../../src/lib/ocr-parser";

it("retries when date, receipt number and payment total are found but item fields are missing", () => {
  const first = parseReceiptText("Mokėti suapvalinus 179,50\nKvito Nr. 3/4/12345\n2024-01-30 12:41", "2026-10-07");
  expect(needsAlternateScan(first)).toBe(true);
  const second = parseReceiptText("UAB „Bandymų technika“\nTEST60420CK\nBandymų indukcinė kaitlentė\n179,49 A", "2026-10-07");
  const merged = mergeReceiptSuggestions(first, second);
  expect(merged.purchaseDate.value).toBe("2024-01-30");
  expect(merged.receiptNumber.value).toBe("3/4/12345");
  expect(merged.productName.value).toContain("TEST60420CK");
  expect(merged.productPrice).toEqual({ value: "179.49", state: "uncertain" });
  expect(merged.receiptTotal.value).toBe("179.50");
});

it("keeps conflicting OCR values visible without selecting one", () => {
  const first = parseReceiptText("UAB Bandymų technika\nTEST60420CK Kaitlentė 179,49 A", "2026-10-07");
  const second = parseReceiptText("UAB Bandymų technika\nTEST6042OCK Kaitlentė 179,49 A", "2026-10-07");
  expect(mergeReceiptSuggestions(first, second).productName).toEqual({
    value: "", state: "uncertain", candidates: ["TEST60420CK Kaitlentė", "TEST6042OCK Kaitlentė"],
  });
});

it("prefers a full receipt identifier over its suffix while requiring review", () => {
  const first = parseReceiptText("Kvito numeris 12345", "2026-10-08");
  const second = parseReceiptText("Kvito Nr. 3/4/12345", "2026-10-08");
  expect(mergeReceiptSuggestions(first, second).receiptNumber).toEqual({
    value: "3/4/12345", state: "uncertain", candidates: ["12345", "3/4/12345"],
  });
});

it("retries a complete-looking scan when a model code needs another reading", () => {
  const parsed = parseReceiptText("UAB Bandymų prekyba\nTEST60420CK Kaitlentė 179,49 A\nData 2024-01-30\nKvito Nr. 3/4/12345", "2026-10-08");
  expect(needsAlternateScan(parsed)).toBe(true);
});
