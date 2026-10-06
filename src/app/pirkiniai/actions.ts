"use server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { createPurchase, deletePurchase, isPurchaseId, updatePurchase } from "@/lib/purchases";
import { fieldsFromForm, parsePurchaseFields, type PurchaseErrors } from "@/lib/purchase-validation";
import { requireSession } from "@/lib/session";

export type FormState = { errors: PurchaseErrors };
const failed: FormState = { errors: { form: "Nepavyko išsaugoti. Patikrink ryšį ir bandyk dar kartą." } };

export async function createAction(_state: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const parsed = parsePurchaseFields(fieldsFromForm(form));
  if (!parsed.value) return { errors: parsed.errors };
  const key = form.get("submissionKey");
  if (typeof key !== "string" || !isPurchaseId(key)) return { errors: { form: "Atnaujink puslapį ir bandyk dar kartą." } };
  let id: string | null;
  try { id = await createPurchase(key, parsed.value); }
  catch (error) { unstable_rethrow(error); return failed; }
  if (!id) return { errors: { form: "Šis įrašas jau ištrintas. Pridėk pirkinį iš naujo." } };
  revalidatePath("/pirkiniai");
  redirect(`/pirkiniai/${id}?busena=issaugota`);
}

export async function editAction(id: string, context: string, _state: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const parsed = parsePurchaseFields(fieldsFromForm(form));
  if (!parsed.value) return { errors: parsed.errors };
  let updated: boolean;
  try { updated = await updatePurchase(id, parsed.value); }
  catch (error) { unstable_rethrow(error); return failed; }
  if (!updated) return { errors: { form: "Pirkinys nerastas" } };
  revalidatePath("/pirkiniai");
  revalidatePath(`/pirkiniai/${id}`);
  redirect(`/pirkiniai/${id}?${context ? `${context}&` : ""}busena=atnaujinta`);
}

export async function deleteAction(id: string, context: string, state: { error: string }, form: FormData) {
  void state; void form;
  await requireSession();
  let deleted: boolean;
  try { deleted = await deletePurchase(id); }
  catch (error) { unstable_rethrow(error); return { error: "Nepavyko ištrinti. Bandyk dar kartą." }; }
  if (!deleted) return { error: "Pirkinys nerastas" };
  revalidatePath("/pirkiniai");
  revalidatePath(`/pirkiniai/${id}`);
  redirect(`/pirkiniai?${context ? `${context}&` : ""}busena=istrinta`);
}
