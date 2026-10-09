import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { isPurchaseId } from "@/lib/purchases";
import { listReceiptPage, parseReceiptCursor } from "@/lib/receipt-pages";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401, headers: noStore });
  const url = new URL(request.url); const purchaseId = url.searchParams.get("purchaseId") ?? "";
  if (!isPurchaseId(purchaseId)) return Response.json({ error: "Pirkinys nerastas." }, { status: 404, headers: noStore });
  const mode = url.searchParams.get("mode") ?? "available";
  const cursor = parseReceiptCursor(url.searchParams.get("cursor"));
  if (!(["available", "attached"].includes(mode)) || cursor === undefined || (url.searchParams.get("q") ?? "").length > 100)
    return Response.json({ error: "Netinkama čekių puslapio užklausa." }, { status: 400, headers: noStore });
  const active = await pool.query("SELECT 1 FROM purchase WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [purchaseId,session.user.id]);
  if (!active.rowCount) return Response.json({ error: "Pirkinys nerastas." }, { status: 404, headers: noStore });
  return Response.json(await listReceiptPage(session.user.id,purchaseId,mode as "available" | "attached",url.searchParams.get("q") ?? "",cursor), { headers: noStore });
}
