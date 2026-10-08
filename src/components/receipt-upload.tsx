"use client";
/* eslint-disable @next/next/no-img-element -- The selected local original is previewed without optimization. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { todayInVilnius } from "@/lib/purchase-validation";
import type { PurchaseFields } from "@/lib/purchase-validation";
import { WarrantyEditor, newWarrantyDraft } from "./warranty-editor";
import { ReceiptScanControls, useReceiptScan } from "./receipt-scan";
import { hasModelCode, suggestionValues, type ReceiptSuggestions, type Suggestion } from "@/lib/ocr-parser";

const limit = 10485760;
function newSubmissionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function errorMessage(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : "Įkelti nepavyko. Bandyk dar kartą.";
}
export async function sendReceipt(file: File, purchaseId: string, key: string, signal: AbortSignal, receiptNumber = "") {
  const result = await fetch("/api/receipts", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-Purchase-Id": purchaseId, "X-Submission-Key": key, "X-Receipt-Number": encodeURIComponent(receiptNumber) }, body: file, signal });
  if (!result.ok) throw new Error(await errorMessage(result));
  return result.json() as Promise<{ id: string }>;
}
export async function cancelReceipt(key: string) {
  const result = await fetch("/api/receipts/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  if (!result.ok) throw new Error(await errorMessage(result));
  return result.json() as Promise<{ completed: boolean }>;
}
function useSelectedFile() {
  const [selected, setSelected] = useState<{ file: File | null; url: string | null }>({ file: null, url: null });
  const currentUrl = useRef<string | null>(null);
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  const setFile = (file: File | null) => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    const url = file ? URL.createObjectURL(file) : null;
    currentUrl.current = url; setSelected({ file, url });
  };
  return { ...selected, setFile };
}
export function FileChoices({ onFile, disabled = false }: { onFile: (file: File) => void | Promise<void>; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const image = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);
  const select = (event: React.ChangeEvent<HTMLInputElement>) => { const picked = event.target.files?.[0]; if (picked) void onFile(picked); event.target.value = ""; };
  return <div className="file-choices">
    <p className="small-note">JPEG, PNG arba PDF · iki 10 MiB vienam failui. Jei įrenginys siūlo HEIC, pasirink JPEG arba įvesk rankiniu būdu.</p>
    <input ref={camera} className="sr-only" tabIndex={-1} type="file" disabled={disabled} accept="image/jpeg,image/png" capture="environment" onChange={select} aria-label="Fotografuoti čekį" />
    <input ref={image} className="sr-only" tabIndex={-1} type="file" disabled={disabled} accept="image/jpeg,image/png" onChange={select} aria-label="Įkelti nuotrauką" />
    <input ref={pdf} className="sr-only" tabIndex={-1} type="file" disabled={disabled} accept="application/pdf,.pdf" onChange={select} aria-label="Įkelti PDF" />
    <button className="choice-card" type="button" disabled={disabled} onClick={() => camera.current?.click()}>Fotografuoti čekį <span>Atverti įrenginio kamerą arba failų pasirinkimą</span></button>
    <button className="choice-card" type="button" disabled={disabled} onClick={() => image.current?.click()}>Įkelti nuotrauką <span>Pasirinkti JPEG arba PNG</span></button>
    <button className="choice-card" type="button" disabled={disabled} onClick={() => pdf.current?.click()}>Įkelti PDF <span>Pasirinkti PDF dokumentą</span></button>
  </div>;
}
function Preview({ file, url }: { file: File; url: string | null }) {
  return <div className="receipt-preview"><strong>{file.name}</strong><span>{(file.size / 1048576).toFixed(2)} MiB</span>
    {/* The browser previews the selected local original without an image optimizer. */}
    {url && file.type.startsWith("image/") && <img src={url} alt="Pasirinkto čekio peržiūra" />}
    {url && file.type === "application/pdf" && <a href={url} target="_blank" rel="noreferrer">Peržiūrėti pasirinktą PDF</a>}
  </div>;
}
export function ExistingPurchaseUploader({ purchaseId }: { purchaseId: string }) {
  const router = useRouter(); const { file, setFile, url } = useSelectedFile();
  const selection = useRef(0);
  const [suggestions, setSuggestions] = useState<ReceiptSuggestions | null>(null);
  const scan = useReceiptScan(todayInVilnius(), setSuggestions);
  const [key, setKey] = useState(newSubmissionKey); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [uploadedId, setUploadedId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null); const uploading = useRef(false);
  const choose = async (next: File) => { if (uploading.current) return; const selected = ++selection.current; scan.cancel(); setSuggestions(null); setUploadedId(null); if (!next.size || next.size > limit) { setMessage("Failas turi būti nuo 1 baito iki 10 MiB."); return; } let completed = false; if (file) { try { completed = (await cancelReceipt(key)).completed; } catch { setMessage("Ankstesnio įkėlimo atšaukti nepavyko. Bandyk dar kartą."); return; } } if (selected !== selection.current) return; setFile(next); if (next.type === "image/jpeg" || next.type === "image/png") void scan.scan(next); setKey(newSubmissionKey()); setMessage(completed ? "Ankstesnis čekis jau pridėtas ir liko prie pirkinio." : ""); if (completed) router.refresh(); };
  const upload = async () => {
    if (!file || uploading.current || scan.state === "loading") return;
    if (!file.size || file.size > limit) { setMessage("Failas turi būti nuo 1 baito iki 10 MiB."); return; }
    uploading.current = true; const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("Įkeliama…");
    try { const saved = await sendReceipt(file,purchaseId,key,abort.signal);
      if (abort.signal.aborted) return;
      if (suggestions) {
        try { sessionStorage.setItem(`receipt-scan:${saved.id}`, JSON.stringify(suggestions)); }
        catch { /* Storage may be disabled; the saved receipt can still be rescanned. */ }
      }
      setUploadedId(saved.id); setMessage("Čekis pridėtas. Peržiūrėk pasiūlymus prieš keisdamas pirkinio duomenis.");
      setFile(null); setKey(newSubmissionKey()); router.refresh(); }
    catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Įkelti nepavyko. Bandyk dar kartą."); }
    finally { uploading.current = false; setBusy(false); controller.current = null; }
  };
  const cancel = async () => { selection.current++; scan.cancel(); controller.current?.abort(); setBusy(false);
    try { const result = await cancelReceipt(key); setFile(null); setKey(newSubmissionKey()); setMessage(result.completed ? "Čekis jau pridėtas ir liko prie pirkinio." : "Įkėlimas atšauktas."); router.refresh(); }
    catch { setMessage("Atšaukti nepavyko. Bandyk dar kartą."); }
  };
  return <section className="receipt-upload"><h3>Pridėti čekį</h3><FileChoices onFile={choose} disabled={busy} />
    {file && <><Preview file={file} url={url} />{(file.type === "image/jpeg" || file.type === "image/png") && <><ReceiptScanControls scan={scan} retry={() => { if (!busy) void scan.scan(file); }} />{suggestions && <p className="small-note">{[suggestions.seller.value, suggestions.productName.value, suggestions.purchaseDate.value, suggestions.productPrice.value].filter(Boolean).join(" · ")} · Duomenis pritaikyk per čekio peržiūrą po įkėlimo.</p>}</>}<button className="primary-button" disabled={busy || scan.state === "loading"} type="button" onClick={upload}>{busy ? "Įkeliama…" : "Įkelti čekį"}</button><button className="secondary-button" type="button" onClick={cancel}>Atšaukti</button></>}
    {uploadedId && <Link href={`/pirkiniai/${purchaseId}/cekis/${uploadedId}`}>Peržiūrėti nuskaitytus duomenis</Link>}
    {message && <p role="status" aria-live="polite" className={message.includes("nepavyko") ? "form-error" : "notice"}>{message}</p>}
  </section>;
}
const empty: PurchaseFields = { productName: "", seller: "", purchaseDate: "", price: "", currency: "EUR", notes: "" };
const labels: Record<keyof PurchaseFields,string> = { productName: "Prekės pavadinimas", seller: "Pardavėjas", purchaseDate: "Pirkimo data", price: "Kaina (neprivaloma)", currency: "Valiuta", notes: "Pastabos (neprivaloma)" };
function CandidateButtons({ suggestion, current, onApply, disabled }: { suggestion?: Suggestion; current: string; onApply: (value: string) => void; disabled: boolean }) {
  if (!suggestion || suggestion.state === "absent") return null;
  const options = suggestionValues(suggestion);
  if (!options.length) return <p className="ocr-uncertain">Nuskaitymas neaiškus. Patikrink čekį ir įvesk pats.</p>;
  if (suggestion.state === "strong" && options.length === 1 && current === options[0]) return null;
  return <div className="ocr-suggestion"><span>{suggestion.state === "uncertain" ? "Galimi nuskaitymo variantai – patikrink čekį:" : "Nuskaityta:"}</span>
    {options.map((option) => <button key={option} type="button" disabled={disabled} onClick={() => onApply(option)}>{option}</button>)}</div>;
}
export function AddReceiptFlow({ maxDate }: { maxDate: string }) {
  const router = useRouter(); const { file, setFile, url } = useSelectedFile();
  const [values, setValues] = useState(empty); const [purchaseKey] = useState(newSubmissionKey);
  const selection = useRef(0);
  const [suggestions, setSuggestions] = useState<ReceiptSuggestions | null>(null);
  const edited = useRef(new Set<keyof PurchaseFields>());
  const [number, setNumber] = useState(""); const numberEdited = useRef(false);
  const receiptScan = useReceiptScan(maxDate, (parsed) => {
    setSuggestions(parsed);
    if (!numberEdited.current && parsed.receiptNumber.value) setNumber(parsed.receiptNumber.value);
    setValues((prior) => {
      const next = { ...prior };
      for (const name of ["productName", "seller", "purchaseDate"] as const) {
        if (parsed[name].value && !edited.current.has(name)) next[name] = parsed[name].value;
      }
      if (parsed.productPrice.value && !edited.current.has("price")) next.price = parsed.productPrice.value;
      if (parsed.receiptCurrency.state === "strong" && !edited.current.has("currency")) next.currency = parsed.receiptCurrency.value;
      return next;
    });
  });
  const changeField = (name: keyof PurchaseFields, value: string) => { edited.current.add(name); setValues((prior) => ({ ...prior, [name]: value })); };
  const [warranty, setWarranty] = useState(newWarrantyDraft);
  const [uploadKey, setUploadKey] = useState(newSubmissionKey); const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const controller = useRef<AbortController | null>(null);
  const createAttempted = useRef(false); const operation = useRef(0); const saving = useRef(false); const cancelling = useRef(false);
  const choose = async (next: File) => { if (saving.current || cancelling.current) return; const selected = ++selection.current; receiptScan.cancel(); if (!next.size || next.size > limit) { setMessage("Failas turi būti nuo 1 baito iki 10 MiB."); return; } let completed = false; if (file) { try { completed = (await cancelReceipt(uploadKey)).completed; } catch { setMessage("Ankstesnio įkėlimo atšaukti nepavyko. Bandyk dar kartą."); return; } } if (selected !== selection.current) return; receiptScan.cancel(); setSuggestions(null);
    if (!purchaseId && !createAttempted.current) { setValues(empty); edited.current.clear(); setNumber(""); numberEdited.current = false; }
    setFile(next); setUploadKey(newSubmissionKey());
    if (!purchaseId && (next.type === "image/jpeg" || next.type === "image/png")) void receiptScan.scan(next);
    setMessage(completed ? "Ankstesnis čekis jau pridėtas ir liko prie pirkinio." : createAttempted.current && !purchaseId ? "Pirkinio išsaugojimo būsena neaiški. Prieš kartodamas patikrink pirkinių sąrašą." : ""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!file || saving.current || cancelling.current) return;
    if (!file.size || file.size > limit) { setMessage("Failas turi būti nuo 1 baito iki 10 MiB."); return; }
    receiptScan.cancel();
    saving.current = true;
    const attempt = ++operation.current;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("Išsaugoma…");
    const current = () => operation.current === attempt && !abort.signal.aborted;
    let savedPurchaseId = purchaseId;
    try {
      let id = savedPurchaseId;
      if (!id) {
        createAttempted.current = true;
        const result = await fetch("/api/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: purchaseKey, fields: values, warranty }), signal: abort.signal });
        if (!current()) return;
        if (!result.ok) { const body = await result.json().catch(() => ({})); if (!current()) return; if (result.status < 500) createAttempted.current = false; throw new Error(body.errors ? Object.values(body.errors).join(" ") : body.error ?? "Pirkinio išsaugoti nepavyko."); }
        const saved = await result.json() as { id: string; fields: PurchaseFields; matchesSubmitted: boolean };
        if (!current()) return;
        id = saved.id; savedPurchaseId = id; setValues(saved.fields); setPurchaseId(id);
        if (!saved.matchesSubmitted) {
          setMessage("Pirkinys jau buvo išsaugotas su kitais duomenimis. Patikrink išsaugotą pirkinį ir prireikus jį redaguok. Tada bandyk įkelti čekį dar kartą.");
          return;
        }
      }
      setMessage("Pirkinys išsaugotas. Įkeliama…");
      await sendReceipt(file,id!,uploadKey,abort.signal,number);
      if (!current()) return;
      router.push(`/pirkiniai/${id}?busena=cekis-pridetas`);
      router.refresh();
    } catch (error) { if (current()) setMessage(`${savedPurchaseId ? "Pirkinys išsaugotas. " : ""}${error instanceof Error ? error.message : "Įkelti nepavyko. Bandyk dar kartą."}`); }
    finally { if (operation.current === attempt) { controller.current = null; saving.current = false; setBusy(false); } }
  };
  const cancel = async () => { selection.current++; receiptScan.cancel(); if (cancelling.current) return; cancelling.current = true; ++operation.current; controller.current?.abort(); controller.current = null; setBusy(true);
    try { const result = await cancelReceipt(uploadKey); setFile(null); setUploadKey(newSubmissionKey()); setMessage(result.completed ? "Čekis jau pridėtas ir liko prie pirkinio." : purchaseId ? "Pirkinys išsaugotas be čekio." : createAttempted.current ? "Čekio įkėlimas atšauktas. Pirkinio išsaugojimo būsena neaiški; patikrink pirkinių sąrašą." : "Įkėlimas atšauktas."); }
    catch { setMessage("Atšaukti nepavyko. Bandyk dar kartą."); }
    finally { saving.current = false; cancelling.current = false; setBusy(false); }
  };
  return <><FileChoices onFile={choose} disabled={busy} />{file && <><Preview file={file} url={url} />
    {!purchaseId && file.type.startsWith("image/") && <ReceiptScanControls scan={receiptScan} retry={() => { if (!busy) void receiptScan.scan(file); }} />}
    {!purchaseId && file.type === "application/pdf" && <p className="small-note">PDF automatinis nuskaitymas neprieinamas. Įvesk duomenis rankiniu būdu.</p>}
    {suggestions?.receiptTotal.value && <p>Čekio suma: {suggestions.receiptTotal.value} {suggestions.receiptCurrency.value} · ši suma gali skirtis nuo prekės kainos.</p>}
    <form className="purchase-form" onSubmit={save} noValidate><p className="small-note">{purchaseId ? "Pirkinys jau išsaugotas. Čia rodomi išsaugoti duomenys; bandant dar kartą įkeliamas tik čekis." : "Patikrink nuskaitytus duomenis ir pataisyk trūkstamus laukus. EUR yra pasirinkta numatytoji valiuta; patikrink ją čekyje."}</p>
      {(Object.keys(labels) as (keyof PurchaseFields)[]).map((name) => <div className="field" key={name}><label htmlFor={`receipt-${name}`}>{labels[name]}</label>
        {name === "currency" ? <select id={`receipt-${name}`} disabled={busy || Boolean(purchaseId)} value={values[name]} onChange={(event) => changeField(name, event.target.value)}><option>EUR</option><option>USD</option><option>GBP</option><option>PLN</option></select> : name === "notes" ? <textarea id={`receipt-${name}`} disabled={busy || Boolean(purchaseId)} value={values[name]} maxLength={2000} onChange={(event) => changeField(name, event.target.value)} /> : <input id={`receipt-${name}`} disabled={busy || Boolean(purchaseId)} type={name === "purchaseDate" ? "date" : "text"} max={name === "purchaseDate" ? maxDate : undefined} maxLength={name === "productName" || name === "seller" ? 200 : undefined} value={values[name]} onChange={(event) => changeField(name, event.target.value)} />}
        {name !== "currency" && name !== "notes" && <CandidateButtons suggestion={suggestions?.[name === "price" ? "productPrice" : name]} current={values[name]} disabled={busy || Boolean(purchaseId)} onApply={(value) => changeField(name, value)} />}
        {name === "productName" && hasModelCode(values.productName) && <p className="ocr-uncertain">Modelio kodą sutikrink su čekiu: panašūs simboliai gali būti atpažinti klaidingai.</p>}
      </div>)}
      <div className="field"><label htmlFor="receipt-number">Čekio numeris (neprivaloma)</label><input id="receipt-number" disabled={busy || Boolean(purchaseId)} value={number} maxLength={100} onChange={(event) => { numberEdited.current = true; setNumber(event.target.value); }} /><CandidateButtons suggestion={suggestions?.receiptNumber} current={number} disabled={busy || Boolean(purchaseId)} onApply={(value) => { numberEdited.current = true; setNumber(value); }} /></div>
      {!purchaseId && <fieldset disabled={busy}><WarrantyEditor value={warranty} onChange={setWarranty} purchaseDate={values.purchaseDate} initialPurchaseDate="" initialKnown={false} fields={false} /></fieldset>}
      <button className="primary-button" disabled={busy || receiptScan.state === "loading"} type="submit">{busy ? "Įkeliama…" : purchaseId ? "Bandyti dar kartą" : "Išsaugoti pirkinį ir čekį"}</button>
      <button className="secondary-button" type="button" onClick={cancel}>Atšaukti</button></form></>}
    {message && <p className={message.includes("nepavyko") ? "form-error" : "notice"} role="status" aria-live="polite">{message}</p>}
    {purchaseId && <p className="small-note"><Link href={`/pirkiniai/${purchaseId}/redaguoti`}>Redaguoti išsaugotą pirkinį</Link> · <Link href={`/pirkiniai/${purchaseId}`}>Atverti pirkinį</Link></p>}
  </>;
}
