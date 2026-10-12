import "server-only";
import { importPKCS8, SignJWT } from "jose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { formatPaise } from "@/lib/money";

/**
 * Google Sheets 3-Spreadsheet Audit & Backup Sync Service (plan §7.16, §12.18).
 *
 * Synchronizes registrations to three dedicated Google Spreadsheets:
 * 1. Basic Card Registrations
 * 2. Delegate Card (VIP All-Access) Registrations
 * 3. All Events Registrations
 *
 * Concurrency & Rate Limiting:
 * - Batched writes to stay well below Google's 300 write requests/min quota.
 * - Non-blocking asynchronous processing via durable queue.
 * - Formula injection sanitization (prefixing '=', '+', '-', '@').
 */

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** Formula injection sanitizer (plan §12.18 rule 5). */
export function sanitizeSheetCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

/** Parse Google Service Account credentials from environment. */
function getServiceAccount(): ServiceAccountCredentials | null {
  const e = env();
  let jsonStr = e.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr && e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    try {
      jsonStr = Buffer.from(e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        private_key_id: typeof parsed.private_key_id === "string" ? parsed.private_key_id : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** Get Google OAuth2 access token for Sheets API using JWT assertion. */
async function getGoogleSheetsAccessToken(): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const sa = getServiceAccount();
  if (!sa) return null;

  try {
    const pk = await importPKCS8(sa.private_key, "RS256");
    const jwt = await new SignJWT({
      scope: "https://www.googleapis.com/auth/spreadsheets",
    })
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWT",
        ...(sa.private_key_id ? { kid: sa.private_key_id } : {}),
      })
      .setIssuer(sa.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pk);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      logger().error({ err: errText }, "failed to exchange google service account token");
      return null;
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in: number };
    cachedAccessToken = {
      token: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in - 120) * 1000,
    };
    return tokenData.access_token;
  } catch (err) {
    logger().error({ err: err instanceof Error ? err.message : String(err) }, "error generating google token");
    return null;
  }
}

/** Options for append operations */
export interface AppendOptions {
  sheetKind?: "BASIC_PASS" | "DELEGATE_PASS" | "EVENT" | "MERCHANDISE" | "GROUP_ENTRY";
  sheetName?: string;
}

/** Append rows to a Google Spreadsheet. */
export async function appendToGoogleSheet(
  spreadsheetId: string,
  range: string,
  rows: unknown[][],
  options?: AppendOptions
): Promise<{ success: boolean; rowsAppended: number; error?: string }> {
  if (rows.length === 0) return { success: true, rowsAppended: 0 };

  const sanitizedRows = rows.map((row) => row.map(sanitizeSheetCell));
  const e = env();

  // Mode 1: Webhook URL (if provided)
  if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
    try {
      const payload = {
        spreadsheetId,
        range,
        rows: sanitizedRows,
        sheetKind: options?.sheetKind ?? "GENERAL",
        sheetName: options?.sheetName ?? (range.includes("!") ? range.split("!")[0].replace(/'/g, "") : "Sheet1"),
        timestamp: new Date().toISOString(),
      };

      const res = await fetch(e.GOOGLE_SHEETS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        logger().info(
          { spreadsheetId, rowsCount: sanitizedRows.length, kind: options?.sheetKind },
          "google sheets webhook appended successfully"
        );
        return { success: true, rowsAppended: sanitizedRows.length };
      }

      const webhookErrText = await res.text().catch(() => "unknown error");
      logger().warn(
        { status: res.status, err: webhookErrText },
        "google sheets webhook returned non-200, attempting service account fallback"
      );
    } catch (err) {
      logger().warn({ err: err instanceof Error ? err.message : String(err) }, "google sheets webhook failed");
    }
  }

  // Mode 2: Google Sheets REST API v4 with Service Account
  if (!spreadsheetId || spreadsheetId === "webhook_default") {
    return {
      success: false,
      rowsAppended: 0,
      error: "Spreadsheet ID not configured for Google Sheets API v4",
    };
  }

  const accessToken = await getGoogleSheetsAccessToken();
  if (!accessToken) {
    logger().error("Google Sheets access token not available — check service account credentials");
    return { success: false, rowsAppended: 0, error: "Google Sheets access token not available" };
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: sanitizedRows }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger().error({ status: res.status, err: errText }, "google sheets API append failed");
      return { success: false, rowsAppended: 0, error: `Google Sheets API error (${res.status}): ${errText}` };
    }

    logger().info({ spreadsheetId, range, count: sanitizedRows.length }, "appended rows to Google Sheets");
    return { success: true, rowsAppended: sanitizedRows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger().error({ err: msg }, "exception during google sheets append");
    return { success: false, rowsAppended: 0, error: msg };
  }
}

/** Column headers for each spreadsheet */
export const BASIC_PASS_HEADERS = [
  "Timestamp",
  "Pass Code",
  "Holder Name",
  "Email",
  "Phone",
  "College",
  "Order Code",
  "Payment ID",
  "Amount (INR)",
  "Pass State",
  "Activated At",
];

export const DELEGATE_PASS_HEADERS = [
  "Timestamp",
  "Pass Code",
  "Holder Name",
  "Email",
  "Phone",
  "College",
  "Order Code",
  "Payment ID",
  "Amount (INR)",
  "Pass State",
  "Concert Pro Shows Included",
  "VIP Front-Row Zone",
  "Activated At",
];

export const EVENT_REGISTRATION_HEADERS = [
  "Timestamp",
  "Registration Code",
  "Event Name",
  "Category",
  "Starts At",
  "Venue",
  "Mode",
  "Participant Name",
  "Email",
  "Phone",
  "College",
  "Team Name",
  "Team Members",
  "Order Code",
  "Payment ID",
  "Amount (INR)",
  "Payment Status",
];

export const MERCHANDISE_ORDER_HEADERS = [
  "Timestamp",
  "Order Code",
  "Payment ID",
  "Item Name",
  "Size / Variant",
  "Quantity",
  "Unit Price (INR)",
  "Total Amount (INR)",
  "Customer Name",
  "Email",
  "Phone",
  "Delivery Mode",
  "Shipping Address",
  "Order Status",
];

export const GROUP_ENTRY_HEADERS = [
  "Timestamp",
  "Entry Code",
  "Lead Name",
  "Email",
  "Phone",
  "College",
  "Group Size",
  "Notes",
];

/** Resolve spreadsheet ID, sheet name, and range for each category */
function resolveSheetTarget(kind: "BASIC_PASS" | "DELEGATE_PASS" | "EVENT" | "MERCHANDISE" | "GROUP_ENTRY"): {
  spreadsheetId: string | null;
  sheetName: string;
  range: string;
} {
  const e = env();
  if (kind === "BASIC_PASS") {
    if (e.GOOGLE_SHEETS_BASIC_PASS_ID) {
      return { spreadsheetId: e.GOOGLE_SHEETS_BASIC_PASS_ID, sheetName: "Basic Passes", range: "A:A" };
    }
    if (e.GOOGLE_MASTER_SPREADSHEET_ID) {
      return { spreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID, sheetName: "Basic Passes", range: "'Basic Passes'!A:A" };
    }
    if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
      return { spreadsheetId: "webhook_default", sheetName: "Basic Passes", range: "A:A" };
    }
  }

  if (kind === "DELEGATE_PASS") {
    if (e.GOOGLE_SHEETS_DELEGATE_PASS_ID) {
      return { spreadsheetId: e.GOOGLE_SHEETS_DELEGATE_PASS_ID, sheetName: "Delegate Passes", range: "A:A" };
    }
    if (e.GOOGLE_MASTER_SPREADSHEET_ID) {
      return { spreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID, sheetName: "Delegate Passes", range: "'Delegate Passes'!A:A" };
    }
    if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
      return { spreadsheetId: "webhook_default", sheetName: "Delegate Passes", range: "A:A" };
    }
  }

  if (kind === "EVENT") {
    if (e.GOOGLE_SHEETS_EVENTS_ID) {
      return { spreadsheetId: e.GOOGLE_SHEETS_EVENTS_ID, sheetName: "Event Registrations", range: "A:A" };
    }
    if (e.GOOGLE_MASTER_SPREADSHEET_ID) {
      return { spreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID, sheetName: "Event Registrations", range: "'Event Registrations'!A:A" };
    }
    if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
      return { spreadsheetId: "webhook_default", sheetName: "Event Registrations", range: "A:A" };
    }
  }

  if (kind === "MERCHANDISE") {
    if (e.GOOGLE_SHEETS_MERCHANDISE_ID) {
      return { spreadsheetId: e.GOOGLE_SHEETS_MERCHANDISE_ID, sheetName: "Merchandise Orders", range: "A:A" };
    }
    if (e.GOOGLE_MASTER_SPREADSHEET_ID) {
      return { spreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID, sheetName: "Merchandise Orders", range: "'Merchandise Orders'!A:A" };
    }
    if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
      return { spreadsheetId: "webhook_default", sheetName: "Merchandise Orders", range: "A:A" };
    }
  }

  if (kind === "GROUP_ENTRY") {
    if (e.GOOGLE_SHEETS_GROUP_ENTRY_ID) {
      return { spreadsheetId: e.GOOGLE_SHEETS_GROUP_ENTRY_ID, sheetName: "Group Entries", range: "A:A" };
    }
    if (e.GOOGLE_MASTER_SPREADSHEET_ID) {
      return { spreadsheetId: e.GOOGLE_MASTER_SPREADSHEET_ID, sheetName: "Group Entries", range: "'Group Entries'!A:A" };
    }
    if (e.GOOGLE_SHEETS_WEBHOOK_URL) {
      return { spreadsheetId: "webhook_default", sheetName: "Group Entries", range: "A:A" };
    }
  }

  return { spreadsheetId: null, sheetName: "Sheet1", range: "A:A" };
}

interface PassRecord {
  id: string;
  public_pass_code: string;
  state: string;
  activated_at: string | null;
  pass_products?: { name?: string; slug?: string; is_base_pass?: boolean } | Array<{ name?: string; slug?: string; is_base_pass?: boolean }> | null;
}

interface RegistrationRecord {
  id: string;
  public_registration_code: string | null;
  registration_mode: string;
  team_name: string | null;
  state: string;
  confirmed_at: string | null;
  events?: {
    name?: string;
    category_id?: string;
    starts_at?: string;
    venue_id?: string;
    categories?: { name?: string } | Array<{ name?: string }> | null;
    venues?: { name?: string } | Array<{ name?: string }> | null;
  } | Array<{
    name?: string;
    category_id?: string;
    starts_at?: string;
    venue_id?: string;
    categories?: { name?: string } | Array<{ name?: string }> | null;
    venues?: { name?: string } | Array<{ name?: string }> | null;
  }> | null;
}

/**
 * Sync a fulfilled order to the respective spreadsheet(s) asynchronously.
 */
export async function syncOrderToSpreadsheets(orderId: string): Promise<{ synced: boolean; error?: string }> {
  const e = env();
  if (!e.GOOGLE_SHEETS_ENABLED) {
    logger().debug({ orderId }, "google sheets sync skipped — GOOGLE_SHEETS_ENABLED is false");
    return { synced: true };
  }

  const sb = createServiceRoleClient();

  const { data: order, error: orderErr } = await sb
    .from("orders")
    .select("id, purchaser_user_id, festival_id, public_order_code, amount_paise, currency, kind, fulfilled_at, created_at")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    const err = orderErr ? orderErr.message : "Order not found";
    logger().error({ orderId, err }, "google sheets sync: failed to load order");
    return { synced: false, error: err };
  }

  // 1. Atomic Pre-Lock: Claim this order in DB BEFORE starting any network calls.
  // Database unique constraint (festival_id, entity_type, entity_id, entity_version)
  // guarantees that only 1 concurrent process wins the lock; all others exit immediately.
  const { data: lockRow, error: lockErr } = await sb
    .from("sheets_sync_items")
    .insert({
      festival_id: order.festival_id,
      entity_type: "ORDER",
      entity_id: order.id,
      entity_version: 1,
      sync_state: "IN_PROGRESS",
    })
    .select("id")
    .maybeSingle();

  if (lockErr || !lockRow) {
    logger().info({ orderId }, "sheets sync already claimed or completed by another thread — skipping duplicate");
    return { synced: true };
  }

  try {
    const { data: profile } = await sb
      .from("profiles")
      .select("display_name, phone_e164, college_name")
      .eq("user_id", order.purchaser_user_id)
      .maybeSingle();

    let email = "";
    try {
      const { data: user } = await sb.auth.admin.getUserById(order.purchaser_user_id);
      email = user.user?.email ?? "";
    } catch (userFetchErr) {
      logger().warn({ err: userFetchErr, userId: order.purchaser_user_id }, "could not fetch user email for sheets");
    }

    const name = profile?.display_name || "Participant";
    const phone = profile?.phone_e164 || "—";
    const college = profile?.college_name || "—";
    const timestamp = new Date(order.fulfilled_at ?? order.created_at).toISOString();
    const amountStr = formatPaise(Number(order.amount_paise));

    // Look up provider payment reference (e.g. Razorpay pay_...)
    const { data: payment } = await sb
      .from("payments")
      .select("razorpay_payment_id")
      .eq("local_order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const paymentId = payment?.razorpay_payment_id || "—";

    // Find associated order lines
    const { data: orderLines } = await sb
      .from("order_lines")
      .select("id, pass_product_id, event_id, pass_products ( name, slug, is_base_pass ), events ( name )")
      .eq("order_id", order.id);

    const primaryLine = orderLines?.[0];

    if (order.kind === "BASE_PASS") {
      // Look up pass created from this order line or latest active for user
      let pass: PassRecord | null = null;

      if (primaryLine?.id) {
        const { data: directPass } = await sb
          .from("delegate_passes")
          .select("id, public_pass_code, state, activated_at, pass_products ( name, slug, is_base_pass )")
          .eq("source_order_line_id", primaryLine.id)
          .maybeSingle();
        if (directPass) pass = directPass as unknown as PassRecord;
      }

      if (!pass) {
        const { data: fallbackPass } = await sb
          .from("delegate_passes")
          .select("id, public_pass_code, state, activated_at, pass_products ( name, slug, is_base_pass )")
          .eq("user_id", order.purchaser_user_id)
          .eq("state", "ACTIVE")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fallbackPass) pass = fallbackPass as unknown as PassRecord;
      }

      const prodFromLine = primaryLine?.pass_products;
      const prodFromPass = pass?.pass_products;
      const prod = (Array.isArray(prodFromPass) ? prodFromPass[0] : prodFromPass) ??
        (Array.isArray(prodFromLine) ? prodFromLine[0] : prodFromLine);

      const isDelegate =
        prod?.slug === "vip-delegate-pass" ||
        prod?.name?.toLowerCase().includes("delegate") ||
        prod?.name?.toLowerCase().includes("all-access") ||
        Number(order.amount_paise) >= 200000;

      const passCode = pass?.public_pass_code ?? `PASS-${order.public_order_code.slice(3)}`;
      const passState = pass?.state ?? "ACTIVE";
      const activatedAt = pass?.activated_at ?? timestamp;

      if (isDelegate) {
        const target = resolveSheetTarget("DELEGATE_PASS");
        if (!target.spreadsheetId) {
          logger().warn({ orderId }, "no spreadsheet configured for DELEGATE_PASS");
          return { synced: true };
        }

        const row = [
          timestamp,
          passCode,
          name,
          email,
          phone,
          college,
          order.public_order_code,
          paymentId,
          amountStr,
          passState,
          "YES (All 5 Star Concerts)",
          "VIP Front-Row Zone",
          activatedAt,
        ];
        const res = await appendToGoogleSheet(target.spreadsheetId, target.range, [row], {
          sheetKind: "DELEGATE_PASS",
          sheetName: target.sheetName,
        });

        await sb
          .from("sheets_sync_items")
          .update({
            sync_state: res.success ? "SYNCED" : "FAILED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", lockRow.id);

        logger().info({ orderId, success: res.success, error: res.error }, "delegate pass sync result");
        return { synced: res.success, error: res.error };
      } else {
        const target = resolveSheetTarget("BASIC_PASS");
        if (!target.spreadsheetId) {
          logger().warn({ orderId }, "no spreadsheet configured for BASIC_PASS");
          return { synced: true };
        }

        const row = [
          timestamp,
          passCode,
          name,
          email,
          phone,
          college,
          order.public_order_code,
          paymentId,
          amountStr,
          passState,
          activatedAt,
        ];
        const res = await appendToGoogleSheet(target.spreadsheetId, target.range, [row], {
          sheetKind: "BASIC_PASS",
          sheetName: target.sheetName,
        });

        await sb
          .from("sheets_sync_items")
          .update({
            sync_state: res.success ? "SYNCED" : "FAILED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", lockRow.id);

        logger().info({ orderId, success: res.success, error: res.error }, "basic pass sync result");
        return { synced: res.success, error: res.error };
      }
    }

    if (order.kind === "EVENT") {
      const target = resolveSheetTarget("EVENT");
      if (!target.spreadsheetId) {
        logger().warn({ orderId }, "no spreadsheet configured for EVENT");
        return { synced: true };
      }

      let reg: RegistrationRecord | null = null;

      if (primaryLine?.id) {
        const { data: directReg } = await sb
          .from("registrations")
          .select(
            `id, public_registration_code, registration_mode, team_name, state, confirmed_at,
             events ( name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
          )
          .eq("order_line_id", primaryLine.id)
          .maybeSingle();
        if (directReg) reg = directReg as unknown as RegistrationRecord;
      }

      if (!reg) {
        const { data: fallbackReg } = await sb
          .from("registrations")
          .select(
            `id, public_registration_code, registration_mode, team_name, state, confirmed_at,
             events ( name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
          )
          .eq("owner_user_id", order.purchaser_user_id)
          .order("confirmed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fallbackReg) reg = fallbackReg as unknown as RegistrationRecord;
      }

      const evRaw = reg?.events;
      const ev = Array.isArray(evRaw) ? evRaw[0] : evRaw;
      const catRaw = ev?.categories;
      const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
      const venueRaw = ev?.venues;
      const venue = Array.isArray(venueRaw) ? venueRaw[0] : venueRaw;

      // Get team members if team registration
      let membersList = "";
      if (reg?.id && reg.registration_mode === "TEAM") {
        const { data: members } = await sb
          .from("registration_members")
          .select("user_id, role")
          .eq("registration_id", reg.id);
        membersList = (members ?? []).map((m) => `${m.role}: ${m.user_id}`).join("; ");
      }

      const row = [
        timestamp,
        reg?.public_registration_code ?? `REG-${order.public_order_code.slice(3)}`,
        ev?.name ?? "Event",
        cat?.name ?? "General",
        ev?.starts_at ?? "",
        venue?.name ?? "Main Campus",
        reg?.registration_mode ?? "INDIVIDUAL",
        name,
        email,
        phone,
        college,
        reg?.team_name ?? "—",
        membersList || "Individual",
        order.public_order_code,
        paymentId,
        amountStr,
        reg?.state ?? "CONFIRMED",
      ];

      const res = await appendToGoogleSheet(target.spreadsheetId, target.range, [row], {
        sheetKind: "EVENT",
        sheetName: target.sheetName,
      });

      await sb
        .from("sheets_sync_items")
        .update({
          sync_state: res.success ? "SYNCED" : "FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", lockRow.id);

      return { synced: res.success, error: res.error };
    }

    if (order.kind === "MERCHANDISE") {
      const target = resolveSheetTarget("MERCHANDISE");
      if (!target.spreadsheetId) {
        logger().warn({ orderId }, "no spreadsheet configured for MERCHANDISE");
        return { synced: true };
      }

      const { data: merchOrder } = await sb
        .from("merchandise_orders")
        .select("item_name, selected_size, quantity, unit_price_paise, total_amount_paise, recipient_name, recipient_email, recipient_phone, delivery_mode, shipping_address, state, public_order_code")
        .eq("order_id", order.id)
        .maybeSingle();

      const itemName = merchOrder?.item_name || "Fest Merchandise";
      const size = merchOrder?.selected_size || "Standard";
      const qty = merchOrder?.quantity || 1;
      const unitAmountStr = merchOrder?.unit_price_paise ? formatPaise(Number(merchOrder.unit_price_paise)) : amountStr;
      const totalAmountStr = formatPaise(Number(order.amount_paise));
      const customerName = merchOrder?.recipient_name || name;
      const customerEmail = merchOrder?.recipient_email || email;
      const customerPhone = merchOrder?.recipient_phone || phone;
      const deliveryMode = "Campus Pickup";
      const address = "Campus Quadrangle Counter";
      const orderStatus = merchOrder?.state || "CONFIRMED";

      const row = [
        timestamp,
        order.public_order_code,
        paymentId,
        itemName,
        size,
        qty,
        unitAmountStr,
        totalAmountStr,
        customerName,
        customerEmail,
        customerPhone,
        deliveryMode,
        address,
        orderStatus,
      ];

      const res = await appendToGoogleSheet(target.spreadsheetId, target.range, [row], {
        sheetKind: "MERCHANDISE",
        sheetName: target.sheetName,
      });

      await sb
        .from("sheets_sync_items")
        .update({
          sync_state: res.success ? "SYNCED" : "FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", lockRow.id);

      if (res.success) {
        await sb
          .from("merchandise_orders")
          .update({ synced_to_sheets: true })
          .eq("order_id", order.id);
      }

      logger().info({ orderId, success: res.success, error: res.error }, "merchandise order sync result");
      return { synced: res.success, error: res.error };
    }

    return { synced: true };
  } catch (err) {
    await sb
      .from("sheets_sync_items")
      .update({
        sync_state: "FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lockRow.id);
    throw err;
  }
}

/**
 * Sync a public group-entry submission to the Group Entries spreadsheet.
 *
 * Best-effort mirror of a `group_entries` row (plan §7.16). Unlike order syncs,
 * group entries carry no festival FK, so they do not use the `sheets_sync_items`
 * lock table; the route invokes this once per submission and treats failure as
 * non-fatal (the DB row and organizer email are the durable records).
 */
export async function syncGroupEntryToSheet(entryId: string): Promise<{ synced: boolean; error?: string }> {
  const e = env();
  if (!e.GOOGLE_SHEETS_ENABLED) {
    logger().debug({ entryId }, "group entry sheets sync skipped — GOOGLE_SHEETS_ENABLED is false");
    return { synced: true };
  }

  const target = resolveSheetTarget("GROUP_ENTRY");
  if (!target.spreadsheetId) {
    logger().warn({ entryId }, "no spreadsheet configured for GROUP_ENTRY");
    return { synced: true };
  }

  const sb = createServiceRoleClient();
  const { data: entry, error: entryErr } = await sb
    .from("group_entries")
    .select("id, public_entry_code, lead_name, email, phone, college, group_size, notes, created_at")
    .eq("id", entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    const err = entryErr ? entryErr.message : "Group entry not found";
    logger().error({ entryId, err }, "group entry sheets sync: failed to load entry");
    return { synced: false, error: err };
  }

  const row = [
    entry.created_at,
    entry.public_entry_code,
    entry.lead_name,
    entry.email,
    entry.phone,
    entry.college ?? "",
    entry.group_size,
    entry.notes ?? "",
  ];

  const res = await appendToGoogleSheet(target.spreadsheetId, target.range, [row], {
    sheetKind: "GROUP_ENTRY",
    sheetName: target.sheetName,
  });

  logger().info({ entryId, success: res.success, error: res.error }, "group entry sync result");
  return { synced: res.success, error: res.error };
}

/**
 * Incremental Historical Sync / Backfill: Exports only confirmed/fulfilled records
 * from the database that have NOT yet been synced to Google Sheets.
 *
 * Idempotent & Deduplicated:
 * - Checks sheets_sync_items for already-synced orders (sync_state = 'SYNCED')
 * - Skips already-synced records so repeated calls append 0 duplicate rows
 * - Batches unsynced records into single append requests per sheet category
 * - Atomically marks newly synced orders in sheets_sync_items
 */
export async function syncAllHistoricalRecordsToSheets(): Promise<{
  basicPasses: number;
  delegatePasses: number;
  events: number;
  merchandise: number;
  total: number;
}> {
  const e = env();
  if (!e.GOOGLE_SHEETS_ENABLED) {
    logger().debug("google sheets sync skipped — GOOGLE_SHEETS_ENABLED is false");
    return { basicPasses: 0, delegatePasses: 0, events: 0, merchandise: 0, total: 0 };
  }

  const sb = createServiceRoleClient();

  // 1. Fetch all successfully synced order IDs to skip already synced records
  const { data: syncedItems, error: syncErr } = await sb
    .from("sheets_sync_items")
    .select("entity_id")
    .eq("entity_type", "ORDER")
    .eq("sync_state", "SYNCED");

  if (syncErr) {
    logger().error({ err: syncErr.message }, "failed to fetch sheets_sync_items during historical sync");
  }

  const syncedOrderIds = new Set<string>((syncedItems ?? []).map((i) => i.entity_id));

  // 2. Fetch all FULFILLED orders
  const { data: orders, error: ordersErr } = await sb
    .from("orders")
    .select("id, purchaser_user_id, festival_id, public_order_code, amount_paise, currency, kind, fulfilled_at, created_at, state")
    .eq("state", "FULFILLED")
    .order("created_at", { ascending: true });

  if (ordersErr || !orders || orders.length === 0) {
    return { basicPasses: 0, delegatePasses: 0, events: 0, merchandise: 0, total: 0 };
  }

  // Filter for unsynced orders only
  const unsyncedOrders = orders.filter((o) => !syncedOrderIds.has(o.id));
  if (unsyncedOrders.length === 0) {
    logger().info("all fulfilled orders already synced to google sheets — 0 duplicate rows appended");
    return { basicPasses: 0, delegatePasses: 0, events: 0, merchandise: 0, total: 0 };
  }

  logger().info({ unsyncedCount: unsyncedOrders.length }, "starting incremental sync for unsynced orders");

  const unsyncedOrderIds = unsyncedOrders.map((o) => o.id);
  const unsyncedUserIds = Array.from(new Set(unsyncedOrders.map((o) => o.purchaser_user_id)));

  // Batch fetch profiles
  const { data: profiles } = await sb
    .from("profiles")
    .select("user_id, display_name, phone_e164, college_name")
    .in("user_id", unsyncedUserIds);
  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

  // Batch fetch payments
  const { data: payments } = await sb
    .from("payments")
    .select("local_order_id, razorpay_payment_id, created_at")
    .in("local_order_id", unsyncedOrderIds)
    .order("created_at", { ascending: false });
  const paymentMap = new Map<string, string>();
  for (const p of payments ?? []) {
    if (p.local_order_id && !paymentMap.has(p.local_order_id) && p.razorpay_payment_id) {
      paymentMap.set(p.local_order_id, p.razorpay_payment_id);
    }
  }

  // Batch fetch order lines with pass products and events
  const { data: orderLines } = await sb
    .from("order_lines")
    .select(
      `id, order_id, pass_product_id, event_id,
       pass_products ( id, name, slug, is_base_pass ),
       events ( id, name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
    )
    .in("order_id", unsyncedOrderIds);

  const orderLinesByOrderId = new Map<string, NonNullable<typeof orderLines>>();
  for (const line of orderLines ?? []) {
    if (!orderLinesByOrderId.has(line.order_id)) {
      orderLinesByOrderId.set(line.order_id, []);
    }
    orderLinesByOrderId.get(line.order_id)!.push(line);
  }

  // Batch fetch passes for these order lines
  const lineIds = (orderLines ?? []).map((l) => l.id);
  const { data: passes } = lineIds.length > 0
    ? await sb
        .from("delegate_passes")
        .select("id, public_pass_code, user_id, state, activated_at, source_order_line_id, pass_products ( name, slug, is_base_pass )")
        .in("source_order_line_id", lineIds)
    : { data: [] };
  const passByLineId = new Map((passes ?? []).map((p) => [p.source_order_line_id, p]));

  // Batch fetch registrations for these order lines
  const { data: registrations } = lineIds.length > 0
    ? await sb
        .from("registrations")
        .select(
          `id, public_registration_code, order_line_id, registration_mode, team_name, state, confirmed_at,
           events ( name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
        )
        .in("order_line_id", lineIds)
    : { data: [] };
  const regByLineId = new Map((registrations ?? []).map((r) => [r.order_line_id, r]));

  // Batch fetch merchandise orders
  const { data: merchandiseOrders } = await sb
    .from("merchandise_orders")
    .select("*")
    .in("order_id", unsyncedOrderIds);
  const merchByOrderId = new Map((merchandiseOrders ?? []).map((m) => [m.order_id, m]));

  // Helper to fetch user email with in-memory caching
  const userEmailCache = new Map<string, string>();
  async function getUserEmail(userId: string): Promise<string> {
    if (userEmailCache.has(userId)) return userEmailCache.get(userId)!;
    try {
      const { data } = await sb.auth.admin.getUserById(userId);
      const email = data?.user?.email ?? "";
      userEmailCache.set(userId, email);
      return email;
    } catch {
      return "";
    }
  }

  // Buckets for rows to append
  const basicRows: unknown[][] = [];
  const basicOrderIds: { id: string; festival_id: string }[] = [];

  const delegateRows: unknown[][] = [];
  const delegateOrderIds: { id: string; festival_id: string }[] = [];

  const eventRows: unknown[][] = [];
  const eventOrderIds: { id: string; festival_id: string }[] = [];

  const merchRows: unknown[][] = [];
  const merchOrderIds: { id: string; festival_id: string }[] = [];

  for (const order of unsyncedOrders) {
    const prof = profileMap.get(order.purchaser_user_id);
    const email = await getUserEmail(order.purchaser_user_id);
    const name = prof?.display_name || "Participant";
    const phone = prof?.phone_e164 || "—";
    const college = prof?.college_name || "—";
    const timestamp = new Date(order.fulfilled_at ?? order.created_at).toISOString();
    const amountStr = formatPaise(Number(order.amount_paise));
    const paymentId = paymentMap.get(order.id) || "—";

    const lines = orderLinesByOrderId.get(order.id) ?? [];
    const primaryLine = lines[0];

    if (order.kind === "BASE_PASS") {
      const pass = primaryLine?.id ? passByLineId.get(primaryLine.id) : null;
      const prodFromLine = primaryLine?.pass_products;
      const prodFromPass = pass?.pass_products;
      const prod = (Array.isArray(prodFromPass) ? prodFromPass[0] : prodFromPass) ??
        (Array.isArray(prodFromLine) ? prodFromLine[0] : prodFromLine);

      const isDelegate =
        prod?.slug === "vip-delegate-pass" ||
        prod?.name?.toLowerCase().includes("delegate") ||
        prod?.name?.toLowerCase().includes("all-access") ||
        Number(order.amount_paise) >= 200000;

      const passCode = pass?.public_pass_code ?? `PASS-${order.public_order_code.slice(3)}`;
      const passState = pass?.state ?? "ACTIVE";
      const activatedAt = pass?.activated_at ?? timestamp;

      if (isDelegate) {
        delegateRows.push([
          timestamp,
          passCode,
          name,
          email,
          phone,
          college,
          order.public_order_code,
          paymentId,
          amountStr,
          passState,
          "YES (All 5 Star Concerts)",
          "VIP Front-Row Zone",
          activatedAt,
        ]);
        delegateOrderIds.push({ id: order.id, festival_id: order.festival_id });
      } else {
        basicRows.push([
          timestamp,
          passCode,
          name,
          email,
          phone,
          college,
          order.public_order_code,
          paymentId,
          amountStr,
          passState,
          activatedAt,
        ]);
        basicOrderIds.push({ id: order.id, festival_id: order.festival_id });
      }
    } else if (order.kind === "EVENT") {
      const reg = primaryLine?.id ? regByLineId.get(primaryLine.id) : null;
      const evRaw = reg?.events ?? primaryLine?.events;
      const ev = Array.isArray(evRaw) ? evRaw[0] : evRaw;
      const catRaw = ev?.categories;
      const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
      const venueRaw = ev?.venues;
      const venue = Array.isArray(venueRaw) ? venueRaw[0] : venueRaw;

      eventRows.push([
        timestamp,
        reg?.public_registration_code ?? `REG-${order.public_order_code.slice(3)}`,
        ev?.name ?? "Event",
        cat?.name ?? "General",
        ev?.starts_at ?? "",
        venue?.name ?? "Main Campus",
        reg?.registration_mode ?? "INDIVIDUAL",
        name,
        email,
        phone,
        college,
        reg?.team_name ?? "—",
        reg?.registration_mode === "TEAM" ? "Team Registered" : "Individual",
        order.public_order_code,
        paymentId,
        amountStr,
        reg?.state ?? "CONFIRMED",
      ]);
      eventOrderIds.push({ id: order.id, festival_id: order.festival_id });
    } else if (order.kind === "MERCHANDISE") {
      const merchOrder = merchByOrderId.get(order.id);
      const itemName = merchOrder?.item_name || "Fest Merchandise";
      const size = merchOrder?.selected_size || "Standard";
      const qty = merchOrder?.quantity || 1;
      const unitAmountStr = merchOrder?.unit_price_paise ? formatPaise(Number(merchOrder.unit_price_paise)) : amountStr;
      const totalAmountStr = formatPaise(Number(order.amount_paise));
      const customerName = merchOrder?.recipient_name || name;
      const customerEmail = merchOrder?.recipient_email || email;
      const customerPhone = merchOrder?.recipient_phone || phone;
      const deliveryMode = "Campus Pickup";
      const address = "Campus Quadrangle Counter";
      const orderStatus = merchOrder?.state || "CONFIRMED";

      merchRows.push([
        timestamp,
        order.public_order_code,
        paymentId,
        itemName,
        size,
        qty,
        unitAmountStr,
        totalAmountStr,
        customerName,
        customerEmail,
        customerPhone,
        deliveryMode,
        address,
        orderStatus,
      ]);
      merchOrderIds.push({ id: order.id, festival_id: order.festival_id });
    }
  }

  // Execute Appends & record sync states in sheets_sync_items
  let basicSuccessCount = 0;
  let delegateSuccessCount = 0;
  let eventSuccessCount = 0;
  let merchSuccessCount = 0;

  // 1. Basic Passes
  if (basicRows.length > 0) {
    const basicTarget = resolveSheetTarget("BASIC_PASS");
    if (basicTarget.spreadsheetId) {
      const res = await appendToGoogleSheet(basicTarget.spreadsheetId, basicTarget.range, basicRows, {
        sheetKind: "BASIC_PASS",
        sheetName: basicTarget.sheetName,
      });
      if (res.success) {
        basicSuccessCount = basicRows.length;
        await sb.from("sheets_sync_items").upsert(
          basicOrderIds.map((item) => ({
            festival_id: item.festival_id,
            entity_type: "ORDER",
            entity_id: item.id,
            entity_version: 1,
            sync_state: "SYNCED",
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "festival_id,entity_type,entity_id,entity_version" }
        );
      } else {
        logger().error({ err: res.error }, "failed to append basic passes to google sheets");
      }
    }
  }

  // 2. Delegate Passes
  if (delegateRows.length > 0) {
    const delegateTarget = resolveSheetTarget("DELEGATE_PASS");
    if (delegateTarget.spreadsheetId) {
      const res = await appendToGoogleSheet(delegateTarget.spreadsheetId, delegateTarget.range, delegateRows, {
        sheetKind: "DELEGATE_PASS",
        sheetName: delegateTarget.sheetName,
      });
      if (res.success) {
        delegateSuccessCount = delegateRows.length;
        await sb.from("sheets_sync_items").upsert(
          delegateOrderIds.map((item) => ({
            festival_id: item.festival_id,
            entity_type: "ORDER",
            entity_id: item.id,
            entity_version: 1,
            sync_state: "SYNCED",
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "festival_id,entity_type,entity_id,entity_version" }
        );
      } else {
        logger().error({ err: res.error }, "failed to append delegate passes to google sheets");
      }
    }
  }

  // 3. Events
  if (eventRows.length > 0) {
    const eventTarget = resolveSheetTarget("EVENT");
    if (eventTarget.spreadsheetId) {
      const res = await appendToGoogleSheet(eventTarget.spreadsheetId, eventTarget.range, eventRows, {
        sheetKind: "EVENT",
        sheetName: eventTarget.sheetName,
      });
      if (res.success) {
        eventSuccessCount = eventRows.length;
        await sb.from("sheets_sync_items").upsert(
          eventOrderIds.map((item) => ({
            festival_id: item.festival_id,
            entity_type: "ORDER",
            entity_id: item.id,
            entity_version: 1,
            sync_state: "SYNCED",
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "festival_id,entity_type,entity_id,entity_version" }
        );
      } else {
        logger().error({ err: res.error }, "failed to append events to google sheets");
      }
    }
  }

  // 4. Merchandise
  if (merchRows.length > 0) {
    const merchTarget = resolveSheetTarget("MERCHANDISE");
    if (merchTarget.spreadsheetId) {
      const res = await appendToGoogleSheet(merchTarget.spreadsheetId, merchTarget.range, merchRows, {
        sheetKind: "MERCHANDISE",
        sheetName: merchTarget.sheetName,
      });
      if (res.success) {
        merchSuccessCount = merchRows.length;
        await sb.from("sheets_sync_items").upsert(
          merchOrderIds.map((item) => ({
            festival_id: item.festival_id,
            entity_type: "ORDER",
            entity_id: item.id,
            entity_version: 1,
            sync_state: "SYNCED",
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "festival_id,entity_type,entity_id,entity_version" }
        );
        await sb
          .from("merchandise_orders")
          .update({ synced_to_sheets: true })
          .in("order_id", merchOrderIds.map((m) => m.id));
      } else {
        logger().error({ err: res.error }, "failed to append merchandise to google sheets");
      }
    }
  }

  const total = basicSuccessCount + delegateSuccessCount + eventSuccessCount + merchSuccessCount;
  logger().info(
    { basicPasses: basicSuccessCount, delegatePasses: delegateSuccessCount, events: eventSuccessCount, merchandise: merchSuccessCount, total },
    "incremental google sheets sync completed"
  );

  return {
    basicPasses: basicSuccessCount,
    delegatePasses: delegateSuccessCount,
    events: eventSuccessCount,
    merchandise: merchSuccessCount,
    total,
  };
}
