import type { NextRequest } from "next/server";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/razorpay/client";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bodyHash, processRazorpayWebhookEvent } from "@/services/payment-service";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/razorpay (plan §12.8).
 *
 * Order of operations is load-bearing:
 *   1. Preserve the exact raw body.
 *   2. Verify X-Razorpay-Signature (current secret, then previous rotation).
 *   3. Durably insert the webhook inbox row (deduped by provider event id).
 *   4. Only then return 2xx; processing happens asynchronously via after().
 *
 * If the DB insert fails we return non-2xx so Razorpay retries. No IP
 * allowlist, no browser challenge — signature + body limit are the trust.
 */
export async function POST(req: NextRequest) {
  const log = logger();
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (rawBody.length > 1024 * 1024) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  const e = env();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const secrets = [
    e.RAZORPAY_WEBHOOK_SECRET_CURRENT,
    e.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
  ].filter(Boolean) as string[];
  if (secrets.length === 0) {
    log.warn("razorpay webhook secret not configured");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const signatureValid = secrets.some((secret) =>
    verifyWebhookSignature(rawBody, signature, secret)
  );
  if (!signatureValid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let parsed: { event?: string; payload?: unknown; event_id?: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const eventType = parsed.event ?? "unknown";
  // Dedupe key must be covered by the HMAC, so derive it from the verified
  // body (Razorpay includes `event_id` in every webhook payload). The
  // x-razorpay-event-id header is attacker-controllable and must not be
  // trusted for idempotency (V-12a); it is only recorded for forensics.
  const providerEventId =
    typeof parsed.event_id === "string" && parsed.event_id.trim().length > 0
      ? parsed.event_id.trim()
      : bodyHash(rawBody);
  const headerEventId = req.headers.get("x-razorpay-event-id");

  const sb = createServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("webhook_events")
    .insert({
      provider: "RAZORPAY",
      provider_event_id: providerEventId,
      event_type: eventType,
      raw_body: parsed,
      body_hash: bodyHash(rawBody),
      headers_subset: {
        "x-razorpay-event-id": headerEventId ?? null,
        "content-type": req.headers.get("content-type"),
      },
      signature_valid: true,
      processing_state: "RECEIVED",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      // Duplicate delivery: already durably stored. Acknowledge.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    // DB unavailable: non-2xx so Razorpay retries (plan §12.8.6).
    log.error({ err: error.message }, "webhook insert failed");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  // Process asynchronously after the response; idempotent by event id.
  const webhookEventId = inserted!.id as string;
  after(async () => {
    try {
      await processRazorpayWebhookEvent(webhookEventId);
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err), webhookEventId },
        "webhook processing failed (will retry)"
      );
    }
  });

  return NextResponse.json({ ok: true });
}
