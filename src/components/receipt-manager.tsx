"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExistingPurchaseUploader } from "./receipt-upload";

type Item = { id: string; filename: string; contentType: string; byteSize: number; links: number };
async function mutate(url: string, method: string, purchaseId?: string) {
  const result = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: purchaseId ? JSON.stringify({ purchaseId }) : undefined });
  if (!result.ok) { const body = await result.json().catch(() => ({})); throw new Error(body.error ?? "Veiksmo atlikti nepavyko."); }
}
export function ReceiptManager({ purchaseId, attached, available }: { purchaseId: string; attached: Item[]; available: Item[] }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Item | null>(null); const [selected, setSelected] = useState("");
  const [search, setSearch] = useState(""); const [results, setResults] = useState<Item[] | null>(null);
  const options = results ?? available;
  const find = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/receipts/list?purchaseId=${purchaseId}&q=${encodeURIComponent(search)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Čekių paieška nepavyko.");
      setResults((await response.json()).receipts); setSelected("");
    } catch { setMessage("Čekių paieška nepavyko. Bandyk dar kartą."); }
    finally { setBusy(false); }
  };
  const run = async (url: string, method: string, body?: string) => {
    setBusy(true); setMessage("");
    try { await mutate(url, method, body); setMessage("Pakeitimai išsaugoti"); setConfirm(null); setResults(null); setSelected(""); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Veiksmo atlikti nepavyko."); }
    finally { setBusy(false); }
  };
  return <section className="placeholder-card receipt-section"><h2>Pirkimo čekiai</h2>
    {!attached.length && <p>Čekis nepridėtas</p>}
    {attached.map((item) => <article className="receipt-item" key={item.id}><strong>{item.filename}</strong><span>{item.contentType === "application/pdf" ? "PDF" : item.contentType === "image/png" ? "PNG" : "JPEG"} · {(item.byteSize / 1048576).toFixed(2)} MiB</span>
      <div className="receipt-links"><a href={`/api/receipts/${item.id}/content`} target="_blank" rel="noreferrer">Peržiūrėti čekį</a><a href={`/api/receipts/${item.id}/content?download=1`}>Atsisiųsti originalą</a></div>
      <button disabled={busy} type="button" onClick={() => run(`/api/receipts/${item.id}/links`, "DELETE", purchaseId)}>Pašalinti iš šio pirkinio</button>
      <button disabled={busy} type="button" onClick={() => setConfirm(item)}>Ištrinti čekį visur</button></article>)}
    {confirm && <div className="delete-confirm" role="group" aria-label="Patvirtinti čekio ištrynimą"><strong>Ištrinti „{confirm.filename}“?</strong><p>Čekis bus pašalintas iš {confirm.links} pirkinių ir taps nepasiekiamas.</p><button className="danger-button" disabled={busy} type="button" onClick={() => run(`/api/receipts/${confirm.id}`, "DELETE")}>Ištrinti čekį visur</button><button className="secondary-button" type="button" onClick={() => setConfirm(null)}>Atšaukti</button></div>}
    <ExistingPurchaseUploader purchaseId={purchaseId} />
    <div className="existing-receipt"><label htmlFor="receipt-search">Ieškoti turimo čekio pagal failo pavadinimą</label><input id="receipt-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} /><button className="secondary-button" type="button" disabled={busy} onClick={find}>Ieškoti čekių</button>
      <label htmlFor="existing-receipt">Pridėti turimą čekį</label><select id="existing-receipt" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Pasirink čekį</option>{options.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}</select><button className="secondary-button" type="button" disabled={!selected || busy} onClick={() => run(`/api/receipts/${selected}/links`, "POST", purchaseId)}>Pridėti turimą čekį</button></div>
    {message && <p role="status" aria-live="polite" className="notice">{message}</p>}
  </section>;
}
