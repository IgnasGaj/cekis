import { notFound } from "next/navigation";
import { PurchaseShell } from "@/components/purchase-shell";
import { getPurchase, listParams } from "@/lib/purchases";
import { todayInVilnius } from "@/lib/purchase-validation";
import { editAction } from "../../actions";
import { PurchaseForm } from "../../purchase-form";

export const dynamic = "force-dynamic";
export default async function EditPurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const row = await getPurchase(id);
  if (!row) notFound();
  const search = await searchParams;
  const single = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const context = listParams({ q: single("q"), sort: single("sort"), page: single("page") });
  const query = new URLSearchParams();
  if (context.q) query.set("q", context.q);
  if (context.sort !== "newest") query.set("sort", context.sort);
  if (context.page > 1) query.set("page", String(context.page));
  return <PurchaseShell><section className="page-heading"><h1>Redaguoti pirkinį</h1><p>Atnaujink išsaugotą informaciją.</p></section>
    <PurchaseForm initial={{ productName: row.productName, seller: row.seller, purchaseDate: row.purchaseDate, price: row.price ?? "", currency: row.currency ?? "EUR", notes: row.notes ?? "" }} action={editAction.bind(null, id, query.toString())} cancelHref={`/pirkiniai/${id}${query.size ? `?${query}` : ""}`} edit maxDate={todayInVilnius()} />
  </PurchaseShell>;
}
