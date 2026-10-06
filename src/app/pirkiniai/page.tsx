import Link from "next/link";
import { redirect } from "next/navigation";
import { PurchaseShell } from "@/components/purchase-shell";
import { displayDate, displayPrice } from "@/lib/purchase-format";
import { listHref, listParams, listPurchases } from "@/lib/purchases";
import { dayPhrase, warrantyStatus } from "@/lib/warranty";

export const dynamic = "force-dynamic";
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const single = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const params = listParams({ q: single("q"), sort: single("sort"), warranty: single("warranty"), page: single("page") });
  const { rows, hasNext, redirectPage, today } = await listPurchases(params);
  if (redirectPage !== null) {
    const target = listHref({ ...params, page: redirectPage });
    redirect(single("busena") === "istrinta" ? `${target}${target.includes("?") ? "&" : "?"}busena=istrinta` : target);
  }
  const context = new URLSearchParams();
  if (params.q) context.set("q", params.q);
  if (params.sort !== "newest") context.set("sort", params.sort);
  if (params.warranty !== "all") context.set("warranty", params.warranty);
  if (params.page > 1) context.set("page", String(params.page));
  const suffix = context.size ? `?${context}` : "";
  return <PurchaseShell>
    <section className="page-heading heading-with-action"><div><h1>Mano pirkiniai</h1><p>Čia saugomi tavo pridėti pirkiniai.</p></div><Link className="small-action" href="/pirkiniai/naujas">Pridėti pirkinį</Link></section>
    {single("busena") === "istrinta" && <p className="notice" role="status">Pirkinys ištrintas</p>}
    <form className="list-filters" action="/pirkiniai" method="get">
      <label htmlFor="purchase-search">Ieškoti pagal prekę arba pardavėją</label>
      <input id="purchase-search" name="q" maxLength={200} defaultValue={params.q} type="search" />
      <label htmlFor="purchase-warranty">Garantijos filtras</label>
      <select id="purchase-warranty" name="warranty" defaultValue={params.warranty}><option value="all">Visi</option><option value="valid">Galioja</option><option value="soon">Greitai baigsis</option><option value="expired">Pasibaigė</option><option value="unknown">Garantija nenurodyta</option><option value="none">Pažymėta: garantijos nėra</option></select>
      <label htmlFor="purchase-sort">Rikiuoti pirkinius</label>
      <select id="purchase-sort" name="sort" defaultValue={params.sort}><option value="newest">Naujausi pirmiausia</option><option value="oldest">Seniausi pirmiausia</option><option value="expiry">Pagal artimiausią garantijos pabaigą</option></select>
      <button className="filter-button" type="submit">Rodyti</button>
    </form>
    {rows.length ? <div className="purchase-list">{rows.map((row) => <Link className="purchase-card" href={`/pirkiniai/${row.id}${suffix}`} key={row.id}>
      <strong>{row.productName}</strong><span>{row.seller}</span><span>{displayDate(row.purchaseDate)}{row.price && row.currency ? ` · ${displayPrice(row.price, row.currency)}` : ""}</span>
      <span className="warranty-card-status">{(() => { const status = warrantyStatus({ warrantyState: row.warrantyState as "unknown" | "none" | "known", warrantyEndDate: row.warrantyEndDate }, today); return `${status.label}${row.warrantyEndDate ? ` · ${displayDate(row.warrantyEndDate)}` : ""}${status.days !== null && status.days >= 0 ? ` · ${dayPhrase(status.days)}` : ""}`; })()}</span>
    </Link>)}</div> : <section className="empty-card compact-empty"><h2>{params.q || params.warranty !== "all" ? "Pirkinių nerasta" : "Dar neturi pirkinių"}</h2><p>{params.q || params.warranty !== "all" ? "Pabandyk kitą paiešką arba išvalyk filtrus." : "Pridėk pirmą pirkinį rankiniu būdu."}</p>
      <Link className="secondary-button" href={params.q || params.warranty !== "all" ? "/pirkiniai" : "/pirkiniai/naujas"}>{params.q || params.warranty !== "all" ? "Išvalyti filtrus" : "Pridėti pirkinį"}</Link>
    </section>}
    {(params.page > 1 || hasNext) && <nav className="pagination" aria-label="Pirkinių puslapiai">
      {params.page > 1 && <Link href={listHref({ ...params, page: params.page - 1 })}>Ankstesnis puslapis</Link>}
      <span>{params.page} puslapis</span>
      {hasNext && <Link href={listHref({ ...params, page: params.page + 1 })}>Kitas puslapis</Link>}
    </nav>}
  </PurchaseShell>;
}
