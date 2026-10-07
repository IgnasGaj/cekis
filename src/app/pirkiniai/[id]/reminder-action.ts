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
    if (typeof result === "string") return { message: result === "conflict" ? "Pirkinys pasikeitė kitur. Atnaujink puslapį ir peržiūrėk pakeitimus." : "Pirkinys nerastas arba pasirinkimas netinkamas.",error: true,mode:mode as ReminderMode,offset:value };
    revalidatePath(`/pirkiniai/${id}`);
    return { message: "Pirkinio priminimo pasirinkimas išsaugotas.",error: false,revision: result.revision,mode:mode as ReminderMode,offset:value };
  } catch { return { message: "Išsaugoti nepavyko. Bandyk dar kartą.",error: true,mode:mode as ReminderMode,offset:value }; }
}
