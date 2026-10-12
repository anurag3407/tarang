import { describe, it, expect } from "vitest";
import { formatDateTimeIST, formatDateIST, formatTimeIST } from "@/lib/dates";

describe("dates utility (IST)", () => {
  it("formats ISO timestamps in Indian Standard Time (UTC+5:30)", () => {
    // 2026-08-23T19:51:32.000Z is 2026-08-24 01:21:32 in IST
    const utcIso = "2026-08-23T19:51:32.000Z";
    const formatted = formatDateTimeIST(utcIso);
    expect(formatted).toContain("24");
    expect(formatted).toContain("Aug");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/1:21|01:21/);
    expect(formatted).toMatch(/am|AM/);
  });

  it("formats date only in IST", () => {
    const utcIso = "2026-08-23T19:51:32.000Z";
    const formatted = formatDateIST(utcIso);
    expect(formatted).toContain("24");
    expect(formatted).toContain("Aug");
    expect(formatted).toContain("2026");
  });

  it("formats time only in IST", () => {
    const utcIso = "2026-08-23T19:51:32.000Z";
    const formatted = formatTimeIST(utcIso);
    expect(formatted).toMatch(/1:21|01:21/);
    expect(formatted).toMatch(/am|AM/);
  });

  it("handles null or undefined safely", () => {
    expect(formatDateTimeIST(null)).toBe("—");
    expect(formatDateTimeIST(undefined)).toBe("—");
    expect(formatDateIST(null)).toBe("—");
    expect(formatTimeIST(null)).toBe("—");
  });
});
