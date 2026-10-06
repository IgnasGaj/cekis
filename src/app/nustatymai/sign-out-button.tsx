"use client";
import { ReactNode, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const subscribeToHydration = () => () => {};

export function SignOutButton({ icon }: { icon: ReactNode }) {
  const [pending, setPending] = useState(false);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function signOut() {
    setPending(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError("Atsijungti nepavyko. Pabandyk dar kartą."); return; }
      router.replace("/prisijungti");
      router.refresh();
    } catch { setError("Ryšys nutrūko. Pabandyk dar kartą."); }
    finally { setPending(false); }
  }
  return <div className="signout-area"><button className="signout-button" type="button" onClick={signOut} disabled={pending || !ready}>{icon}{pending ? "Atsijungiama…" : "Atsijungti"}</button>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
