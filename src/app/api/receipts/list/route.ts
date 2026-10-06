import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const url = new URL(request.url); const purchaseId = url.searchParams.get("purchaseId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaseId)) return Response.json({ error: "Pirkinys nerastas." }, { status: 404 });
  const active = await pool.query("SELECT 1 FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [purchaseId,session.user.id]);
  if (!active.rowCount) return Response.json({ error: "Pirkinys nerastas." }, { status: 404 });
  const q = (url.searchParams.get("q") ?? "").trim().slice(0,100).replace(/[\\%_]/g,(character) => `\\${character}`);
  const rows = await pool.query(`SELECT r.id,r.filename,r.content_type AS "contentType",r.byte_size AS "byteSize",
    (SELECT count(*)::int FROM purchase_receipt x WHERE x.receipt_id=r.id) AS links
    FROM receipt r WHERE r.owner_id=$1 AND r.state='ready' AND r.filename ILIKE $3 ESCAPE '\\'
    AND NOT EXISTS (SELECT 1 FROM purchase_receipt pr WHERE pr.receipt_id=r.id AND pr.purchase_id=$2)
    ORDER BY r.created_at DESC LIMIT 50`, [session.user.id,purchaseId,`%${q}%`]);
  return Response.json({ receipts: rows.rows }, { headers: { "Cache-Control": "private, no-store" } });
}
