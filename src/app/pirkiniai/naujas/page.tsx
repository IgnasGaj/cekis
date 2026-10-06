import { randomUUID } from "node:crypto";
import { PurchaseShell } from "@/components/purchase-shell";
import { todayInVilnius } from "@/lib/purchase-validation";
import { requireSession } from "@/lib/session";
import { createAction } from "../actions";
import { PurchaseForm } from "../purchase-form";

export const dynamic = "force-dynamic";
export default async function NewPurchasePage() {
  // Session is checked before the form and again for every submitted action.
  await requireSession();
  return <PurchaseShell><section className="page-heading"><h1>Pridėti pirkinį</h1><p>Įvesk pirkimo informaciją rankiniu būdu.</p></section>
    <PurchaseForm initial={{ productName: "", seller: "", purchaseDate: "", price: "", currency: "EUR", notes: "" }} action={createAction} cancelHref="/pirkiniai" submissionKey={randomUUID()} maxDate={todayInVilnius()} />
  </PurchaseShell>;
}
