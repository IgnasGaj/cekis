import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/pradzia" : "/prisijungti");
}
