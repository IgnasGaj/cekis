import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("public/ocr");
await mkdir(`${output}/core`, { recursive: true });
await mkdir(`${output}/lang`, { recursive: true });
await copyFile(resolve("node_modules/tesseract.js/dist/worker.min.js"), `${output}/worker.min.js`);
for (const variant of ["", "-simd", "-lstm", "-simd-lstm", "-relaxedsimd", "-relaxedsimd-lstm"]) {
  for (const suffix of [".wasm.js", ".wasm"]) {
    const name = `tesseract-core${variant}${suffix}`;
    await copyFile(resolve("node_modules/tesseract.js-core", name), `${output}/core/${name}`);
  }
}
for (const lang of ["lit", "eng"]) await copyFile(resolve(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), `${output}/lang/${lang}.traineddata.gz`);
console.log("Local OCR worker, core and lit/eng language data prepared.");
