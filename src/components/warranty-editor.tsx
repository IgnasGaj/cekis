"use client";
import { useEffect, useRef } from "react";
import { addMonthsClamped, type WarrantyDraft, type WarrantyInput } from "@/lib/warranty";
import { displayDate } from "@/lib/purchase-format";

export function draftFromWarranty(value: WarrantyInput): WarrantyDraft {
  return { warrantyState: value.warrantyState, warrantyEndDate: value.warrantyEndDate ?? "", warrantyDurationMonths: value.warrantyDurationMonths?.toString() ?? "", warrantySource: value.warrantySource ?? "", warrantyConfirmed: value.warrantyState === "known" };
}

export function WarrantyEditor({ value, onChange, purchaseDate, initialPurchaseDate, initialKnown, error, fields = true }: {
  value: WarrantyDraft; onChange: (value: WarrantyDraft) => void; purchaseDate: string; initialPurchaseDate: string; initialKnown: boolean; error?: string; fields?: boolean;
}) {
  const previousDate = useRef(purchaseDate);
  useEffect(() => {
    if (previousDate.current === purchaseDate) return;
    previousDate.current = purchaseDate;
    const current = value;
    if (current.warrantyState !== "known") return;
    if (initialKnown && purchaseDate !== initialPurchaseDate) {
      onChange({ ...current, warrantySource: "date", warrantyDurationMonths: "", warrantyConfirmed: false });
    } else if (current.warrantySource === "duration") {
      onChange({ ...current, warrantyEndDate: addMonthsClamped(purchaseDate, Number(current.warrantyDurationMonths)) ?? "", warrantyConfirmed: false });
    } else onChange({ ...current, warrantyConfirmed: false });
  }, [purchaseDate, initialKnown, initialPurchaseDate, onChange, value]);
  const changeState = (state: string) => onChange(state === "known"
    ? { warrantyState: "known", warrantyEndDate: "", warrantyDurationMonths: "", warrantySource: "date", warrantyConfirmed: false }
    : { warrantyState: state, warrantyEndDate: "", warrantyDurationMonths: "", warrantySource: "", warrantyConfirmed: false });
  const changeMode = (source: string) => onChange({ ...value, warrantySource: source, warrantyEndDate: "", warrantyDurationMonths: "", warrantyConfirmed: false });
  const changeDuration = (months: string) => onChange({ ...value, warrantyDurationMonths: months, warrantyEndDate: addMonthsClamped(purchaseDate, Number(months)) ?? "", warrantyConfirmed: false });
  return <section className="warranty-editor" aria-label="Garantijos informacija">
    <h2>Garantija</h2>
    <div className="field"><label htmlFor="warranty-state">Garantijos būsena</label><select id="warranty-state" name={fields ? "warrantyState" : undefined} value={value.warrantyState} onChange={(event) => changeState(event.target.value)}>
      <option value="unknown">Nežinau / nenurodyta</option><option value="none">Garantijos nėra</option><option value="known">Nurodyti garantiją</option>
    </select></div>
    {value.warrantyState === "known" && <>
      <div className="field"><label htmlFor="warranty-source">Kaip nurodysi pabaigą?</label><select id="warranty-source" name={fields ? "warrantySource" : undefined} value={value.warrantySource} onChange={(event) => changeMode(event.target.value)}>
        <option value="date">Įvesiu datą</option><option value="duration">Nurodysiu trukmę mėnesiais</option>
      </select></div>
      {value.warrantySource === "duration" ? <div className="field"><label htmlFor="warranty-months">Trukmė mėnesiais (1–600)</label><input id="warranty-months" name={fields ? "warrantyDurationMonths" : undefined} type="number" min="1" max="600" step="1" value={value.warrantyDurationMonths} onChange={(event) => changeDuration(event.target.value)} />
        {value.warrantyEndDate && <p className="warranty-suggestion">Siūloma pabaigos data: <strong>{displayDate(value.warrantyEndDate)}</strong></p>}</div>
      : <div className="field"><label htmlFor="warranty-date">Garantijos pabaigos data</label><input id="warranty-date" name={fields ? "warrantyEndDate" : undefined} type="date" min={purchaseDate || "0001-01-01"} max="9999-12-31" value={value.warrantyEndDate} onChange={(event) => onChange({ ...value, warrantyEndDate: event.target.value, warrantyConfirmed: false })} /></div>}
      {value.warrantySource === "duration" && fields && <input type="hidden" name="warrantyEndDate" value={value.warrantyEndDate} />}
      {value.warrantySource === "date" && fields && <input type="hidden" name="warrantyDurationMonths" value="" />}
      <div className="warranty-confirm"><label><input type="checkbox" name={fields ? "warrantyConfirmed" : undefined} checked={value.warrantyConfirmed} disabled={!value.warrantyEndDate} onChange={(event) => onChange({ ...value, warrantyConfirmed: event.target.checked })} /> Patvirtinu garantijos pabaigos datą{value.warrantyEndDate ? `: ${displayDate(value.warrantyEndDate)}` : ""}</label></div>
      {initialKnown && purchaseDate !== initialPurchaseDate && <p className="small-note">Pirkimo data pasikeitė. Patikrink išsaugotą garantijos datą ir patvirtink ją iš naujo.</p>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
