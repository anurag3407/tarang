import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FESTIVAL_ID,
  ORDER_ID,
  USER_ID,
  flushAfter,
  rateLimiter,
  resetWorld,
  rzp,
  sb,
} from "./helpers/mocks";
import {
  json,
  post,
  rawPost,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";

// Provider secrets must exist BEFORE the first env() parse in this worker.
const WHSEC_CURRENT = "whsec_current_e2e_0123456789abcdef";
const WHSEC_PREVIOUS = "whsec_previous_e2e_fedcba9876543210";
const RESEND_SECRET_RAW = "e2e-resend-secret-bytes-0123456789ab";
process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT = WHSEC_CURRENT;
process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS = WHSEC_PREVIOUS;
process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from(RESEND_SECRET_RAW).toString("base64")}`;

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
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  const m = await import("./helpers/mocks");
  return { ...actual, getRazorpay: () => m.rzp };
});
vi.mock("next/server", async (importOriginal) => {
  const [actual, m] = await Promise.all([
    importOriginal<typeof import("next/server")>(),
    import("./helpers/mocks"),
  ]);
  return {
    ...actual,
    // Execute after() callbacks through our queue so tests can flush them.
    // `m` is resolved eagerly so registration stays synchronous.
    after: (fn: () => unknown) => m.enqueueAfter(fn),
  };
});

import { POST as verifyRoute } from "@/app/api/checkout/razorpay/verify/route";
import { POST as razorpayWebhookRoute } from "@/app/api/webhooks/razorpay/route";
import { POST as resendWebhookRoute } from "@/app/api/webhooks/resend/route";

const RZP_ORDER = "order_WEBPAY01";
const RZP_PAYMENT = "pay_WEBPAY01";
const KEY_SECRET = "test_razorpay_secret_0123456789"; // vitest config env

function checkoutSignature(orderId: string, paymentId: string): string {
  return createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

/** Auth + flag prelude consumed by authenticated mutation routes. */
function seedGuards(): void {
  sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
  sb.onTable("feature_flags", { data: { enabled: false }, error: null });
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: true } });
});

describe("POST /api/checkout/razorpay/verify (plan §12.7)", () => {
  function seedCapturedMapping(): void {
    sb.onTable("razorpay_orders", {
      data: {
        local_order_id: ORDER_ID,
        expected_amount_paise: "20000",
        currency: "INR",
      },
      error: null,
    });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        purchaser_user_id: USER_ID,
        amount_paise: "20000",
        currency: "INR",
      },
      error: null,
    });
  }

  it("verifies the HMAC, fetches authoritative state, applies captured idempotently", async () => {
    seedGuards();
    seedCapturedMapping();
    rzp.payments.fetch.mockResolvedValueOnce({
      id: RZP_PAYMENT,
      status: "captured",
      amount: 20000,
      created_at: 1_755_000_000,
    });
    sb.onRpc("apply_captured_payment", { data: { result: "FULFILLED" }, error: null });

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, RZP_PAYMENT),
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toEqual({ result: "FULFILLED", orderId: ORDER_ID });

    const apply = sb.rpcParams("apply_captured_payment");
    expect(apply).toMatchObject({
      p_razorpay_payment_id: RZP_PAYMENT,
      p_razorpay_order_id: RZP_ORDER,
      p_amount_paise: 20000,
      p_currency: "INR",
      p_provider_status: "captured",
    });
    expect(apply?.p_provider_created_at).toBe(new Date(1_755_000_000 * 1000).toISOString());
  });

  it("401s SIGNATURE_INVALID on a tampered signature before touching orders", async () => {
    seedGuards();

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, "pay_FORGED"),
        },
      })
    );
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "SIGNATURE_INVALID");
    expect(sb.callsFor("razorpay_orders")).toHaveLength(0);
    expect(sb.callsFor("apply_captured_payment")).toHaveLength(0);
  });

  it("404s an unknown provider order mapping", async () => {
    seedGuards();
    sb.onTable("razorpay_orders", { data: null, error: null });

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, RZP_PAYMENT),
        },
      })
    );
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("403s a payment belonging to another account", async () => {
    seedGuards();
    sb.onTable("razorpay_orders", {
      data: { local_order_id: ORDER_ID, expected_amount_paise: "20000", currency: "INR" },
      error: null,
    });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        purchaser_user_id: "88888888-8888-4888-8888-888888888888",
        amount_paise: "20000",
        currency: "INR",
      },
      error: null,
    });

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, RZP_PAYMENT),
        },
      })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(sb.callsFor("apply_captured_payment")).toHaveLength(0);
  });

  it("returns PROCESSING when the provider is unreachable and lets reconciliation finish", async () => {
    seedGuards();
    seedCapturedMapping();
    rzp.payments.fetch.mockRejectedValueOnce(new Error("upstream timeout"));

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, RZP_PAYMENT),
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.result).toBe("PROCESSING");
    expect(sb.callsFor("apply_captured_payment")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/razorpay (plan §12.8)", () => {
  const captureEvent = {
    event: "payment.captured",
    event_id: "evt_e2e_100",
    payload: {
      payment: {
        entity: {
          id: RZP_PAYMENT,
          order_id: RZP_ORDER,
          amount: 20000,
          currency: "INR",
          status: "captured",
          created_at: 1_755_000_000,
        },
      },
    },
  };

  function webhookRequest(rawBody: string, secret: string): ReturnType<typeof rawPost> {
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    return rawPost("/api/webhooks/razorpay", rawBody, {
      "x-razorpay-signature": signature,
      // Attacker-controlled: must NOT drive the dedupe key (V-12a).
      "x-razorpay-event-id": "evt_spoofed_header",
    });
  }

  it("durably stores then processes a valid capture asynchronously", async () => {
    resetWorld({ actor: null, festival: false });
    const rawBody = JSON.stringify(captureEvent);
    // The after() callback runs at the next await, so pre-seed BOTH reads:
    // (1) the durable insert returning the inbox id, (2) the processor's
    // single-row read that drives the state machine.
    sb.onTable("webhook_events", { data: { id: "wev-1" }, error: null }); // insert
    sb.onTable("webhook_events", {
      data: {
        id: "wev-1",
        event_type: "payment.captured",
        raw_body: captureEvent,
        processing_state: "RECEIVED",
        attempts: 0,
      },
      error: null,
    }); // processor read

    const res = await razorpayWebhookRoute(webhookRequest(rawBody, WHSEC_CURRENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    // Durability first: the inbox row carries the exact parsed body + hash.
    const insert = sb.callsFor("webhook_events").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      provider: "RAZORPAY",
      provider_event_id: "evt_e2e_100",
      event_type: "payment.captured",
      processing_state: "RECEIVED",
      signature_valid: true,
    });
    // Body-derived key wins over the spoofable header; header kept for forensics.
    expect((insert!.payload as Record<string, unknown>).headers_subset).toMatchObject({
      "x-razorpay-event-id": "evt_spoofed_header",
    });
    expect((insert!.payload as Record<string, unknown>).body_hash).toBe(
      createHash("sha256").update(rawBody).digest("hex")
    );

    // Async processing (after()). The processor's read was already pre-seeded
    // above: enqueueAfter starts the callback on the next microtask, so it has
    // consumed that seed by the time the route's await resolves. Re-seeding it
    // here would leave an unconsumed response behind.
    await flushAfter();

    const apply = sb.rpcParams("apply_captured_payment");
    expect(apply).toMatchObject({
      p_razorpay_payment_id: RZP_PAYMENT,
      p_razorpay_order_id: RZP_ORDER,
      p_amount_paise: 20000,
      p_currency: "INR",
      p_provider_status: "captured",
    });
    const updates = sb.callsFor("webhook_events").filter((c) => c.action === "update");
    const states = updates.map((u) => (u.payload as Record<string, unknown>).processing_state);
    expect(states[0]).toBe("PROCESSING"); // attempts bumped to 1
    expect(states[states.length - 1]).toBe("PROCESSED");
    expect(sb.pendingCount()).toBe(0);
  });

  it("accepts signatures from the previous rotation window secret", async () => {
    resetWorld({ actor: null, festival: false });
    const rawBody = JSON.stringify(captureEvent);
    sb.onTable("webhook_events", { data: { id: "wev-2" }, error: null });

    const res = await razorpayWebhookRoute(webhookRequest(rawBody, WHSEC_PREVIOUS));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    await flushAfter();
  });

  it("401s an invalid signature without storing anything", async () => {
    const rawBody = JSON.stringify(captureEvent);
    const req = webhookRequest(rawBody, WHSEC_CURRENT);
    req.headers.set("x-razorpay-signature", "deadbeef");

    const res = await razorpayWebhookRoute(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(sb.callsFor("webhook_events")).toHaveLength(0);
  });

  it("401s when the signature header is missing entirely", async () => {
    const rawBody = JSON.stringify(captureEvent);
    const sig = createHmac("sha256", WHSEC_CURRENT).update(rawBody).digest("hex");
    const req = rawPost("/api/webhooks/razorpay", rawBody);

    const res = await razorpayWebhookRoute(req);
    expect(sig).toBeTruthy(); // deterministic helper sanity
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("acknowledges duplicate deliveries without reprocessing", async () => {
    const rawBody = JSON.stringify(captureEvent);
    sb.onTable("webhook_events", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const res = await razorpayWebhookRoute(webhookRequest(rawBody, WHSEC_CURRENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    const flushed = await flushAfter();
    expect(flushed).toHaveLength(0); // nothing was enqueued for processing
  });

  it("503s when the durable insert fails so Razorpay retries", async () => {
    const rawBody = JSON.stringify(captureEvent);
    sb.onTable("webhook_events", {
      data: null,
      error: { message: "connection reset" },
    });

    const res = await razorpayWebhookRoute(webhookRequest(rawBody, WHSEC_CURRENT));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("413s oversized bodies", async () => {
    const huge = JSON.stringify({ event: "payment.captured", blob: "x".repeat(1024 * 1024 + 64) });
    const res = await razorpayWebhookRoute(webhookRequest(huge, WHSEC_CURRENT));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("400s malformed JSON even under a valid signature", async () => {
    const garbage = "{not-json";
    sb.onTable("webhook_events", { data: { id: "wev-3" }, error: null });

    const res = await razorpayWebhookRoute(webhookRequest(garbage, WHSEC_CURRENT));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
    await flushAfter();
    expect(sb.callsFor("apply_captured_payment")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/resend (plan §13.5)", () => {
  function svixHeaders(rawBody: string, msgId = "msg_e2e_1"): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(RESEND_SECRET_RAW, "utf8").toString("base64");
    const expected = createHmac("sha256", Buffer.from(key, "base64"))
      .update(`${msgId}.${timestamp}.${rawBody}`)
      .digest("base64");
    return {
      "svix-id": msgId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${expected}`,
    };
  }

  it("records a signed delivery event monotonically", async () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "re_e2e_9" } });

    const res = await resendWebhookRoute(
      rawPost("/api/webhooks/resend", rawBody, svixHeaders(rawBody))
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    expect(sb.rpcParams("record_email_event")).toMatchObject({
      p_resend_email_id: "re_e2e_9",
      p_resend_event_id: "msg_e2e_1",
      p_event_type: "email.delivered",
    });
  });

  it("accepts any svix-signed event type including bounces", async () => {
    const rawBody = JSON.stringify({ type: "email.bounced", data: { email_id: "re_e2e_b" } });

    const res = await resendWebhookRoute(
      rawPost("/api/webhooks/resend", rawBody, svixHeaders(rawBody))
    );
    expect(res.status).toBe(200);
    expect(sb.rpcParams("record_email_event")?.p_event_type).toBe("email.bounced");
  });

  it("401s a forged signature", async () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: {} });
    const headers = svixHeaders(rawBody);
    headers["svix-signature"] = "v1,Zm9yZ2Vk";

    const res = await resendWebhookRoute(rawPost("/api/webhooks/resend", rawBody, headers));
    expect(res.status).toBe(401);
    expect(sb.callsFor("record_email_event")).toHaveLength(0);
  });

  it("400s when svix headers are missing", async () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: {} });

    const res = await resendWebhookRoute(rawPost("/api/webhooks/resend", rawBody));
    expect(res.status).toBe(400);
  });

  it("503s when recording the event crashes", async () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "re_x" } });
    sb.failHardOnRpc("record_email_event");

    const res = await resendWebhookRoute(
      rawPost("/api/webhooks/resend", rawBody, svixHeaders(rawBody))
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});

describe("rate limiting on the verify route", () => {
  it("counts against the per-user order limiter", async () => {
    seedGuards();
    rateLimiter.reset("limited");

    const res = await verifyRoute(
      post("/api/checkout/razorpay/verify", {
        body: {
          razorpayOrderId: RZP_ORDER,
          razorpayPaymentId: RZP_PAYMENT,
          razorpaySignature: checkoutSignature(RZP_ORDER, RZP_PAYMENT),
        },
      })
    );
    expect(res.status).toBe(429);
    expectErrEnvelope(await json(res), "RATE_LIMITED");
    expect(rateLimiter.calls[0]).toMatchObject({ cls: "order" });
  });
});
