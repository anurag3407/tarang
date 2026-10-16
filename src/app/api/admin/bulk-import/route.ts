import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { logger } from "@/lib/logger";
import { readJsonBody } from "@/lib/route-utils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { issueQrCredential, generatePassQrDataUrl } from "@/services/qr-service";
import { runEmailDispatcher } from "@/workers/outbox-dispatcher";
import { formatDateIST, formatTimeIST, formatDateTimeIST } from "@/lib/dates";

export const dynamic = "force-dynamic";

const BulkImportSchema = z.object({
  issuanceType: z.enum(["PASS", "EVENT"]).default("PASS"),
  passProductId: z.string().uuid().optional(),
  passSlug: z.string().optional(),
  eventId: z.string().uuid().optional(),
  sendEmail: z.boolean().default(true),
  users: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name is required"),
        email: z.string().trim().email("Valid email is required"),
        phone: z.string().trim().optional().nullable(),
        college: z.string().trim().optional().nullable(),
      })
    )
    .min(1, "At least 1 user is required")
    .max(500, "Maximum 500 users per batch"),
});

export interface BulkImportRowResult {
  email: string;
  name: string;
  success: boolean;
  userCreated: boolean;
  userId?: string;
  passCode?: string;
  registrationCode?: string;
  orderCode?: string;
  qrIssued?: boolean;
  emailQueued?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    // 256 KiB mirrors the nginx cap; 500 rows of name/email/phone/college fit.
    await guardAdminMutation(req, "pass.reissue", { maxBodyBytes: 256 * 1024 });

    const body = await readJsonBody<Record<string, unknown>>(req, 256 * 1024);
    const parsed = BulkImportSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid bulk import payload", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const { issuanceType, eventId, sendEmail, users } = parsed.data;
    const sb = createServiceRoleClient();

    const festivalId = await getCurrentFestivalId();
    if (!festivalId) {
      return apiError(req, "INTERNAL", "No active published festival found");
    }

    // Resolve Delegate Card product if PASS issuance (bulk import is strictly Delegate Card only)
    let passProduct: {
      id: string;
      name: string;
      slug: string;
      valid_until: string | null;
      current_price_version_id: string | null;
      is_base_pass: boolean;
    } | null = null;

    if (issuanceType === "PASS") {
      // Strictly fetch VIP delegate pass product
      const { data: vipProd } = await sb
        .from("pass_products")
        .select("id, name, slug, valid_until, current_price_version_id, is_base_pass")
        .eq("festival_id", festivalId)
        .eq("slug", "vip-delegate-pass")
        .maybeSingle();

      if (vipProd) {
        passProduct = vipProd;
      } else {
        // Fallback: fetch any delegate pass (is_base_pass = false)
        const { data: delegateProd } = await sb
          .from("pass_products")
          .select("id, name, slug, valid_until, current_price_version_id, is_base_pass")
          .eq("festival_id", festivalId)
          .eq("is_base_pass", false)
          .limit(1)
          .maybeSingle();

        passProduct = delegateProd;
      }

      if (!passProduct) {
        return apiError(req, "NOT_FOUND", "No Delegate Card product found for this festival");
      }
    }

    // Resolve event if EVENT issuance
    let eventRecord: {
      id: string;
      name: string;
      slug: string;
      starts_at: string;
      ends_at: string;
      current_price_version_id: string | null;
      venue?: { name?: string; short_name?: string } | null;
    } | null = null;

    if (issuanceType === "EVENT") {
      if (!eventId) {
        return apiError(req, "VALIDATION_FAILED", "Event ID is required for event registration issuance");
      }
      const { data: ev, error: evErr } = await sb
        .from("events")
        .select("id, name, slug, starts_at, ends_at, current_price_version_id, venues ( name, short_name )")
        .eq("id", eventId)
        .eq("festival_id", festivalId)
        .maybeSingle();

      if (evErr || !ev) {
        return apiError(req, "NOT_FOUND", "Event not found");
      }
      const ven = Array.isArray(ev.venues) ? ev.venues[0] : ev.venues;
      eventRecord = {
        id: ev.id,
        name: ev.name,
        slug: ev.slug,
        starts_at: ev.starts_at,
        ends_at: ev.ends_at,
        current_price_version_id: ev.current_price_version_id,
        venue: ven,
      };
    }

    const results: BulkImportRowResult[] = [];

    for (const u of users) {
      const email = u.email.toLowerCase().trim();
      const name = u.name.trim();
      const phone = u.phone?.trim() || null;
      const college = u.college?.trim() || null;

      try {
        // 1. Check if user already exists
        let userId: string | null = null;
        let userCreated = false;

        const { data: existingId } = await sb.rpc("resolve_user_id_by_email", {
          p_email: email,
        });

        if (existingId) {
          userId = existingId;
        } else {
          // Create new user in Supabase Auth with auto-confirmed email
          const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              display_name: name,
              phone,
              college_name: college,
            },
            password: randomUUID(),
          });

          if (createErr || !created.user) {
            throw new Error(`Auth account creation failed: ${createErr?.message || "unknown"}`);
          }
          userId = created.user.id;
          userCreated = true;
        }

        // Normalize phone to E.164 format when one was supplied.
        let phoneE164: string | null = null;
        if (phone) {
          const digits = phone.replace(/\D/g, "");
          if (digits.length === 10) {
            phoneE164 = `+91${digits}`;
          } else if (phone.startsWith("+")) {
            phoneE164 = phone;
          } else if (digits.length > 10) {
            phoneE164 = `+${digits}`;
          }
        }

        // 2. Profile. The orders BEFORE INSERT trigger
        //    (enforce_profile_complete_for_order) needs phone_e164 and
        //    profile_completed_at, so fill whatever is missing — but never
        //    overwrite what an existing user already entered themselves.
        const now = new Date().toISOString();
        const { data: existingProfile, error: profileReadErr } = await sb
          .from("profiles")
          .select("user_id, display_name, phone_e164, college_name, profile_completed_at, consented_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (profileReadErr) {
          throw new Error(`Profile lookup failed: ${profileReadErr.message}`);
        }
        const { error: profileErr } = await sb.from("profiles").upsert(
          {
            user_id: userId,
            display_name: existingProfile?.display_name || name,
            phone_e164: existingProfile?.phone_e164 || phoneE164 || "+910000000000",
            college_name: existingProfile?.college_name || college || null,
            consent_version: "v1",
            consented_at: existingProfile?.consented_at || now,
            profile_completed_at: existingProfile?.profile_completed_at || now,
            updated_at: now,
          },
          { onConflict: "user_id", ignoreDuplicates: false }
        );
        if (profileErr) {
          throw new Error(`Profile update failed: ${profileErr.message}`);
        }

        let passCode: string | undefined;
        let registrationCode: string | undefined;
        let orderCode: string | undefined;
        let qrIssued = false;

        // 3. Issue Pass or Event Registration
        if (issuanceType === "PASS" && passProduct) {
          // Check existing active pass
          const { data: existingPass } = await sb
            .from("delegate_passes")
            .select("id, public_pass_code, state, source_order_line_id")
            .eq("festival_id", festivalId)
            .eq("user_id", userId)
            .eq("pass_product_id", passProduct.id)
            .eq("state", "ACTIVE")
            .maybeSingle();

          let passId: string;

          if (existingPass) {
            passId = existingPass.id;
            passCode = existingPass.public_pass_code;
          } else {
            // Create ₹0 order for tracking
            const orderId = randomUUID();
            const orderLineId = randomUUID();
            orderCode = `PO-ADM-${randomUUID().slice(0, 6).toUpperCase()}`;

            const { error: orderErr } = await sb.from("orders").insert({
              id: orderId,
              public_order_code: orderCode,
              festival_id: festivalId,
              purchaser_user_id: userId,
              kind: "BASE_PASS",
              idempotency_key: randomUUID(),
              request_hash: `bulk_import:${userId}:${passProduct.id}`,
              checkout_state: "FULFILLED",
              amount_paise: 0,
              currency: "INR",
              fulfilled_at: new Date().toISOString(),
            });
            if (orderErr) {
              throw new Error(`Failed to create order: ${orderErr.message}`);
            }

            const { error: lineErr } = await sb.from("order_lines").insert({
              id: orderLineId,
              order_id: orderId,
              line_kind: "PASS",
              pass_product_id: passProduct.id,
              pass_price_version_id: passProduct.current_price_version_id,
              unit_amount_paise: 0,
              charge_quantity: 1,
              line_amount_paise: 0,
              description_snapshot: passProduct.name,
            });
            if (lineErr) {
              // Clean up orphaned order
              await sb.from("orders").delete().eq("id", orderId);
              throw new Error(`Failed to create order line: ${lineErr.message}`);
            }

            const { data: newPass, error: passErr } = await sb
              .from("delegate_passes")
              .insert({
                festival_id: festivalId,
                user_id: userId,
                pass_product_id: passProduct.id,
                source_order_line_id: orderLineId,
                state: "ACTIVE",
                activated_at: new Date().toISOString(),
                expires_at: passProduct.valid_until,
              })
              .select("id, public_pass_code")
              .single();

            if (passErr || !newPass) {
              // Clean up orphaned order + order_line
              await sb.from("order_lines").delete().eq("id", orderLineId);
              await sb.from("orders").delete().eq("id", orderId);
              throw new Error(`Failed to issue pass: ${passErr?.message || "database error"}`);
            }
            passId = newPass.id;
            passCode = newPass.public_pass_code;
          }

          // Issue QR credential & generate Gate QR data URL
          await issueQrCredential(passId);
          qrIssued = true;

          const isDelegate =
            passProduct.slug.includes("delegate") ||
            passProduct.slug.includes("vip") ||
            !passProduct.is_base_pass ||
            passProduct.name.toLowerCase().includes("delegate");

          let qrDataUrl: string | undefined;
          if (isDelegate) {
            try {
              const qrRes = await generatePassQrDataUrl(passId);
              qrDataUrl = qrRes.dataUrl;
            } catch {
              // The email goes out without an inline QR; the pass page still has it.
            }
          }

          // Enqueue confirmation email
          if (sendEmail && isDelegate) {
            await sb.from("email_jobs").upsert(
              {
                logical_key: `order-confirmation:grant:${passId}`,
                recipient_user_id: userId,
                to_email_snapshot: email,
                template_name: "delegate-pass-confirmation",
                template_version: 1,
                render_data: {
                  displayName: name,
                  publicOrderCode: orderCode ?? `PO-${passCode}`,
                  publicPassCode: passCode,
                  productName: passProduct.name,
                  amountPaise: 0,
                  currency: "INR",
                  ...(qrDataUrl ? { qrDataUrl } : {}),
                },
                idempotency_key: `email:order-confirmation:grant:${passId}:v1`,
                state: "PENDING",
              },
              { onConflict: "logical_key", ignoreDuplicates: false }
            );
          }
        } else if (issuanceType === "EVENT" && eventRecord) {
          // Check existing registration
          const { data: existingReg } = await sb
            .from("registrations")
            .select("id, public_registration_code, state")
            .eq("event_id", eventRecord.id)
            .eq("owner_user_id", userId)
            .eq("state", "CONFIRMED")
            .maybeSingle();

          let regId: string;

          if (existingReg) {
            regId = existingReg.id;
            registrationCode = existingReg.public_registration_code;
          } else {
            // Check for an existing fulfilled order for this user+event to avoid duplicates
            const { data: existingOrderLine } = await sb
              .from("order_lines")
              .select("id, orders!inner(id, checkout_state)")
              .eq("event_id", eventRecord.id)
              .eq("line_kind", "EVENT")
              .eq("orders.purchaser_user_id", userId)
              .eq("orders.checkout_state", "FULFILLED")
              .maybeSingle();

            let orderLineId: string;
            let orderId: string;

            if (existingOrderLine) {
              // Reuse the existing order line — just need to create the registration
              orderLineId = existingOrderLine.id;
              const ol = Array.isArray(existingOrderLine.orders) ? existingOrderLine.orders[0] : existingOrderLine.orders;
              orderId = (ol as { id: string }).id;
            } else {
              // Create ₹0 order for tracking
              orderId = randomUUID();
              orderLineId = randomUUID();
              orderCode = `PO-ADM-${randomUUID().slice(0, 6).toUpperCase()}`;

              const { error: orderErr } = await sb.from("orders").insert({
                id: orderId,
                public_order_code: orderCode,
                festival_id: festivalId,
                purchaser_user_id: userId,
                kind: "EVENT",
                idempotency_key: randomUUID(),
                request_hash: `bulk_import:${userId}:${eventRecord.id}`,
                checkout_state: "FULFILLED",
                amount_paise: 0,
                currency: "INR",
                fulfilled_at: new Date().toISOString(),
              });
              if (orderErr) {
                throw new Error(`Failed to create order: ${orderErr.message}`);
              }

              const { error: lineErr } = await sb.from("order_lines").insert({
                id: orderLineId,
                order_id: orderId,
                line_kind: "EVENT",
                event_id: eventRecord.id,
                event_price_version_id: eventRecord.current_price_version_id,
                unit_amount_paise: 0,
                charge_quantity: 1,
                line_amount_paise: 0,
                description_snapshot: eventRecord.name,
              });
              if (lineErr) {
                // Clean up orphaned order
                await sb.from("orders").delete().eq("id", orderId);
                throw new Error(`Failed to create order line: ${lineErr.message}`);
              }
            }

            const { data: newReg, error: regErr } = await sb
              .from("registrations")
              .insert({
                order_line_id: orderLineId,
                event_id: eventRecord.id,
                owner_user_id: userId,
                registration_mode: "INDIVIDUAL",
                capacity_units: 1,
                state: "CONFIRMED",
                confirmed_at: new Date().toISOString(),
              })
              .select("id, public_registration_code")
              .single();

            if (regErr || !newReg) {
              // Clean up orphaned order + order_line only if we just created them
              if (orderCode) {
                await sb.from("order_lines").delete().eq("id", orderLineId);
                await sb.from("orders").delete().eq("id", orderId);
              }
              throw new Error(`Failed to create registration: ${regErr?.message || "database error"}`);
            }

            regId = newReg.id;
            registrationCode = newReg.public_registration_code;

            // Add member
            const { error: memberErr } = await sb.from("registration_members").insert({
              registration_id: regId,
              event_id: eventRecord.id,
              user_id: userId,
              role: "INDIVIDUAL",
            });
            if (memberErr) {
              // Non-fatal: registration already created, just log
              logger().warn(
                { err: memberErr.message, registrationId: regId },
                "bulk import: registration member insert failed"
              );
            }
          }

          // Format Event Date Time
          let eventDateTime: string | undefined;
          if (eventRecord.starts_at) {
            const startDateStr = formatDateIST(eventRecord.starts_at);
            const startTimeStr = formatTimeIST(eventRecord.starts_at);
            if (eventRecord.ends_at) {
              const endDateStr = formatDateIST(eventRecord.ends_at);
              const endTimeStr = formatTimeIST(eventRecord.ends_at);
              if (startDateStr === endDateStr) {
                eventDateTime = `${startDateStr}, ${startTimeStr} – ${endTimeStr} IST`;
              } else {
                eventDateTime = `${formatDateTimeIST(eventRecord.starts_at)} – ${formatDateTimeIST(eventRecord.ends_at)} IST`;
              }
            } else {
              eventDateTime = `${formatDateTimeIST(eventRecord.starts_at)} IST`;
            }
          }

          const venueName = eventRecord.venue?.name ?? eventRecord.venue?.short_name ?? undefined;

          // Enqueue confirmation email
          if (sendEmail) {
            await sb.from("email_jobs").upsert(
              {
                logical_key: `order-confirmation:grant:${regId}`,
                recipient_user_id: userId,
                to_email_snapshot: email,
                template_name: "event-registration-confirmation",
                template_version: 1,
                render_data: {
                  displayName: name,
                  publicOrderCode: orderCode ?? `PO-${registrationCode}`,
                  publicRegistrationCode: registrationCode,
                  eventName: eventRecord.name,
                  eventDateTime,
                  venue: venueName,
                  amountPaise: 0,
                  currency: "INR",
                },
                idempotency_key: `email:order-confirmation:grant:${regId}:v1`,
                state: "PENDING",
              },
              { onConflict: "logical_key", ignoreDuplicates: false }
            );
          }
        }

        results.push({
          email,
          name,
          success: true,
          userCreated,
          userId: userId ?? undefined,
          passCode,
          registrationCode,
          orderCode,
          qrIssued,
          emailQueued: sendEmail,
        });
      } catch (rowErr) {
        results.push({
          email,
          name,
          success: false,
          userCreated: false,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        });
      }
    }

    // Kick the email dispatcher without holding the response open; the
    // worker loop picks up anything this pass does not send.
    if (sendEmail) {
      void runEmailDispatcher({ batchSize: users.length * 2 }).catch((dispErr) => {
        logger().warn(
          { err: dispErr instanceof Error ? dispErr.message : String(dispErr) },
          "bulk import: email dispatch deferred to worker"
        );
      });
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    return apiSuccess(req, {
      message: `Bulk import completed: ${successful} succeeded, ${failed} failed.`,
      processed: results.length,
      successful,
      failed,
      results,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
