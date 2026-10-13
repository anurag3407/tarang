import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { emailProvider, EMAIL_PROVIDER_LABEL } from "@/lib/env";
import { enqueueOrderEmails, runEmailDispatcher } from "@/workers/outbox-dispatcher";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await guardAdminMutation(req, "admin.access");
    const { id: orderId } = await ctx.params;

    const sb = createServiceRoleClient();
    const { data: order } = await sb
      .from("orders")
      .select("id, kind, checkout_state")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return apiError(req, "NOT_FOUND", "Order not found");

    if (order.checkout_state !== "FULFILLED") {
      return apiError(req, "BAD_REQUEST", `Cannot send confirmation email for order with state '${order.checkout_state}'. Only FULFILLED orders receive emails.`);
    }

    // 1. Ensure email job is enqueued with latest order data
    await enqueueOrderEmails(orderId, order.kind, { refresh: true });

    // 2. Reset email job state to PENDING and give it a fresh idempotency key
    const freshIdempotencyKey = `email:order-confirmation:${orderId}:resend:${Date.now()}`;
    await sb
      .from("email_jobs")
      .update({
        state: "PENDING",
        attempts: 0,
        last_error: null,
        lease_owner: null,
        lease_expires_at: null,
        idempotency_key: freshIdempotencyKey,
        updated_at: new Date().toISOString(),
      })
      .eq("logical_key", `order-confirmation:${orderId}`);

    // 3. Immediately trigger dispatcher
    const res = await runEmailDispatcher({ batchSize: 5 });

    // 4. Read back the updated job to give accurate feedback
    const { data: job } = await sb
      .from("email_jobs")
      .select("state, last_error, resend_email_id, to_email_snapshot, submitted_at")
      .eq("logical_key", `order-confirmation:${orderId}`)
      .maybeSingle();

    if (!job) {
      return apiError(req, "NOT_FOUND", "No email job could be created for this order (verify this order is a VIP/Delegate pass or Event registration).");
    }

    if (job.state === "SUBMITTED") {
      return apiSuccess(req, {
        message: `Email successfully sent to ${job.to_email_snapshot}`,
        resendEmailId: job.resend_email_id,
        submittedAt: job.submitted_at,
        result: res,
      });
    }

    if (job.last_error) {
      return apiError(
        req,
        "UPSTREAM_ERROR",
        `${EMAIL_PROVIDER_LABEL[emailProvider()]} Error: ${job.last_error} (Recipient: ${job.to_email_snapshot})`
      );
    }

    return apiSuccess(req, {
      message: `Email queued for delivery to ${job.to_email_snapshot}`,
      jobState: job.state,
      result: res,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
