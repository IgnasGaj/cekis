import { validPurchaseDate } from "./purchase-validation";

export type Suggestion = { value: string; state: "strong" | "uncertain" | "absent"; candidates?: string[] };
export type ReceiptSuggestions = { seller: Suggestion; purchaseDate: Suggestion; receiptTotal: Suggestion; receiptCurrency: Suggestion; receiptNumber: Suggestion; productName: Suggestion; productPrice: Suggestion };
const absent = (): Suggestion => ({ value: "", state: "absent" });
export const suggestionValues = (suggestion: Suggestion): string[] => [...new Set([suggestion.value, ...(suggestion.candidates ?? [])].filter(Boolean))];
const pick = (values: string[], strong: boolean): Suggestion => {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length === 1 ? { value: unique[0], state: strong ? "strong" : "uncertain" } : unique.length > 1 ? { value: "", state: "uncertain", candidates: unique.slice(0, 5) } : absent();
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
const removeTotalNoise = (line: string) => line.replace(/^\S{1,3}\s+(?=mok[ėe]ti\b|i[šs]\s*viso\b|viso\s+mokėti\b|mokėtina\b|bendra\s+suma\b|total\b|amount\s+due\b)/iu, "");
const numberLabel = /(?:(?:(?:č|c)ekio|kvito|dokumento|receipt|invoice)\s*(?:nr\.?|numeris|number|no\.?)|(?:nr\.?|no\.?)\s*(?:(?:č|c)ekio|kvito|receipt))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]{2,29})/i;
const datePattern = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)|(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/g;
const normalizeDate = (match: RegExpExecArray) => {
  const year = match[1] ?? match[6]; const month = match[2] ?? match[5]; const day = match[3] ?? match[4];
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

export function parseReceiptText(text: string, today?: string): ReceiptSuggestions {
  const lines = text.replace(/\r/g, "\n").split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 150);
  if (!lines.length) return { seller: absent(), purchaseDate: absent(), receiptTotal: absent(), receiptCurrency: absent(), receiptNumber: absent(), productName: absent(), productPrice: absent() };
  const sellerLines = lines.slice(0, 14).map((line) => line.replace(/["„“|]/g, "").trim());
  const legalSeller = lines.slice(0, 14).map((line) => {
    const match = line.match(/(?:^|\s)((?:UAB|AB|MB|IĮ)\s+["„“]?\p{L}[^"„“|]{2,79})/iu);
    return match?.[1].replace(/["„“|]/g, "").trim() ?? "";
  }).find((line) => line && !forbiddenSeller.test(line));
  const brandCandidates = sellerLines.slice(0, 8).filter((line) => /^[\p{L}][\p{L}\p{N} .,'&-]{2,79}$/u.test(line) && !forbiddenSeller.test(line)).slice(0, 3);
  const seller = legalSeller ? { value: legalSeller, state: "strong" as const } : pick(brandCandidates, brandCandidates.length === 1 && sellerLines.indexOf(brandCandidates[0]) < 3);
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
  const purchaseDate = pick(distinctDates, distinctDates.length === 1 && (labeledDates.includes(distinctDates[0]) || dates.length === 1));
  const totals = lines.map(removeTotalNoise).filter((line) => totalLabel.test(line)).flatMap((line) => {
    const match = line.match(/(?:^|\s)(\d{1,10}[.,]\s?\d{2})(?=\s|[€$£]|$)/);
    return match && money(match[1]) ? [{ value: money(match[1]), unit: currency(line) }] : [];
  });
  // A rounded payable amount is the final receipt total; retain item prices separately.
  const rounded = lines.map(removeTotalNoise).filter((line) => /^mok[ėe]ti\s+suapvalinus\b/i.test(line)).flatMap((line) => {
    const match = line.match(/(\d{1,10}[.,]\s?\d{2})/); return match ? [money(match[1])] : [];
  });
  const roundedLabelSeen = lines.map(removeTotalNoise).some((line) => /^mok[ėe]ti\s+suapvalinus\b/i.test(line));
  const receiptTotal = pick(rounded.length ? rounded : roundedLabelSeen ? [] : totals.map((item) => item.value), true);
  const receiptCurrency = receiptTotal.state === "strong" ? pick(totals.filter((item) => item.value === receiptTotal.value).map((item) => item.unit), true) : absent();
  const numbers = lines.flatMap((line) => {
    const match = line.match(numberLabel);
    return match && /\d/.test(match[1]) && !/^(?:LT\d{6,}|\d{4}[-./]\d{2}[-./]\d{2})$/i.test(match[1]) ? [{ value: match[1], primary: /(?:nr\.?|no\.?)\s*[:#-]?/i.test(line) }] : [];
  });
  const primary = numbers.filter((item) => item.primary);
  const receiptNumber = pick((primary.length ? primary : numbers).map((item) => item.value), true);
  const excluded = (line: string) => totalLabel.test(removeTotalNoise(line)) || /pvm|vat|nuolaida|discount|gr[ąa][žz]a|change|kortel|card|\bmok[ėe]ti\b|mok[ėe]j|payment|grynaisiais|apvalinim|suma|kasinink|kvitas|kvito|ček|cek|\bdata\b|\bdate\b|www\.|tel\.|[=%]/i.test(line);
  const productFragment = (line: string) => line.length <= 100 && /\p{L}/u.test(line) && !excluded(line) &&
    !/^(?:UAB|AB|MB|IĮ)\b/iu.test(line) && !/\b(?:g\.|gatvė|pr\.|LT-\d|@)\b/iu.test(line) && !/\d[.,]\s?\d{2}/.test(line);
  const products: { name: string; price: string; strong: boolean; unit: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (excluded(line)) continue;
    const match = line.match(/^(.*?)(\d{1,10}[.,]\s?\d{2})(?:\s*(?:€|EUR|USD|GBP|PLN|[$£]))?(?:\s*[A-D])?$/iu);
    if (!match || !money(match[2])) continue;
    const prefix = match[1].replace(/\b\d+\s*[xX*]\s*$/u, "").trim();
    const fragments = prefix && productFragment(prefix) ? [prefix] : [];
    // Keep at most two adjacent wrapped lines; stop at totals, contacts and other amounts.
    for (let back = 1; back <= 2 && index - back >= 0; back++) {
      const previous = lines[index - back];
      if (!productFragment(previous)) break;
      if (fragments.length && !hasModelCode(previous)) break;
      fragments.unshift(previous);
      if (hasModelCode(previous)) break;
    }
    if (!fragments.length) continue;
    let name = fragments.join(" ");
    const trailingBrand = name.match(/^([A-Z][A-Z0-9-]{4,}\s+.+),\s+(\p{Lu}[\p{L}0-9&.-]{2,})$/u);
    if (trailingBrand && hasModelCode(trailingBrand[1])) name = `${trailingBrand[2]} ${trailingBrand[1]}`;
    if (name.length > 200) continue;
    products.push({ name, price: money(match[2]), strong: Boolean(prefix) && (fragments.length === 1 || hasModelCode(name)), unit: currency(line) });
  }
  const productPrice = products.length === 1 ? pick([products[0].price], products[0].strong) : pick(products.map((item) => item.price), false);
  const itemCurrency = products.length === 1 ? pick([products[0].unit], products[0].strong) : absent();
  return { seller, purchaseDate, receiptTotal, receiptCurrency: receiptCurrency.state === "absent" ? itemCurrency : receiptCurrency,
    receiptNumber, productName: pick(products.map((item) => item.name), products.length === 1 && products[0].strong), productPrice };
}
