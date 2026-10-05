import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { safePostLoginPath } from "@/lib/redirects";

export const dynamic = "force-dynamic";
const handlers = toNextJsHandler(auth);
const input = z.object({
  email: z.email().max(254),
  callbackURL: z.literal("/pradzia"),
  newUserCallbackURL: z.unknown().optional(),
  errorCallbackURL: z.literal("/prisijungti/nuoroda-nebegalioja"),
}).passthrough();

export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth/sign-in/magic-link") {
    let body: unknown;
    try { body = await request.clone().json(); } catch { return NextResponse.json({ message: "Neteisingi duomenys." }, { status: 400 }); }
    const parsed = input.safeParse(body);
    if (!parsed.success ||
      (parsed.data.newUserCallbackURL !== undefined && !safePostLoginPath(parsed.data.newUserCallbackURL))) {
      return NextResponse.json({ message: "Neteisingi duomenys." }, { status: 400 });
    }
  }
  return handlers.POST(request);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth/magic-link/verify") {
    const destination = request.nextUrl.searchParams.get("callbackURL");
    const newUserDestination = request.nextUrl.searchParams.get("newUserCallbackURL");
    const errorDestination = request.nextUrl.searchParams.get("errorCallbackURL");
    if (!safePostLoginPath(destination) ||
        (newUserDestination && !safePostLoginPath(newUserDestination)) ||
        errorDestination !== "/prisijungti/nuoroda-nebegalioja") {
      return NextResponse.redirect(new URL("/prisijungti/nuoroda-nebegalioja", request.url));
    }
  }
  return handlers.GET(request);
}
