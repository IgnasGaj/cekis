import { createHash } from "node:crypto";
import { validDateOnly } from "./warranty";

export type ReminderMode = "inherit" | "off" | "custom";
export type ReminderOffset = 7 | 30 | 90;
export const allowedOffsets = [90,30,7] as const;

export function subtractCivilDays(date: string, days: ReminderOffset): string | null {
  if (!validDateOnly(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCDate(value.getUTCDate() - days);
  if (value.getUTCFullYear() < 1) return null;
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function vilniusHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vilnius", hour: "2-digit", hourCycle: "h23" }).format(now));
}
export const insideSendWindow = (now = new Date()) => vilniusHour(now) >= 9 && vilniusHour(now) < 21;

export function reminderIdentity(ownerId: string, purchaseId: string, endDate: string, offset: ReminderOffset, recipientVersion: number, email: string): string {
  return createHash("sha256").update(JSON.stringify([ownerId, purchaseId, endDate, offset, recipientVersion, email.toLowerCase()])).digest("hex");
}

export type ReminderPurchase = { id: string; owner_id: string; warranty_state: string; warranty_end_date: string | null; reminder_mode: ReminderMode; reminder_offset: number | null; deleted_at: Date | null };
export type ReminderPreference = { enabled: boolean; default_offset: ReminderOffset; revision: number; email: string; email_verified: boolean; reminder_recipient_version: number };

export function desiredReminder(row: ReminderPurchase, pref: ReminderPreference, today: string) {
  if (row.deleted_at || row.warranty_state !== "known" || !row.warranty_end_date || row.warranty_end_date < today ||
      !pref.enabled || !pref.email_verified || row.reminder_mode === "off") return null;
  const offset = (row.reminder_mode === "custom" ? row.reminder_offset : pref.default_offset) as ReminderOffset;
  if (!allowedOffsets.includes(offset)) return null;
  const dueDate = subtractCivilDays(row.warranty_end_date, offset);
  if (!dueDate) return null;
  return { offset, dueDate, endDate: row.warranty_end_date, recipientVersion: pref.reminder_recipient_version,
    identity: reminderIdentity(row.owner_id, row.id, row.warranty_end_date, offset, pref.reminder_recipient_version, pref.email) };
}
