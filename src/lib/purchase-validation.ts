export const currencies = ["EUR", "USD", "GBP", "PLN"] as const;
export type Currency = (typeof currencies)[number];
export type PurchaseFields = { productName: string; seller: string; purchaseDate: string; price: string; currency: string; notes: string };
export type PurchaseErrors = Partial<Record<keyof PurchaseFields | "form", string>>;

export function todayInVilnius(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function validPurchaseDate(value: string, today = todayInVilnius()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

export function parsePurchaseFields(fields: PurchaseFields, today = todayInVilnius()) {
  const errors: PurchaseErrors = {};
  const productName = fields.productName.trim();
  const seller = fields.seller.trim();
  const notes = fields.notes.trim() || null;
  if (!productName || productName.length > 200) errors.productName = !productName ? "Įvesk prekės pavadinimą" : "Prekės pavadinimas per ilgas (iki 200 ženklų)";
  if (!seller || seller.length > 200) errors.seller = !seller ? "Įvesk pardavėją" : "Pardavėjo pavadinimas per ilgas (iki 200 ženklų)";
  if (!validPurchaseDate(fields.purchaseDate, today)) errors.purchaseDate = "Pasirink tinkamą pirkimo datą";
  if (notes && notes.length > 2000) errors.notes = "Pastabos per ilgos (iki 2000 ženklų)";
  let price: string | null = null;
  let currency: Currency | null = null;
  const rawPrice = fields.price.trim();
  if (rawPrice) {
    if (!/^(?:0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(rawPrice)) errors.price = "Įvesk tinkamą kainą";
    else {
      const [whole, fraction = ""] = rawPrice.replace(",", ".").split(".");
      price = `${whole}.${fraction.padEnd(2, "0")}`;
    }
    if (!currencies.includes(fields.currency as Currency)) errors.currency = "Pasirink palaikomą valiutą";
    else currency = fields.currency as Currency;
  } else if (fields.currency && !currencies.includes(fields.currency as Currency)) {
    errors.currency = "Pasirink palaikomą valiutą";
  }
  return { errors, value: Object.keys(errors).length ? null : { productName, seller, purchaseDate: fields.purchaseDate, price, currency, notes } };
}

export function fieldsFromForm(form: FormData): PurchaseFields {
  const string = (key: keyof PurchaseFields) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  return { productName: string("productName"), seller: string("seller"), purchaseDate: string("purchaseDate"), price: string("price"), currency: string("currency"), notes: string("notes") };
}
