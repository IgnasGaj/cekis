import { createWorker, PSM } from "tesseract.js";

// Track the nested Tesseract worker so cancellation also stops language loading.
const NativeWorker = self.Worker;
const children = new Set<Worker>();
Object.defineProperty(self, "Worker", { configurable: true, value: class extends NativeWorker {
  constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); children.add(this); }
} });
let cancelled = false;
const stop = () => { cancelled = true; for (const child of children) child.terminate(); children.clear(); self.postMessage({ type: "cancelled" }); self.close(); };
self.onmessage = async (event: MessageEvent<{ type: "start"; bytes?: ArrayBuffer } | { type: "cancel" }>) => {
  if (event.data.type === "cancel") { stop(); return; }
  if (event.data.type !== "start" || !event.data.bytes) return;
  try {
    const worker = await createWorker(["lit", "eng"], 1, {
      workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang",
      workerBlobURL: false, cacheMethod: "none",
      logger: (message) => { if (!cancelled) self.postMessage({ type: "progress", progress: message.progress, status: message.status }); },
      errorHandler: () => {},
    });
    if (cancelled) { await worker.terminate(); return; }
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
      const result = await worker.recognize(new Blob([event.data.bytes]));
      if (!cancelled) self.postMessage({ type: "done", text: result.data.text });
    } finally { await worker.terminate(); }
  } catch {
    if (!cancelled) self.postMessage({ type: "error" });
  } finally { if (!cancelled) stop(); }
};
