import { PDFDocument } from "pdf-lib";
const chunks = []; let total = 0;
process.stdin.on("data", (chunk) => { total += chunk.length; if (total > 10485760) process.exit(2); chunks.push(chunk); });
process.stdin.on("end", async () => {
  try {
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from("%%EOF"))) throw new Error("structure");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const count = doc.getPageCount();
    if (count < 1 || count > 50) throw new Error("pages");
    process.stdout.write("OK");
  } catch { process.exitCode = 2; }
});
