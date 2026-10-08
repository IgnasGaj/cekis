import { todayInVilnius } from "./purchase-validation";

export type WarrantyState = "unknown" | "none" | "known";
export type WarrantySource = "date" | "duration";
export type WarrantyInput = { warrantyState: WarrantyState; warrantyEndDate: string | null; warrantyDurationMonths: number | null; warrantySource: WarrantySource | null };
export type WarrantyDraft = { warrantyState: string; warrantyEndDate: string; warrantyDurationMonths: string; warrantySource: string; warrantyConfirmed: boolean };
export const emptyWarranty: WarrantyInput = { warrantyState: "unknown", warrantyEndDate: null, warrantyDurationMonths: null, warrantySource: null };
export const MAX_END_DATE = "9999-12-31";
export const quickDurations = [6, 12, 24, 36] as const;
export function defaultWarranty(purchaseDate: string): WarrantyInput {
  return { warrantyState: "known", warrantySource: "duration", warrantyDurationMonths: 24, warrantyEndDate: addMonthsClamped(purchaseDate, 24) };
}

export function validDateOnly(value: string, max = MAX_END_DATE): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01" || value > max) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function civilDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86400000);
}

export function addMonthsClamped(purchaseDate: string, months: number): string | null {
  if (!validDateOnly(purchaseDate) || !Number.isInteger(months) || months < 1 || months > 600) return null;
  const [year, month, day] = purchaseDate.split("-").map(Number);
  const targetMonth = year * 12 + month - 1 + months;
  const targetYear = Math.floor(targetMonth / 12);
  if (targetYear > 9999) return null;
  const target = targetMonth % 12 + 1;
  const last = new Date(Date.UTC(targetYear, target, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${String(target).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function parseWarranty(draft: WarrantyDraft, purchaseDate: string, existing?: WarrantyInput): { value: WarrantyInput | null; error?: string } {
  if (draft.warrantyState === "unknown" || draft.warrantyState === "none") {
    if (draft.warrantyEndDate || draft.warrantyDurationMonths || draft.warrantySource || draft.warrantyConfirmed)
      return { value: null, error: "Išvalyk garantijos datą ir trukmę." };
    return { value: { ...emptyWarranty, warrantyState: draft.warrantyState } };
  }
  if (draft.warrantyState !== "known") return { value: null, error: "Pasirink garantijos būseną." };
  if (!validDateOnly(purchaseDate)) return { value: null, error: "Įvesk tinkamą pirkimo datą." };
  if (draft.warrantySource === "date") {
    if (draft.warrantyDurationMonths || !existing || existing.warrantySource !== "date" || existing.warrantyEndDate !== draft.warrantyEndDate)
      return { value: null, error: "Išsaugotą datą galima tik išlaikyti arba pakeisti į trukmę." };
    if (draft.warrantyEndDate < purchaseDate) return { value: null, error: "Pirkimo data negali būti vėlesnė už išsaugotą garantijos pabaigą." };
    return { value: existing };
  }
  if (draft.warrantySource !== "duration" || !/^[1-9]\d{0,2}$/.test(draft.warrantyDurationMonths)) return { value: null, error: "Pasirink garantijos trukmę." };
  const months = Number(draft.warrantyDurationMonths);
  if (!quickDurations.some((duration) => duration === months) && !(existing?.warrantySource === "duration" && existing.warrantyDurationMonths === months))
    return { value: null, error: "Pasirink 6, 12, 24 arba 36 mėnesius." };
  const endDate = addMonthsClamped(purchaseDate, months);
  if (!endDate) return { value: null, error: "Garantijos pabaigos datos apskaičiuoti nepavyko." };
  return { value: { warrantyState: "known", warrantyEndDate: endDate, warrantyDurationMonths: months, warrantySource: "duration" } };
}

export function warrantyFromForm(form: FormData): WarrantyDraft | null {
  if (!["warrantyState", "warrantyEndDate", "warrantyDurationMonths", "warrantySource", "warrantyConfirmed"].some((key) => form.has(key))) return null;
  const read = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
  return { warrantyState: read("warrantyState"), warrantyEndDate: read("warrantyEndDate"), warrantyDurationMonths: read("warrantyDurationMonths"), warrantySource: read("warrantySource"), warrantyConfirmed: read("warrantyConfirmed") === "on" };
}

export function remainingDays(endDate: string, today = todayInVilnius()): number { return civilDay(endDate) - civilDay(today); }
export function dayPhrase(days: number): string {
  if (days === 0) return "Baigiasi šiandien";
  const lastTwo = days % 100, last = days % 10;
  return `Liko ${days} ${lastTwo >= 11 && lastTwo <= 19 ? "dienų" : last === 1 ? "diena" : last >= 2 && last <= 9 ? "dienos" : "dienų"}`;
}
export function warrantyStatus(warranty: Pick<WarrantyInput, "warrantyState" | "warrantyEndDate">, today = todayInVilnius()) {
  if (warranty.warrantyState === "unknown") return { label: "Garantija nenurodyta", days: null };
  if (warranty.warrantyState === "none") return { label: "Pažymėta: garantijos nėra", days: null };
  const days = remainingDays(warranty.warrantyEndDate!, today);
  return { label: days < 0 ? "Pasibaigė" : days <= 30 ? "Greitai baigsis" : "Galioja", days };
}
