import "server-only";
import { randomUUID } from "node:crypto";
import { renderEmailHtml, renderEmailText } from "@/emails/render";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";
import { env, emailProvider, EMAIL_PROVIDER_LABEL } from "@/lib/env";
import { getEmailSender } from "@/lib/email/send";
import { issueQrCredential } from "@/services/qr-service";
import { isPronitePassProduct } from "@/lib/pronite-pass";
import { cancelRazorpayOrder } from "@/lib/razorpay/client";
import { invalidateAvailability } from "@/lib/redis/availability";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { formatDateIST, formatTimeIST, formatDateTimeIST } from "@/lib/dates";
import { renderTemplate, type TemplateData } from "@/emails/templates";
import type { TemplateName } from "@/domain/email";

/**
 * Outbox dispatcher (plan §7.13, §9.5.5).
 *
 * Claims durable outbox jobs (FOR UPDATE SKIP LOCKED) and performs their
 * side effects idempotently. QStash is at-least-once, so every handler must
 * be safe to run repeatedly. The DB is job truth; this worker only executes.
 */

const OWNER = `outbox:${process.pid}:${randomUUID().slice(0, 8)}`;

type OutboxJob = {
  id: string;
  job_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export async function runOutboxDispatcher(opts: { batchSize?: number } = {}): Promise<{
  processed: number;
  failed: number;
}> {
  const log = logger();
  const sb = createServiceRoleClient();

  const { data: jobs, error } = await sb.rpc("claim_outbox_jobs", {
    p_job_types: ["SEND_EMAIL", "ISSUE_QR", "INVALIDATE_CACHE", "SHEETS_SYNC", "CANCEL_RAZORPAY_ORDER"],
    p_owner: OWNER,
    p_batch_size: opts.batchSize ?? 20,
    p_lease_seconds: 120,
  });
  if (error) {
    log.error({ err: error.message }, "outbox claim failed");
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as OutboxJob[]) {
    try {
      await handleJob(job);
      await sb.rpc("complete_outbox_job", { p_job_id: job.id });
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message, jobId: job.id, type: job.job_type }, "outbox job failed");
      await sb.rpc("fail_outbox_job", {
        p_job_id: job.id,
        p_error: message,
        p_retry_delay_seconds: 30,
      });
    }
  }

  return { processed, failed };
}

async function handleJob(job: OutboxJob): Promise<void> {
  const sb = createServiceRoleClient();
  const log = logger();

  switch (job.job_type) {
    case "SEND_EMAIL": {
      // Translate the order-fulfillment outbox job into a durable email job.
      // The email dispatcher does the actual Resend send. Idempotent via
      // email_jobs.logical_key.
      const orderId = String(job.payload.orderId ?? job.aggregate_id);
      const kind = String(job.payload.kind ?? "");
      await enqueueOrderEmails(orderId, kind);

      // Trigger email dispatcher right away so user receives email immediately
      try {
        await runEmailDispatcher({ batchSize: 5 });
      } catch (dispErr) {
        log.warn(
          { err: dispErr instanceof Error ? dispErr.message : String(dispErr), orderId },
          "immediate email dispatch failed, will retry"
        );
      }

      // Concurrently / asynchronously mirror order to Google Sheets if enabled
      if (env().GOOGLE_SHEETS_ENABLED) {
        try {
          const { syncOrderToSpreadsheets } = await import("@/services/sheets-service");
          await syncOrderToSpreadsheets(orderId);
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err), orderId }, "sheets sync failed");
        }
      }
      return;
    }

    case "SHEETS_SYNC": {
      const orderId = String(job.payload.orderId ?? job.aggregate_id);
      if (env().GOOGLE_SHEETS_ENABLED) {
        const { syncOrderToSpreadsheets } = await import("@/services/sheets-service");
        await syncOrderToSpreadsheets(orderId);
      }
      return;
    }

    case "ISSUE_QR": {
      const delegatePassId = String(job.payload.delegatePassId ?? job.aggregate_id);
      await issueQrCredential(delegatePassId);
      return;
    }

    case "INVALIDATE_CACHE": {
      const festivalId = await getCurrentFestivalId();
      if (!festivalId) return;
      // Order fulfillment changes availability for the order's event(s).
      const { data: lines } = await sb
        .from("order_lines")
        .select("event_id")
        .eq("order_id", job.aggregate_id);
      for (const line of lines ?? []) {
        if (line.event_id) {
          await invalidateAvailability(festivalId, line.event_id);
        }
      }
      return;
    }

    case "CANCEL_RAZORPAY_ORDER": {
      // Best-effort provider-side cancel for locally-cancelled/expired
      // orders. Idempotent: the provider answers 400 (already paid or
      // cancelled) once a payment session is terminal, which the handler
      // treats as success.
      const razorpayOrderId = String(job.payload.razorpayOrderId ?? "");
      if (!razorpayOrderId) return;
      const outcome = await cancelRazorpayOrder(razorpayOrderId);
      log.debug({ razorpayOrderId, outcome }, "razorpay order cancelled");
      return;
    }

    default:
      // Unknown job type (including legacy SUBMIT_REFUND — refunds are now
      // handled manually by the organizers): complete to avoid infinite retry.
      return;
  }
}

/** Create email jobs for a fulfilled order (idempotent by logical_key). */
export async function enqueueOrderEmails(orderId: string, kind: string): Promise<void> {
  const sb = createServiceRoleClient();

  const { data: order } = await sb
    .from("orders")
    .select("id, purchaser_user_id, public_order_code, amount_paise, currency")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const { data: profile } = await sb
    .from("profiles")
    .select("display_name")
    .eq("user_id", order.purchaser_user_id)
    .maybeSingle();

  const { data: user } = await sb.auth.admin.getUserById(order.purchaser_user_id);
  const toEmail = user.user?.email;
  if (!toEmail) return;

  const { data: payment } = await sb
    .from("payments")
    .select("razorpay_payment_id")
    .eq("local_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const providerReference = payment?.razorpay_payment_id ?? undefined;

  const templateName =
    kind === "BASE_PASS" ? "delegate-pass-confirmation" : "event-registration-confirmation";

  let qrDataUrl: string | undefined;
  let publicPassCode: string | undefined;
  let productName: string | undefined;
  let eventName: string | undefined;
  let eventDateTime: string | undefined;
  let venue: string | undefined;
  let teamName: string | undefined;
  let teamMembers: string[] | undefined;
  let publicRegistrationCode: string | undefined;

  if (kind === "BASE_PASS") {
    // 1. Fetch the exact pass product from the order line
    const { data: line } = await sb
      .from("order_lines")
      .select("id, pass_product_id, description_snapshot, pass_products ( id, name, slug, is_base_pass )")
      .eq("order_id", orderId)
      .maybeSingle();

    const product = (Array.isArray(line?.pass_products) ? line?.pass_products[0] : line?.pass_products) as
      | { id?: string; name?: string; slug?: string; is_base_pass?: boolean }
      | null;

    // 2. Fetch the corresponding delegate pass
    let pass: { id: string; public_pass_code: string; pass_products?: unknown } | null = null;
    if (line?.id) {
      const { data: passByLine } = await sb
        .from("delegate_passes")
        .select("id, public_pass_code, pass_products ( name, slug, is_base_pass )")
        .eq("source_order_line_id", line.id)
        .eq("state", "ACTIVE")
        .maybeSingle();
      pass = passByLine;
    }

    if (!pass) {
      const { data: passByUser } = await sb
        .from("delegate_passes")
        .select("id, public_pass_code, pass_products ( name, slug, is_base_pass )")
        .eq("user_id", order.purchaser_user_id)
        .eq("state", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pass = passByUser;
    }

    const p = (Array.isArray(pass?.pass_products) ? pass?.pass_products[0] : pass?.pass_products) as
      | { name?: string; slug?: string; is_base_pass?: boolean }
      | null;

    const prodName = product?.name ?? p?.name ?? line?.description_snapshot ?? "Pronite Pass";
    const prodSlug = product?.slug ?? p?.slug ?? "";
    const isBase = product?.is_base_pass ?? p?.is_base_pass ?? false;

    // The confirmation email (with the gate QR) is for the Pronite Pass only.
    if (!isPronitePassProduct({ slug: prodSlug, is_base_pass: isBase, name: prodName })) {
      logger().info({ orderId, prodName, prodSlug, isBase }, "skipping confirmation email for retired basic pass");
      return;
    }

    if (pass) {
      publicPassCode = pass.public_pass_code;
      productName = prodName;

      // Embed the gate QR in the confirmation email
      try {
        const { generatePassQrDataUrl } = await import("@/services/qr-service");
        const qrRes = await generatePassQrDataUrl(pass.id);
        qrDataUrl = qrRes.dataUrl;
      } catch (qrErr) {
        logger().warn({ err: qrErr, passId: pass.id }, "could not generate QR data URL for email");
      }
    } else {
      productName = prodName;
    }
  } else {
    // 1. Fetch order line and joined event & venue details
    const { data: line } = await sb
      .from("order_lines")
      .select("id, event_id, description_snapshot, team_size, registration_mode_snapshot, events ( id, name, slug, starts_at, ends_at, category_id, venue_id, categories ( name ), venues ( name, short_name ) )")
      .eq("order_id", orderId)
      .maybeSingle();

    const ev = (Array.isArray(line?.events) ? line?.events[0] : line?.events) as {
      id?: string;
      name?: string;
      slug?: string;
      starts_at?: string;
      ends_at?: string;
      venues?: { name?: string; short_name?: string } | { name?: string; short_name?: string }[];
    } | null;

    const ven = (Array.isArray(ev?.venues) ? ev?.venues[0] : ev?.venues) as { name?: string; short_name?: string } | null;

    eventName = ev?.name ?? line?.description_snapshot ?? "TARANG Event";
    venue = ven?.name ?? ven?.short_name ?? undefined;

    if (ev?.starts_at) {
      const startDateStr = formatDateIST(ev.starts_at);
      const startTimeStr = formatTimeIST(ev.starts_at);
      if (ev.ends_at) {
        const endDateStr = formatDateIST(ev.ends_at);
        const endTimeStr = formatTimeIST(ev.ends_at);
        if (startDateStr === endDateStr) {
          eventDateTime = `${startDateStr}, ${startTimeStr} – ${endTimeStr} IST`;
        } else {
          eventDateTime = `${formatDateTimeIST(ev.starts_at)} – ${formatDateTimeIST(ev.ends_at)} IST`;
        }
      } else {
        eventDateTime = `${formatDateTimeIST(ev.starts_at)} IST`;
      }
    }

    // 2. Fetch registration details
    let registration: {
      id: string;
      public_registration_code: string;
      team_name: string | null;
      registration_mode: string;
    } | null = null;

    if (line?.id) {
      const { data: regByLine } = await sb
        .from("registrations")
        .select("id, public_registration_code, team_name, registration_mode")
        .eq("order_line_id", line.id)
        .maybeSingle();
      registration = regByLine;
    }

    if (!registration && (line?.event_id || ev?.id)) {
      const { data: regByUser } = await sb
        .from("registrations")
        .select("id, public_registration_code, team_name, registration_mode")
        .eq("event_id", line?.event_id ?? ev?.id)
        .eq("owner_user_id", order.purchaser_user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      registration = regByUser;
    }

    if (registration) {
      publicRegistrationCode = registration.public_registration_code;
      teamName = registration.team_name ?? undefined;

      // 3. Fetch registration members
      const { data: members } = await sb
        .from("registration_members")
        .select("user_id, role")
        .eq("registration_id", registration.id);

      if (members && members.length > 0) {
        const userIds = members.map((m) => m.user_id);
        const { data: memberProfiles } = await sb
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);

        const profileMap = new Map(
          (memberProfiles ?? []).map((p) => [p.user_id, p.display_name])
        );

        const memberNames = members.map((m) => {
          const name = profileMap.get(m.user_id) ?? "Participant";
          return m.role === "CAPTAIN" ? `${name} (Captain)` : name;
        });
        if (memberNames.length > 0) {
          teamMembers = memberNames;
        }

        // Notify co-registered team members
        for (const m of members) {
          if (m.user_id !== order.purchaser_user_id) {
            try {
              const { data: memberUser } = await sb.auth.admin.getUserById(m.user_id);
              const memberEmail = memberUser.user?.email;
              if (memberEmail) {
                const memberDisplayName = profileMap.get(m.user_id) ?? "Participant";
                await sb.from("email_jobs").upsert(
                  {
                    logical_key: `team-member-registration:${registration.id}:${m.user_id}`,
                    recipient_user_id: m.user_id,
                    to_email_snapshot: memberEmail,
                    template_name: "team-member-registration",
                    template_version: 1,
                    render_data: {
                      displayName: memberDisplayName,
                      eventName,
                      teamName,
                      eventDateTime,
                      venue,
                      teamMembers: memberNames,
                      publicRegistrationCode,
                      publicOrderCode: order.public_order_code,
                    },
                    idempotency_key: `email:team-member-registration:${registration.id}:${m.user_id}:v1`,
                    state: "PENDING",
                  },
                  { onConflict: "logical_key", ignoreDuplicates: true }
                );
              }
            } catch (memberErr) {
              logger().warn(
                { err: memberErr instanceof Error ? memberErr.message : String(memberErr), memberUserId: m.user_id },
                "failed to enqueue team member registration email"
              );
            }
          }
        }
      }
    }
  }

  const renderData: Record<string, unknown> = {
    displayName: profile?.display_name ?? "Participant",
    publicOrderCode: order.public_order_code,
    amountPaise: Number(order.amount_paise),
    currency: order.currency,
    ...(providerReference ? { providerReference } : {}),
    ...(publicPassCode ? { publicPassCode } : {}),
    ...(productName ? { productName } : {}),
    ...(qrDataUrl ? { qrDataUrl } : {}),
    ...(eventName ? { eventName } : {}),
    ...(eventDateTime ? { eventDateTime } : {}),
    ...(venue ? { venue } : {}),
    ...(teamName ? { teamName } : {}),
    ...(teamMembers && teamMembers.length > 0 ? { teamMembers } : {}),
    ...(publicRegistrationCode ? { publicRegistrationCode } : {}),
  };

  await sb.from("email_jobs").upsert(
    {
      logical_key: `order-confirmation:${orderId}`,
      recipient_user_id: order.purchaser_user_id,
      to_email_snapshot: toEmail,
      template_name: templateName,
      template_version: 1,
      render_data: renderData,
      idempotency_key: `email:order-confirmation:${orderId}:v1`,
      state: "PENDING",
    },
    { onConflict: "logical_key", ignoreDuplicates: true }
  );
}

/**
 * Email dispatcher (plan §13.4).
 *
 * Claims email_jobs leases, renders the template, and submits to the active
 * provider (Resend, or Amazon SES when USE_SES=true) — Resend with a stable
 * idempotency key (job id + template version). Retry classification:
 * network/429/5xx retry with backoff; deterministic 4xx dead-letter.
 * Transient failures retry at most MAX_EMAIL_ATTEMPTS times, then dead-letter
 * too — a permanently failing email must not retry forever and burn credits.
 */
export async function runEmailDispatcher(opts: { batchSize?: number } = {}): Promise<{
  submitted: number;
  failed: number;
  dead: number;
}> {  const log = logger();
  const sb = createServiceRoleClient();
  const owner = `email:${process.pid}:${randomUUID().slice(0, 8)}`;

  const { data: jobs, error } = await sb.rpc("claim_email_jobs", {
    p_owner: owner,
    p_batch_size: opts.batchSize ?? 10,
    p_lease_seconds: 120,
  });
  if (error) {
    log.error({ err: error.message }, "email claim failed");
    return { submitted: 0, failed: 0, dead: 0 };
  }

  const e = env();
  const sender = getEmailSender();
  const providerLabel = EMAIL_PROVIDER_LABEL[sender?.provider ?? emailProvider()];
  let submitted = 0;
  let failed = 0;
  let dead = 0;

  for (const job of (jobs ?? []) as EmailJob[]) {
    try {
      if (!sender) {
        // No provider configured: park for retry rather than lose the job.
        // Deliberately exempt from the attempts cap — the failure is
        // environmental (missing config), not a property of this email.
        await setEmailState(job.id, "RETRY_WAIT", `${providerLabel} not configured`);
        failed++;
        continue;
      }

      // Skip suppressed recipients (dead-letter, don't retry).
      const { data: suppressed } = await sb
        .from("email_suppressions")
        .select("email")
        .eq("email", job.to_email_snapshot)
        .maybeSingle();
      if (suppressed) {
        await setEmailState(job.id, "SUPPRESSED", "recipient suppressed");
        dead++;
        continue;
      }

      const rawQrDataUrl = (job.render_data as Record<string, unknown> | null)?.qrDataUrl;
      let qrBuffer: Buffer | undefined;

      if (rawQrDataUrl && typeof rawQrDataUrl === "string") {
        const base64Data = rawQrDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
        qrBuffer = Buffer.from(base64Data, "base64");
      }

      const templateData = buildTemplateData(job);
      // Inline (CID) images: data: URIs are stripped by Gmail and others, and
      // CID images still show when a client blocks remote images.
      const attachments: { content: Buffer; filename: string; contentType: string; contentId: string }[] = [];
      if (qrBuffer) {
        attachments.push({ content: qrBuffer, filename: "gate-qr.png", contentType: "image/png", contentId: "gate-qr-code" });
        templateData.qrDataUrl = "cid:gate-qr-code";
      }
      if (job.template_name === "delegate-pass-confirmation") {
        for (const [key, file] of [
          ["ticket-art", "ticket-art.png"],
          ["ticket-perf", "ticket-perf.png"],
        ] as const) {
          const content = await readTicketAsset(file);
          // Without the file on disk the template falls back to the hosted copy.
          if (!content) continue;
          attachments.push({ content, filename: file, contentType: "image/png", contentId: key });
          if (key === "ticket-art") templateData.ticketArtUrl = `cid:${key}`;
          else templateData.ticketPerfUrl = `cid:${key}`;
        }
      }

      const { subject, element } = renderTemplate(
        job.template_name as TemplateName,
        templateData
      );
      const html = `<!DOCTYPE html>${renderEmailHtml(element)}`;
      const text = renderEmailText(html);

      const result = await sender.send(
        {
          from: e.EMAIL_FROM,
          to: job.to_email_snapshot,
          subject,
          html,
          text,
          ...(e.EMAIL_REPLY_TO ? { replyTo: e.EMAIL_REPLY_TO } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
        { idempotencyKey: job.idempotency_key }
      );

      if (!result.ok) {
        const status = result.statusCode;
        const message = result.message;
        log.error(
          { err: message, statusCode: status, to: job.to_email_snapshot, from: e.EMAIL_FROM, jobId: job.id },
          `${providerLabel} rejected email send request`
        );
        // Deterministic client errors (except 429) dead-letter.
        const deterministic =
          status !== undefined && status >= 400 && status < 500 && status !== 429;
        if (deterministic) {
          await setEmailState(job.id, "DEAD", message);
          dead++;
        } else if (await setEmailRetryOrDead(job, message)) {
          dead++;
        } else {
          failed++;
        }
        continue;
      }

      log.info(
        { provider: sender.provider, messageId: result.id, to: job.to_email_snapshot, from: e.EMAIL_FROM, jobId: job.id },
        `Email accepted by ${providerLabel} successfully`
      );

      await sb
        .from("email_jobs")
        .update({
          state: "SUBMITTED",
          // Provider message id (column predates SES support).
          resend_email_id: result.id,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id);
      submitted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message, jobId: job.id }, "email job failed");
      const gaveUp = await setEmailRetryOrDead(job, message);
      if (gaveUp) dead++;
      else failed++;
    }
  }

  return { submitted, failed, dead };
}

type EmailJob = {
  id: string;
  to_email_snapshot: string;
  template_name: string;
  template_version: number;
  render_data: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
};

async function setEmailState(
  jobId: string,
  state: string,
  lastError: string | null
): Promise<void> {
  const sb = createServiceRoleClient();
  await sb
    .from("email_jobs")
    .update({
      state,
      last_error: lastError?.slice(0, 2000) ?? null,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

// Mirrors the outbox/webhook attempts ceiling: after this many attempts a
// still-failing email dead-letters instead of retrying forever.
const MAX_EMAIL_ATTEMPTS = 8;

/**
 * Re-queue a failed email for retry, or dead-letter it once the attempts
 * ceiling is reached. `job.attempts` already counts the attempt that just
 * failed (claim_email_jobs increments before returning). Returns true when
 * the job was dead-lettered so callers can count it correctly.
 */
async function setEmailRetryOrDead(job: EmailJob, message: string): Promise<boolean> {
  if (job.attempts >= MAX_EMAIL_ATTEMPTS) {
    await setEmailState(
      job.id,
      "DEAD",
      `gave up after ${job.attempts} attempts: ${message}`
    );
    return true;
  }
  await setEmailState(job.id, "RETRY_WAIT", message);
  return false;
}

function buildTemplateData(job: EmailJob): TemplateData {
  const e = env();
  const data = job.render_data as Partial<TemplateData>;
  const base = (e.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  // Group-entry notifications go to the organizers, so link the admin
  // mission-control dashboard instead of the participant dashboard.
  const dashboardUrl =
    job.template_name === "group-entry-notification"
      ? `${base}/admin`
      : `${base}/dashboard`;
  return {
    displayName: data.displayName ?? "Delegate",
    publicOrderCode: data.publicOrderCode,
    publicPassCode: data.publicPassCode,
    productName: data.productName,
    qrDataUrl: data.qrDataUrl,
    publicRegistrationCode: data.publicRegistrationCode,
    amountPaise: data.amountPaise,
    currency: data.currency,
    eventName: data.eventName,
    eventDateTime: data.eventDateTime,
    venue: data.venue,
    teamName: data.teamName,
    teamMembers: data.teamMembers,
    providerReference: data.providerReference,
    ticketCode: data.ticketCode,
    topic: data.topic,
    resolutionNote: data.resolutionNote,
    roleName: data.roleName,
    entryCode: data.entryCode,
    leadName: data.leadName,
    entryEmail: data.entryEmail,
    phone: data.phone,
    college: data.college,
    groupSize: data.groupSize,
    notes: data.notes,
    dashboardUrl,
    fontUrl: `${base}/fonts/Noot-Regular.ttf`,
    supportEmail: e.EMAIL_REPLY_TO ?? e.EMAIL_FROM.replace(/^.*<|>.*$/g, ""),
  };
}

/** Pre-rendered ticket artwork (scripts/email-ticket/build.py), cached per process. */
const ticketAssetCache = new Map<string, Buffer | null>();
async function readTicketAsset(file: string): Promise<Buffer | null> {
  if (ticketAssetCache.has(file)) return ticketAssetCache.get(file) ?? null;
  let content: Buffer | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    content = await readFile(join(process.cwd(), "public", "tarang", "email", file));
  } catch (err) {
    logger().warn({ err: err instanceof Error ? err.message : String(err), file }, "ticket asset missing; using hosted copy");
  }
  ticketAssetCache.set(file, content);
  return content;
}
