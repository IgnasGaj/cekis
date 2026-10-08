import "server-only";
import { headers } from "next/headers";
import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { purchase } from "./schema";
import { requireSession } from "./session";
import type { parsePurchaseFields } from "./purchase-validation";
import { todayInVilnius } from "./purchase-validation";
import { defaultWarranty, type WarrantyInput } from "./warranty";
import { reconcilePurchase } from "./reminders";

type Values = NonNullable<ReturnType<typeof parsePurchaseFields>["value"]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isPurchaseId = (id: string) => uuid.test(id);

export function listParams(input: { q?: string; sort?: string; page?: string; warranty?: string }) {
  const q = (input.q ?? "").trim().slice(0, 200);
  const sort = input.sort === "oldest" || input.sort === "expiry" ? input.sort : "newest" as const;
  const warranty = ["valid", "soon", "upcoming90", "expired", "unknown", "none"].includes(input.warranty ?? "") ? input.warranty as "valid" | "soon" | "upcoming90" | "expired" | "unknown" | "none" : "all" as const;
  const requestedPage = /^\d+$/.test(input.page ?? "") ? Number(input.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= Math.floor(2147483647 / 50) ? requestedPage : 1;
  return { q, sort, warranty, page };
}

function upcomingWhere(today: string, days: 30 | 90) {
  return and(eq(purchase.warrantyState, "known"), sql`${purchase.warrantyEndDate} between ${today}::date and (${today}::date + ${days}::integer)`);
}

export async function homePurchases() {
  const { user } = await requireSession();
  if (process.env.CEKIS_TEST_WORKER === "true" && (await headers()).get("x-cekis-test-home-failure") === "1")
    throw new Error("Disposable home retrieval failure");
  const today = todayInVilnius();
  const ownerWhere = and(eq(purchase.ownerId, user.id), isNull(purchase.deletedAt));
  const upcoming = and(ownerWhere, upcomingWhere(today, 90));
  return db.transaction(async (tx) => {
    const [totals] = await tx.select({
      purchases: count(),
      next30: sql<number>`count(*) filter (where ${upcomingWhere(today, 30)})::integer`,
      next90: sql<number>`count(*) filter (where ${upcomingWhere(today, 90)})::integer`,
    }).from(purchase).where(ownerWhere);
    const upcomingRows = await tx.select({ id: purchase.id, productName: purchase.productName, seller: purchase.seller,
      warrantyEndDate: purchase.warrantyEndDate }).from(purchase).where(upcoming)
      .orderBy(asc(purchase.warrantyEndDate), desc(purchase.createdAt), desc(purchase.id)).limit(5);
    const recentRows = await tx.select({ id: purchase.id, productName: purchase.productName, seller: purchase.seller,
      purchaseDate: purchase.purchaseDate, warrantyState: purchase.warrantyState, warrantyEndDate: purchase.warrantyEndDate })
      .from(purchase).where(ownerWhere).orderBy(desc(purchase.createdAt), desc(purchase.id)).limit(5);
    return { today, totals, upcomingRows, recentRows };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function listHref(params: ReturnType<typeof listParams>) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.sort !== "newest") query.set("sort", params.sort);
  if (params.warranty !== "all") query.set("warranty", params.warranty);
  if (params.page > 1) query.set("page", String(params.page));
  return `/pirkiniai${query.size ? `?${query}` : ""}`;
}

export async function listPurchases(params: ReturnType<typeof listParams>) {
  const { user } = await requireSession();
  if (process.env.CEKIS_TEST_WORKER === "true" && (await headers()).get("x-cekis-test-list-failure") === "1")
    throw new Error("Disposable purchase retrieval failure");
  const today = todayInVilnius();
  // Backslashes escape LIKE's wildcard symbols, so a typed % or _ stays literal.
  const escaped = params.q.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const warrantyWhere = params.warranty === "unknown" || params.warranty === "none" ? eq(purchase.warrantyState, params.warranty)
    : params.warranty === "valid" ? and(eq(purchase.warrantyState, "known"), sql`${purchase.warrantyEndDate} >= ${today}::date`)
    : params.warranty === "soon" ? upcomingWhere(today, 30)
    : params.warranty === "upcoming90" ? upcomingWhere(today, 90)
    : params.warranty === "expired" ? and(eq(purchase.warrantyState, "known"), sql`${purchase.warrantyEndDate} < ${today}::date`) : undefined;
  const where = and(eq(purchase.ownerId, user.id), isNull(purchase.deletedAt), warrantyWhere,
    params.q ? or(sql`${purchase.productName} ILIKE ${pattern} ESCAPE '\\'`, sql`${purchase.seller} ILIKE ${pattern} ESCAPE '\\'`) : undefined);
  const order = params.sort === "oldest"
    ? [asc(purchase.purchaseDate), asc(purchase.createdAt), asc(purchase.id)]
    : params.sort === "expiry" ? [sql`case when ${purchase.warrantyState} = 'known' and ${purchase.warrantyEndDate} >= ${today}::date then 0 when ${purchase.warrantyState} = 'known' then 1 else 2 end`, sql`case when ${purchase.warrantyEndDate} >= ${today}::date then ${purchase.warrantyEndDate} end asc`, sql`case when ${purchase.warrantyEndDate} < ${today}::date then ${purchase.warrantyEndDate} end desc`, desc(purchase.createdAt), desc(purchase.id)]
    : [desc(purchase.purchaseDate), desc(purchase.createdAt), desc(purchase.id)];
  const rows = await db.select().from(purchase).where(where).orderBy(...order).limit(51).offset((params.page - 1) * 50);
  if (params.page > 1 && rows.length === 0) {
    // Use the same owner/search predicate. A concurrent write may change the count,
    // so always move strictly toward page 1 to avoid a redirect loop.
    const [{ total }] = await db.select({ total: count() }).from(purchase).where(where);
    const lastPage = Math.max(1, Math.ceil(total / 50));
    return { rows: [], hasNext: false, redirectPage: Math.min(params.page - 1, lastPage), today, vaultEmpty: false };
  }
  let vaultEmpty = false;
  if (rows.length === 0) {
    if (!params.q && params.warranty === "all") vaultEmpty = true;
    else {
      const [{ total }] = await db.select({ total: count() }).from(purchase)
        .where(and(eq(purchase.ownerId, user.id), isNull(purchase.deletedAt)));
      vaultEmpty = total === 0;
    }
  }
  return { rows: rows.slice(0, 50), hasNext: rows.length > 50, redirectPage: null, today, vaultEmpty };
}

export async function getPurchase(id: string) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return null;
  const [row] = await db.select().from(purchase).where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).limit(1);
  return row ?? null;
}

export function purchaseMatchesSubmitted(saved: NonNullable<Awaited<ReturnType<typeof getPurchase>>>, values: Values, warranty?: WarrantyInput) {
  warranty ??= defaultWarranty(values.purchaseDate);
  return saved.productName === values.productName && saved.seller === values.seller &&
    saved.purchaseDate === values.purchaseDate && saved.price === values.price &&
    saved.currency === values.currency && saved.notes === values.notes &&
    saved.warrantyState === warranty.warrantyState && saved.warrantyEndDate === warranty.warrantyEndDate &&
    saved.warrantyDurationMonths === warranty.warrantyDurationMonths && saved.warrantySource === warranty.warrantySource;
}

export async function createPurchase(key: string, values: Values, warranty?: WarrantyInput) {
  warranty ??= defaultWarranty(values.purchaseDate);
  const { user } = await requireSession();
  if (!isPurchaseId(key)) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,price,currency,notes,
      warranty_state,warranty_end_date,warranty_duration_months,warranty_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(owner_id,submission_key) DO NOTHING RETURNING id`,
      [user.id,key,values.productName,values.seller,values.purchaseDate,values.price,values.currency,values.notes,
        warranty.warrantyState,warranty.warrantyEndDate,warranty.warrantyDurationMonths,warranty.warrantySource]);
    if (inserted.rows[0]) await reconcilePurchase(client,user.id,inserted.rows[0].id);
    const existing = inserted.rows[0] ?? (await client.query<{ id: string; deleted_at: Date | null }>(
      "SELECT id,deleted_at FROM purchase WHERE owner_id=$1 AND submission_key=$2",[user.id,key])).rows[0];
    await client.query("COMMIT");
    return existing && !("deleted_at" in existing && existing.deleted_at) ? existing.id : null;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function updatePurchase(id: string, values: Values, expectedRevision: number, warranty?: WarrantyInput): Promise<"updated" | "missing" | "conflict" | "review"> {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return "missing";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(`UPDATE purchase SET product_name=$3,seller=$4,purchase_date=$5,price=$6,currency=$7,notes=$8,
      warranty_state=coalesce($9,warranty_state),warranty_end_date=case when $9::text is null then warranty_end_date else $10::date end,
      warranty_duration_months=case when $9::text is null then warranty_duration_months else $11::integer end,
      warranty_source=case when $9::text is null then warranty_source else $12::text end,revision=revision+1,updated_at=now()
      WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND revision=$13
      AND ($9::text IS NOT NULL OR warranty_state <> 'known' OR purchase_date=$5::date) RETURNING id`,
      [id,user.id,values.productName,values.seller,values.purchaseDate,values.price,values.currency,values.notes,
        warranty?.warrantyState ?? null,warranty?.warrantyEndDate ?? null,warranty?.warrantyDurationMonths ?? null,warranty?.warrantySource ?? null,expectedRevision]);
    if (rows.rowCount) { await reconcilePurchase(client,user.id,id); await client.query("COMMIT"); return "updated"; }
    const current = (await client.query<{revision:number; warranty_state:string; purchase_date:string}>(
      "SELECT revision,warranty_state,purchase_date::text FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",[id,user.id])).rows[0];
    await client.query("ROLLBACK");
    if (!current) return "missing";
    return current.revision !== expectedRevision ? "conflict" : "review";
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function deletePurchase(id: string) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const active = await client.query("SELECT id FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [id,user.id]);
    if (!active.rowCount) { await client.query("ROLLBACK"); return false; }
    // Keep only the owner-bound submission key as a replay tombstone; erase user content.
    await client.query("UPDATE purchase SET product_name='Ištrinta',seller='Ištrinta',purchase_date='1970-01-01',price=NULL,currency=NULL,notes=NULL,warranty_state='unknown',warranty_end_date=NULL,warranty_duration_months=NULL,warranty_source=NULL,revision=revision+1,deleted_at=now(),updated_at=now() WHERE id=$1", [id]);
    await reconcilePurchase(client,user.id,id);
    const linked = await client.query("SELECT receipt_id FROM purchase_receipt WHERE purchase_id=$1 ORDER BY receipt_id", [id]);
    for (const row of linked.rows) await client.query("SELECT id FROM receipt WHERE id=$1 FOR UPDATE", [row.receipt_id]);
    await client.query("DELETE FROM purchase_receipt WHERE purchase_id=$1", [id]);
    for (const row of linked.rows) await client.query("UPDATE receipt SET expires_at=now()+interval '24 hours',updated_at=now() WHERE id=$1", [row.receipt_id]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
