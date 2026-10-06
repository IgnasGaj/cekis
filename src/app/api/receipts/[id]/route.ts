import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getEnv } from "@/lib/env";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== getEnv().APP_URL) return Response.json({ error: "Neleistina užklausa." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401 });
  const { id } = await params; const db = await pool.connect();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) { db.release(); return Response.json({ error: "Čekis nerastas." }, { status: 404 }); }
  try {
    await db.query("BEGIN");
    const row = await db.query("SELECT state FROM receipt WHERE id=$1 AND owner_id=$2 FOR UPDATE", [id,session.user.id]);
    if (!row.rowCount || row.rows[0].state === "deleted") { await db.query("ROLLBACK"); return Response.json({ error: "Čekis nerastas." }, { status: 404 }); }
    if (row.rows[0].state !== "deleting") {
      await db.query("UPDATE receipt SET state='deleting',expires_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1", [id]);
      await db.query("DELETE FROM purchase_receipt WHERE receipt_id=$1 AND owner_id=$2", [id,session.user.id]);
    }
    await db.query("COMMIT"); return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { await db.query("ROLLBACK").catch(() => {}); return Response.json({ error: "Ištrinti nepavyko. Bandyk dar kartą." }, { status: 503 }); }
  finally { db.release(); }
}
