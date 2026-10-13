import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FESTIVAL_ID, ORDER_ID, USER_ID, resetWorld, sb } from "./helpers/mocks";

process.env.GOOGLE_SHEETS_ENABLED = "true";
process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://sheets.example.test/hook";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});

import {
  syncAllHistoricalRecordsToSheets,
  syncOrderToSpreadsheets,
} from "@/services/sheets-service";

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
globalThis.fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_SHEETS_ENABLED;
  delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
});

beforeEach(() => {
  resetWorld({ actor: null, festival: false });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
});

const PRONITE = { name: "Pronite Pass", slug: "vip-delegate-pass", is_base_pass: false };

const ORDER = {
  id: ORDER_ID,
  purchaser_user_id: USER_ID,
  festival_id: FESTIVAL_ID,
  public_order_code: "PO-SHEET0001",
  amount_paise: 49900,
  currency: "INR",
  kind: "BASE_PASS",
  fulfilled_at: "2026-10-01T10:00:00Z",
  created_at: "2026-10-01T09:59:00Z",
};

function sentRows(): { rows: string[][]; sheetKind: string } {
  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
  return { rows: body.rows, sheetKind: body.sheetKind };
}

describe("syncAllHistoricalRecordsToSheets (Sync all)", () => {
  it("selects FULFILLED orders by checkout_state and mirrors a sub-₹500 Pronite Pass to the pass sheet", async () => {
    sb.onTable(
      "sheets_sync_items",
      { data: [], error: null }, // existing sync items page
      { data: [{ entity_id: ORDER_ID }], error: null }, // claim insert
      { data: [], error: null }, // reclaim FAILED/stale
      { data: null, error: null } // mark SYNCED
    );
    sb.onTable("orders", { data: [ORDER], error: null });
    sb.onTable("profiles", {
      data: [{ user_id: USER_ID, display_name: "Aarav Sharma", phone_e164: "+919999999999", college_name: "NIT" }],
      error: null,
    });
    sb.onTable("payments", {
      data: [{ local_order_id: ORDER_ID, razorpay_payment_id: "pay_123", created_at: "2026-10-01T10:00:00Z" }],
      error: null,
    });
    sb.onTable("order_lines", {
      data: [{ id: "line-1", order_id: ORDER_ID, pass_product_id: "pp-1", event_id: null, pass_products: PRONITE, events: null }],
      error: null,
    });
    sb.onTable("delegate_passes", {
      data: [{ public_pass_code: "PP-SHEET0001", state: "ACTIVE", activated_at: "2026-10-01T10:00:00Z", source_order_line_id: "line-1", pass_products: PRONITE }],
      error: null,
    });
    sb.onTable("registrations", { data: [], error: null });
    sb.onTable("merchandise_orders", { data: [], error: null });

    const result = await syncAllHistoricalRecordsToSheets();

    expect(result).toEqual({ basicPasses: 0, delegatePasses: 1, events: 0, merchandise: 0, total: 1 });

    // Regression: orders has no `state` column — filtering on it failed the
    // query and the backfill always reported "already up to date".
    const ordersQuery = sb.callsFor("orders")[0];
    expect(ordersQuery.filters.checkout_state).toBe("FULFILLED");
    expect(ordersQuery.filters.state).toBeUndefined();
    expect(ordersQuery.filters.range).toEqual([0, 999]);

    const { rows, sheetKind } = sentRows();
    expect(sheetKind).toBe("DELEGATE_PASS");
    expect(rows[0]).toContain("PP-SHEET0001");
    expect(rows[0]).toContain("Pronite Pass");

    const marked = sb.callsFor("sheets_sync_items").at(-1)!;
    expect(marked.action).toBe("update");
    expect(marked.payload).toMatchObject({ sync_state: "SYNCED" });
  });

  it("skips orders that are already synced", async () => {
    sb.onTable("sheets_sync_items", {
      data: [{ entity_id: ORDER_ID, sync_state: "SYNCED", updated_at: "2026-10-01T10:00:00Z" }],
      error: null,
    });
    sb.onTable("orders", { data: [ORDER], error: null });

    const result = await syncAllHistoricalRecordsToSheets();
    expect(result.total).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("syncOrderToSpreadsheets (per order)", () => {
  function seedOrderData(): void {
    sb.onTable("profiles", { data: { display_name: "Aarav Sharma", phone_e164: null, college_name: null }, error: null });
    sb.onTable("payments", { data: { razorpay_payment_id: "pay_123" }, error: null });
    sb.onTable("order_lines", {
      data: [{ id: "line-1", pass_product_id: "pp-1", event_id: null, pass_products: PRONITE, events: null }],
      error: null,
    });
    sb.onTable("delegate_passes", {
      data: { id: "pass-1", public_pass_code: "PP-SHEET0001", state: "ACTIVE", activated_at: null, pass_products: PRONITE },
      error: null,
    });
  }

  it("reclaims a FAILED sync instead of skipping the order forever", async () => {
    sb.onTable("orders", { data: ORDER, error: null });
    sb.onTable(
      "sheets_sync_items",
      { data: null, error: { message: "duplicate key", code: "23505" } }, // claim insert
      { data: { id: "sync-1" }, error: null }, // reclaim FAILED
      { data: null, error: null } // mark SYNCED
    );
    seedOrderData();

    const res = await syncOrderToSpreadsheets(ORDER_ID);
    expect(res).toEqual({ synced: true, error: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const reclaim = sb.callsFor("sheets_sync_items")[1];
    expect(reclaim.action).toBe("update");
    expect(String(reclaim.filters.$or)).toContain("sync_state.eq.FAILED");
  });

  it("reports in-progress (so the outbox job retries) when another caller holds the claim", async () => {
    sb.onTable("orders", { data: ORDER, error: null });
    sb.onTable(
      "sheets_sync_items",
      { data: null, error: { message: "duplicate key", code: "23505" } },
      { data: null, error: null }, // not reclaimable
      { data: { sync_state: "IN_PROGRESS" }, error: null }
    );

    const res = await syncOrderToSpreadsheets(ORDER_ID);
    expect(res).toMatchObject({ synced: false, inProgress: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an already-synced order as done", async () => {
    sb.onTable("orders", { data: ORDER, error: null });
    sb.onTable(
      "sheets_sync_items",
      { data: null, error: { message: "duplicate key", code: "23505" } },
      { data: null, error: null },
      { data: { sync_state: "SYNCED" }, error: null }
    );

    const res = await syncOrderToSpreadsheets(ORDER_ID);
    expect(res).toEqual({ synced: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
