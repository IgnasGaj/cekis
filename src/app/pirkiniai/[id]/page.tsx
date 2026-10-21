import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseShell } from "@/components/purchase-shell";
import { displayDate, displayPrice } from "@/lib/purchase-format";
import { getPurchase, listHref, listParams } from "@/lib/purchases";
import { listReceiptPage } from "@/lib/receipt-pages";
import { ReceiptManager } from "@/components/receipt-manager";
import { DeleteButton } from "../delete-button";
import { todayInVilnius } from "@/lib/purchase-validation";
import { dayPhrase, warrantyStatus } from "@/lib/warranty";
import { getPurchaseReminderSummary } from "@/lib/reminders";
import { ReminderControl } from "./reminder-control";
import { WarrantyControl } from "./warranty-control";

export const dynamic = "force-dynamic";
export default async function PurchaseDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const row = await getPurchase(id);
  if (!row) notFound();
  const [attachedPage,availablePage] = await Promise.all([
    listReceiptPage(row.ownerId,id,"attached"),listReceiptPage(row.ownerId,id,"available"),
  ]);
  const search = await searchParams;
  const single = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const context = listParams({ q: single("q"), sort: single("sort"), warranty: single("warranty"), page: single("page") });
  const contextQuery = new URLSearchParams();
  if (context.q) contextQuery.set("q", context.q);
  if (context.sort !== "newest") contextQuery.set("sort", context.sort);
  if (context.warranty !== "all") contextQuery.set("warranty", context.warranty);
  if (context.page > 1) contextQuery.set("page", String(context.page));
  const status = warrantyStatus({ warrantyState: row.warrantyState as "unknown" | "none" | "known", warrantyEndDate: row.warrantyEndDate }, todayInVilnius());
  const reminderStatus = await getPurchaseReminderSummary(row.ownerId,row);
  return <PurchaseShell>
    <Link href={listHref(context)} className="back-link">← Mano pirkiniai</Link>
    <section className="page-heading detail-heading"><h1>{row.productName || "Čekis be pavadinimo"}</h1><p>{row.seller || "Pardavėjas nenurodytas"}</p></section>
    {attachedPage.receipts[0] && <a className="small-action" href={`/api/receipts/${attachedPage.receipts[0].id}/content`} target="_blank" rel="noreferrer">Atidaryti čekį</a>}
    {single("busena") === "issaugota" && <p className="notice" role="status">Pirkinys išsaugotas</p>}
    {single("busena") === "atnaujinta" && <p className="notice" role="status">Pakeitimai išsaugoti</p>}
    {single("busena") === "cekis-pridetas" && <p className="notice" role="status">Čekis pridėtas</p>}
    <section className="detail-card" aria-label="Pirkinio informacija">
      <div className="detail-row"><span>Pardavėjas</span><strong>{row.seller || "Nenurodyta"}</strong></div>
      <div className="detail-row"><span>Pirkimo data</span><strong>{displayDate(row.purchaseDate)}</strong></div>
      {row.price && row.currency && <div className="detail-row"><span>Kaina</span><strong>{displayPrice(row.price, row.currency)}</strong></div>}
      {row.notes && <div className="detail-row"><span>Pastabos</span><p className="notes-text">{row.notes}</p></div>}
    </section>
    <section className="placeholder-card" aria-label="Garantijos informacija"><h2>Garantija</h2><p><strong>{status.label}</strong></p>
      {row.warrantyEndDate && <p>Garantija iki {displayDate(row.warrantyEndDate)}</p>}
      {row.warrantyOrigin === "automatic" && row.warrantyState === "known" && <p className="small-note">Automatiškai nustatyta: 24 mėn.</p>}
      {status.days !== null && status.days >= 0 && <p>{dayPhrase(status.days)}</p>}
      <WarrantyControl id={id} revision={row.revision} purchaseDate={row.purchaseDate} warranty={{ warrantyState: row.warrantyState as "known" | "unknown" | "none", warrantyEndDate: row.warrantyEndDate, warrantyDurationMonths: row.warrantyDurationMonths, warrantySource: row.warrantySource as "date" | "duration" | null }} />
    </section>
    <ReminderControl id={id} mode={row.reminderMode} offset={row.reminderOffset} revision={row.revision} status={reminderStatus} />
    <ReceiptManager purchaseId={id} attachedPage={attachedPage} availablePage={availablePage} />
    <Link className="primary-button" href={`/pirkiniai/${id}/redaguoti${contextQuery.size ? `?${contextQuery}` : ""}`}>Redaguoti</Link>
    <DeleteButton id={id} productName={row.productName} context={contextQuery.toString()} />
  </PurchaseShell>;
}
