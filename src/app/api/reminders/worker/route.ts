import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { runReminderWorker } from "@/lib/reminder-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = getEnv().REMINDER_WORKER_SECRET;
  const value = request.headers.get("authorization") ?? "";
  const supplied = value.startsWith("Bearer ") ? value.slice(7) : "";
  const valid = Boolean(secret && supplied && timingSafeEqual(
    createHash("sha256").update(secret).digest(),createHash("sha256").update(supplied).digest()));
  if (!valid) return Response.json({ error: "Neleistina užklausa." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const counts = await runReminderWorker();
  return Response.json(counts,{ headers: { "Cache-Control": "no-store" } });
}
