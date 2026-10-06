import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { purchase } from "./schema";
import { requireSession } from "./session";
import type { parsePurchaseFields } from "./purchase-validation";

type Values = NonNullable<ReturnType<typeof parsePurchaseFields>["value"]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isPurchaseId = (id: string) => uuid.test(id);

export function listParams(input: { q?: string; sort?: string; page?: string }) {
  const q = (input.q ?? "").trim().slice(0, 200);
  const sort = input.sort === "oldest" ? "oldest" as const : "newest" as const;
  const requestedPage = /^\d+$/.test(input.page ?? "") ? Number(input.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= Math.floor(2147483647 / 50) ? requestedPage : 1;
  return { q, sort, page };
}

export function listHref(params: ReturnType<typeof listParams>) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.sort !== "newest") query.set("sort", params.sort);
  if (params.page > 1) query.set("page", String(params.page));
  return `/pirkiniai${query.size ? `?${query}` : ""}`;
}

export async function listPurchases(params: ReturnType<typeof listParams>) {
  const { user } = await requireSession();
  // Backslashes escape LIKE's wildcard symbols, so a typed % or _ stays literal.
  const escaped = params.q.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const where = and(eq(purchase.ownerId, user.id), isNull(purchase.deletedAt),
    params.q ? or(sql`${purchase.productName} ILIKE ${pattern} ESCAPE '\\'`, sql`${purchase.seller} ILIKE ${pattern} ESCAPE '\\'`) : undefined);
  const order = params.sort === "oldest"
    ? [asc(purchase.purchaseDate), asc(purchase.createdAt), asc(purchase.id)]
    : [desc(purchase.purchaseDate), desc(purchase.createdAt), desc(purchase.id)];
  const rows = await db.select().from(purchase).where(where).orderBy(...order).limit(51).offset((params.page - 1) * 50);
  return { rows: rows.slice(0, 50), hasNext: rows.length > 50 };
}

export async function getPurchase(id: string) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return null;
  const [row] = await db.select().from(purchase).where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).limit(1);
  return row ?? null;
}

export async function createPurchase(key: string, values: Values) {
  const { user } = await requireSession();
  if (!isPurchaseId(key)) return null;
  const [inserted] = await db.insert(purchase).values({ ...values, ownerId: user.id, submissionKey: key }).onConflictDoNothing({ target: [purchase.ownerId, purchase.submissionKey] }).returning({ id: purchase.id });
  if (inserted) return inserted.id;
  const [existing] = await db.select({ id: purchase.id, deletedAt: purchase.deletedAt }).from(purchase)
    .where(and(eq(purchase.ownerId, user.id), eq(purchase.submissionKey, key))).limit(1);
  return existing && !existing.deletedAt ? existing.id : null;
}

export async function updatePurchase(id: string, values: Values) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return false;
  const rows = await db.update(purchase).set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).returning({ id: purchase.id });
  return rows.length > 0;
}

export async function deletePurchase(id: string) {
  const { user } = await requireSession();
  if (!isPurchaseId(id)) return false;
  // Keep only the owner-bound submission key as a replay tombstone; erase user content.
  const rows = await db.update(purchase).set({ productName: "Ištrinta", seller: "Ištrinta", purchaseDate: "1970-01-01", price: null, currency: null, notes: null, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(purchase.id, id), eq(purchase.ownerId, user.id), isNull(purchase.deletedAt))).returning({ id: purchase.id });
  return rows.length > 0;
}
