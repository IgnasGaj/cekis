import Link from "next/link";
import { Home, ShoppingBag, Plus, Settings } from "lucide-react";

export function BottomNav({ active }: { active: "home" | "purchases" | "add" | "settings" }) {
  return <nav className="bottom-nav" aria-label="Pagrindinė navigacija">
    <Link href="/pradzia" aria-current={active === "home" ? "page" : undefined} className={active === "home" ? "nav-item active" : "nav-item"}><Home size={23} aria-hidden="true" /><span>Pradžia</span></Link>
    <Link href="/pirkiniai" aria-current={active === "purchases" ? "page" : undefined} className={active === "purchases" ? "nav-item active" : "nav-item"}><ShoppingBag size={23} aria-hidden="true" /><span>Pirkiniai</span></Link>
    <Link href="/prideti" aria-current={active === "add" ? "page" : undefined} className={active === "add" ? "nav-item active" : "nav-item"}><span className="add-icon"><Plus size={25} aria-hidden="true" /></span><span>+ Čekis</span></Link>
    <Link href="/nustatymai" aria-current={active === "settings" ? "page" : undefined} className={active === "settings" ? "nav-item active" : "nav-item"}><Settings size={23} aria-hidden="true" /><span>Nustatymai</span></Link>
  </nav>;
}
