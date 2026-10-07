import { PurchaseShell } from "@/components/purchase-shell";

export default function Loading() {
  return <PurchaseShell active="home"><section className="page-heading"><h1>Pradžia</h1><p className="notice" role="status">Kraunami pirkiniai…</p></section></PurchaseShell>;
}
