"use client";
import { PurchaseShell } from "@/components/purchase-shell";
export default function ErrorPage({ reset }: { reset: () => void }) { return <PurchaseShell><section className="page-heading"><h1>Nepavyko įkelti pirkinių</h1><p>Patikrink ryšį ir bandyk dar kartą.</p><button className="primary-button" onClick={reset}>Bandyti dar kartą</button></section></PurchaseShell>; }
