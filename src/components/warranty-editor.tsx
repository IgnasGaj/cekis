"use client";
import { addMonthsClamped, quickDurations, type WarrantyDraft, type WarrantyInput } from "@/lib/warranty";
import { displayDate } from "@/lib/purchase-format";

export function draftFromWarranty(value: WarrantyInput): WarrantyDraft {
  return { warrantyState: value.warrantyState, warrantyEndDate: value.warrantyEndDate ?? "", warrantyDurationMonths: value.warrantyDurationMonths?.toString() ?? "", warrantySource: value.warrantySource ?? "", warrantyConfirmed: value.warrantyState === "known" };
}
export function newWarrantyDraft(): WarrantyDraft {
  return { warrantyState: "known", warrantyEndDate: "", warrantyDurationMonths: "24", warrantySource: "duration", warrantyConfirmed: true };
}

export function WarrantyEditor({ value, onChange, purchaseDate, initialPurchaseDate, initialKnown, error, fields = true }: {
  value: WarrantyDraft; onChange: (value: WarrantyDraft) => void; purchaseDate: string; initialPurchaseDate: string; initialKnown: boolean; error?: string; fields?: boolean;
}) {
  const legacy = value.warrantyState === "known" && value.warrantySource === "date";
  const preview = value.warrantySource === "duration" ? addMonthsClamped(purchaseDate, Number(value.warrantyDurationMonths)) : value.warrantyEndDate;
  const legacyDuration = value.warrantySource === "duration" && value.warrantyDurationMonths && !quickDurations.some((months) => String(months) === value.warrantyDurationMonths);
  const changeState = (state: string) => onChange(state === "known" ? newWarrantyDraft()
    : { warrantyState: state, warrantyEndDate: "", warrantyDurationMonths: "", warrantySource: "", warrantyConfirmed: false });
  const changeDuration = (months: string) => onChange({ ...value, warrantyDurationMonths: months, warrantyEndDate: "", warrantyConfirmed: true });
  return <section className="warranty-editor" aria-label="Garantijos informacija">
    <h2>Garantija</h2>
    <div className="field"><label htmlFor="warranty-state">Garantijos būsena</label><select id="warranty-state" name={fields ? "warrantyState" : undefined} value={value.warrantyState} onChange={(event) => changeState(event.target.value)}>
      <option value="known">Nurodyti garantiją</option><option value="unknown">Garantija nežinoma</option><option value="none">Garantijos nėra</option>
    </select></div>
    {value.warrantyState === "known" && <>
      {legacy ? <>
        <p className="small-note">Anksčiau išsaugota garantijos pabaiga lieka {value.warrantyEndDate ? displayDate(value.warrantyEndDate) : "nenurodyta"}. Pakeitus pirkimo datą, ši pabaiga nesikeičia.</p>
        <button className="secondary-button" type="button" onClick={() => onChange(newWarrantyDraft())}>Pakeisti į trukmę (perskaičiuos pabaigą)</button>
      </> : <div className="field"><label htmlFor="warranty-months">Garantijos trukmė</label><select id="warranty-months" name={fields ? "warrantyDurationMonths" : undefined} value={value.warrantyDurationMonths} onChange={(event) => changeDuration(event.target.value)}>
        {legacyDuration && <option value={value.warrantyDurationMonths}>{value.warrantyDurationMonths} mėn. (anksčiau išsaugota)</option>}
        {quickDurations.map((months) => <option key={months} value={months}>{months} mėn.</option>)}
      </select><p className="small-note">Pasirinkta trukmė naudojama garantijos datai ir priminimams skaičiuoti.</p></div>}
      {preview ? <p className="warranty-suggestion" aria-live="polite">Garantija iki: <strong>{displayDate(preview)}</strong></p>
        : <p className="small-note" role="status">Garantijos pabaigai apskaičiuoti reikia tinkamos pirkimo datos.</p>}
      {initialKnown && legacy && purchaseDate !== initialPurchaseDate && <p className="small-note">Pirkimo data pasikeitė. Anksčiau išsaugota garantijos pabaiga lieka ta pati.</p>}
      {fields && <><input type="hidden" name="warrantySource" value={value.warrantySource} /><input type="hidden" name="warrantyEndDate" value={preview ?? ""} /><input type="hidden" name="warrantyConfirmed" value="on" />{legacy && <input type="hidden" name="warrantyDurationMonths" value="" />}</>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
