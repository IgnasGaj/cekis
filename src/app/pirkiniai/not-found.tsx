import Link from "next/link";
import { PurchaseShell } from "@/components/purchase-shell";
export default function PurchaseNotFound() { return <PurchaseShell><section className="page-heading"><h1>Pirkinys nerastas</h1><p>Šio pirkinio nėra arba jo negali peržiūrėti.</p><Link className="secondary-button" href="/pirkiniai">Mano pirkiniai</Link></section></PurchaseShell>; }
