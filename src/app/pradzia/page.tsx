import Link from "next/link";
import { PurchaseShell } from "@/components/purchase-shell";
import { displayDate } from "@/lib/purchase-format";
import { homePurchases } from "@/lib/purchases";
import { dayPhrase, remainingDays, warrantyStatus, type WarrantyState } from "@/lib/warranty";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { today, totals, upcomingRows, recentRows } = await homePurchases();
  return <PurchaseShell active="home">
    <section className="home-intro" aria-labelledby="home-title">
      <h1 id="home-title">Pradžia</h1>
      <p>Tavo pirkiniai ir artėjančios garantijų pabaigos.</p>
      <Link className="primary-button" href="/prideti">Pridėti čekį</Link>
    </section>
    {totals.purchases === 0 ? <section className="empty-card compact-empty" aria-labelledby="home-empty-title">
      <h2 id="home-empty-title">Dar neturite pirkinių</h2>
      <p>Pridėkite čekį arba įveskite pirkinį rankiniu būdu.</p>
      <Link className="secondary-button" href="/prideti">Pridėti čekį</Link>
    </section> : <>
      <section className="home-section" aria-labelledby="warranty-summary-title">
        <h2 id="warranty-summary-title">Artėjančios garantijų pabaigos</h2>
        <div className="home-summary">
          <Link href="/pirkiniai?warranty=soon&sort=expiry" aria-label={`Per artimiausias 30 dienų: ${totals.next30}. Rodyti pirkinius.`}>
            <span>Per artimiausias 30 dienų</span><strong>{totals.next30}</strong>
          </Link>
          <Link href="/pirkiniai?warranty=upcoming90&sort=expiry" aria-label={`Per artimiausias 90 dienų: ${totals.next90}. Rodyti pirkinius.`}>
            <span>Per artimiausias 90 dienų</span><strong>{totals.next90}</strong>
          </Link>
        </div>
        <p className="home-clarification">Į 90 dienų skaičių įtrauktos ir artimiausios 30 dienų.</p>
      </section>
      <section className="home-section" aria-labelledby="upcoming-title">
        <h2 id="upcoming-title">Artimiausios garantijų pabaigos</h2>
        <p className="home-section-note">Iki penkių pirkinių per artimiausias 90 dienų.</p>
        {upcomingRows.length ? <div className="purchase-list">{upcomingRows.map((row) => <Link className="purchase-card" href={`/pirkiniai/${row.id}`} key={row.id}>
          <strong>{row.productName}</strong><span>{row.seller}</span>
          <span>Garantija iki {displayDate(row.warrantyEndDate!)}</span>
          <span className="warranty-card-status">{dayPhrase(remainingDays(row.warrantyEndDate!, today))}</span>
        </Link>)}</div> : <p className="home-no-upcoming">Per artimiausias 90 dienų garantijos nesibaigia.</p>}
      </section>
      <section className="home-section" aria-labelledby="recent-title">
        <h2 id="recent-title">Naujausi pirkiniai</h2>
        <p className="home-section-note">Pagal įrašymo datą.</p>
        <div className="purchase-list">{recentRows.map((row) => <Link className="purchase-card" href={`/pirkiniai/${row.id}`} key={row.id}>
          <strong>{row.productName}</strong><span>{row.seller}</span><span>Pirkta {displayDate(row.purchaseDate)}</span>
          <span className="warranty-card-status">{warrantyStatus({ warrantyState: row.warrantyState as WarrantyState, warrantyEndDate: row.warrantyEndDate }, today).label}</span>
        </Link>)}</div>
        <Link className="text-link" href="/pirkiniai">Visi pirkiniai</Link>
      </section>
    </>}
  </PurchaseShell>;
}
