import { prepareReceiptImage } from "./receipt-image";
import { parseReceiptText, type ReceiptSuggestions } from "./ocr-parser";

async function recognize(bytes: ArrayBuffer, signal: AbortSignal, progress: (value: number) => void): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("../workers/receipt-ocr.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject(new Error("Nuskaitymo modulis nepasiekiamas. Bandyk dar kartą arba įvesk rankiniu būdu.")); return; }
    let settled = false;
    const finish = (error?: Error, text = "") => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener("abort", abort);
      worker.postMessage({ type: "cancel" });
      const deadline = window.setTimeout(() => worker.terminate(), 1000);
      worker.addEventListener("message", (event) => { if (event.data.type === "cancelled") { clearTimeout(deadline); worker.terminate(); } });
      if (error) reject(error); else resolve(text);
    };
    const abort = () => finish(new DOMException("Nuskaitymas atšauktas.", "AbortError"));
    const timeout = window.setTimeout(() => finish(new Error("Nuskaitymas užtruko per ilgai. Bandyk dar kartą arba įvesk rankiniu būdu.")), 45000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; text?: string; progress?: number }>) => {
      if (settled) return;
      if (event.data.type === "progress") progress(Math.round(Math.max(0, Math.min(1, event.data.progress ?? 0)) * 100));
      if (event.data.type === "done") finish(undefined, event.data.text);
      if (event.data.type === "error") finish(new Error("Nepavyko nuskaityti čekio. Bandyk dar kartą arba įvesk rankiniu būdu."));
    };
    worker.onerror = () => finish(new Error("Nuskaitymo modulis nepasiekiamas. Bandyk dar kartą arba įvesk rankiniu būdu."));
    try { worker.postMessage({ type: "start", bytes }, [bytes]); }
    catch { finish(new Error("Nuskaitymo pradėti nepavyko. Bandyk dar kartą arba įvesk rankiniu būdu.")); }
  });
}

function score(suggestions: ReceiptSuggestions) {
  return Object.values(suggestions).reduce((total, field) => total + (field.value ? field.state === "strong" ? 3 : 1 : 0), 0);
}

export async function scanReceipt(file: Blob, today: string, signal: AbortSignal, progress: (value: number) => void): Promise<ReceiptSuggestions> {
  const firstBytes = await prepareReceiptImage(file);
  signal.throwIfAborted();
  const first = parseReceiptText(await recognize(firstBytes, signal, (value) => progress(Math.round(value * 0.75))), today);
  signal.throwIfAborted();
  if (score(first) >= 9) { progress(100); return first; }
  // Only weak scans get one sequential pass without cropping or contrast changes.
  try {
    const alternateBytes = await prepareReceiptImage(file, "fallback");
    signal.throwIfAborted();
    const second = parseReceiptText(await recognize(alternateBytes, signal, (value) => progress(75 + Math.round(value * 0.25))), today);
    signal.throwIfAborted();
    progress(100);
    return score(second) > score(first) ? second : first;
  } catch (error) {
    if (signal.aborted) throw error;
    progress(100);
    return first;
  }
}
