import Link from "next/link";
import { Home, ShoppingBag, Plus, Settings } from "lucide-react";

export function BottomNav({ active }: { active: "home" | "settings" }) {
  return <nav className="bottom-nav" aria-label="Pagrindinė navigacija">
    <Link href="/pradzia" aria-current={active === "home" ? "page" : undefined} className={active === "home" ? "nav-item active" : "nav-item"}><Home size={23} aria-hidden="true" /><span>Pradžia</span></Link>
    <span className="nav-item unavailable" role="link" aria-disabled="true" title="Dar nepasiekiama: pirkiniai"><ShoppingBag size={23} aria-hidden="true" /><span>Pirkiniai</span><small>Netrukus</small><span className="sr-only">Dar nepasiekiama</span></span>
    <span className="nav-item unavailable" role="link" aria-disabled="true" title="Dar nepasiekiama: čekio pridėjimas"><span className="add-icon"><Plus size={25} aria-hidden="true" /></span><span>Čekis</span><small>Netrukus</small><span className="sr-only">Dar nepasiekiama</span></span>
    <Link href="/nustatymai" aria-current={active === "settings" ? "page" : undefined} className={active === "settings" ? "nav-item active" : "nav-item"}><Settings size={23} aria-hidden="true" /><span>Nustatymai</span></Link>
  </nav>;
}
