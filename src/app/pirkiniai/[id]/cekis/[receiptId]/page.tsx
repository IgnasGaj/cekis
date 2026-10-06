import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { getPurchase, isPurchaseId } from "@/lib/purchases";
import { PurchaseShell } from "@/components/purchase-shell";
import { ReceiptReview } from "@/components/receipt-review";
import { todayInVilnius } from "@/lib/purchase-validation";

export const dynamic = "force-dynamic";
export default async function ReceiptReviewPage({ params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const { id, receiptId } = await params;
  const purchase = await getPurchase(id);
  if (!purchase || !isPurchaseId(receiptId)) notFound();
  const result = await pool.query(`SELECT r.id,r.filename,r.content_type AS "contentType",r.receipt_number AS "receiptNumber"
    FROM receipt r JOIN purchase_receipt pr ON pr.receipt_id=r.id AND pr.owner_id=r.owner_id
    WHERE r.id=$1 AND pr.purchase_id=$2 AND r.owner_id=$3 AND r.state='ready'`, [receiptId,id,purchase.ownerId]);
  if (!result.rowCount) notFound();
  const receipt = result.rows[0];
  return <PurchaseShell>
    <Link className="back-link" href={`/pirkiniai/${id}`}>← Grįžti į pirkinį</Link>
    <section className="page-heading detail-heading"><h1>Peržiūrėk duomenis</h1><p>Nuskaitytas tekstas yra tik pasiūlymas. Patikrink ir pataisyk prieš išsaugodamas.</p></section>
    <ReceiptReview purchaseId={id} receiptId={receiptId} filename={receipt.filename} contentType={receipt.contentType} receiptNumber={receipt.receiptNumber ?? ""}
      initial={{ productName: purchase.productName, seller: purchase.seller, purchaseDate: purchase.purchaseDate, price: purchase.price ?? "", currency: purchase.currency ?? "", notes: purchase.notes ?? "" }}
      maxDate={todayInVilnius()} revision={purchase.revision} initialWarranty={{ warrantyState: purchase.warrantyState as "unknown" | "none" | "known", warrantyEndDate: purchase.warrantyEndDate, warrantyDurationMonths: purchase.warrantyDurationMonths, warrantySource: purchase.warrantySource as "date" | "duration" | null }} />
  </PurchaseShell>;
}
