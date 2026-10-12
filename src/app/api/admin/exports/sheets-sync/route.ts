import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead } from "@/lib/admin-route";
import { env } from "@/lib/env";
import {
  syncAllHistoricalRecordsToSheets,
  BASIC_PASS_HEADERS,
  DELEGATE_PASS_HEADERS,
  EVENT_REGISTRATION_HEADERS,
  MERCHANDISE_ORDER_HEADERS,
  appendToGoogleSheet,
} from "@/services/sheets-service";
import { readJsonBody } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/exports/sheets-sync — Check Google Sheets 3-spreadsheet configuration and connection status.
 */
export async function GET(req: NextRequest) {
  try {
    await guardAdminRead(req, "registration.export");
    const e = env();

    return apiSuccess(req, {
      enabled: e.GOOGLE_SHEETS_ENABLED,
      serviceAccountConfigured: Boolean(e.GOOGLE_SERVICE_ACCOUNT_JSON || e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64),
      webhookConfigured: Boolean(e.GOOGLE_SHEETS_WEBHOOK_URL),
      spreadsheets: {
        basicPassSpreadsheetId: e.GOOGLE_SHEETS_BASIC_PASS_ID ?? (e.GOOGLE_MASTER_SPREADSHEET_ID ? `${e.GOOGLE_MASTER_SPREADSHEET_ID} (Tab: 'Basic Passes')` : null),
        delegatePassSpreadsheetId: e.GOOGLE_SHEETS_DELEGATE_PASS_ID ?? (e.GOOGLE_MASTER_SPREADSHEET_ID ? `${e.GOOGLE_MASTER_SPREADSHEET_ID} (Tab: 'Delegate Passes')` : null),
        eventsSpreadsheetId: e.GOOGLE_SHEETS_EVENTS_ID ?? (e.GOOGLE_MASTER_SPREADSHEET_ID ? `${e.GOOGLE_MASTER_SPREADSHEET_ID} (Tab: 'Event Registrations')` : null),
        merchandiseSpreadsheetId: e.GOOGLE_SHEETS_MERCHANDISE_ID ?? (e.GOOGLE_MASTER_SPREADSHEET_ID ? `${e.GOOGLE_MASTER_SPREADSHEET_ID} (Tab: 'Merchandise Orders')` : null),
        masterSpreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID ?? null,
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * POST /api/admin/exports/sheets-sync — Trigger initial backfill / full historical sync or header initialization.
 */
export async function POST(req: NextRequest) {
  try {
    await guardAdminMutation(req, "registration.export");
    const e = env();

    if (!e.GOOGLE_SHEETS_ENABLED) {
      return apiError(req, "CONFLICT", "Google Sheets synchronization is currently disabled in environment (GOOGLE_SHEETS_ENABLED=false).");
    }

    const body = await readJsonBody<{ action?: "sync_all" | "init_headers" }>(req).catch(() => ({ action: "sync_all" as const }));
    const action = body.action ?? "sync_all";

    if (action === "init_headers") {
      // Write column headers to row 1 of each spreadsheet
      const results: Record<string, unknown> = {};

      if (e.GOOGLE_SHEETS_BASIC_PASS_ID) {
        results.basicPassHeaders = await appendToGoogleSheet(e.GOOGLE_SHEETS_BASIC_PASS_ID, "A1:K1", [BASIC_PASS_HEADERS]);
      }
      if (e.GOOGLE_SHEETS_DELEGATE_PASS_ID) {
        results.delegatePassHeaders = await appendToGoogleSheet(e.GOOGLE_SHEETS_DELEGATE_PASS_ID, "A1:M1", [DELEGATE_PASS_HEADERS]);
      }
      if (e.GOOGLE_SHEETS_EVENTS_ID) {
        results.eventHeaders = await appendToGoogleSheet(e.GOOGLE_SHEETS_EVENTS_ID, "A1:Q1", [EVENT_REGISTRATION_HEADERS]);
      }
      if (e.GOOGLE_SHEETS_MERCHANDISE_ID) {
        results.merchandiseHeaders = await appendToGoogleSheet(e.GOOGLE_SHEETS_MERCHANDISE_ID, "A1:N1", [MERCHANDISE_ORDER_HEADERS]);
      }

      return apiSuccess(req, {
        message: "Spreadsheet headers initialized",
        results,
      });
    }

    // Default: incremental sync
    const result = await syncAllHistoricalRecordsToSheets();
    return apiSuccess(req, {
      message: result.total > 0
        ? `Incremental sync complete (${result.total} new records mirrored to Google Sheets)`
        : "Google Sheets are already up to date (0 new records to sync)",
      recordsSynced: result,
      syncedOrders: result.total,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
