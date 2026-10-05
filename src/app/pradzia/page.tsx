import { ReceiptText } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireSession();
  return <main className="app-shell">
    <header className="app-header"><span className="wordmark">Čekis</span></header>
    <section className="greeting"><h1>Labas 👋</h1><p>Čia bus tavo pirkiniai ir čekiai.</p></section>
    <section className="empty-card" aria-labelledby="empty-title">
      <span className="large-icon"><ReceiptText size={32} strokeWidth={1.7} aria-hidden="true" /></span>
      <h2 id="empty-title">Kol kas čia tuščia</h2>
      <p>Čekių išsaugojimas bus pasiekiamas kitame etape. Tada galėsi viską rasti vienoje vietoje.</p>
    </section>
    <BottomNav active="home" />
  </main>;
}
