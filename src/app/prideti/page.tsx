import Link from "next/link";
import { PurchaseShell } from "@/components/purchase-shell";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function AddPage() {
  await requireSession();
  return <PurchaseShell active="add"><section className="page-heading"><h1>Pridėti pirkinį</h1><p>Pasirink, kaip pridėti pirkinį.</p></section>
    <section className="empty-card compact-empty"><h2>Įvesti rankiniu būdu</h2><p>Įrašyk prekę, pardavėją ir pirkimo datą.</p><Link className="primary-button" href="/pirkiniai/naujas">Įvesti rankiniu būdu</Link></section>
    <p className="small-note">Čekio fotografavimas ir failo įkėlimas bus pasiekiami vėlesniame etape.</p>
  </PurchaseShell>;
}
