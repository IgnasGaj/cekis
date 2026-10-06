import { describe, expect, it } from "vitest";
import { parseReceiptText } from "../../src/lib/ocr-parser";
const today = "2026-10-06";
const parse = (text: string) => parseReceiptText(text, today);

describe("conservative receipt parser", () => {
  it("extracts a labeled Lithuanian receipt without converting total into a product price", () => {
    const result = parse("Topo Centras, UAB\nUkmergės g. 369, Vilnius\nPVM kodas LT123456789\nSONY WH-1000XM6 449,00 €\nIš viso: 449,00 €\nData: 2026-10-05 14:23\nČekio Nr.: K12345");
    expect(result.seller).toEqual({ value: "Topo Centras, UAB", state: "strong" });
    expect(result.purchaseDate).toEqual({ value: "2026-10-05", state: "strong" });
    expect(result.receiptTotal).toEqual({ value: "449.00", state: "strong" });
    expect(result.receiptCurrency.value).toBe("EUR");
    expect(result.receiptNumber.value).toBe("K12345");
    expect(result.productName.value).toBe("SONY WH-1000XM6");
  });
  it.each(["2026-10-06", "2026.10.06", "06.10.2026", "06/10/2026"])("accepts date %s", (date) => {
    expect(parse(`Parduotuvė\nData: ${date}`).purchaseDate.value).toBe("2026-10-06");
  });
  it("rejects impossible, future and card-expiry dates", () => {
    expect(parse("Data: 2026-02-30\nKortelė galioja 10/10/2025").purchaseDate.state).toBe("absent");
    expect(parse("Data: 2026-10-07").purchaseDate.state).toBe("absent");
  });
  it("does not choose between two dates", () => {
    expect(parse("Data 2026-10-05\nData 2026-10-06").purchaseDate).toEqual({ value: "", state: "uncertain" });
  });
  it("handles comma and point totals, but never invents currency", () => {
    expect(parse("Iš viso 12,30").receiptTotal.value).toBe("12.30");
    expect(parse("Total 12.30").receiptTotal.value).toBe("12.30");
    expect(parse("Total 12.30 Kč").receiptCurrency.state).toBe("absent");
    expect(parse("Total 12.30 EUR USD").receiptCurrency.state).toBe("absent");
  });
  it("requires a receipt label for numbers", () => {
    expect(parse("Terminal ID 123456\nPVM kodas LT123456789\nAutorizacija 998877").receiptNumber.state).toBe("absent");
    expect(parse("Dokumento Nr. AB-124").receiptNumber.value).toBe("AB-124");
    expect(parse("Cekio Nr. K12345").receiptNumber.value).toBe("K12345");
  });
  it("leaves multiple product lines ambiguous", () => {
    const result = parse("Obuoliai 2,30\nPienas 1,40\nIš viso 3,70 €");
    expect(result.productName).toEqual({ value: "", state: "uncertain" });
    expect(result.receiptTotal.value).toBe("3.70");
  });
  it("does not turn noisy or blank OCR into confident values", () => {
    expect(parse("I5 vi5o 44,OO\n20Z6.10.06\n---").receiptTotal.state).toBe("absent");
    expect(Object.values(parse(" \n  ")).every((suggestion) => suggestion.state === "absent")).toBe(true);
  });
});
