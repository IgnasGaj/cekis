import { Mail, LogOut, ShieldCheck } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { requireSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";
import { SessionRefresh } from "@/components/session-refresh";
import { getReminderSettings } from "@/lib/reminders";
import { ReminderSettings } from "./reminder-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const current = await requireSession();
  const reminders = await getReminderSettings(current.user.id);
  return <main className="app-shell">
    <SessionRefresh />
    <header className="app-header"><span className="wordmark">Čekis</span></header>
    <section className="page-heading"><h1>Nustatymai</h1><p>Tavo paskyra</p></section>
    <section className="settings-card" aria-label="Paskyros informacija">
      <div className="settings-row"><span className="row-icon"><Mail size={23} aria-hidden="true" /></span><div><span className="row-label">Paskyros el. paštas ir priminimų gavėjas</span><strong className="email-value">{reminders?.email ?? current.user.email}</strong></div></div>
      <div className="settings-row"><span className="row-icon"><ShieldCheck size={23} aria-hidden="true" /></span><div><span className="row-label">Prisijungimas</span><p>Prie paskyros prisijungi per nuorodą, atsiųstą į el. paštą. Jei reikia, visada gali paprašyti naujos.</p></div></div>
    </section>
    {reminders && <ReminderSettings verified={reminders.email_verified} ready={reminders.transportReady}
      enabled={reminders.enabled} offset={reminders.default_offset} revision={reminders.revision} />}
    <SignOutButton icon={<LogOut size={20} aria-hidden="true" />} />
    <BottomNav active="settings" />
  </main>;
}
