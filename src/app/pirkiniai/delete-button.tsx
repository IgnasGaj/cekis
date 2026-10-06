"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteAction } from "./actions";

export function DeleteButton({ id, productName, context }: { id: string; productName: string; context: string }) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState(deleteAction.bind(null, id, context), { error: "" });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (confirm) heading.current?.focus(); }, [confirm]);
  if (!confirm) return <button className="delete-trigger" type="button" onClick={() => setConfirm(true)}>Ištrinti pirkinį</button>;
  return <section className="delete-confirm" aria-labelledby="delete-title"><h2 id="delete-title" tabIndex={-1} ref={heading}>Ištrinti „{productName}“?</h2><p>Šis veiksmas ištrins pirkinio informaciją.</p>
    <form action={action}><button className="danger-button" disabled={pending} type="submit">{pending ? "Trinama…" : "Ištrinti"}</button></form>
    <button className="secondary-button" disabled={pending} type="button" onClick={() => setConfirm(false)}>Atšaukti</button>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
  </section>;
}
