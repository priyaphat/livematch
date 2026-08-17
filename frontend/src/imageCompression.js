const TARGET_SLIP_BYTES = 100 * 1024;
const MAX_SLIP_BYTES = 2 * 1024 * 1024;
const MAX_SLIP_EDGE = 1200;

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressBookingSlip(file) {
	if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("รองรับเฉพาะ JPEG, PNG และ WebP");
	}
	const image = await decodeImage(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("อ่านขนาดรูปสลิปไม่ได้");
	if (file.size <= TARGET_SLIP_BYTES && Math.max(sourceWidth, sourceHeight) <= MAX_SLIP_EDGE) {
		if (typeof image.close === "function") image.close();
		return file;
	}

  let scale = Math.min(1, MAX_SLIP_EDGE / Math.max(sourceWidth, sourceHeight));
  let best = null;
  for (const dimensionScale of [1, 0.85, 0.7, 0.6, 0.5]) {
    const width = Math.max(1, Math.round(sourceWidth * scale * dimensionScale));
    const height = Math.max(1, Math.round(sourceHeight * scale * dimensionScale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการย่อรูป");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.82, 0.74, 0.66, 0.58, 0.5]) {
      let blob = await canvasBlob(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= TARGET_SLIP_BYTES) break;
    }
    if (best?.size <= TARGET_SLIP_BYTES) break;
  }
  if (typeof image.close === "function") image.close();
  if (!best || best.size > TARGET_SLIP_BYTES) throw new Error("ไม่สามารถลดขนาดสลิปให้ต่ำกว่า 100 KB ได้ กรุณาถ่ายหรือเลือกภาพใหม่");
  const extension = best.type === "image/webp" ? "webp" : "jpg";
  return new File([best], `booking-slip.${extension}`, { type: best.type, lastModified: Date.now() });
}

export { MAX_SLIP_BYTES, MAX_SLIP_EDGE, TARGET_SLIP_BYTES };
