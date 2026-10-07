"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { savePurchaseReminderAction, type PurchaseReminderState } from "./reminder-action";

export function ReminderControl({ id,mode: savedMode,offset: savedOffset,revision,status }: { id:string; mode:string; offset:number|null; revision:number; status:string }) {
  const [state,action,pending] = useActionState<PurchaseReminderState,FormData>(savePurchaseReminderAction.bind(null,id),{ message: "",error: false });
  const [mode,setMode] = useState(state.mode ?? savedMode);
  const [offset,setOffset] = useState(String(state.offset ?? savedOffset ?? 30));
  const submitting = useRef(false);
  useEffect(() => { submitting.current = false; }, [state]);
  return <section className="placeholder-card reminder-card" aria-labelledby="purchase-reminder-heading">
    <h2 id="purchase-reminder-heading">Garantijos priminimas el. paštu</h2>
    <p role="status">{status}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (submitting.current || pending) return; submitting.current = true; const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="reminder-form">
      <fieldset disabled={pending}>
      <input type="hidden" name="revision" value={state.revision ?? revision} />
      <label htmlFor="purchase-reminder-mode">Šio pirkinio pasirinkimas</label>
      <select id="purchase-reminder-mode" name="mode" value={mode} onChange={(event) => { if (!submitting.current) setMode(event.target.value); }}>
        <option value="inherit">Paveldėti bendrus nustatymus</option><option value="off">Išjungti šiam pirkiniui</option><option value="custom">Pasirinkti laiką</option>
      </select>
      {mode === "custom" && <><label htmlFor="purchase-reminder-offset">Priminti prieš</label><select id="purchase-reminder-offset" name="offset" value={offset} onChange={(event) => { if (!submitting.current) setOffset(event.target.value); }}>
        <option value="90">90 dienų</option><option value="30">30 dienų</option><option value="7">7 dienas</option>
      </select></>}
      {mode !== "custom" && <input type="hidden" name="offset" value={offset} />}
      <p className="form-help">Paveldėtas pasirinkimas seka bendrą laiką. Bendras išjungimas galioja visiems pirkiniams.</p>
      {state.message && <p role={state.error ? "alert" : "status"} className={state.error ? "form-error" : "notice"}>{state.message}</p>}
      <button type="submit" className="secondary-button" disabled={pending}>{pending ? "Saugoma…" : "Išsaugoti priminimą"}</button>
      </fieldset>
    </form>
  </section>;
}
