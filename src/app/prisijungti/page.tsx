import Link from "next/link";
import { Mail } from "lucide-react";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ busena?: string }> }) {
  const { busena } = await searchParams;
  return <main className="auth-wrap">
    <div className="auth-brand">Čekis</div>
    <section className="auth-panel">
      <span className="round-icon"><Mail size={25} aria-hidden="true" /></span>
      <h1>Prisijunk prie Čekis</h1>
      <p className="lead">Įvesk el. pašto adresą. Atsiųsime prisijungimo nuorodą.</p>
      {busena === "sesija-baigesi" && <p className="notice" role="status">Sesija baigėsi. Paprašyk naujos prisijungimo nuorodos.</p>}
      <SignInForm />
      <p className="small-note">Jei naudojiesi pirmą kartą, paskyra bus sukurta patvirtinus el. paštą.</p>
    </section>
    <p className="auth-footer">Nuoroda galioja 5 minutes ir veikia vieną kartą. <Link href="/prisijungti/nuoroda-nebegalioja">Reikia pagalbos?</Link></p>
  </main>;
}
