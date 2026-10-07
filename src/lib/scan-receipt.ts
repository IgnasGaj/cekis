import { prepareReceiptImage } from "./receipt-image";
import { parseReceiptText, suggestionValues, type ReceiptSuggestions, type Suggestion } from "./ocr-parser";

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

export function needsAlternateScan(suggestions: ReceiptSuggestions) {
  const core = [suggestions.seller, suggestions.productName, suggestions.productPrice];
  if (core.some((field) => field.state !== "strong" || !field.value)) return true;
  return [suggestions.seller, suggestions.productName, suggestions.productPrice, suggestions.purchaseDate, suggestions.receiptNumber]
    .filter((field) => field.state === "strong" && field.value).length < 4;
}

function mergeField(first: Suggestion, second: Suggestion): Suggestion {
  if (first.state === "absent") return second;
  if (second.state === "absent") return first;
  const options = [...new Set([...suggestionValues(first), ...suggestionValues(second)])].slice(0, 5);
  if (options.length > 1) return { value: "", state: "uncertain", candidates: options };
  if (!options.length) return { value: "", state: "uncertain" };
  return { value: options[0], state: first.state === "strong" || second.state === "strong" ? "strong" : "uncertain" };
}

export function mergeReceiptSuggestions(first: ReceiptSuggestions, second: ReceiptSuggestions): ReceiptSuggestions {
  return {
    seller: mergeField(first.seller, second.seller), purchaseDate: mergeField(first.purchaseDate, second.purchaseDate),
    receiptTotal: mergeField(first.receiptTotal, second.receiptTotal), receiptCurrency: mergeField(first.receiptCurrency, second.receiptCurrency),
    receiptNumber: mergeField(first.receiptNumber, second.receiptNumber), productName: mergeField(first.productName, second.productName),
    productPrice: mergeField(first.productPrice, second.productPrice),
  };
}

export async function scanReceipt(file: Blob, today: string, signal: AbortSignal, progress: (value: number) => void): Promise<ReceiptSuggestions> {
  const firstBytes = await prepareReceiptImage(file);
  signal.throwIfAborted();
  const first = parseReceiptText(await recognize(firstBytes, signal, (value) => progress(Math.round(value * 0.75))), today);
  signal.throwIfAborted();
  if (!needsAlternateScan(first)) { progress(100); return first; }
  // Only weak scans get one sequential pass without cropping or contrast changes.
  try {
    const alternateBytes = await prepareReceiptImage(file, "fallback");
    signal.throwIfAborted();
    const second = parseReceiptText(await recognize(alternateBytes, signal, (value) => progress(75 + Math.round(value * 0.25))), today);
    signal.throwIfAborted();
    progress(100);
    return mergeReceiptSuggestions(first, second);
  } catch (error) {
    if (signal.aborted) throw error;
    progress(100);
    return first;
  }
}
