import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getRazorpay, receiptForOrder } from "@/lib/razorpay/client";
import type { CheckoutResult } from "@/domain/checkout";
import { isPronitePassProduct } from "@/lib/pronite-pass";

/**
 * Checkout service (plan §9.2–§9.4, §12.3, §12.5).
 *
 * The DB transaction reserves inventory and snapshots price; the Razorpay
 * HTTP call happens outside the transaction. The browser never submits an
 * amount. Free events skip Razorpay and fulfill immediately.
 */

function requestHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

function mapRpcError(err: { message?: string; code?: string } | null): never {
  const msg = err?.message ?? "";
  const discountError = mapDiscountError(msg);
  if (discountError) throw discountError;
  // Double registration from a second session: the partial unique index
  // one_live_event_claim_per_participant rejects the second insert.
  if (msg.includes("one_live_event_claim_per_participant"))
    throw new AppError("ALREADY_REGISTERED", "You are already registered for this event");
  if (msg.includes("PROFILE_INCOMPLETE"))
    throw new AppError("PROFILE_INCOMPLETE", "Complete your profile before purchasing");
  if (msg.includes("INVALID_SIZE"))
    throw new AppError("INVALID_SIZE", "Please select a valid size for this product");
  if (msg.includes("INVALID_QUANTITY"))
    throw new AppError("INVALID_QUANTITY", "Please choose a valid quantity");
  if (msg.includes("SOLD_OUT")) throw new AppError("SOLD_OUT", "This item is sold out");
  if (msg.includes("BASE_PASS_REQUIRED"))
    throw new AppError("BASE_PASS_REQUIRED", "You must have an active festival pass before registering for events");
  if (msg.includes("BASE_PASS_EXISTS"))
    throw new AppError("BASE_PASS_EXISTS", "You already have an active pass of this type");
  if (msg.includes("BASE_PASS_ORDER_OPEN"))
    throw new AppError(
      "BASE_PASS_EXISTS",
      "You already have a pass order in progress — finish or wait for it to expire, then retry"
    );
  if (msg.includes("TEAM_NOT_READY"))
    throw new AppError("TEAM_NOT_READY", "Your team is not ready for checkout");
  if (msg.includes("TEAM_LOCKED"))
    throw new AppError("TEAM_LOCKED", "This team is locked for checkout");
  if (msg.includes("SALES_PAUSED"))
    throw new AppError("SALES_PAUSED", "Sales are temporarily paused");
  if (msg.includes("SALES_CLOSED"))
    throw new AppError("SALES_CLOSED", "Sales are closed for this item");
  if (msg.includes("REGISTRATION_WINDOW_CLOSED"))
    throw new AppError("REGISTRATION_WINDOW_CLOSED", "The registration window is closed");
  if (msg.includes("IDEMPOTENCY_MISMATCH"))
    throw new AppError("IDEMPOTENCY_MISMATCH", "Idempotency key reused with a different request");
  // Remaining unique violations (BASE_PASS_EXISTS shares SQLSTATE 23505, so
  // the named checks above must run first).
  if (err?.code === "23505")
    throw new AppError("CONFLICT", "This purchase already exists — refresh the page to see it");
  if (msg.includes("NOT_FOUND")) throw new AppError("NOT_FOUND", "Not found");
  if (msg.includes("FORBIDDEN") || err?.code === "42501")
    throw new AppError("FORBIDDEN", "You are not authorized to perform this checkout");
  throw new AppError("INTERNAL", "Checkout failed");
}

/**
 * Discount failures share one API code. Unknown, inactive, expired and
 * wrong-pass codes get the same message so the endpoint does not reveal which
 * codes exist; the usage-limit messages only fire for a real, live code.
 */
function mapDiscountError(msg: string): AppError | null {
  if (msg.includes("DISCOUNT_EXHAUSTED"))
    return new AppError("DISCOUNT_INVALID", "This discount code has reached its usage limit");
  if (msg.includes("DISCOUNT_ALREADY_USED"))
    return new AppError("DISCOUNT_INVALID", "You have already used this discount code");
  if (msg.includes("DISCOUNT_INVALID"))
    return new AppError("DISCOUNT_INVALID", "This discount code is invalid or has expired");
  return null;
}

async function provisionProviderOrder(
  localOrderId: string,
  amountPaise: number,
  currency: string
): Promise<string | null> {
  const rzp = getRazorpay();
  if (!rzp) {
    // No provider configured: leave in provisioning; reconciler resolves.
    return null;
  }
  const receipt = receiptForOrder(localOrderId);
  try {
    const providerOrder = await rzp.orders.create({
      amount: amountPaise,
      currency,
      receipt,
      // automatic capture (plan §2.3.11)
      payment: { capture: "automatic" },
      notes: { local_order_id: localOrderId },
    });

    const sb = createServiceRoleClient();
    const { error } = await sb.rpc("attach_razorpay_order", {
      p_local_order_id: localOrderId,
      p_razorpay_order_id: providerOrder.id,
      p_amount_paise: amountPaise,
      p_currency: currency,
      p_receipt: receipt,
      p_provider_status: providerOrder.status ?? "created",
    });
    if (error) throw error;
    return providerOrder.id as string;
  } catch (err) {
    // Definitive failure vs uncertain: on network uncertainty we keep the
    // order in provisioning and let reconciliation resolve (plan §9.4.7).
    const e = err as { statusCode?: number; error?: { description?: string } };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      await releaseLocalOrder(localOrderId);
      throw new AppError("UPSTREAM_ERROR", "Payment provider rejected the order");
    }
    return null;
  }
}

async function releaseLocalOrder(localOrderId: string): Promise<void> {
  const sb = createServiceRoleClient();
  // Find the order line, force-expire its hold, then run the reaper so the
  // inventory/claims/order transitions happen atomically in one function.
  const { data: line } = await sb
    .from("order_lines")
    .select("id")
    .eq("order_id", localOrderId)
    .maybeSingle();
  if (line) {
    await sb
      .from("capacity_holds")
      .update({ expires_at: new Date(0).toISOString() })
      .eq("order_line_id", line.id);
    await sb.rpc("expire_holds_batch", { p_batch_size: 100 });
  }
  await sb
    .from("orders")
    .update({ checkout_state: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", localOrderId)
    .eq("checkout_state", "PROVISIONING_PROVIDER");
}

/**
 * Idempotent replay. If the first attempt created the local order but never
 * got a Razorpay order attached (provider timeout, process restart), retry
 * provisioning now: the reconciler only looks at orders that already have a
 * provider order, so otherwise the buyer waits out the whole hold with
 * nothing to pay. Racing retries are safe — attach_razorpay_order keeps the
 * first mapping and getOrderResult always returns the stored one.
 */
async function resumeReplayedOrder(localOrderId: string): Promise<CheckoutResult> {
  const result = await getOrderResult(localOrderId);
  if (
    result.status === "PROVISIONING_PROVIDER" &&
    !result.razorpayOrderId &&
    result.amountPaise > 0
  ) {
    await provisionProviderOrder(localOrderId, result.amountPaise, result.currency);
    return getOrderResult(localOrderId);
  }
  return result;
}

async function getOrderResult(localOrderId: string): Promise<CheckoutResult> {
  const sb = createServiceRoleClient();
  const { data: order, error } = await sb
    .from("orders")
    .select(
      "id, public_order_code, checkout_state, amount_paise, currency, hold_expires_at, discount_paise, discount_code_snapshot"
    )
    .eq("id", localOrderId)
    .single();
  if (error || !order) throw new AppError("NOT_FOUND", "Order not found");

  const { data: rzpOrder } = await sb
    .from("razorpay_orders")
    .select("razorpay_order_id")
    .eq("local_order_id", localOrderId)
    .maybeSingle();

  const e = env();
  return {
    localOrderId: order.id,
    publicOrderCode: order.public_order_code,
    razorpayOrderId: rzpOrder?.razorpay_order_id ?? null,
    razorpayKeyId: e.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? e.RAZORPAY_KEY_ID ?? null,
    amountPaise: Number(order.amount_paise),
    currency: order.currency,
    expiresAt: order.hold_expires_at,
    status: order.checkout_state,
    discountPaise: Number(order.discount_paise ?? 0),
    discountCode: order.discount_code_snapshot ?? null,
  };
}

/**
 * Base pass checkout. `discountCode` must already be normalized (trimmed,
 * upper-case); the discount amount is computed in the checkout transaction,
 * never taken from the browser.
 */
export async function createBasePassCheckout(
  userId: string,
  festivalId: string,
  passProductId: string,
  idempotencyKey: string,
  discountCode: string | null = null
): Promise<CheckoutResult> {
  const sb = createServiceRoleClient();
  // The code is part of the request identity: retrying a key with a different
  // code is an IDEMPOTENCY_MISMATCH, not a silent replay of the old price.
  const hash = requestHash(discountCode ? { passProductId, discountCode } : { passProductId });

  // The Pronite Pass is the only pass on sale. The retired Basic Card is
  // unpublished in the DB too; this guards against it being re-opened by
  // mistake, since it would sell a pass with no gate QR and no email.
  const { data: product } = await sb
    .from("pass_products")
    .select("slug, name, is_base_pass")
    .eq("id", passProductId)
    .maybeSingle();
  // A missing product falls through: the checkout RPC raises NOT_FOUND.
  if (product && !isPronitePassProduct(product)) {
    throw new AppError("SALES_CLOSED", "This pass is no longer on sale");
  }

  const { data, error } = await sb.rpc("create_base_pass_checkout", {
    p_user_id: userId,
    p_festival_id: festivalId,
    p_pass_product_id: passProductId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: hash,
    p_discount_code: discountCode,
  });
  if (error) mapRpcError(error);

  const { orderId, replayed } = data as { orderId: string; replayed: boolean };
  if (replayed) return resumeReplayedOrder(orderId);

  // Provider provisioning outside the transaction (plan §9.4).
  const { data: order } = await sb
    .from("orders")
    .select("amount_paise, currency")
    .eq("id", orderId)
    .single();

  const amountPaise = Number(order!.amount_paise);

  // Zero-price pass: fulfill immediately without Razorpay. Check BEFORE
  // provider provisioning — Razorpay rejects zero-amount orders.
  if (amountPaise === 0) {
    await fulfillFreeOrder(orderId);
  } else {
    await provisionProviderOrder(orderId, amountPaise, order!.currency);
  }

  return getOrderResult(orderId);
}

export interface DiscountQuote {
  code: string;
  originalAmountPaise: number;
  discountPaise: number;
  finalAmountPaise: number;
}

/** Read-only price quote for a pass with a discount code applied. */
export async function previewPassDiscount(
  userId: string,
  festivalId: string,
  passProductId: string,
  discountCode: string
): Promise<DiscountQuote> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb.rpc("preview_pass_discount", {
    p_user_id: userId,
    p_festival_id: festivalId,
    p_pass_product_id: passProductId,
    p_code: discountCode,
  });
  if (error) mapRpcError(error);
  const quote = data as {
    code: string;
    originalAmountPaise: number | string;
    discountPaise: number | string;
    finalAmountPaise: number | string;
  };
  return {
    code: quote.code,
    originalAmountPaise: Number(quote.originalAmountPaise),
    discountPaise: Number(quote.discountPaise),
    finalAmountPaise: Number(quote.finalAmountPaise),
  };
}

export async function createEventCheckout(
  userId: string,
  festivalId: string,
  eventId: string,
  registrationMode: "INDIVIDUAL" | "TEAM",
  teamDraftId: string | null,
  idempotencyKey: string
): Promise<CheckoutResult> {
  const sb = createServiceRoleClient();
  const hash = requestHash({ eventId, registrationMode, teamDraftId });

  const { data, error } = await sb.rpc("create_event_checkout", {
    p_user_id: userId,
    p_festival_id: festivalId,
    p_event_id: eventId,
    p_team_draft_id: teamDraftId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: hash,
  });
  if (error) mapRpcError(error);

  const result = data as {
    orderId: string;
    replayed: boolean;
    amountPaise: number;
  };
  if (result.replayed) return resumeReplayedOrder(result.orderId);

  if (result.amountPaise === 0) {
    // Zero-price event (plan §12.13): skip Razorpay, fulfill immediately.
    await fulfillFreeOrder(result.orderId);
  } else {
    await provisionProviderOrder(result.orderId, result.amountPaise, "INR");
  }

  return getOrderResult(result.orderId);
}

export interface MerchandiseCheckoutInput {
  productId: string;
  selectedSize: string;
  quantity: number;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  deliveryMode: "PICKUP" | "DELIVERY";
  shippingAddress?: Record<string, string> | null;
}

export async function createMerchandiseCheckout(
  userId: string,
  festivalId: string,
  input: MerchandiseCheckoutInput,
  idempotencyKey: string
): Promise<CheckoutResult> {
  const sb = createServiceRoleClient();
  const hash = requestHash({
    productId: input.productId,
    selectedSize: input.selectedSize,
    quantity: input.quantity,
    recipientEmail: input.recipientEmail,
    deliveryMode: input.deliveryMode,
  });

  const { data, error } = await sb.rpc("create_merchandise_checkout", {
    p_user_id: userId,
    p_festival_id: festivalId,
    p_product_id: input.productId,
    p_selected_size: input.selectedSize,
    p_quantity: input.quantity,
    p_recipient_name: input.recipientName,
    p_recipient_phone: input.recipientPhone,
    p_recipient_email: input.recipientEmail,
    p_delivery_mode: input.deliveryMode,
    p_shipping_address: input.shippingAddress ?? null,
    p_idempotency_key: idempotencyKey,
    p_request_hash: hash,
  });
  if (error) mapRpcError(error);

  const result = data as {
    orderId: string;
    replayed: boolean;
    amountPaise: number;
  };
  if (result.replayed) return resumeReplayedOrder(result.orderId);

  if (result.amountPaise === 0) {
    await fulfillFreeOrder(result.orderId);
  } else {
    await provisionProviderOrder(result.orderId, result.amountPaise, "INR");
  }

  return getOrderResult(result.orderId);
}

/** Fulfill a zero-amount order by applying a synthetic captured payment. */
async function fulfillFreeOrder(localOrderId: string): Promise<void> {
  const sb = createServiceRoleClient();
  const syntheticPaymentId = `free_${localOrderId.replace(/-/g, "")}`;
  const { data: order } = await sb
    .from("orders")
    .select("amount_paise, currency")
    .eq("id", localOrderId)
    .single();

  // Attach a synthetic provider order so apply_captured_payment can map it.
  const receipt = receiptForOrder(localOrderId);
  await sb.rpc("attach_razorpay_order", {
    p_local_order_id: localOrderId,
    p_razorpay_order_id: syntheticPaymentId,
    p_amount_paise: Number(order!.amount_paise),
    p_currency: order!.currency,
    p_receipt: receipt,
    p_provider_status: "paid",
  });

  const { error } = await sb.rpc("apply_captured_payment", {
    p_razorpay_payment_id: syntheticPaymentId,
    p_razorpay_order_id: syntheticPaymentId,
    p_amount_paise: Number(order!.amount_paise),
    p_currency: order!.currency,
    p_provider_status: "captured",
    p_provider_created_at: new Date().toISOString(),
  });
  if (error) throw new AppError("INTERNAL", "Free fulfillment failed");

  // Email, QR and Sheets jobs were enqueued by the fulfillment trigger.
  const { runOutboxDispatcher } = await import("@/workers/outbox-dispatcher");
  void runOutboxDispatcher({ batchSize: 5 }).catch(() => {});
}

/** Generate a fresh idempotency key for a user action. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
