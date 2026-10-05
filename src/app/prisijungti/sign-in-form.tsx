"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      setError("Įvesk galiojantį el. pašto adresą.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.signIn.magicLink({
        email: normalized,
        callbackURL: "/pradzia",
        errorCallbackURL: "/prisijungti/nuoroda-nebegalioja",
      });
      if (result.error) {
        setError(result.error.status === 429 ? "Per daug bandymų. Pabandyk vėliau." : "Nuorodos išsiųsti nepavyko. Pabandyk dar kartą.");
      } else {
        router.push("/prisijungti/patikrink-pasta");
      }
    } catch {
      setError("Ryšys nutrūko. Pabandyk dar kartą.");
    } finally { setPending(false); }
  }
  return <form onSubmit={submit} noValidate>
    <label htmlFor="email">El. pašto adresas</label>
    <input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" required value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "email-error" : undefined} aria-invalid={Boolean(error)} placeholder="vardas@pastas.lt" />
    {error && <p id="email-error" className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Siunčiama…" : "Siųsti prisijungimo nuorodą"}</button>
  </form>;
}
