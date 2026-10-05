import Link from "next/link";
import { CircleAlert } from "lucide-react";

export default function InvalidLinkPage() {
  return <main className="auth-wrap"><div className="auth-brand">Čekis</div><section className="auth-panel">
    <span className="round-icon"><CircleAlert size={28} aria-hidden="true" /></span>
    <h1>Nuoroda nebegalioja</h1>
    <p className="lead">Nuoroda neteisinga, pasibaigė arba jau buvo panaudota. Paprašyk naujos.</p>
    <Link className="primary-button" href="/prisijungti">Prašyti naujos nuorodos</Link>
  </section></main>;
}
