"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { PurchaseFields } from "@/lib/purchase-validation";
import type { FormState } from "./actions";

type Props = { initial: PurchaseFields; action: (state: FormState, form: FormData) => Promise<FormState>; cancelHref: string; submissionKey?: string; edit?: boolean; maxDate: string };
const labels: Record<keyof PurchaseFields, string> = {
  productName: "Prekės pavadinimas", seller: "Pardavėjas", purchaseDate: "Pirkimo data", price: "Kaina (neprivaloma)", currency: "Valiuta", notes: "Pastabos (neprivaloma)",
};

export function PurchaseForm({ initial, action, cancelHref, submissionKey, edit = false, maxDate }: Props) {
  const [state, formAction, pending] = useActionState(action, { errors: {} });
  const [values, setValues] = useState(initial);
  const [dismissed, setDismissed] = useState<{ state: FormState; keys: string[] }>({ state: { errors: {} }, keys: [] });
  const errors = dismissed.state === state ? Object.fromEntries(Object.entries(state.errors).filter(([key]) => !dismissed.keys.includes(key))) as FormState["errors"] : state.errors;
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!Object.keys(state.errors).length) return;
    const first = (Object.keys(labels) as (keyof PurchaseFields)[]).find((key) => state.errors[key]);
    if (first) document.getElementById(first)?.focus();
    else summary.current?.focus();
  }, [state]);
  const change = (key: keyof PurchaseFields, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDismissed((previous) => ({ state, keys: [...(previous.state === state ? previous.keys : []), key] }));
  };
  const field = (key: keyof PurchaseFields, type = "text") => <div className="field" key={key}>
    <label htmlFor={key}>{labels[key]}</label>
    <input id={key} name={key} type={type} value={values[key]} onChange={(event) => change(key, event.target.value)}
      maxLength={key === "productName" || key === "seller" ? 200 : key === "price" ? 20 : undefined}
      max={key === "purchaseDate" ? maxDate : undefined}
      inputMode={key === "price" ? "decimal" : undefined} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : undefined} />
    {errors[key] && <p className="form-error" id={`${key}-error`}>{errors[key]}</p>}
  </div>;
  return <form className="purchase-form" action={formAction} noValidate>
    {submissionKey && <input type="hidden" name="submissionKey" value={submissionKey} />}
    {Object.keys(errors).length > 0 && <div ref={summary} tabIndex={-1} className="error-summary" role="alert">{errors.form ?? "Patikrink pažymėtus laukus ir bandyk dar kartą."}</div>}
    <fieldset disabled={pending}>
      {field("productName")}{field("seller")}{field("purchaseDate", "date")}{field("price")}
      <div className="field"><label htmlFor="currency">{labels.currency}</label><select id="currency" name="currency" value={values.currency} onChange={(event) => change("currency", event.target.value)} aria-invalid={Boolean(errors.currency)} aria-describedby={errors.currency ? "currency-error" : undefined}>
        <option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="PLN">PLN</option>
      </select>{errors.currency && <p className="form-error" id="currency-error">{errors.currency}</p>}</div>
      <div className="field"><label htmlFor="notes">{labels.notes}</label><textarea id="notes" name="notes" value={values.notes} maxLength={2000} rows={5} onChange={(event) => change("notes", event.target.value)} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "notes-error" : undefined} />{errors.notes && <p className="form-error" id="notes-error">{errors.notes}</p>}</div>
      <button className="primary-button" type="submit">{pending ? "Išsaugoma…" : edit ? "Išsaugoti pakeitimus" : "Išsaugoti"}</button>
    </fieldset>
    <a className="secondary-button" href={cancelHref}>Atšaukti</a>
    <p className="sr-only" role="status" aria-live="polite">{pending ? "Išsaugoma" : ""}</p>
  </form>;
}
