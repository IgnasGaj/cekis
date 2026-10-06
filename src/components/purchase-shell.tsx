import Link from "next/link";
import { BottomNav } from "./bottom-nav";
import { SessionRefresh } from "./session-refresh";

export function PurchaseShell({ children, active = "purchases" }: { children: React.ReactNode; active?: "purchases" | "add" }) {
  return <main className="app-shell">
    <SessionRefresh />
    <header className="app-header"><Link href="/pradzia" className="wordmark brand-link">Čekis</Link></header>
    {children}
    <BottomNav active={active} />
  </main>;
}
