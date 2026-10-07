import { prepareReceiptImage } from "./receipt-image";
import { parseReceiptText, type ReceiptSuggestions } from "./ocr-parser";

export async function scanReceipt(file: Blob, today: string, signal: AbortSignal, progress: (value: number) => void): Promise<ReceiptSuggestions> {
  const bytes = await prepareReceiptImage(file);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/receipt-ocr.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (error?: Error, text = "") => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener("abort", abort);
      worker.postMessage({ type: "cancel" });
      const deadline = window.setTimeout(() => worker.terminate(), 1000);
      worker.addEventListener("message", (event) => { if (event.data.type === "cancelled") { clearTimeout(deadline); worker.terminate(); } });
      if (error) reject(error); else resolve(parseReceiptText(text, today));
    };
    const abort = () => finish(new DOMException("Nuskaitymas atšauktas.", "AbortError"));
    const timeout = window.setTimeout(() => finish(new Error("Nuskaitymas užtruko per ilgai. Bandyk dar kartą arba įvesk rankiniu būdu.")), 90000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; text?: string; progress?: number }>) => {
      if (settled) return;
      if (event.data.type === "progress") progress(Math.round(Math.max(0, Math.min(1, event.data.progress ?? 0)) * 100));
      if (event.data.type === "done") finish(undefined, event.data.text);
      if (event.data.type === "error") finish(new Error("Nepavyko nuskaityti čekio. Bandyk dar kartą arba įvesk rankiniu būdu."));
    };
    worker.onerror = () => finish(new Error("Nuskaitymo modulis nepasiekiamas. Bandyk dar kartą arba įvesk rankiniu būdu."));
    worker.postMessage({ type: "start", bytes }, [bytes]);
  });
}
