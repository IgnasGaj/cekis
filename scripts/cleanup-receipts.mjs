import { config } from "dotenv";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";
config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
const dryRun = process.argv.includes("--dry-run");
const limit = Math.min(100, Math.max(1, Number(process.env.RECEIPT_CLEANUP_BATCH ?? 25)));
const { DATABASE_URL, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
if (!DATABASE_URL || (!dryRun && (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY))) throw new Error("Trūksta saugyklos arba duomenų bazės konfigūracijos.");
const db = new pg.Client({ connectionString: DATABASE_URL }); await db.connect();
const s3 = dryRun ? null : new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: true, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }, maxAttempts: 2 });
let examined = 0, deleted = 0, failed = 0;
try {
  for (let i = 0; i < limit; i++) {
    await db.query("BEGIN");
    const selected = await db.query(`SELECT r.id,r.object_key,r.state FROM receipt r
      WHERE r.expires_at <= now() AND r.state IN ('reserved','ready','deleting')
      AND (r.lease_until IS NULL OR r.lease_until < now() - interval '5 minutes')
      AND NOT EXISTS (SELECT 1 FROM purchase_receipt pr WHERE pr.receipt_id=r.id)
      ORDER BY r.expires_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`);
    if (!selected.rowCount) { await db.query("COMMIT"); break; }
    const row = selected.rows[0]; examined++;
    if (dryRun) { process.stdout.write(`candidate ${row.id} ${row.state}\n`); await db.query("ROLLBACK"); break; }
    await db.query("UPDATE receipt SET state='deleting',updated_at=now() WHERE id=$1", [row.id]);
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: row.object_key }), { abortSignal: AbortSignal.timeout(30000) });
      await db.query("UPDATE receipt SET state='deleted',cleanup_error=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [row.id]);
      await db.query("COMMIT"); deleted++;
    } catch {
      await db.query(`UPDATE receipt SET cleanup_attempts=cleanup_attempts+1,cleanup_error='Saugyklos trynimas nepavyko',
        expires_at=now()+(least(3600,power(2,least(cleanup_attempts,10))*60)::text || ' seconds')::interval,updated_at=now() WHERE id=$1`, [row.id]);
      await db.query("COMMIT"); failed++;
    }
  }
} finally { await db.end(); s3?.destroy(); }
process.stdout.write(JSON.stringify({ dryRun, examined, deleted, failed }) + "\n");
