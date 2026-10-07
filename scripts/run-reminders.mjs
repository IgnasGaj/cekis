import { config } from "dotenv";
config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
const origin = process.env.APP_URL;
const secret = process.env.REMINDER_WORKER_SECRET;
if (!origin || !secret) throw new Error("Nustatyk APP_URL ir REMINDER_WORKER_SECRET.");
const response = await fetch(new URL("/api/reminders/worker",origin), { method: "POST",headers: { Authorization: `Bearer ${secret}` },cache: "no-store" });
if (!response.ok) throw new Error(`Priminimų darbuotojo užklausa nepavyko (${response.status}).`);
console.log(JSON.stringify(await response.json()));
