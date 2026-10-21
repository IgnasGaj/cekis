"use client";
/* eslint-disable @next/next/no-img-element -- Private authenticated receipt content is served without a public image URL. */
import { useCallback, useEffect, useRef, useState } from "react";
import { scanReceipt } from "@/lib/scan-receipt";
import { hasModelCode, suggestionValues, type ReceiptSuggestions, type Suggestion } from "@/lib/ocr-parser";
import type { PurchaseFields, PurchaseErrors } from "@/lib/purchase-validation";

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
export function ReceiptReview({ purchaseId, receiptId, filename, contentType, receiptNumber, initial, maxDate, revision }: {
  purchaseId: string; receiptId: string; filename: string; contentType: string; receiptNumber: string; initial: PurchaseFields; maxDate: string; revision: number;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [values, setValues] = useState(initial);
  const edited = useRef(new Set<keyof PurchaseFields | "receiptNumber">());
  const more = useRef<HTMLDetailsElement>(null);
  const autoStarted = useRef(false);
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
      autoStarted.current = true;
      sessionStorage.removeItem(key);
      const parsed: ReceiptSuggestions = JSON.parse(cached);
      const names = ["seller", "purchaseDate", "receiptTotal", "receiptCurrency", "receiptNumber", "productName", "productPrice"] as const;
      if (names.every((name) => typeof parsed[name]?.value === "string" && ["strong", "uncertain", "absent"].includes(parsed[name]?.state))) {
        queueMicrotask(() => {
          if (!mounted.current) return;
          setSuggestions(parsed);
          setValues((prior) => ({ ...prior,
            productName: edited.current.has("productName") ? prior.productName : prior.productName || parsed.productName.value,
            seller: edited.current.has("seller") ? prior.seller : prior.seller || parsed.seller.value,
            purchaseDate: edited.current.has("purchaseDate") ? prior.purchaseDate : prior.purchaseDate || parsed.purchaseDate.value,
            price: edited.current.has("price") ? prior.price : prior.price || (parsed.receiptCurrency.state === "strong" ? parsed.productPrice.value : ""),
            currency: edited.current.has("currency") ? prior.currency : prior.currency || (parsed.receiptCurrency.state === "strong" ? parsed.receiptCurrency.value : ""),
          }));
          if (!edited.current.has("receiptNumber") && parsed.receiptNumber.value) setNumber((prior) => prior || parsed.receiptNumber.value);
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
  const scan = useCallback(async () => {
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
      setSuggestions(parsed);
      setValues((prior) => ({ ...prior,
        productName: edited.current.has("productName") ? prior.productName : prior.productName || parsed.productName.value,
        seller: edited.current.has("seller") ? prior.seller : prior.seller || parsed.seller.value,
        purchaseDate: edited.current.has("purchaseDate") ? prior.purchaseDate : prior.purchaseDate || parsed.purchaseDate.value,
        price: edited.current.has("price") ? prior.price : prior.price || (parsed.receiptCurrency.state === "strong" ? parsed.productPrice.value : ""),
        currency: edited.current.has("currency") ? prior.currency : prior.currency || (parsed.receiptCurrency.state === "strong" ? parsed.receiptCurrency.value : ""),
      }));
      if (!edited.current.has("receiptNumber") && parsed.receiptNumber.value) setNumber((prior) => prior || parsed.receiptNumber.value);
      setState(Object.values(parsed).some((field) => field.value) ? "ready" : "empty"); active.current = null;
    } catch (cause) {
      if (!mounted.current || active.current?.id !== id) return;
      setState("failed"); setError(cause instanceof Error ? cause.message : "Nepavyko nuskaityti čekio."); active.current?.worker?.terminate(); active.current = null;
    }
  }, [contentType, receiptId, maxDate]);
  useEffect(() => { if (!hydrated || autoStarted.current || contentType === "application/pdf") return; autoStarted.current = true; void scan(); }, [hydrated, contentType, scan]); // Start image OCR after the original is available.
  const setField = (key: keyof PurchaseFields, value: string) => { edited.current.add(key); setValues((prior) => ({ ...prior, [key]: value })); setErrors((prior) => ({ ...prior, [key]: undefined, form: undefined })); };
  const hint = (key: "productName" | "seller" | "purchaseDate" | "receiptNumber" | "price") => {
    const suggestion = key === "price" ? suggestions?.productPrice : suggestions?.[key];
    if (!suggestion || suggestion.state === "absent") return null;
    const options = suggestionValues(suggestion);
    if (!options.length) return <p className="ocr-uncertain">Nuskaitymas neaiškus. Patikrink čekį ir įvesk pats.</p>;
    return <div className="ocr-suggestion"><span>{suggestion.state === "uncertain" ? "Galimi nuskaitymo variantai – patikrink čekį: " : "Siūloma: "}</span>
      {options.map((option) => <span key={option}><strong>{option}</strong><button type="button" onClick={() => key === "receiptNumber" ? (edited.current.add("receiptNumber"), setNumber(option)) : setField(key, option)}>Pritaikyti pasiūlymą</button></span>)}</div>;
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
      const response = await fetch(`/api/receipts/${receiptId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId, ...values, expectedRevision: revision, expectedReceiptNumber: receiptNumber, receiptNumber: number }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setErrors(body.errors ?? {}); if (["price","currency","notes","receiptNumber"].some((key) => body.errors?.[key])) more.current?.setAttribute("open", ""); requestAnimationFrame(() => document.getElementById(`review-${Object.keys(body.errors ?? {})[0]}`)?.focus()); throw new Error(body.error ?? "Patikrink pažymėtus laukus ir bandyk dar kartą."); }
      // A committed review leaves this form with a fresh server-rendered purchase detail.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/pirkiniai/${purchaseId}?busena=atnaujinta`);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Išsaugoti nepavyko. Bandyk dar kartą."); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const image = contentType === "image/jpeg" || contentType === "image/png";
  const suggestionTotal: Suggestion | undefined = suggestions?.receiptTotal;
  return <>
    <details className="receipt-review-preview" aria-label="Čekio peržiūra"><summary aria-label="Išskleisti čekio peržiūrą">{image ? <img className="receipt-thumbnail" src={`/api/receipts/${receiptId}/content`} alt="" /> : <span className="receipt-thumbnail receipt-pdf-icon" aria-hidden="true">PDF</span>}<span>Čekio peržiūra · {filename}</span></summary>
      {image ? <img src={`/api/receipts/${receiptId}/content`} alt={`Čekio „${filename}“ peržiūra`} /> : <iframe src={`/api/receipts/${receiptId}/content`} title={`PDF čekis „${filename}“`} />}
    </details>
    <section className="ocr-controls" aria-label="Čekio nuskaitymas">
      {contentType === "application/pdf" ? <p>PDF automatinis nuskaitymas neprieinamas. Duomenis gali papildyti rankiniu būdu.</p> : <>
        <p role="status" aria-live="polite">{state === "loading" ? `Nuskaitomas čekis… ${progress} %` : state === "ready" ? "Nuskaityta. Patikrink informaciją." : state === "empty" ? "Teksto atpažinti nepavyko. Gali išsaugoti originalą ir papildyti vėliau." : state === "cancelled" ? "Nuskaitymas atšauktas." : state === "failed" ? error : "Nuskaitomas čekis…"}</p>
        {state === "loading" && <progress value={progress} max={100} aria-label="Nuskaitymo eiga" />}
        {state === "loading" ? <button className="secondary-button" type="button" onClick={cancel}>Atšaukti nuskaitymą</button> : (state === "failed" || state === "empty" || state === "cancelled") && <button className="secondary-button" type="button" onClick={scan}>Bandyti dar kartą</button>}
      </>}
    </section>
    <form id="review-fields" className="purchase-form receipt-review-form" onSubmit={save} noValidate>
      {error && <div className="error-summary" role="alert">{error}</div>}
      <fieldset disabled={!hydrated || saving}>
        {field("productName")}{field("seller")}{field("purchaseDate")}
        <details className="receipt-more" ref={more}><summary>Daugiau informacijos</summary>
          {suggestionTotal?.value && <p className="small-note">Čekio suma: {suggestionTotal.value} {suggestions?.receiptCurrency.value}. Viso čekio suma nėra vienos prekės kaina.</p>}
          {field("price")}
          <div className="field"><label htmlFor="review-currency">Valiuta</label><select id="review-currency" value={values.currency} onChange={(event) => setField("currency", event.target.value)} aria-invalid={Boolean(errors.currency)}>
            <option value="">Pasirink valiutą</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="PLN">PLN</option>
          </select>{errors.currency && <p className="form-error">{errors.currency}</p>}</div>
          <div className="field"><label htmlFor="review-receiptNumber">Čekio numeris (neprivaloma)</label><input id="review-receiptNumber" value={number} maxLength={100} onChange={(event) => { edited.current.add("receiptNumber"); setNumber(event.target.value); setErrors((prior) => ({ ...prior, receiptNumber: undefined })); }} aria-invalid={Boolean(errors.receiptNumber)} />{hint("receiptNumber")}{errors.receiptNumber && <p className="form-error">{errors.receiptNumber}</p>}</div>
          <div className="field"><label htmlFor="review-notes">Pastabos (neprivaloma)</label><textarea id="review-notes" value={values.notes} maxLength={2000} rows={4} onChange={(event) => setField("notes", event.target.value)} />{errors.notes && <p className="form-error">{errors.notes}</p>}</div>
        </details>
        <button className="primary-button" type="submit" disabled={!hydrated || saving}>{saving ? "Išsaugoma…" : "Išsaugoti"}</button>
      </fieldset>
    </form>
  </>;
}
