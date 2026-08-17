import { afterEach, describe, expect, it, vi } from "vitest";
import { compressBookingSlip, MAX_SLIP_BYTES, TARGET_SLIP_BYTES } from "./imageCompression";

describe("booking slip compression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockLargeImage(toBlob) {
    const bitmap = { width: 3200, height: 2400, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }), toBlob };
    vi.spyOn(document, "createElement").mockImplementation((tag) => tag === "canvas" ? canvas : null);
    return { bitmap, canvas };
  }

  it("keeps an already-small supported image without Base64 conversion", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1200, height: 800, close: vi.fn() })));
    const file = new File([new Uint8Array([1, 2, 3])], "slip.png", { type: "image/png" });
    expect(await compressBookingSlip(file)).toBe(file);
    expect(file.size).toBeLessThan(TARGET_SLIP_BYTES);
  });

  it("rejects unsupported files", async () => {
    const file = new File(["text"], "slip.txt", { type: "text/plain" });
    await expect(compressBookingSlip(file)).rejects.toThrow("JPEG, PNG และ WebP");
  });

  it("resizes a large image to WebP and honors EXIF orientation", async () => {
    const { bitmap, canvas } = mockLargeImage((callback, type) => callback(new Blob([new Uint8Array(80_000)], { type })));
    const file = new File([new Uint8Array(100)], "large.jpg", { type: "image/jpeg" });
    const result = await compressBookingSlip(file);
    expect(result.type).toBe("image/webp");
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(1200);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("falls back to JPEG when canvas cannot encode WebP", async () => {
    mockLargeImage((callback, type) => callback(new Blob([new Uint8Array(90_000)], { type: type === "image/webp" ? "image/png" : "image/jpeg" })));
    const result = await compressBookingSlip(new File([new Uint8Array(100)], "slip.png", { type: "image/png" }));
    expect(result.type).toBe("image/jpeg");
  });

  it("rejects an image that remains over the 100 KB client target", async () => {
    const oversized = new Blob([new Uint8Array(MAX_SLIP_BYTES + 1)], { type: "image/webp" });
    mockLargeImage((callback) => callback(oversized));
    await expect(compressBookingSlip(new File([new Uint8Array(100)], "slip.webp", { type: "image/webp" }))).rejects.toThrow("ต่ำกว่า 100 KB");
  });
});
