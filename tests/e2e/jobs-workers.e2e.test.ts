import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMBER_ID,
  ORDER_ID,
  PASS_ID,
  USER_ID,
  resetWorld,
  rzp,
  sb,
  userSb,
} from "./helpers/mocks";
import { json, rawPost, expectErrEnvelope } from "./helpers/requests";

// ISSUE_QR jobs exercise the real qr-service -> signing keys required.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.QR_ED25519_PRIVATE_KEY_BASE64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
process.env.QR_ED25519_PUBLIC_KEY_BASE64 = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");
process.env.QR_SIGNING_KEY_ID = "k1";

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

import { POST as jobsOutbox } from "@/app/api/jobs/outbox/route";
import { POST as jobsEmail } from "@/app/api/jobs/email/route";
import { POST as jobsReconcile } from "@/app/api/jobs/reconcile/route";
import { POST as jobsHoldReaper } from "@/app/api/jobs/hold-reaper/route";
import { POST as jobsExports } from "@/app/api/jobs/exports/route";
import { runOutboxDispatcher, runEmailDispatcher } from "@/workers/outbox-dispatcher";
import { runPaymentReconciler } from "@/workers/payment-reconciler";
import { runHoldReaper } from "@/workers/hold-reaper";

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: null });
});

describe("POST /api/jobs/* — QStash auth is mandatory (plan §10.4)", () => {
  const cases = [
    ["/api/jobs/outbox", jobsOutbox],
    ["/api/jobs/email", jobsEmail],
    ["/api/jobs/reconcile", jobsReconcile],
    ["//api/jobs/hold-reaper", jobsHoldReaper],
    ["/api/jobs/exports", jobsExports],
  ] as const;

  it.each(cases)("401s %s when no signing key is configured", async (_path, handler) => {
    const res = await handler(rawPost("/api/jobs/wake", "{}"));
    expect(res.status).toBe(401);
    const body = await json(res);
    expectErrEnvelope(body, "UNAUTHORIZED");
    expect(body.message).toMatch(/Job endpoint is not configured/i);
    // No worker side effects ran.
    expect(sb.callsFor("claim_outbox_jobs")).toHaveLength(0);
    expect(sb.callsFor("expire_holds_batch")).toHaveLength(0);
  });
});

describe("outbox dispatcher (plan §7.13)", () => {
  function seedClaim(jobs: Array<Record<string, unknown>>): void {
    sb.onRpc("claim_outbox_jobs", { data: jobs, error: null });
  }

  it("drives SEND_EMAIL / ISSUE_QR / INVALIDATE_CACHE to completion and skips unknown types", async () => {
    seedClaim([
      { id: "j-email", job_type: "SEND_EMAIL", aggregate_type: "order", aggregate_id: ORDER_ID, payload: { orderId: ORDER_ID, kind: "BASE_PASS" }, attempts: 0 },
      { id: "j-qr", job_type: "ISSUE_QR", aggregate_type: "delegate_pass", aggregate_id: PASS_ID, payload: { delegatePassId: PASS_ID }, attempts: 0 },
      { id: "j-cache", job_type: "INVALIDATE_CACHE", aggregate_type: "order", aggregate_id: ORDER_ID, payload: {}, attempts: 0 },
      { id: "j-legacy", job_type: "SUBMIT_REFUND", aggregate_type: "refund", aggregate_id: "r1", payload: {}, attempts: 0 },
    ]);
    // SEND_EMAIL chain
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        purchaser_user_id: USER_ID,
        public_order_code: "PO-EML01",
        amount_paise: "200000",
        currency: "INR",
      },
      error: null,
    });
    sb.onTable("profiles", { data: { display_name: "Aarav Sharma" }, error: null });
    const pronite = { name: "Pronite Pass", slug: "vip-delegate-pass", is_base_pass: false };
    sb.onTable(
      "order_lines",
      // SEND_EMAIL: the pass line
      {
        data: { id: "line-1", pass_product_id: "pp-1", description_snapshot: "Pronite Pass", pass_products: pronite },
        error: null,
      },
      // INVALIDATE_CACHE chain
      { data: [{ event_id: "evt-1" }, { event_id: null }], error: null }
    );
    sb.onTable("delegate_passes", {
      data: { id: PASS_ID, public_pass_code: "PP-EMAIL00001", pass_products: pronite },
      error: null,
    });
    const credentialRow = {
      id: "cred-x",
      jti: "6f1c2a64-9d1e-4c8b-9a51-1f3c2b7d8e90",
      entitlement_version: 1,
      not_before: "2026-01-01T00:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
      state: "ACTIVE",
      festival_id: "fest-1",
      delegate_passes: { public_pass_code: "PP-EMAIL00001", festivals: { slug: "pulse-2026" } },
    };
    sb.onTable(
      "qr_credentials",
      { data: { id: "cred-x", jti: credentialRow.jti }, error: null }, // email: issue (reuse)
      { data: credentialRow, error: null }, // email: build token
      { data: null, error: null }, // email: persist digest
      { data: { id: "cred-x", jti: credentialRow.jti }, error: null } // ISSUE_QR: reuse
    );
    sb.onTable("email_jobs", { data: null, error: null }); // upsert ignoreDuplicates

    const result = await runOutboxDispatcher({ batchSize: 25 });
    expect(result).toEqual({ processed: 4, failed: 0 });
    expect(sb.callsFor("complete_outbox_job")).toHaveLength(4);

    const upsert = sb.callsFor("email_jobs").find((c) => c.action === "upsert")!;
    const payload = upsert.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      logical_key: `order-confirmation:${ORDER_ID}`,
      template_name: "delegate-pass-confirmation",
      state: "PENDING",
    });
    // The pass email always carries the gate QR.
    const renderData = payload.render_data as Record<string, unknown>;
    expect(renderData.publicPassCode).toBe("PP-EMAIL00001");
    expect(String(renderData.qrDataUrl)).toMatch(/^data:image\/png;base64,/);
  });

  it("defers (fails + retries) a pass email instead of sending it without a QR", async () => {
    seedClaim([
      { id: "j-email", job_type: "SEND_EMAIL", aggregate_type: "order", aggregate_id: ORDER_ID, payload: { orderId: ORDER_ID, kind: "BASE_PASS" }, attempts: 0 },
    ]);
    sb.onTable("orders", {
      data: { id: ORDER_ID, purchaser_user_id: USER_ID, public_order_code: "PO-EML03", amount_paise: "200000", currency: "INR" },
      error: null,
    });
    sb.onTable("profiles", { data: { display_name: "Aarav Sharma" }, error: null });
    sb.onTable("order_lines", {
      data: { id: "line-1", pass_product_id: "pp-1", pass_products: { name: "Pronite Pass", slug: "vip-delegate-pass", is_base_pass: false } },
      error: null,
    });
    // No pass row found (by line or by user).

    const result = await runOutboxDispatcher({ batchSize: 25 });
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(sb.rpcParams("fail_outbox_job")).toMatchObject({ p_job_id: "j-email" });
    expect(sb.callsFor("email_jobs").filter((c) => c.action === "upsert")).toHaveLength(0);
  });

  it("routes EVENT-kind orders to the registration template and populates event details", async () => {
    seedClaim([
      { id: "j-email2", job_type: "SEND_EMAIL", aggregate_type: "order", aggregate_id: ORDER_ID, payload: { orderId: ORDER_ID, kind: "EVENT" }, attempts: 0 },
    ]);
    sb.onTable("orders", {
      data: { id: ORDER_ID, purchaser_user_id: USER_ID, public_order_code: "PO-EML02", amount_paise: "15000", currency: "INR" },
      error: null,
    });
    sb.onTable("profiles", { data: { display_name: "Aarav Sharma" }, error: null });
    sb.onTable("order_lines", {
      data: {
        id: "line-evt-1",
        event_id: "evt-100",
        description_snapshot: "RoboWars 2026",
        events: {
          id: "evt-100",
          name: "RoboWars 2026",
          starts_at: "2026-08-25T04:30:00Z",
          ends_at: "2026-08-25T07:30:00Z",
          venues: { name: "Main Auditorium", short_name: "Audi" },
        },
      },
      error: null,
    });
    sb.onTable("registrations", {
      data: {
        id: "reg-100",
        public_registration_code: "PR-ROBO01",
        team_name: "Cyber Knights",
        registration_mode: "TEAM",
      },
      error: null,
    });
    sb.onTable("registration_members", {
      data: [
        { user_id: USER_ID, role: "CAPTAIN" },
        { user_id: MEMBER_ID, role: "MEMBER" },
      ],
      error: null,
    });
    sb.onTable("profiles", {
      data: [
        { user_id: USER_ID, display_name: "Aarav Sharma" },
        { user_id: MEMBER_ID, display_name: "Priya Patel" },
      ],
      error: null,
    });
    sb.onTable("email_jobs", { data: null, error: null });
    sb.onTable("email_jobs", { data: null, error: null });

    await runOutboxDispatcher();
    const upserts = sb.callsFor("email_jobs").filter((c) => c.action === "upsert");
    expect(upserts.length).toBeGreaterThanOrEqual(1);

    const purchaserEmail = upserts.find((c) => (c.payload as Record<string, unknown>).logical_key === `order-confirmation:${ORDER_ID}`)!;
    expect((purchaserEmail.payload as Record<string, unknown>).template_name).toBe(
      "event-registration-confirmation"
    );
    const renderData = (purchaserEmail.payload as Record<string, unknown>).render_data as Record<string, unknown>;
    expect(renderData.eventName).toBe("RoboWars 2026");
    expect(renderData.venue).toBe("Main Auditorium");
    expect(renderData.publicRegistrationCode).toBe("PR-ROBO01");
    expect(renderData.teamName).toBe("Cyber Knights");
    expect(renderData.teamMembers).toEqual(["Aarav Sharma (Captain)", "Priya Patel"]);

    // Teammate email enqueued
    const teammateEmail = upserts.find((c) => (c.payload as Record<string, unknown>).logical_key === `team-member-registration:reg-100:${MEMBER_ID}`);
    expect(teammateEmail).toBeDefined();
    expect((teammateEmail?.payload as Record<string, unknown>).template_name).toBe("team-member-registration");
  });

  it("fails a job with backoff and never completes it when a handler throws", async () => {
    seedClaim([
      { id: "j-bad", job_type: "ISSUE_QR", aggregate_type: "delegate_pass", aggregate_id: PASS_ID, payload: { delegatePassId: PASS_ID }, attempts: 0 },
    ]);
    sb.onTable("qr_credentials", { data: null, error: null }); // no active credential
    sb.onTable("delegate_passes", { data: null, error: null }); // pass vanished

    const result = await runOutboxDispatcher();
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);

    const fail = sb.rpcParams("fail_outbox_job")!;
    expect(fail.p_job_id).toBe("j-bad");
    expect(String(fail.p_error)).toContain("Pass not found");
    expect(fail.p_retry_delay_seconds).toBe(30);
    expect(sb.callsFor("complete_outbox_job")).toHaveLength(0);
  });

  it("returns zeros without throwing when the claim itself fails", async () => {
    sb.onRpc("claim_outbox_jobs", { data: null, error: { message: "lock timeout" } });

    const result = await runOutboxDispatcher();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});

describe("email dispatcher (plan §13.4)", () => {
  it("parks jobs for retry when Resend is not configured — nothing is lost", async () => {
    sb.onRpc("claim_email_jobs", {
      data: [
        {
          id: "eml-1",
          to_email_snapshot: "student@example.com",
          template_name: "delegate-pass-confirmation",
          template_version: 1,
          render_data: {},
          idempotency_key: "email:x:v1",
          attempts: 0,
        },
      ],
      error: null,
    });

    const result = await runEmailDispatcher({ batchSize: 10 });
    // Redis AND Resend are unset in the offline test env: park, don't drop.
    expect(result.submitted).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);

    const update = sb.callsFor("email_jobs").find((c) => c.action === "update")!;
    expect(update.payload as Record<string, unknown>).toMatchObject({
      state: "RETRY_WAIT",
      last_error: "Resend not configured",
      lease_owner: null,
    });
  });

  it("claims zero jobs cleanly on an empty queue", async () => {
    sb.onRpc("claim_email_jobs", { data: [], error: null });

    const result = await runEmailDispatcher();
    expect(result).toEqual({ submitted: 0, failed: 0, dead: 0 });
  });
});

describe("payment reconciler (plan §12.15)", () => {
  const captureBody = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_recon_1",
          order_id: "order_R1",
          amount: 15000,
          currency: "INR",
          status: "captured",
          created_at: 1755000000,
        },
      },
    },
  };

  it("applies captured payments found on uncertain orders and re-drives stuck webhooks", async () => {
    sb.onTable("orders", {
      data: [
        {
          id: "o-local",
          checkout_state: "AWAITING_PAYMENT",
          hold_expires_at: null,
          razorpay_orders: { razorpay_order_id: "order_R1" },
        },
      ],
      error: null,
    });
    rzp.orders.fetchPayments.mockResolvedValueOnce({
      items: [{ id: "pay_recon_1", status: "captured", amount: 15000, currency: "INR", created_at: 1755000000 }],
    });
    sb.onRpc("apply_captured_payment", { data: { result: "FULFILLED" }, error: null });
    // retryStuckWebhookEvents
    sb.onTable("webhook_events", { data: [{ id: "w-stuck" }], error: null });
    sb.onTable("webhook_events", { data: [], error: null }); // no abandoned PROCESSING claims
    sb.onTable("webhook_events", {
      data: { id: "w-stuck", event_type: "payment.captured", raw_body: captureBody, processing_state: "RECEIVED", attempts: 0 },
      error: null,
    });
    sb.onTable("webhook_events", { data: null, error: null }); // PROCESSING bump
    sb.onRpc("apply_captured_payment", { data: { result: "FULFILLED" }, error: null });
    sb.onTable("webhook_events", { data: null, error: null }); // PROCESSED
    sb.onTable("webhook_events", { data: null, error: null }); // DEAD sweep

    const result = await runPaymentReconciler();
    expect(result.resolvedOrders).toBe(1);
    expect(result.retriedWebhooks).toBe(1);

    const applies = sb.callsFor("apply_captured_payment");
    expect(applies[0].params?.p_razorpay_payment_id).toBe("pay_recon_1");
    expect(applies[1].params?.p_razorpay_payment_id).toBe("pay_recon_1"); // via webhook replay
    const updates = sb.callsFor("webhook_events").filter((c) => c.action === "update");
    const states = updates.map((u) => (u.payload as Record<string, unknown>).processing_state);
    expect(states).toContain("PROCESSING");
    expect(states[states.length - 1]).toBe("DEAD"); // poison sweep ran last
  });

  it("classifies everything when there is nothing to do", async () => {
    sb.onTable("orders", { data: [], error: null });
    sb.onTable("webhook_events", { data: [], error: null });
    sb.onTable("webhook_events", { data: null, error: null }); // DEAD sweep

    const result = await runPaymentReconciler();
    // Every outcome class is reported, so a refund obligation can never hide
    // inside a generic "resolved" count.
    expect(result).toEqual({
      resolvedOrders: 0,
      lateDiscoveries: 0,
      refundRequired: 0,
      amountMismatch: 0,
      orphans: 0,
      noHold: 0,
      providerErrors: 0,
      retriedWebhooks: 0,
    });
    expect(rzp.payments.fetch).not.toHaveBeenCalled();
  });

  it("skips uncertain orders whose provider fetch fails and retries next cycle", async () => {
    sb.onTable("orders", {
      data: [{ id: "o2", checkout_state: "PROVISIONING_PROVIDER", hold_expires_at: null, razorpay_orders: { razorpay_order_id: "order_R2" } }],
      error: null,
    });
    rzp.orders.fetchPayments.mockRejectedValueOnce(new Error("gateway down"));
    sb.onTable("webhook_events", { data: [], error: null });
    sb.onTable("webhook_events", { data: null, error: null });

    const result = await runPaymentReconciler();
    expect(result.resolvedOrders).toBe(0);
    expect(sb.callsFor("apply_captured_payment")).toHaveLength(0);
  });
});

describe("hold reaper (plan §12.9)", () => {
  it("expires stale holds and refreshes availability for touched events", async () => {
    sb.onRpc("expire_holds_batch", {
      data: { expired: 2, inventory: [{ eventId: "evt-1" }] },
      error: null,
    });

    const result = await runHoldReaper({ batchSize: 200 });
    expect(result.expired).toBe(2);
    expect(sb.rpcParams("expire_holds_batch")?.p_batch_size).toBe(200);
  });

  it("degrades safely when the batch RPC errors", async () => {
    sb.onRpc("expire_holds_batch", { data: null, error: { message: "vacuum in progress" } });

    const result = await runHoldReaper();
    expect(result.expired).toBe(0);
    expect(userSb.pendingCount()).toBe(0);
  });

  it("reports zero when nothing has expired", async () => {
    sb.onRpc("expire_holds_batch", { data: { expired: 0, inventory: [] }, error: null });

    const result = await runHoldReaper();
    expect(result.expired).toBe(0);
  });
});
