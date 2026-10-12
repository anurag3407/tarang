import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWorld, sb } from "./helpers/mocks";
import { json, post, rawPost, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

/**
 * Pristine-env behaviors: webhook endpoints that must refuse to run without
 * their provider secrets, and Turnstile gating once a site secret exists.
 * This file runs with NO provider secrets so env() parses that exact state
 * regardless of which worker/file ran earlier.
 */
delete process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT;
delete process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
delete process.env.RESEND_WEBHOOK_SECRET;

const TURNSTILE_SECRET = "turnstile-secret-e2e";
process.env.TURNSTILE_SECRET_KEY = TURNSTILE_SECRET;

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

import { POST as razorpayWebhookRoute } from "@/app/api/webhooks/razorpay/route";
import { POST as resendWebhookRoute } from "@/app/api/webhooks/resend/route";
import { POST as askRoute } from "@/app/api/public/questions/route";

const VALID_ASK = {
  name: "Aarav Sharma",
  email: "aarav@example.com",
  college: "Some College",
  topic: "Registration",
  question: "My payment went through but I have not received my pass yet.",
};

const fetchCalls: Array<{ url: string; body: URLSearchParams }> = [];

beforeEach(() => {
  resetWorld();
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      fetchCalls.push({ url: String(url), body: params });
      if (params.get("response") === "network-death") {
        throw new Error("challenge unreachable");
      }
      // Only a known-good challenge token passes verification.
      const ok = params.get("response") === "valid-challenge-token";
      return new Response(JSON.stringify({ success: ok }), { status: 200 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("webhook endpoints refuse to run unconfigured", () => {
  it("razorpay webhook 503s without any signing secret", async () => {
    const res = await razorpayWebhookRoute(rawPost("/api/webhooks/razorpay", "{}"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(sb.calls.length).toBe(0);
  });

  it("resend webhook 503s without its svix secret", async () => {
    const res = await resendWebhookRoute(
      rawPost("/api/webhooks/resend", "{}", {
        "svix-id": "msg_1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,whatever",
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});

describe("Turnstile gating once configured", () => {
  it("blocks submissions whose challenge fails", async () => {
    const res = await askRoute(
      post("/api/public/questions", { body: { ...VALID_ASK, turnstileToken: "bad-token" } })
    );
    expect(res.status).toBe(403);
    const body = await json(res);
    expectErrEnvelope(body, "FORBIDDEN");
    expect(body.message).toMatch(/Bot check failed/i);

    // The challenge endpoint actually received the verification attempt.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("challenges.cloudflare.com");
    expect(fetchCalls[0].body.get("secret")).toBe(TURNSTILE_SECRET);
    expect(fetchCalls[0].body.get("response")).toBe("bad-token");
    // Fail closed: nothing was stored.
    expect(sb.callsFor("support_questions")).toHaveLength(0);
  });

  it("fails closed when the challenge service is unreachable", async () => {
    const res = await askRoute(
      post("/api/public/questions", {
        body: { ...VALID_ASK, turnstileToken: "network-death" },
      })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(sb.calls.length).toBe(0);
  });

  it("rejects a missing token outright without calling the network", async () => {
    const res = await askRoute(post("/api/public/questions", { body: VALID_ASK }));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(fetchCalls).toHaveLength(0);
  });

  it("lets verified humans through to storage", async () => {
    sb.onTable("support_questions", { data: { public_ticket_code: "PQ-OK-001" }, error: null });

    const res = await askRoute(
      post("/api/public/questions", {
        body: { ...VALID_ASK, turnstileToken: "valid-challenge-token" },
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.ticketCode).toBe("PQ-OK-001");
  });
});
