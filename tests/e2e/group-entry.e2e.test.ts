import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter, resetWorld, sb } from "./helpers/mocks";
import { post, json, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});
// The route triggers an immediate outbox dispatch and a best-effort Sheets
// mirror after persisting the entry. Mock both so the tests never reach the
// claim_email_jobs RPC, Resend, or Google APIs regardless of env state.
vi.mock("@/workers/outbox-dispatcher", () => ({
  runEmailDispatcher: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/sheets-service", () => ({
  syncGroupEntryToSheet: vi.fn().mockResolvedValue(undefined),
}));

import { POST as groupEntryRoute } from "@/app/api/public/group-entries/route";
import { runEmailDispatcher } from "@/workers/outbox-dispatcher";
import { syncGroupEntryToSheet } from "@/services/sheets-service";
import { env } from "@/lib/env";

const ENTRY_ID = "9f1c2a4e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
const ENTRY_CODE = "GE-AB12CD34EF";
// groupSize is a string on purpose: the client form posts strings and the
// schema coerces them.
const VALID_ENTRY = {
  leadName: "Meera Iyer",
  email: "meera@example.com",
  phone: "+91 98765 43210",
  college: "Some Medical College",
  groupSize: "12",
  notes: "Arriving together by bus on day 2.",
};

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld();
  vi.mocked(runEmailDispatcher).mockClear();
  vi.mocked(syncGroupEntryToSheet).mockClear();
});

describe("POST /api/public/group-entries (group entry form)", () => {
  it("stores the entry, enqueues the organizer email, and returns the entry code", async () => {
    sb.onTable("group_entries", {
      data: { id: ENTRY_ID, public_entry_code: ENTRY_CODE },
      error: null,
    });
    sb.onTable("email_jobs", { data: null, error: null });

    const res = await groupEntryRoute(post("/api/public/group-entries", { body: VALID_ENTRY }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.entryCode).toBe(ENTRY_CODE);

    const insert = sb.callsFor("group_entries").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      lead_name: "Meera Iyer",
      email: "meera@example.com",
      phone: "+91 98765 43210",
      college: "Some Medical College",
      group_size: 12,
      notes: "Arriving together by bus on day 2.",
    });

    // Organizer notification goes to the fixed inbox via the durable outbox.
    const job = sb.callsFor("email_jobs").find((c) => c.action === "upsert");
    expect(job?.payload).toMatchObject({
      logical_key: `group-entry-notification:${ENTRY_ID}`,
      recipient_user_id: null,
      to_email_snapshot: "pulseaiims141@gmail.com",
      template_name: "group-entry-notification",
      template_version: 1,
      idempotency_key: `email:group-entry-notification:${ENTRY_ID}:v1`,
      state: "PENDING",
    });
    const renderData = (job?.payload as Record<string, unknown>).render_data as Record<
      string,
      unknown
    >;
    expect(renderData).toMatchObject({
      entryCode: ENTRY_CODE,
      leadName: "Meera Iyer",
      entryEmail: "meera@example.com",
      phone: "+91 98765 43210",
      college: "Some Medical College",
      groupSize: 12,
    });

    // Both fail-closed limit keys were checked: email hash and ip.
    const keys = rateLimiter.calls.map((c) => c.identifier.split(":")[0]);
    expect(keys).toEqual(["email", "ip"]);
    expect(rateLimiter.calls.every((c) => c.cls === "ask")).toBe(true);

    // Immediate dispatch so organizers get the mail right away.
    expect(runEmailDispatcher).toHaveBeenCalledWith({ batchSize: 5 });

    // Sheets mirroring is gated on the (memoized) env flag; assert wiring
    // either way so a regression on either side is caught.
    if (env().GOOGLE_SHEETS_ENABLED) {
      expect(syncGroupEntryToSheet).toHaveBeenCalledWith(ENTRY_ID);
    } else {
      expect(syncGroupEntryToSheet).not.toHaveBeenCalled();
    }
  });

  it("normalizes the email to lowercase and drops empty college/notes", async () => {
    sb.onTable("group_entries", {
      data: { id: ENTRY_ID, public_entry_code: ENTRY_CODE },
      error: null,
    });

    await groupEntryRoute(
      post("/api/public/group-entries", {
        body: { ...VALID_ENTRY, email: "Meera@EXAMPLE.com", college: "", notes: "" },
      })
    );
    const insert = sb.callsFor("group_entries").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      email: "meera@example.com",
      college: null,
      notes: null,
    });
    // render_data uses "" for the optional fields, not null.
    const job = sb.callsFor("email_jobs").find((c) => c.action === "upsert");
    const renderData = (job?.payload as Record<string, unknown>).render_data as Record<
      string,
      unknown
    >;
    expect(renderData.college).toBe("");
    expect(renderData.notes).toBe("");
  });

  it("422s on validation failures with per-field issues", async () => {
    const res = await groupEntryRoute(
      post("/api/public/group-entries", { body: { ...VALID_ENTRY, groupSize: "0" } })
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "VALIDATION_FAILED");
    expect(sb.calls.length).toBe(0);
  });

  it("rejects control characters in free text", async () => {
    const res = await groupEntryRoute(
      post("/api/public/group-entries", { body: { ...VALID_ENTRY, leadName: "Bad\u0000Name" } })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("blocks foreign origins before any DB work", async () => {
    const res = await groupEntryRoute(
      post("/api/public/group-entries", {
        body: VALID_ENTRY,
        origin: "https://evil.example",
      })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expectErrEnvelope(body, "BAD_REQUEST");
    expect(body.message).toBe("ORIGIN_NOT_ALLOWED");
    expect(sb.calls.length).toBe(0);
  });

  it("rejects non-JSON content types", async () => {
    const req = post("/api/public/group-entries", { body: VALID_ENTRY });
    req.headers.set("content-type", "text/plain");
    const res = await groupEntryRoute(req);
    expect(res.status).toBe(400);
    expectErrEnvelope(await json(res), "BAD_REQUEST");
  });

  it("returns 429 RATE_LIMITED when the limiter trips", async () => {
    rateLimiter.reset("limited");

    const res = await groupEntryRoute(post("/api/public/group-entries", { body: VALID_ENTRY }));
    expect(res.status).toBe(429);
    expectErrEnvelope(await json(res), "RATE_LIMITED");
  });

  it("fails closed with 503 when the limiter is unavailable", async () => {
    rateLimiter.reset("unavailable");

    const res = await groupEntryRoute(post("/api/public/group-entries", { body: VALID_ENTRY }));
    expect(res.status).toBe(503);
    expectErrEnvelope(await json(res), "RATE_LIMIT_UNAVAILABLE");
  });

  it("maps a DB insert failure to INTERNAL without leaking details", async () => {
    sb.onTable("group_entries", {
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const res = await groupEntryRoute(post("/api/public/group-entries", { body: VALID_ENTRY }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expectErrEnvelope(body, "INTERNAL");
    expect(JSON.stringify(body)).not.toContain("duplicate key");
    // Nothing downstream of the failed insert ran.
    expect(sb.callsFor("email_jobs").length).toBe(0);
    expect(runEmailDispatcher).not.toHaveBeenCalled();
  });

  it("still succeeds when the email job enqueue fails", async () => {
    sb.onTable("group_entries", {
      data: { id: ENTRY_ID, public_entry_code: ENTRY_CODE },
      error: null,
    });
    sb.onTable("email_jobs", {
      data: null,
      error: { message: "outbox unavailable" },
    });

    const res = await groupEntryRoute(post("/api/public/group-entries", { body: VALID_ENTRY }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.entryCode).toBe(ENTRY_CODE);
    // No dispatch attempt when the enqueue itself failed.
    expect(runEmailDispatcher).not.toHaveBeenCalled();
  });
});
