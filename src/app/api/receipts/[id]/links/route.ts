import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getEnv } from "@/lib/env";

const json = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
async function mutate(request: Request, id: string, link: boolean) {
  if (request.headers.get("origin") !== getEnv().APP_URL) return json("Neleistina užklausa.", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json("Prisijunk ir bandyk dar kartą.", 401);
  const purchaseId = (await request.json().catch(() => ({}))).purchaseId;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) return json("Čekis nerastas.", 404);
  if (typeof purchaseId !== "string" || !uuid.test(purchaseId)) return json("Pirkinys nerastas.", 404);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const purchase = await db.query("SELECT id FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [purchaseId,session.user.id]);
    if (!purchase.rowCount) { await db.query("ROLLBACK"); return json("Pirkinys nerastas.", 404); }
    const receipt = await db.query("SELECT id FROM receipt WHERE id=$1 AND owner_id=$2 AND state='ready' FOR UPDATE", [id,session.user.id]);
    if (!receipt.rowCount) { await db.query("ROLLBACK"); return json("Čekis nerastas.", 404); }
    if (link) await db.query("INSERT INTO purchase_receipt (owner_id,purchase_id,receipt_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [session.user.id,purchaseId,id]);
    else await db.query("DELETE FROM purchase_receipt WHERE owner_id=$1 AND purchase_id=$2 AND receipt_id=$3", [session.user.id,purchaseId,id]);
    await db.query("UPDATE receipt SET expires_at=now()+interval '24 hours',updated_at=now() WHERE id=$1", [id]);
    await db.query("COMMIT"); return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { await db.query("ROLLBACK").catch(() => {}); return json("Veiksmo atlikti nepavyko. Bandyk dar kartą.", 503); }
  finally { db.release(); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return mutate(request, (await params).id, true); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return mutate(request, (await params).id, false); }
