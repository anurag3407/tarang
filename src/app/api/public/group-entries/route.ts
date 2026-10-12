import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { env, supabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";
import { readJsonBody } from "@/lib/route-utils";
import { groupEntrySchema } from "@/lib/validation/schemas";
import { verifyTurnstile } from "@/lib/turnstile";
import { runEmailDispatcher } from "@/workers/outbox-dispatcher";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/group-entries — submit a group-entry request.
 *
 * Public (no login), modeled on the support-question route: CSRF/origin
 * validated, Zod-validated, rate-limited by email hash and IP (20/hour, fail
 * closed), Turnstile-gated. On success the entry is persisted, a durable
 * email job notifies the organizers, and the row is best-effort mirrored to
 * the Group Entries spreadsheet. Returns only the random public entry code.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const body = await readJsonBody<Record<string, unknown>>(req, 16 * 1024);
    const parsed = groupEntrySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Please check your submission", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const input = parsed.data;

    const ip = getClientIp(req);
    // Fail-closed limits on both keys (plan §10.4).
    await enforceRateLimit("ask", `email:${hashIdentifier(input.email)}`, {
      failClosed: true,
    });
    if (ip) {
      await enforceRateLimit("ask", `ip:${hashIdentifier(ip)}`, { failClosed: true });
    }

    const turnstileOk = await verifyTurnstile(input.turnstileToken, ip);
    if (!turnstileOk) {
      return apiError(req, "FORBIDDEN", "Bot check failed. Please try again.");
    }

    // Submissions need the database; fail closed with a controlled 503.
    if (!supabaseConfigured()) {
      return apiError(
        req,
        "MAINTENANCE",
        "Submissions are temporarily unavailable. Please try again later."
      );
    }

    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("group_entries")
      .insert({
        lead_name: input.leadName,
        email: input.email,
        phone: input.phone,
        college: input.college || null,
        group_size: input.groupSize,
        notes: input.notes || null,
      })
      .select("id, public_entry_code")
      .single();
    if (error || !data) {
      return apiError(req, "INTERNAL", "Could not submit your group entry");
    }
    const entryId = data.id as string;
    const entryCode = data.public_entry_code as string;

    // Organizer inbox for a copy of every submission. Configured per
    // deployment — never hard-coded, since entries carry personal details.
    const notifyTo = env().GROUP_ENTRY_NOTIFY_EMAIL;
    if (!notifyTo) {
      logger().warn({ entryId }, "group entry: GROUP_ENTRY_NOTIFY_EMAIL not set, organizer email skipped");
    } else {
      // Durable organizer notification via the email outbox. Idempotent by
      // logical_key; the dispatcher does the actual Resend send.
      const { error: emailErr } = await sb.from("email_jobs").upsert(
        {
          logical_key: `group-entry-notification:${entryId}`,
          recipient_user_id: null,
          to_email_snapshot: notifyTo,
          template_name: "group-entry-notification",
          template_version: 1,
          render_data: {
            displayName: "Organizer",
            entryCode,
            leadName: input.leadName,
            entryEmail: input.email,
            phone: input.phone,
            college: input.college || "",
            groupSize: input.groupSize,
            notes: input.notes || "",
          },
          idempotency_key: `email:group-entry-notification:${entryId}:v1`,
          state: "PENDING",
        },
        { onConflict: "logical_key", ignoreDuplicates: true }
      );
      if (emailErr) {
        // The entry is already persisted; a failed enqueue must not fail the
        // request. The dispatcher will not pick this one up, so log it loudly.
        logger().error(
          { err: emailErr.message, entryId },
          "group entry: failed to enqueue organizer email job"
        );
      } else {
        // Trigger the email dispatcher right away so organizers get the mail
        // immediately; the durable queue retries on any transient failure.
        try {
          await runEmailDispatcher({ batchSize: 5 });
        } catch (dispErr) {
          logger().warn(
            { err: dispErr instanceof Error ? dispErr.message : String(dispErr), entryId },
            "group entry: immediate email dispatch failed, will retry"
          );
        }
      }
    }

    // Best-effort mirror to the Group Entries spreadsheet. Never blocks or
    // fails the submission — the DB row and email are the durable records.
    if (env().GOOGLE_SHEETS_ENABLED) {
      try {
        const { syncGroupEntryToSheet } = await import("@/services/sheets-service");
        await syncGroupEntryToSheet(entryId);
      } catch (sheetErr) {
        logger().warn(
          { err: sheetErr instanceof Error ? sheetErr.message : String(sheetErr), entryId },
          "group entry: sheets sync failed"
        );
      }
    }

    return apiSuccess(req, { entryCode }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
