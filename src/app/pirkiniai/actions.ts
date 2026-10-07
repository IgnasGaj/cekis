"use server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { createPurchase, deletePurchase, getPurchase, isPurchaseId, purchaseMatchesSubmitted, updatePurchase } from "@/lib/purchases";
import { fieldsFromForm, parsePurchaseFields, type PurchaseErrors } from "@/lib/purchase-validation";
import { requireSession } from "@/lib/session";
import { parseWarranty, warrantyFromForm } from "@/lib/warranty";

export type FormState = { errors: PurchaseErrors & { warranty?: string }; existingPurchaseId?: string };
const failed: FormState = { errors: { form: "Nepavyko išsaugoti. Patikrink ryšį ir bandyk dar kartą." } };

export async function createAction(_state: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const parsed = parsePurchaseFields(fieldsFromForm(form));
  if (!parsed.value) return { errors: parsed.errors };
  const draft = warrantyFromForm(form);
  const warranty = draft ? parseWarranty(draft, parsed.value.purchaseDate) : null;
  if (warranty && !warranty.value) return { errors: { warranty: warranty.error } };
  const key = form.get("submissionKey");
  if (typeof key !== "string" || !isPurchaseId(key)) return { errors: { form: "Atnaujink puslapį ir bandyk dar kartą." } };
  let id: string | null;
  let saved: Awaited<ReturnType<typeof getPurchase>>;
  try {
    id = await createPurchase(key, parsed.value, warranty?.value ?? undefined);
    saved = id ? await getPurchase(id) : null;
  }
  catch (error) { unstable_rethrow(error); return failed; }
  if (!id) return { errors: { form: "Šis įrašas jau ištrintas. Pridėk pirkinį iš naujo." } };
  if (!saved) return { errors: { form: "Pirkinys nerastas. Atnaujink puslapį ir patikrink pirkinių sąrašą." } };
  if (!purchaseMatchesSubmitted(saved, parsed.value, warranty?.value ?? undefined))
    return { errors: { form: "Pirkinys jau išsaugotas su kitais duomenimis. Patikrink jį ir prireikus redaguok; ši forma liko nepakeista." }, existingPurchaseId: id };
  revalidatePath("/pirkiniai");
  redirect(`/pirkiniai/${id}?busena=issaugota`);
}

export async function editAction(id: string, context: string, _state: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const parsed = parsePurchaseFields(fieldsFromForm(form));
  if (!parsed.value) return { errors: parsed.errors };
  const draft = warrantyFromForm(form);
  const warranty = draft ? parseWarranty(draft, parsed.value.purchaseDate) : null;
  if (warranty && !warranty.value) return { errors: { warranty: warranty.error } };
  const revision = Number(form.get("expectedRevision"));
  if (!Number.isSafeInteger(revision) || revision < 1) return { errors: { form: "Atnaujink puslapį ir patikrink naujausius duomenis." } };
  let updated: Awaited<ReturnType<typeof updatePurchase>>;
  try { updated = await updatePurchase(id, parsed.value, revision, warranty?.value ?? undefined); }
  catch (error) { unstable_rethrow(error); return failed; }
  if (updated !== "updated") return { errors: { form: updated === "missing" ? "Pirkinys nerastas." : updated === "review" ? "Pasikeitė pirkimo data. Patvirtink garantijos pabaigą." : "Pirkinys pasikeitė kitur. Atnaujink puslapį, peržiūrėk pakeitimus ir bandyk dar kartą." } };
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
