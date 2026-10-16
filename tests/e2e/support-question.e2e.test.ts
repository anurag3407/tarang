import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter, resetWorld, sb, userSb } from "./helpers/mocks";
import { get, post, json, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

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

import { POST as askRoute } from "@/app/api/public/questions/route";
import { GET as adminQuestionsRoute } from "@/app/api/admin/questions/route";
import { PATCH as adminQuestionPatchRoute } from "@/app/api/admin/questions/[id]/route";
import { ctx } from "./helpers/requests";

const TICKET_CODE = "PQ-7F3K2M";
const VALID_QUESTION = {
  name: "Aarav Sharma",
  email: "aarav@example.com",
  college: "Some College",
  topic: "Registration",
  question: "My payment went through but I have not received my pass yet.",
};

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: ADMIN_ID_LOCAL, email: "admin@example.com", confirmed: true } });
});

describe("POST /api/public/questions (ask form, plan §11.9)", () => {
  it("stores the question and returns only the random ticket code", async () => {
    sb.onTable("support_questions", {
      data: { public_ticket_code: TICKET_CODE },
      error: null,
    });

    const res = await askRoute(post("/api/public/questions", { body: VALID_QUESTION }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.ticketCode).toBe(TICKET_CODE);

    const insert = sb.callsFor("support_questions").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      name: "Aarav Sharma",
      email: "aarav@example.com",
      college: "Some College",
      topic: "Registration",
      status: "OPEN",
    });
    // Both fail-closed limit keys were checked: email hash and ip.
    const keys = rateLimiter.calls.map((c) => c.identifier.split(":")[0]);
    expect(keys).toEqual(["email", "ip"]);
    expect(rateLimiter.calls.every((c) => c.cls === "ask")).toBe(true);
  });

  it("normalizes the email to lowercase and drops an empty college", async () => {
    sb.onTable("support_questions", {
      data: { public_ticket_code: TICKET_CODE },
      error: null,
    });

    await askRoute(
      post("/api/public/questions", {
        body: { ...VALID_QUESTION, email: "Aarav@EXAMPLE.com", college: "" },
      })
    );
    const insert = sb.callsFor("support_questions").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      email: "aarav@example.com",
      college: null,
    });
  });

  it("422s on validation failures with per-field issues", async () => {
    const res = await askRoute(
      post("/api/public/questions", {
        body: { ...VALID_QUESTION, question: "too short" },
      })
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "VALIDATION_FAILED");
    expect(sb.calls.length).toBe(0);
  });

  it("rejects control characters in free text", async () => {
    const res = await askRoute(
      post("/api/public/questions", {
        body: { ...VALID_QUESTION, name: "Bad\u0000Name" },
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("blocks foreign origins before any DB work", async () => {
    const res = await askRoute(
      post("/api/public/questions", { body: VALID_QUESTION, origin: "https://evil.example" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expectErrEnvelope(body, "BAD_REQUEST");
    expect(body.message).toBe("ORIGIN_NOT_ALLOWED");
    expect(sb.calls.length).toBe(0);
  });

  it("rejects non-JSON content types", async () => {
    const req = post("/api/public/questions", { body: VALID_QUESTION });
    req.headers.set("content-type", "text/plain");
    const res = await askRoute(req);
    expect(res.status).toBe(400);
    expectErrEnvelope(await json(res), "BAD_REQUEST");
  });

  it("returns 429 RATE_LIMITED when the limiter trips", async () => {
    rateLimiter.reset("limited");

    const res = await askRoute(post("/api/public/questions", { body: VALID_QUESTION }));
    expect(res.status).toBe(429);
    expectErrEnvelope(await json(res), "RATE_LIMITED");
  });

  it("fails closed with 503 when the limiter is unavailable", async () => {
    rateLimiter.reset("unavailable");

    const res = await askRoute(post("/api/public/questions", { body: VALID_QUESTION }));
    expect(res.status).toBe(503);
    expectErrEnvelope(await json(res), "RATE_LIMIT_UNAVAILABLE");
  });

  it("maps a DB insert failure to INTERNAL without leaking details", async () => {
    sb.onTable("support_questions", {
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const res = await askRoute(post("/api/public/questions", { body: VALID_QUESTION }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expectErrEnvelope(body, "INTERNAL");
    expect(JSON.stringify(body)).not.toContain("duplicate key");
  });
});

describe("admin support queue (plan §11.9)", () => {
  function grantSupportRead(): void {
    userSb.onRpc("has_permission", { data: true, error: null });
  }

  it("lists tickets with pagination metadata and status filter", async () => {
    grantSupportRead();
    userSb.onTable("support_questions", {
      data: [
        {
          id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01",
          public_ticket_code: TICKET_CODE,
          name: "Aarav Sharma",
          email: "aarav@example.com",
          college: "Some College",
          topic: "Registration",
          question: "Where is my pass?",
          status: "OPEN",
          resolution_note: null,
          created_at: "2026-08-20T10:00:00Z",
          resolved_at: null,
        },
      ],
      error: null,
      count: 1,
    });

    const res = await adminQuestionsRoute(get("/api/admin/questions?status=OPEN&page=1"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.total).toBe(1);
    expect(body.data.pageSize).toBe(20);
    const questions = body.data.questions as Array<Record<string, unknown>>;
    expect(questions[0]).toMatchObject({
      ticketCode: TICKET_CODE,
      status: "OPEN",
      resolutionNote: null,
    });
    // Status filter was applied on the query.
    const call = userSb.callsFor("support_questions")[0];
    expect(call.filters["status"]).toBe("OPEN");
    expect(call.filters["range"]).toEqual([0, 19]);
  });

  it("403s a caller without support.read", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });

    const res = await adminQuestionsRoute(get("/api/admin/questions"));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("resolves a ticket, stamps resolved_at and writes an audit entry", async () => {
    userSb.onRpc("has_permission", { data: true, error: null }); // guardAdminMutation
    userSb.onTable("support_questions", { data: { id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01", status: "RESOLVED" }, error: null });
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await adminQuestionPatchRoute(
      post("/api/admin/questions/q-1", {
        body: { status: "RESOLVED", resolutionNote: "Pass reissued manually." },
      }),
      ctx({ id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.status).toBe("RESOLVED");

    const update = userSb.callsFor("support_questions").find((c) => c.action === "update");
    expect(update?.payload).toMatchObject({
      status: "RESOLVED",
      resolution_note: "Pass reissued manually.",
    });
    const resolvedPayload = update?.payload as Record<string, unknown> | undefined;
    expect(typeof resolvedPayload?.resolved_at).toBe("string");

    const audit = userSb.rpcParams("write_audit");
    expect(audit).toMatchObject({
      p_action: "support.resolve",
      p_target_type: "support_question",
      p_target_id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01",
    });
  });

  it("keeps a provided resolution note when reopening without resolving", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    userSb.onTable("support_questions", { data: { id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01", status: "IN_PROGRESS" }, error: null });
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await adminQuestionPatchRoute(
      post("/api/admin/questions/q-1", {
        body: { status: "IN_PROGRESS", resolutionNote: "Waiting on payment gateway." },
      }),
      ctx({ id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01" })
    );
    expect(res.status).toBe(200);
    const update = userSb.callsFor("support_questions").find(
      (c) => c.action === "update"
    )!;
    const payload = update.payload as Record<string, unknown>;
    expect(payload).toEqual({
      status: "IN_PROGRESS",
      resolution_note: "Waiting on payment gateway.",
    });
    expect(payload.resolved_at).toBeUndefined();
  });

  it("404s when the ticket no longer exists", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    userSb.onTable("support_questions", { data: null, error: null });

    const res = await adminQuestionPatchRoute(
      post("/api/admin/questions/ghost", { body: { status: "OPEN" } }),
      ctx({ id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0aff" })
    );
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("422s an invalid status enum", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    const res = await adminQuestionPatchRoute(
      post("/api/admin/questions/q-1", { body: { status: "WONKY" } }),
      ctx({ id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01" })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });
});

const ADMIN_ID_LOCAL = "22222222-2222-4222-8222-222222222222";
