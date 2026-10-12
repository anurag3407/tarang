import { describe, expect, it } from "vitest";
import { formatPaise, multiplyPaise, rupeesToPaise, toPaise } from "@/lib/money";

describe("money (plan §2.1.5 — integer paise only)", () => {
  it("normalizes PostgREST bigint strings to paise", () => {
    expect(toPaise("20000")).toBe(20000);
    expect(toPaise(20000)).toBe(20000);
    expect(toPaise(BigInt(20000))).toBe(20000);
  });

  it("treats null/undefined as zero", () => {
    expect(toPaise(null)).toBe(0);
    expect(toPaise(undefined)).toBe(0);
  });

  it("rejects negative and fractional amounts", () => {
    expect(() => toPaise("-5")).toThrow();
    expect(() => toPaise("10.5")).toThrow();
    expect(() => toPaise(Number.NaN)).toThrow();
  });

  it("converts rupees to paise without float drift", () => {
    expect(rupeesToPaise(200)).toBe(20000);
    expect(rupeesToPaise(199.99)).toBe(19999);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // classic float trap
  });

  it("rejects invalid rupee inputs", () => {
    expect(() => rupeesToPaise(-1)).toThrow();
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("formats paise as INR display strings", () => {
    expect(formatPaise(20000)).toBe("₹200");
    expect(formatPaise(0)).toBe("FREE");
    expect(formatPaise(15050)).toContain("150.5");
  });

  it("multiplies unit price by integer quantity", () => {
    expect(multiplyPaise(5000, 4)).toBe(20000);
    expect(() => multiplyPaise(5000, 1.5)).toThrow();
    expect(() => multiplyPaise(5000, -1)).toThrow();
  });
});
