import { pool } from "@/lib/db";

export type ReceiptItem = { id: string; filename: string; contentType: string; byteSize: number; links: number; uploadedLabel: string };
export type ReceiptPage = { receipts: ReceiptItem[]; nextCursor: string | null };
type Mode = "available" | "attached";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uploadDate = new Intl.DateTimeFormat("lt-LT", { timeZone: "Europe/Vilnius", dateStyle: "medium", timeStyle: "short" });

export function parseReceiptCursor(raw: string | null): { at: string; id: string } | null | undefined {
  if (raw === null) return null;
  try {
    if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const { at, id } = value as Record<string, unknown>;
    if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || typeof id !== "string" || !uuid.test(id)) return undefined;
    return { at, id };
  } catch { return undefined; }
}

export async function listReceiptPage(ownerId: string, purchaseId: string, mode: Mode, search = "", cursor: { at: string; id: string } | null = null): Promise<ReceiptPage> {
  const q = search.trim().slice(0, 100).replace(/[\\%_]/g, (character) => `\\${character}`);
  const attached = mode === "attached";
  const orderAt = attached ? "pr.created_at" : "r.created_at";
  const rows = await pool.query(`SELECT r.id,r.filename,r.content_type AS "contentType",r.byte_size AS "byteSize",r.created_at AS "uploadedAt",
    to_char(${orderAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
    (SELECT count(*)::int FROM purchase_receipt x WHERE x.receipt_id=r.id) AS links
    FROM receipt r ${attached ? "JOIN purchase_receipt pr ON pr.receipt_id=r.id AND pr.owner_id=r.owner_id" : ""}
    WHERE r.owner_id=$1 AND r.state='ready' ${attached ? "AND pr.purchase_id=$2" : "AND NOT EXISTS (SELECT 1 FROM purchase_receipt pr WHERE pr.receipt_id=r.id AND pr.purchase_id=$2)"}
    AND r.filename ILIKE $3 ESCAPE '\\'
    AND ($4::timestamptz IS NULL OR (${orderAt},r.id) < ($4::timestamptz,$5::uuid))
    ORDER BY ${orderAt} DESC,r.id DESC LIMIT 51`, [ownerId,purchaseId,`%${q}%`,cursor?.at ?? null,cursor?.id ?? null]);
  const visible = rows.rows.slice(0, 50);
  const last = visible.at(-1);
  return {
    receipts: visible.map((row) => ({ id: row.id, filename: row.filename, contentType: row.contentType, byteSize: row.byteSize, links: row.links, uploadedLabel: uploadDate.format(row.uploadedAt) })),
    nextCursor: rows.rows.length > 50 && last ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.id })).toString("base64url") : null,
  };
}
