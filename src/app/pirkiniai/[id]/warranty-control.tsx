"use client";
import { useActionState, useState } from "react";
import { WarrantyEditor, draftFromWarranty } from "@/components/warranty-editor";
import type { WarrantyInput } from "@/lib/warranty";
import { saveWarranty } from "./warranty-action";

export function WarrantyControl({ id, revision, purchaseDate, warranty }: { id: string; revision: number; purchaseDate: string | null; warranty: WarrantyInput }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromWarranty(warranty));
  const [state, action, pending] = useActionState(saveWarranty.bind(null, id), { error: "" });
  return <div className="warranty-detail-control">
    {!open ? <button className="secondary-button" type="button" onClick={() => setOpen(true)}>Keisti garantiją</button> :
      <form action={action}><input type="hidden" name="expectedRevision" value={revision} /><fieldset disabled={pending}>
        <WarrantyEditor value={draft} onChange={setDraft} purchaseDate={purchaseDate ?? ""} initialPurchaseDate={purchaseDate ?? ""} initialKnown={warranty.warrantyState === "known"} error={state.error} />
        <button className="primary-button" type="submit">{pending ? "Išsaugoma…" : "Išsaugoti garantiją"}</button>
      </fieldset><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Atšaukti</button></form>}
  </div>;
}
