import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { MAX_RECEIPT_BYTES, safeFilename, validateReceipt } from "../../src/lib/receipt-validation";

describe("receipt validation", () => {
  it("accepts decoded JPEG, PNG and parsed PDF and computes exact hashes", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
    for (const [bytes, type, name] of [[png,"image/png","a.png"],[jpeg,"image/jpeg","a.jpg"],[Buffer.from(await pdf.save()),"application/pdf","a.pdf"]] as const) {
      const result = await validateReceipt(bytes,type,name);
      expect(result.byteSize).toBe(bytes.length); expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("rejects empty, oversized, mismatched, truncated and unsupported bytes", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateReceipt(Buffer.alloc(0),"image/png","a.png")).rejects.toThrow();
    await expect(validateReceipt(Buffer.alloc(10485761),"image/png","a.png")).rejects.toThrow();
    await expect(validateReceipt(png,"application/pdf","a.png")).rejects.toThrow();
    await expect(validateReceipt(png,"image/png","a.pdf")).rejects.toThrow();
    await expect(validateReceipt(png.subarray(0,20),"image/png","a.png")).rejects.toThrow();
    await expect(validateReceipt(Buffer.from("<svg></svg>"),"image/svg+xml","a.svg")).rejects.toThrow();
    await expect(validateReceipt(Buffer.from("%PDF-1.4\n"),"application/pdf","a.pdf")).rejects.toThrow();
  });
  it("bounds decoded pixels and sanitizes display filenames", async () => {
    const huge = await sharp({ create: { width: 6001, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateReceipt(huge,"image/png","a.png")).rejects.toThrow();
    expect(safeFilename("../../\r\nslaptas.png")).toBe(".. .. slaptas.png");
  });
  it("rejects HEIC and PDFs beyond the page bound", async () => {
    const heic = Buffer.from("000000186674797068656963", "hex");
    await expect(validateReceipt(heic,"image/heic","a.heic")).rejects.toThrow(/HEIC/);
    const doc = await PDFDocument.create();
    for (let i = 0; i < 51; i++) doc.addPage([100,100]);
    await expect(validateReceipt(Buffer.from(await doc.save()),"application/pdf","pages.pdf")).rejects.toThrow();
    expect(MAX_RECEIPT_BYTES).toBe(10485760);
  });
});
