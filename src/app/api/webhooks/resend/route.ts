import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Svix-style tolerance: a signed delivery older than this is a replay.
const MAX_AGE_SECONDS = 5 * 60;

/**
 * POST /api/webhooks/resend (plan §13.5).
 *
 * Resend webhooks are svix-signed: HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${rawBody}` with the base64 secret after the
 * `whsec_` prefix. We verify, dedupe by event id, and update delivery state
 * monotonically via record_email_event. "Resend accepted" is never treated
 * as delivered.
 */
function verifySvixSignature(
  rawBody: string,
  secret: string,
  msgId: string,
  timestamp: string,
  signatureHeader: string
): boolean {
  const keyMaterial = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyMaterial, "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key)
    .update(`${msgId}.${timestamp}.${rawBody}`)
    .digest("base64");

  // Header may carry multiple space-separated signatures (v1,...).
  const provided = signatureHeader
    .split(" ")
    .map((part) => part.split(",").pop() ?? "")
    .filter(Boolean);
  return provided.some((sig) => {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function POST(req: NextRequest) {
  const log = logger();
  const e = env();
  if (!e.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (rawBody.length > 512 * 1024) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  const msgId = req.headers.get("svix-id") ?? "";
  const timestamp = req.headers.get("svix-timestamp") ?? "";
  const signatureHeader = req.headers.get("svix-signature") ?? "";
  if (!msgId || !timestamp || !signatureHeader) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ts = Number.parseInt(timestamp, 10);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_AGE_SECONDS
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (
    !verifySvixSignature(
      rawBody,
      e.RESEND_WEBHOOK_SECRET,
      msgId,
      timestamp,
      signatureHeader
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let parsed: { type?: string; data?: { email_id?: string } };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const eventType = parsed.type ?? "unknown";
  const resendEmailId = parsed.data?.email_id ?? "";

  const sb = createServiceRoleClient();
  try {
    await sb.rpc("record_email_event", {
      p_resend_email_id: resendEmailId,
      p_resend_event_id: msgId,
      p_event_type: eventType,
      p_metadata: {},
    });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "resend webhook processing failed"
    );
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
