"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPurchase, updatePurchase } from "@/lib/purchases";
import { parseWarranty, warrantyFromForm, type WarrantyInput } from "@/lib/warranty";

export type WarrantyStateResult = { error: string };
export async function saveWarranty(id: string, _state: WarrantyStateResult, form: FormData): Promise<WarrantyStateResult> {
  const current = await getPurchase(id);
  if (!current) return { error: "Pirkinys nerastas." };
  const revision = Number(form.get("expectedRevision"));
  if (!Number.isSafeInteger(revision) || revision < 1) return { error: "Atnaujink puslapį ir bandyk dar kartą." };
  const draft = warrantyFromForm(form);
  if (!draft) return { error: "Pasirink garantijos informaciją." };
  const existing: WarrantyInput = { warrantyState: current.warrantyState as WarrantyInput["warrantyState"], warrantyEndDate: current.warrantyEndDate,
    warrantyDurationMonths: current.warrantyDurationMonths, warrantySource: current.warrantySource as WarrantyInput["warrantySource"] };
  const parsed = parseWarranty(draft, current.purchaseDate, existing);
  if (!parsed.value) return { error: parsed.error ?? "Patikrink garantijos informaciją." };
  const result = await updatePurchase(id, { productName: current.productName, seller: current.seller, purchaseDate: current.purchaseDate,
    price: current.price, currency: current.currency as "EUR" | "USD" | "GBP" | "PLN" | null, notes: current.notes }, revision, parsed.value);
  if (result !== "updated") return { error: result === "conflict" ? "Pirkinys pasikeitė kitur. Atnaujink puslapį." : "Išsaugoti nepavyko. Bandyk dar kartą." };
  revalidatePath(`/pirkiniai/${id}`); revalidatePath("/pirkiniai"); revalidatePath("/pradzia");
  redirect(`/pirkiniai/${id}?busena=atnaujinta`);
}
