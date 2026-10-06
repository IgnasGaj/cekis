import { ReceiptText } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { requireSession } from "@/lib/session";
import Link from "next/link";
import { SessionRefresh } from "@/components/session-refresh";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireSession();
  return <main className="app-shell">
    <SessionRefresh />
    <header className="app-header"><span className="wordmark">Čekis</span></header>
    <section className="greeting"><h1>Labas 👋</h1><p>Išsaugok pirkinį ir rask jį vėliau.</p></section>
    <section className="empty-card" aria-labelledby="empty-title">
      <span className="large-icon"><ReceiptText size={32} strokeWidth={1.7} aria-hidden="true" /></span>
      <h2 id="empty-title">Tvarkyk pirkinius vienoje vietoje</h2>
      <p>Pradėk rankiniu įrašu. Čekių įkėlimas bus pasiekiamas vėliau.</p>
      <Link className="primary-button" href="/pirkiniai/naujas">Pridėti pirkinį</Link>
      <Link className="text-link" href="/pirkiniai">Mano pirkiniai</Link>
    </section>
    <BottomNav active="home" />
  </main>;
}
