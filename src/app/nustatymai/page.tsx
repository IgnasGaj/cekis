import { Mail, LogOut, ShieldCheck } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { requireSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const current = await requireSession();
  return <main className="app-shell">
    <header className="app-header"><span className="wordmark">Čekis</span></header>
    <section className="page-heading"><h1>Nustatymai</h1><p>Tavo paskyra</p></section>
    <section className="settings-card" aria-label="Paskyros informacija">
      <div className="settings-row"><span className="row-icon"><Mail size={23} aria-hidden="true" /></span><div><span className="row-label">El. pašto adresas</span><strong className="email-value">{current.user.email}</strong></div></div>
      <div className="settings-row"><span className="row-icon"><ShieldCheck size={23} aria-hidden="true" /></span><div><span className="row-label">Prisijungimas</span><p>Prie paskyros prisijungi per nuorodą, atsiųstą į el. paštą. Jei reikia, visada gali paprašyti naujos.</p></div></div>
    </section>
    <SignOutButton icon={<LogOut size={20} aria-hidden="true" />} />
    <BottomNav active="settings" />
  </main>;
}
