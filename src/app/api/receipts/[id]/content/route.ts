import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { readObject } from "@/lib/receipt-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Prisijunk ir bandyk dar kartą.", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return new Response("Čekis nerastas.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const result = await pool.query("SELECT object_key,filename,content_type,byte_size,sha256 FROM receipt WHERE id=$1 AND owner_id=$2 AND state='ready'", [id,session.user.id]);
  if (!result.rowCount) return new Response("Čekis nerastas.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const row = result.rows[0];
  try {
    const bytes = await readObject(row.object_key);
    if (!bytes || bytes.length !== row.byte_size) throw new Error("missing");
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("integrity");
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = row.filename.replace(/[\r\n"\\]/g, "_");
    const disposition = `${download ? "attachment" : "inline"}; filename="cekis"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": row.content_type, "Content-Length": String(bytes.length), "Content-Disposition": disposition, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Čekio atverti nepavyko. Bandyk dar kartą.", { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
}
