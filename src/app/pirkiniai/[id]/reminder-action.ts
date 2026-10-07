"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { isPurchaseId } from "@/lib/purchases";
import { savePurchaseReminder, type ReminderMode, type ReminderOffset } from "@/lib/reminders";

export type PurchaseReminderState = { message: string; error: boolean; revision?: number; mode?: ReminderMode; offset?: number };
export async function savePurchaseReminderAction(id: string, _state: PurchaseReminderState, form: FormData): Promise<PurchaseReminderState> {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return { message: "Pirkinys nerastas.",error: true };
  const mode = form.get("mode");
  const value = Number(form.get("offset"));
  const revision = Number(form.get("revision"));
  if (!["inherit","off","custom"].includes(String(mode)) || ![7,30,90].includes(value) || !Number.isSafeInteger(revision) || revision < 1)
    return { message: "Patikrink priminimo pasirinkimą.",error: true,mode: mode as ReminderMode,offset:value };
  try {
    const result = await savePurchaseReminder(user.id,id,mode as ReminderMode,mode === "custom" ? value as ReminderOffset : null,revision);
    if (result !== "saved") return { message: result === "conflict" ? "Pirkinys pasikeitė kitur. Atnaujink puslapį ir peržiūrėk pakeitimus." : "Pirkinys nerastas arba pasirinkimas netinkamas.",error: true,mode:mode as ReminderMode,offset:value };
    revalidatePath(`/pirkiniai/${id}`);
    const current = (await import("@/lib/db")).pool;
    const fresh = (await current.query<{revision:number}>("SELECT revision FROM purchase WHERE id=$1 AND owner_id=$2",[id,user.id])).rows[0];
    return { message: "Pirkinio priminimo pasirinkimas išsaugotas.",error: false,revision: fresh?.revision,mode:mode as ReminderMode,offset:value };
  } catch { return { message: "Išsaugoti nepavyko. Bandyk dar kartą.",error: true,mode:mode as ReminderMode,offset:value }; }
}
