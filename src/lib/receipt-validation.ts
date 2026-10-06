import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import sharp from "sharp";

export const MAX_RECEIPT_BYTES = 10485760;
export class ReceiptInputError extends Error {}
export function safeFilename(input: string) {
  const name = input.replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e]/g, " ").trim().replace(/\s+/g, " ").slice(0, 200);
  return name || "cekis";
}
async function validatePdfIsolated(bytes: Buffer) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, ["--max-old-space-size=128", join(process.cwd(), "scripts", "validate-pdf.mjs")],
      { stdio: ["pipe", "pipe", "ignore"], env: { NODE_ENV: "production" } });
    let output = ""; let done = false;
    const finish = (valid: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve(valid); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(false); }, 10000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("ascii").slice(0, 8); });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && output === "OK"));
    child.stdin.on("error", () => finish(false));
    child.stdin.end(bytes);
  });
}
export async function validateReceipt(bytes: Buffer, declaredType: string, filename: string) {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new ReceiptInputError("Failas turi būti nuo 1 baito iki 10 MiB.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const pdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const type = jpeg ? "image/jpeg" : png ? "image/png" : pdf ? "application/pdf" : "";
  if (!type) throw new ReceiptInputError("Tinka tik JPEG, PNG arba PDF. HEIC failą išsaugok kaip JPEG arba įvesk rankiniu būdu.");
  if (declaredType && declaredType !== type) throw new ReceiptInputError("Failo tipas neatitinka jo turinio.");
  const extension = filename.toLowerCase().split(".").pop();
  if (!((type === "image/jpeg" && ["jpg", "jpeg"].includes(extension ?? "")) || (type === "image/png" && extension === "png") || (type === "application/pdf" && extension === "pdf"))) {
    throw new ReceiptInputError("Failo plėtinys neatitinka jo turinio.");
  }
  try {
    if (type === "application/pdf") {
      if (!await validatePdfIsolated(bytes)) throw new Error("pdf");
    } else {
      const image = sharp(bytes, { limitInputPixels: 16000000, failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width > 6000 || metadata.height > 6000 || metadata.width * metadata.height > 16000000) throw new Error("dimensions");
      await image.stats();
    }
  } catch {
    throw new ReceiptInputError(type === "application/pdf" ? "PDF sugadintas, apsaugotas slaptažodžiu arba viršija 50 puslapių." : "Nuotrauka sugadinta arba viršija 6000 px / 16 mln. taškų ribą.");
  }
  return { contentType: type, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), filename: safeFilename(filename) };
}
