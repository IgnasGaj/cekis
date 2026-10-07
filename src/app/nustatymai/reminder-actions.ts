"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { saveReminderSettings, type ReminderOffset } from "@/lib/reminders";

export type ReminderFormState = { message: string; error: boolean; revision?: number; enabled?: boolean; offset?: number };
export async function saveSettingsAction(_state: ReminderFormState, form: FormData): Promise<ReminderFormState> {
  const { user } = await requireSession();
  const offset = Number(form.get("offset"));
  const enabled = form.get("enabled") === "on";
  const revision = Number(form.get("revision"));
  if (![7,30,90].includes(offset) || !Number.isSafeInteger(revision) || revision < 1)
    return { message: "Patikrink priminimų pasirinkimus.", error: true,enabled,offset };
  try {
    const result = await saveReminderSettings(user.id,enabled,offset as ReminderOffset,revision);
    if (typeof result === "string") return { message: result === "conflict" ? "Nustatymai pasikeitė kitur. Atnaujink puslapį ir peržiūrėk pasirinkimus." :
      result === "unavailable" ? "Priminimai dabar negalimi. Patikrink patvirtintą el. paštą ir siuntimo konfigūraciją." : "Patikrink pasirinkimą.",error: true,enabled,offset };
    revalidatePath("/nustatymai");
    return { message: "Priminimų nustatymai išsaugoti.",error: false,revision: result.revision,enabled,offset };
  } catch { return { message: "Išsaugoti nepavyko. Bandyk dar kartą.",error: true,enabled,offset }; }
}
