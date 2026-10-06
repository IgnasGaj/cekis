import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createPurchase, isPurchaseId } from "@/lib/purchases";
import { parsePurchaseFields } from "@/lib/purchase-validation";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== getEnv().APP_URL) return Response.json({ error: "Neleistina užklausa." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Prisijunk ir bandyk dar kartą." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || !isPurchaseId(body.key) || !body.fields ||
    !["productName","seller","purchaseDate","price","currency","notes"].every((key) => typeof body.fields[key] === "string")) {
    return Response.json({ error: "Patikrink pirkinio laukus ir bandyk dar kartą." }, { status: 400 });
  }
  const parsed = parsePurchaseFields(body.fields);
  if (!parsed.value) return Response.json({ errors: parsed.errors }, { status: 400 });
  try {
    const id = await createPurchase(body.key, parsed.value);
    if (!id) return Response.json({ error: "Šis įrašas jau ištrintas." }, { status: 409 });
    return Response.json({ id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Pirkinio išsaugoti nepavyko. Bandyk dar kartą." }, { status: 503 }); }
}
