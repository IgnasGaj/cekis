"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scanReceipt } from "@/lib/scan-receipt";
import { suggestionValues, type ReceiptSuggestions } from "@/lib/ocr-parser";

export function useReceiptScan(today: string, onResult: (suggestions: ReceiptSuggestions) => void) {
  const [state, setState] = useState("idle"); const [progress, setProgress] = useState(0); const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null); const sequence = useRef(0);
  const result = useRef(onResult);
  useEffect(() => { result.current = onResult; }, [onResult]);
  const cancel = useCallback(() => { sequence.current++; active.current?.abort(); active.current = null; setState("cancelled"); }, []);
  useEffect(() => () => { sequence.current++; active.current?.abort(); }, []);
  const scan = useCallback(async (file: Blob) => {
    active.current?.abort(); const id = ++sequence.current; const controller = new AbortController(); active.current = controller;
    setState("loading"); setProgress(0); setError("");
    try {
      const suggestions = await scanReceipt(file, today, controller.signal, (value) => { if (sequence.current === id) setProgress(value); });
      if (sequence.current !== id) return;
      result.current(suggestions);
      setState(Object.values(suggestions).some((field) => suggestionValues(field).length) ? "ready" : "empty");
    } catch (cause) { if (sequence.current === id && !controller.signal.aborted) { setState("failed"); setError(cause instanceof Error ? cause.message : "Nepavyko nuskaityti čekio."); } }
    finally { if (sequence.current === id) active.current = null; }
  }, [today]);
  return { state, progress, error, scan, cancel };
}
export function ReceiptScanControls({ scan, retry }: { scan: ReturnType<typeof useReceiptScan>; retry: () => void }) {
  return <section className="ocr-controls" aria-label="Čekio nuskaitymas">
    <p role="status" aria-live="polite">{scan.state === "loading" ? `Nuskaitome čekį… ${scan.progress} %` : scan.state === "ready" ? "Nuskaityta. Patikrink pasiūlytus duomenis prieš išsaugodamas." : scan.state === "empty" ? "Patikimų duomenų atpažinti nepavyko. Bandyk dar kartą arba įvesk rankiniu būdu." : scan.state === "cancelled" ? "Nuskaitymas atšauktas. Gali įvesti duomenis rankiniu būdu." : scan.state === "failed" ? scan.error : "Pasirinktas čekis bus nuskaitytas automatiškai."}</p>
    {scan.state === "loading" ? <><progress value={scan.progress} max={100} aria-label="Nuskaitymo eiga" /><button type="button" className="secondary-button" onClick={scan.cancel}>Atšaukti nuskaitymą</button></> : <button type="button" className="secondary-button" onClick={retry}>Bandyti nuskaityti dar kartą</button>}
  </section>;
}
