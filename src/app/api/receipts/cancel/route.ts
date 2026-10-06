import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getEnv } from "@/lib/env";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== getEnv().APP_URL) return Response.json({ error: "Neleistina užklausa." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401 });
  const { key } = await request.json().catch(() => ({}));
  if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key)) return Response.json({ error: "Netinkamas raktas." }, { status: 400 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [session.user.id]);
    await db.query("INSERT INTO receipt_cancellation (owner_id,submission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [session.user.id,key]);
    const found = await db.query("SELECT id,state FROM receipt WHERE owner_id=$1 AND submission_key=$2 FOR UPDATE", [session.user.id,key]);
    if (found.rowCount && found.rows[0].state !== "deleted") {
      await db.query("UPDATE receipt SET state='deleting',expires_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1", [found.rows[0].id]);
      await db.query("DELETE FROM purchase_receipt WHERE receipt_id=$1", [found.rows[0].id]);
    }
    await db.query("COMMIT"); return Response.json({ ok: true });
  } catch { await db.query("ROLLBACK").catch(() => {}); return Response.json({ error: "Atšaukti nepavyko." }, { status: 503 }); }
  finally { db.release(); }
}
