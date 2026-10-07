// Prepare a derived OCR image; the original File is always retained for upload.
export async function prepareReceiptImage(file: Blob): Promise<ArrayBuffer> {
  const image = await createImageBitmap(file);
  try {
    if (image.width > 6000 || image.height > 6000 || image.width * image.height > 16000000) throw new Error("Nuotrauka viršija 6000 px / 16 mln. taškų ribą.");
    const sample = document.createElement("canvas");
    const scale = Math.min(1, 480 / Math.max(image.width, image.height));
    sample.width = Math.round(image.width * scale); sample.height = Math.round(image.height * scale);
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Vaizdo apdorojimas neprieinamas.");
    ctx.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const mask = new Uint8Array(sample.width * sample.height);
    for (let i = 0; i < mask.length; i++) {
      const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
      mask[i] = (r + g + b) / 3 > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 28 ? 1 : 0;
    }
    let best = { count: 0, left: 0, top: 0, right: sample.width - 1, bottom: sample.height - 1 };
    const queue = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
      if (mask[start] !== 1) continue;
      let head = 0, tail = 1; queue[0] = start; mask[start] = 2;
      let left = sample.width, top = sample.height, right = 0, bottom = 0;
      while (head < tail) {
        const index = queue[head++], x = index % sample.width, y = Math.floor(index / sample.width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const next of [x > 0 ? index - 1 : -1, x < sample.width - 1 ? index + 1 : -1, y > 0 ? index - sample.width : -1, y < sample.height - 1 ? index + sample.width : -1]) {
          if (next >= 0 && mask[next] === 1) { mask[next] = 2; queue[tail++] = next; }
        }
      }
      if (tail > best.count) best = { count: tail, left, top, right, bottom };
    }
    let x = 0, y = 0, width = image.width, height = image.height;
    const boxArea = (best.right - best.left + 1) * (best.bottom - best.top + 1);
    if (best.count > mask.length * 0.18 && best.count / boxArea > 0.55 && boxArea < mask.length * 0.9) {
      const pad = -Math.ceil(3 / scale);
      x = Math.max(0, Math.floor(best.left / scale) - pad); y = Math.max(0, Math.floor(best.top / scale) - pad);
      width = Math.min(image.width - x, Math.ceil((best.right + 1) / scale) + pad - x);
      height = Math.min(image.height - y, Math.ceil((best.bottom + 1) / scale) + pad - y);
    }
    const output = document.createElement("canvas");
    const resize = Math.min(3200 / Math.max(width, height), Math.max(1, 1400 / width));
    output.width = Math.round(width * resize); output.height = Math.round(height * resize);
    const target = output.getContext("2d", { willReadFrequently: true });
    if (!target) throw new Error("Vaizdo apdorojimas neprieinamas.");
    target.fillStyle = "white"; target.fillRect(0, 0, output.width, output.height);
    target.drawImage(image, x, y, width, height, 0, 0, output.width, output.height);
    const data = target.getImageData(0, 0, output.width, output.height);
    // Increase faded thermal-print contrast without destructive hard thresholding.
    for (let i = 0; i < data.data.length; i += 4) {
      const gray = (data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114 - 105) * 1.8;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.max(0, Math.min(255, gray));
    }
    target.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Vaizdo apdoroti nepavyko.")), "image/png"));
    return blob.arrayBuffer();
  } finally { image.close(); }
}
