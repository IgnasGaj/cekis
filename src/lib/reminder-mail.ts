import "server-only";
import nodemailer from "nodemailer";
import { getEnv } from "./env";
import { dayPhrase, remainingDays } from "./warranty";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function reminderMessage(productName: string, endDate: string, today: string, purchaseId: string, origin: string) {
  const base = new URL(origin);
  const detail = new URL(`/pirkiniai/${purchaseId}`, base).toString();
  const settings = new URL("/nustatymai", base).toString();
  const days = remainingDays(endDate, today);
  const remaining = dayPhrase(days);
  const title = "Čekis: artėja išsaugotos garantijos pabaiga";
  const text = `Prekė: ${productName}\nGarantijos pabaiga: ${endDate}\n${remaining}\n\nPriminimas pagal jūsų išsaugotą garantijos datą.\nPeržiūrėti pirkinį: ${detail}\nPriminimų nustatymai: ${settings}`;
  const html = `<p>Prekė: <strong>${escapeHtml(productName)}</strong></p><p>Garantijos pabaiga: ${escapeHtml(endDate)}<br>${escapeHtml(remaining)}</p><p>Priminimas pagal jūsų išsaugotą garantijos datą.</p><p><a href="${escapeHtml(detail)}">Peržiūrėti pirkinį</a></p><p><a href="${escapeHtml(settings)}">Priminimų nustatymai ir išjungimas</a></p>`;
  return { subject: title, text, html };
}

export async function sendReminderMail(to: string, message: ReturnType<typeof reminderMessage>) {
  const env = getEnv();
  if (env.REMINDER_TRANSPORT_ENABLED !== "true") throw Object.assign(new Error("Transport unavailable"), { reminderClass: "configuration" });
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000, dnsTimeout: 15_000 });
  const info = await transport.sendMail({ from: env.SMTP_FROM, to, ...message });
  if (!info.accepted.some((address) => address.toLowerCase() === to.toLowerCase()) ||
      info.rejected.some((address) => address.toLowerCase() === to.toLowerCase()))
    throw Object.assign(new Error("Recipient rejected"), { reminderClass: "recipient" });
  return info.messageId;
}

export function classifyMailError(error: unknown): "transient" | "permanent" | "uncertain" {
  const value = error as { responseCode?: number; reminderClass?: string; code?: string; command?: string; syscall?: string } | null;
  if (value?.reminderClass === "configuration" || value?.reminderClass === "recipient") return "permanent";
  if (typeof value?.responseCode === "number") {
    if (value.responseCode >= 400 && value.responseCode < 500) return "transient";
    if (value.responseCode >= 500 && value.responseCode < 600) return "permanent";
  }
  if (["EAUTH","ENOAUTH","ECONFIG"].includes(value?.code ?? "")) return "permanent";
  // Nodemailer 10 preserves Node's syscall=connect on a refused TCP connection.
  // Its command=CONN alone is insufficient: later socket errors can also use it.
  if (value?.code === "ESOCKET" && value.command === "CONN" && value.syscall === "connect") return "transient";
  // A connection loss or timeout may occur after SMTP accepted DATA.
  return "uncertain";
}
