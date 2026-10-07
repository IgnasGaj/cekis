import { validPurchaseDate } from "./purchase-validation";

export type Suggestion = { value: string; state: "strong" | "uncertain" | "absent" };
export type ReceiptSuggestions = { seller: Suggestion; purchaseDate: Suggestion; receiptTotal: Suggestion; receiptCurrency: Suggestion; receiptNumber: Suggestion; productName: Suggestion; productPrice: Suggestion };
const absent = (): Suggestion => ({ value: "", state: "absent" });
const pick = (values: string[], strong: boolean): Suggestion => {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length === 1 ? { value: unique[0], state: strong ? "strong" : "uncertain" } : unique.length > 1 ? { value: "", state: "uncertain" } : absent();
};
const money = (raw: string) => {
  const value = raw.replace(/\s/g, "").replace(",", ".");
  return /^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value) ? value : "";
};
const currency = (line: string) => {
  const found = [...line.matchAll(/(?:^|\s)(EUR|USD|GBP|PLN)(?=\s|$)|[€$£]/gi)].map((hit) => ({ "€": "EUR", "$": "USD", "£": "GBP" })[hit[0].trim()] ?? hit[1]?.toUpperCase());
  return [...new Set(found)].length === 1 ? found[0] : "";
};
const forbiddenSeller = /(?:\d{3,}|@|www\.|https?:|pvm|vat|kodas|kasinink|kasos|čekis|kvitas|receipt|invoice|viso|total|suma|\btel\.?|gatv| g\.|pr\.|st\.|str\.|\bLT-\d)/i;
export const hasModelCode = (value: string) => /\b(?=[A-Z0-9-]{5,}\b)(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9-]*\b/.test(value);
const totalLabel = /^(?:mok[ėe]ti(?:\s+suapvalinus)?|i[šs]\s*viso|viso\s*mokėti|mokėtina|bendra\s*suma|total|amount\s*due)\b/i;
const numberLabel = /(?:(?:(?:č|c)ekio|kvito|dokumento|receipt|invoice)\s*(?:nr\.?|numeris|number|no\.?)|(?:nr\.?|no\.?)\s*(?:(?:č|c)ekio|kvito|receipt))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]{2,29})/i;
const datePattern = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)|(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/g;
const normalizeDate = (match: RegExpExecArray) => {
  const year = match[1] ?? match[6]; const month = match[2] ?? match[5]; const day = match[3] ?? match[4];
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

export function parseReceiptText(text: string, today?: string): ReceiptSuggestions {
  const lines = text.replace(/\r/g, "\n").split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 150);
  if (!lines.length) return { seller: absent(), purchaseDate: absent(), receiptTotal: absent(), receiptCurrency: absent(), receiptNumber: absent(), productName: absent(), productPrice: absent() };
  const sellerCandidates = lines.slice(0, 7).filter((line) => /^[\p{L}][\p{L}\p{N} .,'&-]{2,79}$/u.test(line) && !forbiddenSeller.test(line) && /\p{L}/u.test(line)).slice(0, 2);
  const legalSeller = lines.slice(0, 7).find((line) => /^(?:UAB|AB|MB|IĮ)\s+["„“]?\p{L}/u.test(line) && !forbiddenSeller.test(line));
  const seller = legalSeller ? { value: legalSeller.replace(/["„“|]/g, "").trim(), state: "strong" as const } : pick(sellerCandidates, sellerCandidates.length === 1 && lines.indexOf(sellerCandidates[0]) < 3);
  const dates: string[] = [];
  const labeledDates: string[] = [];
  for (const line of lines) {
    if (/galioja|expiry|exp\.?\s*date|kortel|card/i.test(line)) continue;
    for (const match of line.matchAll(datePattern)) {
      const value = normalizeDate(match);
      if (validPurchaseDate(value, today)) {
        dates.push(value);
        if (/data|date|pirkimo/i.test(line)) labeledDates.push(value);
      }
    }
  }
  const distinctDates = [...new Set(dates)];
  const purchaseDate = distinctDates.length === 1 ? pick(distinctDates, labeledDates.includes(distinctDates[0]) || dates.length === 1) : { value: "", state: distinctDates.length ? "uncertain" : "absent" } as Suggestion;
  const totals = lines.filter((line) => totalLabel.test(line)).flatMap((line) => {
    const match = line.match(/(?:^|\s)(\d{1,10}[.,]\s?\d{2})(?=\s|[€$£]|$)/);
    return match && money(match[1]) ? [{ value: money(match[1]), unit: currency(line) }] : [];
  });
  // A rounded payable amount is the final receipt total; retain item prices separately.
  const rounded = lines.filter((line) => /^mok[ėe]ti\s+suapvalinus\b/i.test(line)).flatMap((line) => {
    const match = line.match(/(\d{1,10}[.,]\s?\d{2})/); return match ? [money(match[1])] : [];
  });
  const receiptTotal = pick(rounded.length ? rounded : totals.map((item) => item.value), true);
  const receiptCurrency = receiptTotal.state === "strong" ? pick(totals.filter((item) => item.value === receiptTotal.value).map((item) => item.unit), true) : absent();
  const numbers = lines.flatMap((line) => {
    const match = line.match(numberLabel);
    return match && !/^(?:LT\d{6,}|\d{4}[-./]\d{2}[-./]\d{2})$/i.test(match[1]) ? [{ value: match[1], primary: /(?:nr\.?|no\.?)\s*[:#-]?/i.test(line) }] : [];
  });
  const primary = numbers.filter((item) => item.primary);
  const receiptNumber = pick((primary.length ? primary : numbers).map((item) => item.value), true);
  const excluded = (line: string) => totalLabel.test(line) || /pvm|vat|nuolaida|discount|gr[ąa][žz]a|change|kortel|card|mok[ėe]j|payment|grynaisiais|apvalinim|suma|kasinink|kvitas|kvito|ček|cek|\bdata\b|\bdate\b|www\.|tel\.|[=%]/i.test(line);
  const products: { name: string; price: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (excluded(line)) continue;
    const match = line.match(/^([\p{L}][\p{L}\p{N} .,'+()\-/]{2,100}?)\s+(?:\d+\s*[xX*]\s*)?(\d{1,10}[.,]\s?\d{2})(?:\s*(?:€|EUR|USD|GBP|PLN|[$£]))?(?:\s+[A-D])?$/u);
    if (!match) continue;
    let name = match[1].trim();
    const previous = lines[index - 1];
    // Model + description often wrap onto the next line, before its price.
    if (previous && /^[A-Z][A-Z0-9-]{4,}\s+\p{L}/u.test(previous) && !excluded(previous) && !/\d[.,]\d{2}/.test(previous)) name = `${previous} ${name}`;
    products.push({ name, price: money(match[2]) });
  }
  return { seller, purchaseDate, receiptTotal, receiptCurrency, receiptNumber, productName: pick(products.map((item) => item.name), true), productPrice: products.length === 1 ? pick([products[0].price], true) : absent() };
}
