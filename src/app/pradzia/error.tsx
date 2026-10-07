"use client";
import { PurchaseShell } from "@/components/purchase-shell";

export default function ErrorPage() {
  return <PurchaseShell active="home"><section className="page-heading"><h1>Nepavyko įkelti pradžios</h1><p>Patikrink ryšį ir bandyk dar kartą.</p><button className="primary-button" onClick={() => window.location.reload()}>Bandyti dar kartą</button></section></PurchaseShell>;
}
