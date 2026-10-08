import { prepareReceiptImage } from "./receipt-image";
import { hasModelCode, parseReceiptText, suggestionValues, type ReceiptSuggestions, type Suggestion } from "./ocr-parser";

async function recognize(bytes: ArrayBuffer, mode: "auto" | "block", signal: AbortSignal, progress: (value: number) => void): Promise<{ text: string; confidence: number }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("../workers/receipt-ocr.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject(new Error("Nuskaitymo modulis nepasiekiamas. Bandyk dar kartą arba įvesk rankiniu būdu.")); return; }
    let settled = false;
    const finish = (error?: Error, text = "", confidence = 0) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener("abort", abort);
      worker.postMessage({ type: "cancel" });
      const deadline = window.setTimeout(() => worker.terminate(), 1000);
      worker.addEventListener("message", (event) => { if (event.data.type === "cancelled") { clearTimeout(deadline); worker.terminate(); } });
      if (error) reject(error); else resolve({ text, confidence });
    };
    const abort = () => finish(new DOMException("Nuskaitymas atšauktas.", "AbortError"));
    const timeout = window.setTimeout(() => finish(new Error("Nuskaitymas užtruko per ilgai. Bandyk dar kartą arba įvesk rankiniu būdu.")), 45000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; text?: string; confidence?: number; progress?: number }>) => {
      if (settled) return;
      if (event.data.type === "progress") progress(Math.round(Math.max(0, Math.min(1, event.data.progress ?? 0)) * 100));
      if (event.data.type === "done") finish(undefined, event.data.text, event.data.confidence);
      if (event.data.type === "error") finish(new Error("Nepavyko nuskaityti čekio. Bandyk dar kartą arba įvesk rankiniu būdu."));
    };
    worker.onerror = () => finish(new Error("Nuskaitymo modulis nepasiekiamas. Bandyk dar kartą arba įvesk rankiniu būdu."));
    try { worker.postMessage({ type: "start", bytes, mode }, [bytes]); }
    catch { finish(new Error("Nuskaitymo pradėti nepavyko. Bandyk dar kartą arba įvesk rankiniu būdu.")); }
  });
}

export function needsAlternateScan(suggestions: ReceiptSuggestions) {
  return [suggestions.seller, suggestions.productName, suggestions.productPrice, suggestions.purchaseDate, suggestions.receiptNumber]
    .some((field) => field.state !== "strong" || !field.value) || hasModelCode(suggestions.productName.value);
}

function reflectRecognitionConfidence(suggestions: ReceiptSuggestions, confidence: number): ReceiptSuggestions {
  if (confidence >= 70) return suggestions;
  return Object.fromEntries(Object.entries(suggestions).map(([key, field]) => [key,
    field.state === "strong" ? { ...field, state: "uncertain" } : field])) as ReceiptSuggestions;
}

function mergeField(first: Suggestion, second: Suggestion): Suggestion {
  if (first.state === "absent") return second;
  if (second.state === "absent") return first;
  const options = [...new Set([...suggestionValues(first), ...suggestionValues(second)])].slice(0, 5);
  if (options.length > 1) return { value: "", state: "uncertain", candidates: options };
  if (!options.length) return { value: "", state: "uncertain" };
  return { value: options[0], state: first.state === "strong" || second.state === "strong" ? "strong" : "uncertain" };
}

function mergeReceiptNumber(first: Suggestion, second: Suggestion): Suggestion {
  const options = [...new Set([...suggestionValues(first), ...suggestionValues(second)])];
  if (options.length === 2) {
    const [shorter, longer] = [...options].sort((a, b) => a.length - b.length);
    if (longer.endsWith(`/${shorter}`) || longer.endsWith(`-${shorter}`)) {
      return { value: longer, state: "uncertain", candidates: options };
    }
  }
  return mergeField(first, second);
}

export function mergeReceiptSuggestions(first: ReceiptSuggestions, second: ReceiptSuggestions): ReceiptSuggestions {
  return {
    seller: mergeField(first.seller, second.seller), purchaseDate: mergeField(first.purchaseDate, second.purchaseDate),
    receiptTotal: mergeField(first.receiptTotal, second.receiptTotal), receiptCurrency: mergeField(first.receiptCurrency, second.receiptCurrency),
    receiptNumber: mergeReceiptNumber(first.receiptNumber, second.receiptNumber), productName: mergeField(first.productName, second.productName),
    productPrice: mergeField(first.productPrice, second.productPrice),
  };
}

export async function scanReceipt(file: Blob, today: string, signal: AbortSignal, progress: (value: number) => void): Promise<ReceiptSuggestions> {
  const firstBytes = await prepareReceiptImage(file);
  signal.throwIfAborted();
  const firstOcr = await recognize(firstBytes, "auto", signal, (value) => progress(Math.round(value * 0.5)));
  const first = reflectRecognitionConfidence(parseReceiptText(firstOcr.text, today), firstOcr.confidence);
  signal.throwIfAborted();
  if (!needsAlternateScan(first)) { progress(100); return first; }
  // An alternate segmentation can recover fields lost by the primary pass.
  let combined = first;
  try {
    const alternateBytes = await prepareReceiptImage(file, "fallback");
    signal.throwIfAborted();
    const secondOcr = await recognize(alternateBytes, "block", signal, (value) => progress(50 + Math.round(value * 0.25)));
    const second = reflectRecognitionConfidence(parseReceiptText(secondOcr.text, today), secondOcr.confidence);
    signal.throwIfAborted();
    combined = mergeReceiptSuggestions(first, second);
  } catch (error) {
    if (signal.aborted) throw error;
  }
  // Full-page OCR can stop before a faint footer. Retry only a bounded lower crop
  // when neither full-page pass found any calendar date.
  for (const [index, variant] of (["footer", "footer-bottom"] as const).entries()) {
    if (combined.purchaseDate.state !== "absent") break;
    try {
      const footerBytes = await prepareReceiptImage(file, variant);
      signal.throwIfAborted();
      const footerOcr = await recognize(footerBytes, "block", signal, (value) => progress(75 + index * 12 + Math.round(value * 12)));
      const footer = reflectRecognitionConfidence(parseReceiptText(footerOcr.text, today), footerOcr.confidence);
      signal.throwIfAborted();
      combined = { ...combined, purchaseDate: mergeField(combined.purchaseDate, footer.purchaseDate) };
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  progress(100);
  return combined;
}
