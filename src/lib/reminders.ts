import "server-only";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { getEnv } from "./env";
import { todayInVilnius } from "./purchase-validation";
import { allowedOffsets, desiredReminder, type ReminderMode, type ReminderOffset, type ReminderPurchase, type ReminderPreference } from "./reminder-calendar";
export { allowedOffsets, desiredReminder, insideSendWindow } from "./reminder-calendar";
export type { ReminderMode, ReminderOffset } from "./reminder-calendar";
export const transportReady = () => getEnv().REMINDER_TRANSPORT_ENABLED === "true";

type PurchaseRow = ReminderPurchase;
type PreferenceRow = ReminderPreference;
function scheduleNow() {
  return process.env.NODE_ENV !== "production" && process.env.CEKIS_TEST_WORKER === "true" && process.env.REMINDER_TEST_NOW
    ? new Date(process.env.REMINDER_TEST_NOW) : new Date();
}

async function preferenceForUpdate(client: PoolClient, ownerId: string): Promise<PreferenceRow> {
  await client.query("INSERT INTO reminder_preference (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [ownerId]);
  const result = await client.query<PreferenceRow>(`SELECT rp.enabled,rp.default_offset,rp.revision,u.email,u.email_verified,u.reminder_recipient_version
    FROM reminder_preference rp JOIN "user" u ON u.id=rp.user_id WHERE rp.user_id=$1 FOR UPDATE OF rp`, [ownerId]);
  if (!result.rows[0]) throw new Error("Reminder owner missing");
  return result.rows[0];
}

// Caller owns the transaction. Purchase mutations hold the purchase lock before calling this.
export async function reconcilePurchase(client: PoolClient, ownerId: string, purchaseId: string, now = scheduleNow()) {
  const purchase = (await client.query<PurchaseRow>(`SELECT id,owner_id,warranty_state,warranty_end_date::text,reminder_mode,reminder_offset,deleted_at
    FROM purchase WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [purchaseId, ownerId])).rows[0];
  if (!purchase) return;
  const pref = await preferenceForUpdate(client, ownerId);
  const desired = desiredReminder(purchase, pref, todayInVilnius(now));
  await client.query(`UPDATE warranty_reminder SET status='cancelled',claim_token=NULL,lease_until=NULL
    WHERE owner_id=$1 AND purchase_id=$2 AND status IN ('pending','processing') AND dispatch_authorized_at IS NULL
    AND ($3::text IS NULL OR identity <> $3)`, [ownerId, purchaseId, desired?.identity ?? null]);
  if (desired) {
    await client.query(`INSERT INTO warranty_reminder(owner_id,purchase_id,identity,end_date,offset_days,recipient_version,due_date,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (identity) DO UPDATE SET status='pending',claim_token=NULL,lease_until=NULL,next_attempt_at=$8
      WHERE warranty_reminder.status='cancelled' AND warranty_reminder.attempts < 5 AND warranty_reminder.dispatch_authorized_at IS NULL`,
      [ownerId,purchaseId,desired.identity,desired.endDate,desired.offset,desired.recipientVersion,desired.dueDate,now]);
  }
  await client.query("UPDATE purchase SET reminder_pref_revision=$1 WHERE id=$2 AND owner_id=$3", [pref.revision,purchaseId,ownerId]);
}

export async function getReminderSettings(ownerId: string) {
  const result = await pool.query<PreferenceRow>(`SELECT COALESCE(rp.enabled,false) AS enabled,COALESCE(rp.default_offset,30) AS default_offset,
    COALESCE(rp.revision,1) AS revision,u.email,u.email_verified,u.reminder_recipient_version
    FROM "user" u LEFT JOIN reminder_preference rp ON rp.user_id=u.id WHERE u.id=$1`, [ownerId]);
  return result.rows[0] ? { ...result.rows[0], transportReady: transportReady() } : null;
}

export async function getPurchaseReminderSummary(ownerId: string, row: { id: string; warrantyState: string; warrantyEndDate: string | null; reminderMode: string; reminderOffset: number | null; deletedAt: Date | null }) {
  const pref = await getReminderSettings(ownerId);
  if (!pref) return "Priminimų nustatymai nepasiekiami.";
  if (row.warrantyState === "unknown") return "Garantijos data nenurodyta, todėl priminimas neplanuojamas.";
  if (row.warrantyState === "none") return "Pažymėta, kad garantijos nėra. Priminimas neplanuojamas.";
  if (row.reminderMode === "off") return "Šio pirkinio priminimas išjungtas.";
  if (!pref.enabled) return "Bendri priminimai išjungti.";
  if (!pref.email_verified) return "El. paštas nepatvirtintas. Priminimas nesiunčiamas.";
  if (!pref.transportReady) return "Siuntimas nesukonfigūruotas. Priminimas nesiunčiamas.";
  if (row.warrantyEndDate && row.warrantyEndDate < todayInVilnius()) return "Garantija pasibaigė. Naujas priminimas nesiunčiamas.";
  const desired = desiredReminder({ id: row.id,owner_id: ownerId,warranty_state: row.warrantyState,warranty_end_date: row.warrantyEndDate,
    reminder_mode: row.reminderMode as ReminderMode,reminder_offset: row.reminderOffset,deleted_at: row.deletedAt },pref,todayInVilnius());
  if (!desired) return "Priminimas neplanuojamas.";
  const current = (await pool.query<{status:string}>("SELECT status FROM warranty_reminder WHERE identity=$1 AND owner_id=$2 AND purchase_id=$3",[desired.identity,ownerId,row.id])).rows[0];
  return current?.status === "accepted" ? "Siuntimo tarnyba priėmė priminimą. Pristatymas į pašto dėžutę nepatvirtintas." :
    current?.status === "failed" ? "Priminimo išsiųsti nepavyko. Patikrink el. paštą ir bandyk vėliau." :
    current?.status === "uncertain" ? "Siuntimo būsena neaiški. Kad negautum dviejų laiškų, automatiškai nesiunčiame dar kartą." :
    current?.status === "processing" ? "Priminimas siunčiamas." :
    current?.status === "pending" ? "Priminimas suplanuotas." : "Priminimas bus suplanuotas artimiausio darbuotojo paleidimo metu.";
}

export async function saveReminderSettings(ownerId: string, enabled: boolean, offset: ReminderOffset, expectedRevision: number) {
  if (!allowedOffsets.includes(offset)) return "invalid" as const;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pref = await preferenceForUpdate(client, ownerId);
    if (pref.revision !== expectedRevision) { await client.query("ROLLBACK"); return "conflict" as const; }
    if (enabled && (!pref.email_verified || !transportReady())) { await client.query("ROLLBACK"); return "unavailable" as const; }
    const saved = await client.query<{ revision: number }>("UPDATE reminder_preference SET enabled=$2,default_offset=$3,revision=revision+1 WHERE user_id=$1 RETURNING revision", [ownerId,enabled,offset]);
    if (!enabled || pref.default_offset !== offset) {
      await client.query(`UPDATE warranty_reminder wr SET status='cancelled',claim_token=NULL,lease_until=NULL
        FROM purchase p WHERE wr.purchase_id=p.id AND wr.owner_id=$1 AND p.owner_id=$1
        AND wr.status IN ('pending','processing') AND wr.dispatch_authorized_at IS NULL
        AND ($2::boolean=false OR p.reminder_mode='inherit')`, [ownerId,enabled]);
    }
    await client.query("COMMIT");
    return { result: "saved", revision: saved.rows[0].revision } as const;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function savePurchaseReminder(ownerId: string, purchaseId: string, mode: ReminderMode, offset: ReminderOffset | null, expectedRevision: number) {
  if (!["inherit","off","custom"].includes(mode) || (mode === "custom" ? !allowedOffsets.includes(offset as ReminderOffset) : offset !== null)) return "invalid" as const;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ revision: number }>(`UPDATE purchase SET reminder_mode=$3,reminder_offset=$4,revision=revision+1,updated_at=now()
      WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND revision=$5 RETURNING revision`, [purchaseId,ownerId,mode,offset,expectedRevision]);
    if (!result.rowCount) {
      const exists = await client.query("SELECT 1 FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [purchaseId,ownerId]);
      await client.query("ROLLBACK"); return exists.rowCount ? "conflict" as const : "missing" as const;
    }
    await reconcilePurchase(client, ownerId, purchaseId);
    await client.query("COMMIT"); return { result: "saved", revision: result.rows[0].revision } as const;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

// Bounded repair after account preference/verification changes. Every worker run advances it.
export async function reconcileDirtyPurchases(limit = 50, now = new Date(), deadline = Number.POSITIVE_INFINITY) {
  const ids = await pool.query<{ owner_id: string; id: string }>(`SELECT p.owner_id,p.id FROM purchase p
    JOIN reminder_preference rp ON rp.user_id=p.owner_id
    WHERE p.reminder_pref_revision < rp.revision AND rp.enabled AND p.deleted_at IS NULL
    ORDER BY p.created_at,p.id LIMIT $1`, [Math.min(100, Math.max(1,limit))]);
  let done = 0;
  for (const row of ids.rows) {
    if (Date.now() >= deadline) break;
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'");
      await reconcilePurchase(client,row.owner_id,row.id,now); await client.query("COMMIT"); done++; }
    catch { await client.query("ROLLBACK").catch(() => {}); }
    finally { client.release(); }
  }
  return done;
}
