import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { getEnv } from "./env";
import { todayInVilnius } from "./purchase-validation";
import { classifyMailError, reminderMessage, sendReminderMail } from "./reminder-mail";
import { desiredReminder, insideSendWindow, reconcileDirtyPurchases, transportReady } from "./reminders";

type Work = { id: string; owner_id: string; purchase_id: string; identity: string; end_date: string; offset_days: number; recipient_version: number; claim_token: string; lease_until: Date };
type Sender = typeof sendReminderMail;
export type WorkerCounts = { claimed: number; accepted: number; retried: number; failed: number; uncertain: number; cancelled: number };
const emptyCounts = (): WorkerCounts => ({ claimed: 0, accepted: 0, retried: 0, failed: 0, uncertain: 0, cancelled: 0 });

export function nextAttempt(now: Date, attempts: number): Date {
  const delays = [15, 60, 360, 1440];
  const candidate = new Date(now.getTime() + delays[Math.min(attempts - 1, 3)] * 60_000);
  while (!insideSendWindow(candidate)) candidate.setTime(candidate.getTime() + 60_000);
  return candidate;
}

async function claim(now: Date, today: string): Promise<Work | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query(`WITH rows AS (SELECT id FROM warranty_reminder WHERE status IN ('pending','processing')
      AND end_date < $1::date AND (status='pending' OR dispatch_authorized_at IS NULL)
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE warranty_reminder SET status='cancelled',claim_token=NULL,lease_until=NULL WHERE id IN (SELECT id FROM rows)`, [today]);
    await client.query(`WITH rows AS (SELECT id FROM warranty_reminder WHERE status='processing' AND lease_until < $1
      AND dispatch_authorized_at IS NOT NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE warranty_reminder SET status='uncertain',error_class='acknowledgement_lost',claim_token=NULL,lease_until=NULL
      WHERE id IN (SELECT id FROM rows)`, [now]);
    await client.query(`WITH rows AS (SELECT id FROM warranty_reminder WHERE status='processing' AND lease_until < $1
      AND dispatch_authorized_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE warranty_reminder SET status='pending',claim_token=NULL,lease_until=NULL WHERE id IN (SELECT id FROM rows)`, [now]);
    const found = (await client.query<Work>(`SELECT id,owner_id,purchase_id,identity,end_date::text,offset_days,recipient_version
      FROM warranty_reminder WHERE status='pending' AND due_date <= $1::date AND end_date >= $1::date
      AND next_attempt_at <= $2 AND attempts < 5 ORDER BY due_date,next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [today,now])).rows[0];
    if (!found) { await client.query("COMMIT"); return null; }
    const token = randomUUID();
    const leaseUntil = new Date(now.getTime() + 10 * 60_000);
    await client.query(`UPDATE warranty_reminder SET status='processing',claim_token=$2,lease_until=$3,dispatch_authorized_at=NULL
      WHERE id=$1`, [found.id,token,leaseUntil]);
    await client.query("COMMIT");
    return { ...found, claim_token: token, lease_until: leaseUntil };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

async function authorize(work: Work, clock: () => Date): Promise<{ kind: "authorized"; email: string; productName: string; endDate: string } | { kind: "cancelled" | "failed" | "deferred" } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'");
    const purchase = (await client.query(`SELECT id,owner_id,product_name,warranty_state,warranty_end_date::text,
      reminder_mode,reminder_offset,deleted_at FROM purchase WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [work.purchase_id,work.owner_id])).rows[0];
    const account = (await client.query(`SELECT u.email,u.email_verified,u.reminder_recipient_version,
      rp.enabled,rp.default_offset,rp.revision FROM "user" u JOIN reminder_preference rp ON rp.user_id=u.id
      WHERE u.id=$1 FOR SHARE OF u,rp`, [work.owner_id])).rows[0];
    const current = (await client.query(`SELECT status,claim_token,lease_until,attempts,identity FROM warranty_reminder WHERE id=$1 FOR UPDATE`,[work.id])).rows[0];
    const now = clock();
    const desired = purchase && account ? desiredReminder(purchase,account,todayInVilnius(now)) : null;
    if (!current || current.status !== "processing" || current.claim_token !== work.claim_token) {
      await client.query("ROLLBACK"); return null;
    }
    if (current.lease_until <= now) {
      await client.query(`UPDATE warranty_reminder SET status='pending',claim_token=NULL,lease_until=NULL WHERE id=$1 AND claim_token=$2`,[work.id,work.claim_token]);
      await client.query("COMMIT"); return { kind: "deferred" };
    }
    if (!desired || desired.identity !== work.identity || desired.dueDate > todayInVilnius(now) || !transportReady()) {
      const kind = !transportReady() && desired ? "failed" : "cancelled";
      await client.query(`UPDATE warranty_reminder SET status=$2,claim_token=NULL,lease_until=NULL,error_class=$3 WHERE id=$1`,
        [work.id,kind,kind === "failed" ? "configuration" : null]);
      await client.query("COMMIT"); return { kind };
    }
    // The row is still provably unsent here. Closing the window does not use an SMTP attempt.
    const dispatchTime = clock();
    if (!insideSendWindow(dispatchTime) || dispatchTime >= work.lease_until) {
      await client.query(`UPDATE warranty_reminder SET status='pending',claim_token=NULL,lease_until=NULL WHERE id=$1 AND claim_token=$2`,[work.id,work.claim_token]);
      await client.query("COMMIT"); return { kind: "deferred" };
    }
    await client.query(`UPDATE warranty_reminder SET dispatch_authorized_at=$2,attempts=attempts+1 WHERE id=$1`,[work.id,dispatchTime]);
    await client.query("COMMIT");
    return { kind: "authorized", email: account.email, productName: purchase.product_name, endDate: desired.endDate };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

// Called only before transport starts. The token prevents a stale worker from requeuing another claim.
async function requeueUnsent(work: Work): Promise<void> {
  await pool.query(`UPDATE warranty_reminder SET status='pending',claim_token=NULL,lease_until=NULL,
    attempts=attempts-1,dispatch_authorized_at=NULL,error_class=NULL
    WHERE id=$1 AND claim_token=$2 AND status='processing' AND dispatch_authorized_at IS NOT NULL AND attempts > 0`,
    [work.id,work.claim_token]);
}

async function finalize(work: Work, now: Date, result: { messageId: string } | { error: unknown }): Promise<"accepted" | "retried" | "failed" | "uncertain" | null> {
  const kind = "messageId" in result ? "accepted" : classifyMailError(result.error);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'");
    const row = (await client.query<{ attempts: number; end_date: string }>(`SELECT attempts,end_date::text FROM warranty_reminder
      WHERE id=$1 AND claim_token=$2 AND status='processing' FOR UPDATE`,[work.id,work.claim_token])).rows[0];
    if (!row) { await client.query("ROLLBACK"); return null; }
    let status = kind === "accepted" ? "accepted" : kind === "uncertain" ? "uncertain" : kind === "permanent" ? "failed" : "pending";
    if (status === "pending" && (row.attempts >= 5 || row.end_date < todayInVilnius(now))) status = "failed";
    const retryAt = status === "pending" ? nextAttempt(now,row.attempts) : null;
    await client.query(`UPDATE warranty_reminder SET status=$3,claim_token=NULL,lease_until=NULL,
      accepted_at=case when $3='accepted' then $4 else accepted_at end,
      provider_message_id=case when $3='accepted' then $5 else provider_message_id end,
      next_attempt_at=coalesce($6,next_attempt_at),dispatch_authorized_at=case when $3='pending' then NULL else dispatch_authorized_at end,
      error_class=$7 WHERE id=$1 AND claim_token=$2`,
      [work.id,work.claim_token,status,now,"messageId" in result ? result.messageId : null,retryAt,
        status === "accepted" ? null : status === "uncertain" ? "acceptance_unknown" : status === "failed" && kind === "permanent" ? "rejected" : "temporary_rejection"]);
    await client.query("COMMIT");
    return status === "pending" ? "retried" : status as "accepted" | "failed" | "uncertain";
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function runReminderWorker(options: { now?: Date; clock?: () => Date; send?: Sender; batchSize?: number;
  beforeAuthorize?: (purchaseId: string) => Promise<void>; beforeSend?: (purchaseId: string) => Promise<void> } = {}): Promise<WorkerCounts> {
  if (process.env.NODE_ENV === "production" && (options.now || options.clock || options.send || options.beforeAuthorize || options.beforeSend)) throw new Error("Test controls unavailable");
  const testClock = process.env.NODE_ENV !== "production" && process.env.CEKIS_TEST_WORKER === "true" && process.env.REMINDER_TEST_NOW
    ? new Date(process.env.REMINDER_TEST_NOW) : null;
  const clock = options.clock ?? (() => options.now ?? testClock ?? new Date());
  const counts = emptyCounts();
  const deadline = Date.now() + 60_000;
  await reconcileDirtyPurchases(50,clock(),deadline);
  if (!insideSendWindow(clock())) return counts;
  const limit = Math.min(10,Math.max(1,options.batchSize ?? 10));
  for (let index=0; index<limit && Date.now()<deadline; index++) {
    const claimTime = clock();
    if (!insideSendWindow(claimTime)) break;
    const work = await claim(claimTime,todayInVilnius(claimTime));
    if (!work) break;
    counts.claimed++;
    if (options.beforeAuthorize) await options.beforeAuthorize(work.purchase_id);
    const authorized = await authorize(work,clock);
    if (!authorized) continue;
    if (authorized.kind === "deferred") break;
    if (authorized.kind !== "authorized") { counts[authorized.kind]++; continue; }
    if (options.beforeSend) await options.beforeSend(work.purchase_id);
    let message: ReturnType<typeof reminderMessage>;
    try { message = reminderMessage(authorized.productName,authorized.endDate,todayInVilnius(clock()),work.purchase_id,getEnv().APP_URL); }
    catch (error) {
      const final = await finalize(work,clock(),{ error });
      if (final) counts[final]++;
      continue;
    }
    const dispatchTime = clock();
    if (!insideSendWindow(dispatchTime) || dispatchTime >= work.lease_until) {
      await requeueUnsent(work);
      break;
    }
    let outcome: { messageId: string } | { error: unknown };
    try {
      outcome = { messageId: await (options.send ?? sendReminderMail)(authorized.email,message) };
    } catch (error) { outcome = { error }; }
    const final = await finalize(work,clock(),outcome);
    if (final) counts[final]++;
  }
  return counts;
}
