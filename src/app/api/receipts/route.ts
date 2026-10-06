import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { putOriginal } from "@/lib/receipt-storage";
import { MAX_RECEIPT_BYTES, ReceiptInputError, validateReceipt } from "@/lib/receipt-validation";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
async function boundedBytes(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_RECEIPT_BYTES || !request.body) throw new ReceiptInputError("Failas turi būti nuo 1 baito iki 10 MiB.");
  const reader = request.body.getReader(); const chunks: Buffer[] = []; let total = 0; const started = Date.now();
  try {
    while (true) {
      const remaining = 30000 - (Date.now() - started);
      if (remaining <= 0) throw new ReceiptInputError("Įkėlimas užtruko per ilgai.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ReceiptInputError("Įkėlimas užtruko per ilgai.")), remaining); })]).finally(() => clearTimeout(timer));
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RECEIPT_BYTES) throw new ReceiptInputError("Failas turi būti nuo 1 baito iki 10 MiB.");
      chunks.push(Buffer.from(result.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== getEnv().APP_URL) return json("Neleistina užklausa.", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json("Prisijunk ir bandyk dar kartą.", 401);
  const key = request.headers.get("x-submission-key") ?? "";
  const purchaseId = request.headers.get("x-purchase-id") ?? "";
  if (!uuid.test(key) || !uuid.test(purchaseId)) return json("Pirkinys nerastas.", 404);
  const db = await pool.connect().catch(() => null);
  if (!db) return json("Paslauga laikinai nepasiekiama. Bandyk dar kartą.", 503);
  let advisory = false;
  try {
    await db.query("SET lock_timeout = '35s'");
    await db.query("SELECT pg_advisory_lock(hashtextextended($1,90817))", [session.user.id]);
    advisory = true;
    await db.query("RESET lock_timeout");
    // Commit admission before reading bytes so rejected files and failed writes
    // consume the same durable per-owner attempt budget as successful uploads.
    await db.query("BEGIN");
    await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [session.user.id]);
    const attemptLimit = getEnv().RECEIPT_ATTEMPTS_PER_HOUR;
    const admitted = await db.query(`INSERT INTO receipt_upload_limit (owner_id,window_started_at,attempts) VALUES ($1,now(),1)
      ON CONFLICT (owner_id) DO UPDATE SET
        window_started_at=CASE WHEN receipt_upload_limit.window_started_at <= now()-interval '1 hour' THEN now() ELSE receipt_upload_limit.window_started_at END,
        attempts=CASE WHEN receipt_upload_limit.window_started_at <= now()-interval '1 hour' THEN 1 ELSE least(receipt_upload_limit.attempts+1,$2::int+1) END
      RETURNING attempts`, [session.user.id,attemptLimit]);
    await db.query("COMMIT");
    if (admitted.rows[0].attempts > attemptLimit) return json("Pasiekta valandinė įkėlimo bandymų riba. Bandyk vėliau.", 429);
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '35s'");
    await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [session.user.id]);
    const cancelled = await db.query("SELECT 1 FROM receipt_cancellation WHERE owner_id=$1 AND submission_key=$2", [session.user.id,key]);
    if (cancelled.rowCount) { await db.query("ROLLBACK"); return json("Įkėlimas atšauktas.", 409); }
    const purchase = await db.query("SELECT id FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [purchaseId, session.user.id]);
    if (!purchase.rowCount) { await db.query("ROLLBACK"); return json("Pirkinys nerastas.", 404); }
    const prior = await db.query("SELECT id FROM receipt WHERE owner_id=$1 AND submission_key=$2", [session.user.id,key]);
    if (!prior.rowCount) {
      const recent = await db.query("SELECT count(*)::int AS n FROM receipt WHERE owner_id=$1 AND created_at > now()-interval '1 hour'", [session.user.id]);
      if (recent.rows[0].n >= getEnv().RECEIPT_UPLOADS_PER_HOUR) { await db.query("ROLLBACK"); return json("Pasiekta valandinė įkėlimo riba. Bandyk vėliau.", 429); }
    }
    let bytes: Buffer; let file: Awaited<ReturnType<typeof validateReceipt>>;
    try {
      bytes = await boundedBytes(request);
      file = await validateReceipt(bytes, request.headers.get("content-type") ?? "", decodeURIComponent(request.headers.get("x-file-name") ?? "cekis"));
    } catch (error) { await db.query("ROLLBACK"); return json(error instanceof ReceiptInputError ? error.message : "Failo nuskaityti nepavyko.", 400); }
    const id = randomUUID(); const objectKey = `originals/${randomUUID()}`;
    await db.query(`INSERT INTO receipt (id,owner_id,submission_key,target_purchase_id,object_key,filename,content_type,byte_size,sha256,state,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',now()+interval '1 hour') ON CONFLICT (owner_id,submission_key) DO NOTHING`,
      [id,session.user.id,key,purchaseId,objectKey,file.filename,file.contentType,file.byteSize,file.sha256]);
    const found = await db.query("SELECT * FROM receipt WHERE owner_id=$1 AND submission_key=$2 FOR UPDATE", [session.user.id,key]);
    const row = found.rows[0];
    if (row.target_purchase_id !== purchaseId || row.sha256 !== file.sha256 || row.byte_size !== file.byteSize || row.content_type !== file.contentType) {
      await db.query("ROLLBACK"); return json("Šis įkėlimo raktas jau naudotas kitam failui arba pirkiniui.", 409);
    }
    if (row.state === "ready") {
      const link = await db.query("SELECT 1 FROM purchase_receipt WHERE owner_id=$1 AND purchase_id=$2 AND receipt_id=$3", [session.user.id,purchaseId,row.id]);
      if (!link.rowCount) { await db.query("ROLLBACK"); return json("Čekis nebėra pridėtas prie šio pirkinio.", 409); }
      await db.query("COMMIT"); return Response.json({ id: row.id, saved: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (row.state !== "reserved") { await db.query("ROLLBACK"); return json("Šis čekis jau trinamas.", 409); }
    // The reservation must survive a crash after S3 accepts the object.
    await db.query("COMMIT");
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '35s'");
    await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [session.user.id]);
    const cancelledAgain = await db.query("SELECT 1 FROM receipt_cancellation WHERE owner_id=$1 AND submission_key=$2", [session.user.id,key]);
    if (cancelledAgain.rowCount) { await db.query("ROLLBACK"); return json("Įkėlimas atšauktas.", 409); }
    const activeAgain = await db.query("SELECT id FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [purchaseId,session.user.id]);
    if (!activeAgain.rowCount) { await db.query("ROLLBACK"); return json("Pirkinys nerastas.", 404); }
    const current = await db.query("SELECT state FROM receipt WHERE id=$1 AND owner_id=$2 FOR UPDATE", [row.id,session.user.id]);
    if (!current.rowCount || current.rows[0].state !== "reserved") { await db.query("ROLLBACK"); return json("Šis čekis jau trinamas.", 409); }
    await db.query("UPDATE receipt SET lease_until=now()+interval '2 minutes', updated_at=now() WHERE id=$1", [row.id]);
    await putOriginal(row.object_key, bytes, file.contentType, file.sha256);
    const currentSession = await auth.api.getSession({ headers: request.headers });
    if (!currentSession || currentSession.user.id !== session.user.id) {
      await db.query("UPDATE receipt SET state='deleting', expires_at=now(), lease_until=NULL, updated_at=now() WHERE id=$1", [row.id]);
      await db.query("COMMIT"); return json("Sesija baigėsi. Prisijunk ir bandyk dar kartą.", 401);
    }
    await db.query("INSERT INTO purchase_receipt (owner_id,purchase_id,receipt_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [session.user.id,purchaseId,row.id]);
    await db.query("UPDATE receipt SET state='ready', lease_until=NULL, expires_at=now()+interval '24 hours', updated_at=now() WHERE id=$1", [row.id]);
    await db.query("COMMIT");
    return Response.json({ id: row.id, saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { await db.query("ROLLBACK").catch(() => {}); return json("Įkelti nepavyko. Bandyk dar kartą.", 503); }
  finally {
    if (advisory) await db.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [session.user.id]).catch(() => {});
    await db.query("RESET lock_timeout").catch(() => {});
    db.release();
  }
}
