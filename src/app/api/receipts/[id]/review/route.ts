import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isPurchaseId } from "@/lib/purchases";
import { parsePurchaseFields, type PurchaseFields } from "@/lib/purchase-validation";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== getEnv().APP_URL) return Response.json({ error: "Neleistina užklausa." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!isPurchaseId(id) || !body || typeof body !== "object" || typeof body.purchaseId !== "string" || !isPurchaseId(body.purchaseId)) return Response.json({ error: "Čekis arba pirkinys nerastas." }, { status: 404 });
  const keys: (keyof PurchaseFields)[] = ["productName", "seller", "purchaseDate", "price", "currency", "notes"];
  if (keys.some((key) => typeof body[key] !== "string" || body[key].length > 2100)) return Response.json({ error: "Patikrink įvestus duomenis." }, { status: 400 });
  const receiptNumber = body.receiptNumber;
  if (typeof receiptNumber !== "string" || receiptNumber.length > 100 || /[\u0000-\u001f\u007f]/.test(receiptNumber)) return Response.json({ errors: { receiptNumber: "Čekio numeris per ilgas arba netinkamas." } }, { status: 400 });
  const parsed = parsePurchaseFields(Object.fromEntries(keys.map((key) => [key, body[key]])) as PurchaseFields);
  if (!parsed.value) return Response.json({ errors: parsed.errors }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [body.purchaseId,session.user.id]);
    if (!existing.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Pirkinys nerastas." }, { status: 404 }); }
    const linked = await client.query(`SELECT r.id FROM receipt r JOIN purchase_receipt pr ON pr.receipt_id=r.id AND pr.owner_id=r.owner_id
      WHERE r.id=$1 AND r.owner_id=$2 AND r.state='ready' AND pr.purchase_id=$3 FOR UPDATE OF r`, [id,session.user.id,body.purchaseId]);
    if (!linked.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Čekis nerastas arba nebepridėtas prie pirkinio." }, { status: 404 }); }
    const value = parsed.value;
    await client.query(`UPDATE purchase SET product_name=$1,seller=$2,purchase_date=$3,price=$4,currency=$5,notes=$6,updated_at=now()
      WHERE id=$7 AND owner_id=$8`, [value.productName,value.seller,value.purchaseDate,value.price,value.currency,value.notes,body.purchaseId,session.user.id]);
    await client.query("UPDATE receipt SET receipt_number=$1,updated_at=now() WHERE id=$2 AND owner_id=$3", [receiptNumber.trim() || null,id,session.user.id]);
    await client.query("COMMIT");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json({ error: "Išsaugoti nepavyko. Bandyk dar kartą." }, { status: 503 });
  } finally { client.release(); }
}
