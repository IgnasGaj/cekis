import Link from "next/link";
import { PurchaseShell } from "@/components/purchase-shell";
import { requireSession } from "@/lib/session";
import { todayInVilnius } from "@/lib/purchase-validation";
import { AddReceiptFlow } from "@/components/receipt-upload";

export const dynamic = "force-dynamic";
export default async function AddPage() {
  await requireSession();
  return <PurchaseShell active="add"><section className="page-heading"><h1>Pridėti čekį</h1><p>Išsaugok čekį ir pirkinio informaciją.</p></section>
    <AddReceiptFlow maxDate={todayInVilnius()} />
    <Link className="text-link manual-entry-link" href="/pirkiniai/naujas">Įvesti rankiniu būdu</Link>
  </PurchaseShell>;
}
