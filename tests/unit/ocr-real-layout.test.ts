import { expect, it } from "vitest";
import { parseReceiptText } from "../../src/lib/ocr-parser";
it("handles a wrapped appliance line, tax suffix, rounding and two receipt identifiers", () => {
  const result = parseReceiptText(`bandymai
UAB "Bandymų prekyba"
"Bandomoji parduotuvė"
Bandymų g. 6, Vilnius
PVM mokėtojo kodas LT123456789
TEST60420 Prietaisas
bandomasis įrenginys 19,99 A
Apskaitos Kvitas: 0000000000000012345
Mokėti 19,99
Apvalinimo suma 0,01
Mokėti suapvalinus 20,00
Mokestis Suma su PVM Be PVM PVM suma
A 21,00 % 19,99 16,52 3,47
Grynaisiais 20,00
Kvito Nr. 1/1/12345 Kasa 0001
2024-01-30 12:41:21
Kvito numeris 12345`, "2026-10-07");
  expect(result.seller.value).toBe("UAB Bandymų prekyba");
  expect(result.productName.value).toBe("TEST60420 Prietaisas bandomasis įrenginys");
  expect(result.productPrice.value).toBe("19.99");
  expect(result.receiptTotal.value).toBe("20.00");
  expect(result.purchaseDate.value).toBe("2024-01-30");
  expect(result.receiptNumber.value).toBe("1/1/12345");
  expect(result.receiptCurrency.value).toBe("");
});
it("never uses payment or VAT rows as products, or a multi-item total as product price", () => {
  const result = parseReceiptText("Pienas 2,30 A\nDuona 1,40 B\nMokėti 3,70\nGrynaisiais 3,70\nPVM suma 0,64", "2026-10-07");
  expect(result.productName.state).toBe("uncertain"); expect(result.productPrice.state).toBe("absent");
  expect(result.receiptTotal.value).toBe("3.70");
});
