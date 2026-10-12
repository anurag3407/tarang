import { describe, expect, it } from "vitest";
import {
  sanitizeSheetCell,
  BASIC_PASS_HEADERS,
  DELEGATE_PASS_HEADERS,
  EVENT_REGISTRATION_HEADERS,
  appendToGoogleSheet,
} from "@/services/sheets-service";

describe("Google Sheets Mirror Service", () => {
  describe("sanitizeSheetCell (Formula Injection Defense)", () => {
    it("neutralizes formula injection characters (=, +, -, @, tab, CR)", () => {
      expect(sanitizeSheetCell("=SUM(A1:B10)")).toBe("'=SUM(A1:B10)");
      expect(sanitizeSheetCell("+1234567890")).toBe("'+1234567890");
      expect(sanitizeSheetCell("-CMD('calc')")).toBe("'-CMD('calc')");
      expect(sanitizeSheetCell("@SUM")).toBe("'@SUM");
      expect(sanitizeSheetCell("\tTabbed")).toBe("'\tTabbed");
      expect(sanitizeSheetCell("\rReturn")).toBe("'\rReturn");
    });

    it("leaves safe strings untouched", () => {
      expect(sanitizeSheetCell("Anurag Sharma")).toBe("Anurag Sharma");
      expect(sanitizeSheetCell("PS-2027-001")).toBe("PS-2027-001");
      expect(sanitizeSheetCell("₹2,000")).toBe("₹2,000");
    });

    it("handles null and undefined gracefully", () => {
      expect(sanitizeSheetCell(null)).toBe("");
      expect(sanitizeSheetCell(undefined)).toBe("");
    });
  });

  describe("3-Spreadsheet Headers Definition", () => {
    it("defines correct columns for Basic Card registrations", () => {
      expect(BASIC_PASS_HEADERS).toContain("Pass Code");
      expect(BASIC_PASS_HEADERS).toContain("Holder Name");
      expect(BASIC_PASS_HEADERS).toContain("Order Code");
      expect(BASIC_PASS_HEADERS).toContain("Payment ID");
      expect(BASIC_PASS_HEADERS).toContain("Amount (INR)");
      expect(BASIC_PASS_HEADERS).toContain("Activated At");
    });

    it("defines correct columns for Delegate Card registrations (VIP perks included)", () => {
      expect(DELEGATE_PASS_HEADERS).toContain("Pass Code");
      expect(DELEGATE_PASS_HEADERS).toContain("Order Code");
      expect(DELEGATE_PASS_HEADERS).toContain("Payment ID");
      expect(DELEGATE_PASS_HEADERS).toContain("Concert Pro Shows Included");
      expect(DELEGATE_PASS_HEADERS).toContain("VIP Front-Row Zone");
      expect(DELEGATE_PASS_HEADERS).toContain("Amount (INR)");
    });

    it("defines correct columns for All Events registrations", () => {
      expect(EVENT_REGISTRATION_HEADERS).toContain("Registration Code");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Event Name");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Category");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Team Name");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Team Members");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Order Code");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Payment ID");
      expect(EVENT_REGISTRATION_HEADERS).toContain("Payment Status");
    });
  });

  describe("appendToGoogleSheet Graceful Degradation", () => {
    it("returns success with 0 appended if rows array is empty", async () => {
      const res = await appendToGoogleSheet("fake-sheet-id", "A:Z", []);
      expect(res.success).toBe(true);
      expect(res.rowsAppended).toBe(0);
    });

    it("fails safely with non-blocking error if service account credentials not configured in unit test environment", async () => {
      const res = await appendToGoogleSheet("fake-sheet-id", "A:Z", [["Safe", "Row"]]);
      expect(res.rowsAppended).toBe(0);
      expect(res.error).toBeDefined();
    });
  });

  describe("syncAllHistoricalRecordsToSheets Incremental Sync", () => {
    it("returns zero counts gracefully when GOOGLE_SHEETS_ENABLED is false", async () => {
      const { syncAllHistoricalRecordsToSheets } = await import("@/services/sheets-service");
      const result = await syncAllHistoricalRecordsToSheets();
      expect(result).toEqual({
        basicPasses: 0,
        delegatePasses: 0,
        events: 0,
        merchandise: 0,
        total: 0,
      });
    });
  });
});

