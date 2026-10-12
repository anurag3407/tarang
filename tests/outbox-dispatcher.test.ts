import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockSupabase, ok } from "./helpers/supabase-mock";

const sb = new MockSupabase();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => sb,
}));

// Stub side-effect modules the dispatcher imports at module load.
vi.mock("@/services/qr-service", () => ({
  issueQrCredential: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/redis/availability", () => ({
  invalidateAvailability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/repositories/public-content", () => ({
  getCurrentFestivalId: vi.fn().mockResolvedValue("fest-1"),
}));
vi.mock("@/lib/razorpay/client", () => ({
  cancelRazorpayOrder: vi.fn().mockResolvedValue("noop:not_cancellable"),
}));

import { cancelRazorpayOrder } from "@/lib/razorpay/client";
import { runOutboxDispatcher } from "@/workers/outbox-dispatcher";

beforeEach(() => {
  sb.calls = [];
  vi.clearAllMocks();
});

describe("outbox dispatcher — refund jobs are no longer claimed or executed", () => {
  it("does not claim SUBMIT_REFUND jobs", async () => {
    sb.onRpc("claim_outbox_jobs", ok([]));

    await runOutboxDispatcher();

    const claim = sb.rpcParams("claim_outbox_jobs");
    const jobTypes = claim?.p_job_types as string[];
    expect(jobTypes).not.toContain("SUBMIT_REFUND");
    expect(jobTypes).toEqual(
      expect.arrayContaining(["SEND_EMAIL", "ISSUE_QR", "INVALIDATE_CACHE"])
    );
  });

  it("completes jobs it processes", async () => {
    sb.onRpc("claim_outbox_jobs", ok([
      {
        id: "job-1",
        job_type: "INVALIDATE_CACHE",
        aggregate_type: "order",
        aggregate_id: "order-1",
        payload: { orderId: "order-1" },
        attempts: 0,
      },
    ]));
    sb.onTable("order_lines", ok([{ event_id: "evt-1" }]));
    sb.onRpc("complete_outbox_job", ok(null));

    const result = await runOutboxDispatcher();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(sb.rpcParams("complete_outbox_job")?.p_job_id).toBe("job-1");
  });

  it("claims and executes CANCEL_RAZORPAY_ORDER jobs", async () => {
    sb.onRpc("claim_outbox_jobs", ok([
      {
        id: "job-cancel-1",
        job_type: "CANCEL_RAZORPAY_ORDER",
        aggregate_type: "order",
        aggregate_id: "order-1",
        payload: { orderId: "order-1", razorpayOrderId: "order_rzp_1" },
        attempts: 0,
      },
    ]));
    sb.onRpc("complete_outbox_job", ok(null));

    const result = await runOutboxDispatcher();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(cancelRazorpayOrder).toHaveBeenCalledWith("order_rzp_1");
  });
});
