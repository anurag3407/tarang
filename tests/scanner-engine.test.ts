import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";

describe("Rapid Scanner Engine", () => {
  it("decodes signed VIP delegate QR tokens rapidly", async () => {
    const sampleToken =
      "P1.test-key.eyJ2IjoxLCJqdGkiOiJ0ZXN0LWp0aS11dWlkIiwiZmVzdCI6InB1bHNlIiwicGFzcyI6IlBQLTIwMjYtQUJDMTIzIiwiZW50diI6MSwibmJmIjoxNzAwMDAwMDAwLCJleHAiOjE4MDAwMDAwMDAsImNsYXNzIjoiQkFTRSJ9.sample-sig";

    const qrData = QRCode.create(sampleToken, { errorCorrectionLevel: "M" });
    const size = qrData.modules.size;
    const scale = 8;
    const width = size * scale;
    const height = size * scale;
    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const bit = qrData.modules.get(r, c);
        const val = bit ? 0 : 255;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const idx = ((r * scale + y) * width + (c * scale + x)) * 4;
            rgba[idx] = val;
            rgba[idx + 1] = val;
            rgba[idx + 2] = val;
            rgba[idx + 3] = 255;
          }
        }
      }
    }

    // Warm up JIT
    jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });

    const t0 = performance.now();
    const result = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
    const durationMs = performance.now() - t0;

    expect(result).not.toBeNull();
    expect(result?.data).toBe(sampleToken);
    // Must decode rapidly in test environment
    expect(durationMs).toBeLessThan(500);
  });

  it("decodes Basic Card pass codes from QR", async () => {
    const passCode = "PP-AIIMS-789XYZ";
    const qrData = QRCode.create(passCode, { errorCorrectionLevel: "M" });
    const size = qrData.modules.size;
    const scale = 6;
    const width = size * scale;
    const height = size * scale;
    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const bit = qrData.modules.get(r, c);
        const val = bit ? 0 : 255;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const idx = ((r * scale + y) * width + (c * scale + x)) * 4;
            rgba[idx] = val;
            rgba[idx + 1] = val;
            rgba[idx + 2] = val;
            rgba[idx + 3] = 255;
          }
        }
      }
    }

    const result = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
    expect(result).not.toBeNull();
    expect(result?.data).toBe(passCode);
  });
});
