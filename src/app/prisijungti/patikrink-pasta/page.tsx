import Link from "next/link";
import { MailCheck } from "lucide-react";

export default function CheckMailPage() {
  return <main className="auth-wrap"><div className="auth-brand">Čekis</div><section className="auth-panel">
    <span className="round-icon"><MailCheck size={28} aria-hidden="true" /></span>
    <h1>Patikrink el. paštą</h1>
    <p className="lead">Jei adresas galioja, išsiuntėme prisijungimo nuorodą. Atidaryk ją šiame įrenginyje.</p>
    <p className="small-note">Nuoroda galioja 5 minutes ir veikia vieną kartą. Jei laiško nėra, patikrink šlamšto aplanką arba paprašyk naujos nuorodos.</p>
    <Link className="secondary-button" href="/prisijungti">Prašyti naujos nuorodos</Link>
  </section></main>;
}
