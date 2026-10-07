"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { saveSettingsAction, type ReminderFormState } from "./reminder-actions";

export function ReminderSettings({ verified, ready, enabled: savedEnabled, offset: savedOffset, revision }: {
  verified: boolean; ready: boolean; enabled: boolean; offset: number; revision: number;
}) {
  const [state, action, pending] = useActionState<ReminderFormState,FormData>(saveSettingsAction,{ message: "",error: false });
  const [enabled,setEnabled] = useState(state.enabled ?? savedEnabled);
  const [offset,setOffset] = useState(String(state.offset ?? savedOffset));
  const submitting = useRef(false);
  useEffect(() => { submitting.current = false; }, [state]);
  const available = verified && ready;
  return <section className="settings-card reminder-card" aria-labelledby="reminder-heading">
    <h2 id="reminder-heading">Garantijos priminimai el. paštu</h2>
    <p>Priminimą siunčiame į patvirtintą paskyros el. paštą 90, 30 arba 7 kalendorines dienas prieš tavo išsaugotą garantijos pabaigą. Jei data jau artimesnė, vieną priminimą siunčiame artimiausiu tinkamu metu. Siuntimo laikas: 09:00–20:59 Vilniaus laiku.</p>
    <p><strong>Gavėjas:</strong> aukščiau nurodytas paskyros el. paštas.</p>
    {!verified && <p role="status">El. paštas nepatvirtintas. Priminimų įjungti negalima.</p>}
    {!ready && <p role="status">Priminimų siuntimas dar nesukonfigūruotas. Nustatymus gali peržiūrėti, bet priminimai nesiunčiami.</p>}
    <form onSubmit={(event) => { event.preventDefault(); if (submitting.current || pending) return; submitting.current = true; const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="reminder-form">
      <fieldset disabled={pending}>
      <input type="hidden" name="revision" value={state.revision ?? revision} />
      <label className="reminder-check"><input type="checkbox" name="enabled" checked={enabled} disabled={!available && !savedEnabled} onChange={(event) => { if (!submitting.current) setEnabled(event.target.checked); }} /> Įjungti garantijos priminimus el. paštu</label>
      <label htmlFor="reminder-offset">Priminti prieš</label>
      <select id="reminder-offset" name="offset" value={offset} onChange={(event) => { if (!submitting.current) setOffset(event.target.value); }}>
        <option value="90">90 dienų</option><option value="30">30 dienų</option><option value="7">7 dienas</option>
      </select>
      <p className="form-help">Pirkiniai su nustatymu „Paveldėti“ naudoja šį laiką. Bendras išjungimas sustabdo visų pirkinių priminimus.</p>
      {state.message && <p role={state.error ? "alert" : "status"} className={state.error ? "form-error" : "notice"}>{state.message}</p>}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Saugoma…" : "Išsaugoti priminimus"}</button>
      </fieldset>
    </form>
  </section>;
}
