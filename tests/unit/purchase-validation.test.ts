import { describe, expect, it } from "vitest";
import { parsePurchaseFields, todayInVilnius, validPurchaseDate } from "../../src/lib/purchase-validation";

const base = { productName: " Arbata ", seller: " Parduotuvė ", purchaseDate: "2024-02-29", price: "", currency: "EUR", notes: " " };
describe("pirkinio laukų tikrinimas", () => {
  it("tikrina kalendorines datas ir Vilniaus ribą", () => {
    expect(todayInVilnius(new Date("2026-10-06T21:30:00Z"))).toBe("2026-10-07");
    expect(validPurchaseDate("2024-02-29", "2024-02-29")).toBe(true);
    for (const date of ["", "2023-02-29", "2024-02-30", "2024-13-01", "2024-2-1", "2024-03-01"]) expect(validPurchaseDate(date, "2024-02-29")).toBe(false);
  });
  it("trimina ir riboja tekstą", () => {
    expect(parsePurchaseFields(base, "2026-10-06").value).toMatchObject({ productName: "Arbata", seller: "Parduotuvė", notes: null });
    expect(parsePurchaseFields({ ...base, productName: "  " }).errors.productName).toBeTruthy();
    expect(parsePurchaseFields({ ...base, seller: "x".repeat(201) }).errors.seller).toBeTruthy();
    expect(parsePurchaseFields({ ...base, notes: "x".repeat(2001) }).errors.notes).toBeTruthy();
  });
  it("leidžia neužpildytą čekio įrašą, bet tikrina įvestus laukus", () => {
    const empty = { ...base, productName: "", seller: "", purchaseDate: "" };
    expect(parsePurchaseFields(empty, "2026-10-06", true).value).toMatchObject({ productName: "", seller: "", purchaseDate: null });
    expect(parsePurchaseFields(empty, "2026-10-06").value).toBeNull();
    expect(parsePurchaseFields({ ...empty, price: "1.234" }, "2026-10-06", true).errors.price).toBeTruthy();
    expect(parsePurchaseFields({ ...empty, purchaseDate: "2026-02-29" }, "2026-10-06", true).errors.purchaseDate).toBeTruthy();
  });
  it("saugo dviejų dešimtųjų tikslumo kainą kaip tekstą ir valiutą", () => {
    expect(parsePurchaseFields({ ...base, price: "0", currency: "PLN" }).value).toMatchObject({ price: "0.00", currency: "PLN" });
    expect(parsePurchaseFields({ ...base, price: "12,5", currency: "USD" }).value).toMatchObject({ price: "12.50", currency: "USD" });
    expect(parsePurchaseFields({ ...base, price: "9999999999.99", currency: "GBP" }).value?.price).toBe("9999999999.99");
    expect(parsePurchaseFields(base).value).toMatchObject({ price: null, currency: null });
    for (const price of ["-1", "1.234", "1,234", "1,000.00", "10000000000", "Infinity", "NaN", "01", "1."]) {
      expect(parsePurchaseFields({ ...base, price }).errors.price, price).toBeTruthy();
    }
    expect(parsePurchaseFields({ ...base, price: "1", currency: "JPY" }).errors.currency).toBeTruthy();
  });
});
