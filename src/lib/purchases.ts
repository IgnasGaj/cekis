import "server-only";
import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { purchase } from "./schema";
import { requireSession } from "./session";
import type { parsePurchaseFields } from "./purchase-validation";
import { todayInVilnius } from "./purchase-validation";
import type { WarrantyInput } from "./warranty";

type Values = NonNullable<ReturnType<typeof parsePurchaseFields>["value"]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isPurchaseId = (id: string) => uuid.test(id);

export function listParams(input: { q?: string; sort?: string; page?: string; warranty?: string }) {
  const q = (input.q ?? "").trim().slice(0, 200);
  const sort = input.sort === "oldest" || input.sort === "expiry" ? input.sort : "newest" as const;
  const warranty = ["valid", "soon", "expired", "unknown", "none"].includes(input.warranty ?? "") ? input.warranty as "valid" | "soon" | "expired" | "unknown" | "none" : "all" as const;
  const requestedPage = /^\d+$/.test(input.page ?? "") ? Number(input.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= Math.floor(2147483647 / 50) ? requestedPage : 1;
  return { q, sort, warranty, page };
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
  const today = todayInVilnius();
  // Backslashes escape LIKE's wildcard symbols, so a typed % or _ stays literal.
  const escaped = params.q.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const tomorrowWindow = sql`(${today}::date + 30)`;
  const warrantyWhere = params.warranty === "unknown" || params.warranty === "none" ? eq(purchase.warrantyState, params.warranty)
    : params.warranty === "valid" ? and(eq(purchase.warrantyState, "known"), sql`${purchase.warrantyEndDate} >= ${today}::date`)
    : params.warranty === "soon" ? and(eq(purchase.warrantyState, "known"), sql`${purchase.warrantyEndDate} between ${today}::date and ${tomorrowWindow}`)
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
    return { rows: [], hasNext: false, redirectPage: Math.min(params.page - 1, lastPage), today };
  }
  return { rows: rows.slice(0, 50), hasNext: rows.length > 50, redirectPage: null, today };
}

export async function getPurchase(id: string) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return null;
  const [row] = await db.select().from(purchase).where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).limit(1);
  return row ?? null;
}

export async function createPurchase(key: string, values: Values, warranty?: WarrantyInput) {
  const { user } = await requireSession();
  if (!isPurchaseId(key)) return null;
  const [inserted] = await db.insert(purchase).values({ ...values, ...warranty, ownerId: user.id, submissionKey: key }).onConflictDoNothing({ target: [purchase.ownerId, purchase.submissionKey] }).returning({ id: purchase.id });
  if (inserted) return inserted.id;
  const [existing] = await db.select({ id: purchase.id, deletedAt: purchase.deletedAt }).from(purchase)
    .where(and(eq(purchase.ownerId, user.id), eq(purchase.submissionKey, key))).limit(1);
  return existing && !existing.deletedAt ? existing.id : null;
}

export async function updatePurchase(id: string, values: Values, expectedRevision: number, warranty?: WarrantyInput): Promise<"updated" | "missing" | "conflict" | "review"> {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return "missing";
  const rows = await db.update(purchase).set({ ...values, ...warranty, revision: sql`${purchase.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt), eq(purchase.revision, expectedRevision),
      warranty ? undefined : sql`(${purchase.warrantyState} <> 'known' or ${purchase.purchaseDate} = ${values.purchaseDate})`)).returning({ id: purchase.id });
  if (rows.length) return "updated";
  const [current] = await db.select({ revision: purchase.revision, warrantyState: purchase.warrantyState, purchaseDate: purchase.purchaseDate }).from(purchase).where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).limit(1);
  if (!current) return "missing";
  if (current.revision !== expectedRevision) return "conflict";
  return "review";
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
    const linked = await client.query("SELECT receipt_id FROM purchase_receipt WHERE purchase_id=$1 ORDER BY receipt_id", [id]);
    for (const row of linked.rows) await client.query("SELECT id FROM receipt WHERE id=$1 FOR UPDATE", [row.receipt_id]);
    await client.query("DELETE FROM purchase_receipt WHERE purchase_id=$1", [id]);
    for (const row of linked.rows) await client.query("UPDATE receipt SET expires_at=now()+interval '24 hours',updated_at=now() WHERE id=$1", [row.receipt_id]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
