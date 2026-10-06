import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseShell } from "@/components/purchase-shell";
import { displayDate, displayPrice } from "@/lib/purchase-format";
import { getPurchase, listHref, listParams } from "@/lib/purchases";
import { pool } from "@/lib/db";
import { ReceiptManager } from "@/components/receipt-manager";
import { DeleteButton } from "../delete-button";

export const dynamic = "force-dynamic";
export default async function PurchaseDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const row = await getPurchase(id);
  if (!row) notFound();
  const attachedResult = await pool.query(`SELECT r.id,r.filename,r.content_type AS "contentType",r.byte_size AS "byteSize",
    (SELECT count(*)::int FROM purchase_receipt x WHERE x.receipt_id=r.id) AS links
    FROM receipt r JOIN purchase_receipt pr ON pr.receipt_id=r.id AND pr.owner_id=r.owner_id
    WHERE pr.purchase_id=$1 AND r.owner_id=$2 AND r.state='ready' ORDER BY pr.created_at DESC LIMIT 100`, [id,row.ownerId]);
  const availableResult = await pool.query(`SELECT r.id,r.filename,r.content_type AS "contentType",r.byte_size AS "byteSize",
    (SELECT count(*)::int FROM purchase_receipt x WHERE x.receipt_id=r.id) AS links
    FROM receipt r WHERE r.owner_id=$1 AND r.state='ready' AND NOT EXISTS
    (SELECT 1 FROM purchase_receipt pr WHERE pr.receipt_id=r.id AND pr.purchase_id=$2)
    ORDER BY r.created_at DESC LIMIT 50`, [row.ownerId,id]);
  const search = await searchParams;
  const single = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const context = listParams({ q: single("q"), sort: single("sort"), page: single("page") });
  const contextQuery = new URLSearchParams();
  if (context.q) contextQuery.set("q", context.q);
  if (context.sort !== "newest") contextQuery.set("sort", context.sort);
  if (context.page > 1) contextQuery.set("page", String(context.page));
  return <PurchaseShell>
    <Link href={listHref(context)} className="back-link">← Mano pirkiniai</Link>
    <section className="page-heading detail-heading"><h1>{row.productName}</h1><p>{row.seller}</p></section>
    {single("busena") === "issaugota" && <p className="notice" role="status">Pirkinys išsaugotas</p>}
    {single("busena") === "atnaujinta" && <p className="notice" role="status">Pakeitimai išsaugoti</p>}
    {single("busena") === "cekis-pridetas" && <p className="notice" role="status">Čekis pridėtas</p>}
    <section className="detail-card" aria-label="Pirkinio informacija">
      <div className="detail-row"><span>Pardavėjas</span><strong>{row.seller}</strong></div>
      <div className="detail-row"><span>Pirkimo data</span><strong>{displayDate(row.purchaseDate)}</strong></div>
      {row.price && row.currency && <div className="detail-row"><span>Kaina</span><strong>{displayPrice(row.price, row.currency)}</strong></div>}
      {row.notes && <div className="detail-row"><span>Pastabos</span><p className="notes-text">{row.notes}</p></div>}
    </section>
    <section className="placeholder-card"><h2>Garantija nenurodyta</h2><p>Garantijos informaciją galėsi pridėti vėlesniame etape.</p></section>
    <ReceiptManager purchaseId={id} attached={attachedResult.rows} available={availableResult.rows} />
    <Link className="primary-button" href={`/pirkiniai/${id}/redaguoti${contextQuery.size ? `?${contextQuery}` : ""}`}>Redaguoti</Link>
    <DeleteButton id={id} productName={row.productName} context={contextQuery.toString()} />
  </PurchaseShell>;
}
