"use client";
/* eslint-disable @next/next/no-img-element -- Private authenticated receipt content is served without a public image URL. */
import { useEffect, useRef, useState } from "react";
import { scanReceipt } from "@/lib/scan-receipt";
import { hasModelCode, suggestionValues, type ReceiptSuggestions, type Suggestion } from "@/lib/ocr-parser";
import type { PurchaseFields, PurchaseErrors } from "@/lib/purchase-validation";
import { WarrantyEditor, draftFromWarranty } from "./warranty-editor";
import type { WarrantyInput } from "@/lib/warranty";

type ScanState = "idle" | "loading" | "ready" | "failed" | "cancelled" | "empty";
const labels: Record<keyof PurchaseFields, string> = {
  productName: "Prekės pavadinimas", seller: "Pardavėjas", purchaseDate: "Pirkimo data", price: "Prekės kaina (neprivaloma)", currency: "Prekės kainos valiuta", notes: "Pastabos (neprivaloma)",
};
function stopOcrWorker(worker: Worker | null) {
  if (!worker) return;
  const deadline = window.setTimeout(() => worker.terminate(), 1000);
  worker.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
    if (event.data.type === "cancelled") { window.clearTimeout(deadline); worker.terminate(); }
  });
  worker.postMessage({ type: "cancel" });
}
export function ReceiptReview({ purchaseId, receiptId, filename, contentType, receiptNumber, initial, maxDate, initialWarranty, revision }: {
  purchaseId: string; receiptId: string; filename: string; contentType: string; receiptNumber: string; initial: PurchaseFields; maxDate: string; initialWarranty: WarrantyInput; revision: number;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [values, setValues] = useState(initial);
  const [warranty, setWarranty] = useState(() => draftFromWarranty(initialWarranty));
  const [number, setNumber] = useState(receiptNumber);
  const [suggestions, setSuggestions] = useState<ReceiptSuggestions | null>(null);
  const [state, setState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<PurchaseErrors & { receiptNumber?: string; warranty?: string }>({});
  const [saving, setSaving] = useState(false);
  const active = useRef<{ worker: Worker | null; controller: AbortController; id: number } | null>(null);
  const sequence = useRef(0);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; const frame = requestAnimationFrame(() => setHydrated(true)); return () => { cancelAnimationFrame(frame); mounted.current = false; active.current?.controller.abort(); stopOcrWorker(active.current?.worker ?? null); active.current = null; }; }, []);
  useEffect(() => {
    const key = `receipt-scan:${receiptId}`;
    try {
      const cached = sessionStorage.getItem(key);
      if (!cached) return;
      sessionStorage.removeItem(key);
      const parsed: ReceiptSuggestions = JSON.parse(cached);
      const names = ["seller", "purchaseDate", "receiptTotal", "receiptCurrency", "receiptNumber", "productName", "productPrice"] as const;
      if (names.every((name) => typeof parsed[name]?.value === "string" && ["strong", "uncertain", "absent"].includes(parsed[name]?.state))) {
        queueMicrotask(() => {
          if (!mounted.current) return;
          setSuggestions(parsed);
          setState(names.some((name) => parsed[name].value) ? "ready" : "empty");
        });
      }
    } catch { /* A stale browser cache never blocks a fresh scan. */ }
  }, [receiptId]);
  const cancel = () => {
    const attempt = active.current;
    if (!attempt) return;
    attempt.controller.abort(); stopOcrWorker(attempt.worker);
    active.current = null; sequence.current++;
    setState("cancelled"); setProgress(0);
  };
  const scan = async () => {
    if (active.current || contentType === "application/pdf") return;
    const id = ++sequence.current;
    const controller = new AbortController();
    active.current = { worker: null, controller, id };
    setState("loading"); setProgress(0); setError(""); setSuggestions(null);
    try {
      const response = await fetch(`/api/receipts/${receiptId}/content`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Sesija baigėsi. Prisijunk iš naujo." : response.status === 404 ? "Čekis neberastas. Grįžk į pirkinį." : "Čekio atverti nepavyko. Bandyk dar kartą.");
      if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("Šio dokumento automatiškai nuskaityti negalima.");
      const parsed = await scanReceipt(await response.blob(), maxDate, controller.signal, (value) => {
        if (mounted.current && active.current?.id === id) setProgress(value);
      });
      if (!mounted.current || active.current?.id !== id) return;
      setSuggestions(parsed); setState(Object.values(parsed).some((field) => field.value) ? "ready" : "empty"); active.current = null;
    } catch (cause) {
      if (!mounted.current || active.current?.id !== id) return;
      setState("failed"); setError(cause instanceof Error ? cause.message : "Nepavyko nuskaityti čekio."); active.current?.worker?.terminate(); active.current = null;
    }
  };
  const setField = (key: keyof PurchaseFields, value: string) => { setValues((prior) => ({ ...prior, [key]: value })); setErrors((prior) => ({ ...prior, [key]: undefined, form: undefined })); };
  const hint = (key: "productName" | "seller" | "purchaseDate" | "receiptNumber" | "price") => {
    const suggestion = key === "price" ? suggestions?.productPrice : suggestions?.[key];
    if (!suggestion || suggestion.state === "absent") return null;
    const options = suggestionValues(suggestion);
    if (!options.length) return <p className="ocr-uncertain">Nuskaitymas neaiškus. Patikrink čekį ir įvesk pats.</p>;
    return <div className="ocr-suggestion"><span>{suggestion.state === "uncertain" ? "Galimi nuskaitymo variantai – patikrink čekį: " : "Siūloma: "}</span>
      {options.map((option) => <span key={option}><strong>{option}</strong><button type="button" onClick={() => key === "receiptNumber" ? setNumber(option) : setField(key, option)}>Pritaikyti pasiūlymą</button></span>)}</div>;
  };
  const field = (key: "productName" | "seller" | "purchaseDate" | "price") => <div className="field" key={key}>
    <label htmlFor={`review-${key}`}>{labels[key]}</label>
    <input id={`review-${key}`} type={key === "purchaseDate" ? "date" : "text"} value={values[key]} onChange={(event) => setField(key, event.target.value)}
      max={key === "purchaseDate" ? maxDate : undefined} maxLength={key === "productName" || key === "seller" ? 200 : 20}
      inputMode={key === "price" ? "decimal" : undefined} aria-invalid={Boolean(errors[key])} />
    {hint(key)}{key === "productName" && suggestions?.productName.value && hasModelCode(suggestions.productName.value) && <p className="ocr-uncertain">Modelio kodą sutikrink su čekiu: panašūs simboliai gali būti atpažinti klaidingai.</p>}{errors[key] && <p className="form-error">{errors[key]}</p>}
  </div>;
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(""); setErrors({});
    try {
      const response = await fetch(`/api/receipts/${receiptId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId, ...values, ...warranty, expectedRevision: revision, expectedReceiptNumber: receiptNumber, receiptNumber: number }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setErrors(body.errors ?? {}); throw new Error(body.error ?? "Patikrink pažymėtus laukus ir bandyk dar kartą."); }
      // A committed review leaves this form with a fresh server-rendered purchase detail.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/pirkiniai/${purchaseId}?busena=atnaujinta`);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Išsaugoti nepavyko. Bandyk dar kartą."); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const image = contentType === "image/jpeg" || contentType === "image/png";
  const suggestionTotal: Suggestion | undefined = suggestions?.receiptTotal;
  return <>
    <section className="receipt-review-preview" aria-label="Čekio peržiūra">
      {image ? <img src={`/api/receipts/${receiptId}/content`} alt={`Čekio „${filename}“ peržiūra`} /> : <iframe src={`/api/receipts/${receiptId}/content`} title={`PDF čekis „${filename}“`} />}
      <a href={`/api/receipts/${receiptId}/content`} target="_blank" rel="noreferrer">Atverti originalą</a>
    </section>
    <section className="ocr-controls" aria-label="Čekio nuskaitymas">
      {contentType === "application/pdf" ? <p>Šio PDF automatinis nuskaitymas neprieinamas. Originalą gali atverti ir duomenis įvesti rankiniu būdu.</p> : <>
        <p role="status" aria-live="polite">{state === "loading" ? `Nuskaitome čekį. Apdorojama… ${progress} %` : state === "ready" ? "Nuskaityta. Peržiūrėk pasiūlymus." : state === "empty" ? "Teksto atpažinti nepavyko. Įvesk duomenis rankiniu būdu." : state === "cancelled" ? "Nuskaitymas atšauktas. Čekis išsaugotas." : state === "failed" ? "Nepavyko nuskaityti čekio." : "Gali nuskaityti čekį arba pildyti rankiniu būdu."}</p>
        {state === "loading" && <progress value={progress} max={100} aria-label="Nuskaitymo eiga" />}
        {state === "loading" ? <button className="secondary-button" type="button" onClick={cancel}>Atšaukti nuskaitymą</button> : <button className="secondary-button" type="button" onClick={scan}>{state === "idle" ? "Nuskaityti čekį" : "Bandyti dar kartą"}</button>}
      </>}
      <p className="small-note">Įvesti rankiniu būdu gali bet kada. Nuskaitymas nekeičia saugomo originalo.</p>
      <a className="text-link" href="#review-fields">Įvesti rankiniu būdu</a>
    </section>
    <form id="review-fields" className="purchase-form receipt-review-form" onSubmit={save} noValidate>
      <h2>Patikrink informaciją</h2>
      {error && <div className="error-summary" role="alert">{error}</div>}
      <fieldset disabled={saving}>
        {field("productName")}{field("seller")}{field("purchaseDate")}
        <div className="field receipt-total"><span className="review-label">Čekio suma</span><p>{suggestionTotal?.value ? `${suggestionTotal.value}${suggestions?.receiptCurrency.value ? ` ${suggestions.receiptCurrency.value}` : " · valiuta neaiški"}` : "Nėra patikimo pasiūlymo"}</p><small>Viso čekio suma nėra prekės kaina.</small></div>
        {field("price")}
        <div className="field"><label htmlFor="review-currency">Prekės kainos valiuta</label><select id="review-currency" value={values.currency} onChange={(event) => setField("currency", event.target.value)} aria-invalid={Boolean(errors.currency)}>
          <option value="">Pasirink valiutą</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="PLN">PLN</option>
        </select>{errors.currency && <p className="form-error">{errors.currency}</p>}</div>
        <div className="field"><label htmlFor="review-number">Čekio numeris (neprivaloma)</label><input id="review-number" value={number} maxLength={100} onChange={(event) => { setNumber(event.target.value); setErrors((prior) => ({ ...prior, receiptNumber: undefined })); }} aria-invalid={Boolean(errors.receiptNumber)} />{hint("receiptNumber")}{errors.receiptNumber && <p className="form-error">{errors.receiptNumber}</p>}</div>
        <div className="field"><label htmlFor="review-notes">Pastabos (neprivaloma)</label><textarea id="review-notes" value={values.notes} maxLength={2000} rows={4} onChange={(event) => setField("notes", event.target.value)} />{errors.notes && <p className="form-error">{errors.notes}</p>}</div>
        <WarrantyEditor value={warranty} onChange={setWarranty} purchaseDate={values.purchaseDate} initialPurchaseDate={initial.purchaseDate} initialKnown={initialWarranty.warrantyState === "known"} error={errors.warranty} fields={false} />
        <button className="primary-button" type="submit" disabled={!hydrated || saving}>{saving ? "Išsaugoma…" : "Išsaugoti"}</button>
      </fieldset>
    </form>
  </>;
}
