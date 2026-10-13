import "server-only";
import { importPKCS8, SignJWT } from "jose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { formatPaise } from "@/lib/money";
import { isPronitePassProduct } from "@/lib/pronite-pass";
import { fetchAllPages, fetchInChunks } from "@/lib/supabase/paginate";

/**
 * Google Sheets 3-Spreadsheet Audit & Backup Sync Service (plan §7.16, §12.18).
 *
 * Synchronizes registrations to dedicated Google Spreadsheets:
 * 1. Pronite Pass holders (the "Delegate Passes" sheet — env/tab names kept
 *    from when this was the VIP Delegate product)
 * 2. All Events Registrations
 * 3. Merchandise orders
 * Retired Basic Card orders still route to the "Basic Passes" sheet.
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
  "Pass Type",
  "Pronite Access",
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

type PassProductInfo = { name?: string; slug?: string; is_base_pass?: boolean };

/**
 * Pronite Pass orders go to the "Delegate Passes" sheet; only retired Basic
 * Card orders go to "Basic Passes". A pass with no product row is treated as
 * the Pronite Pass, matching the gate-QR route.
 */
function isPronitePassOrder(prod: PassProductInfo | null | undefined): boolean {
  return prod == null || isPronitePassProduct(prod);
}

function pronitePassRow(base: {
  timestamp: string;
  passCode: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  orderCode: string;
  paymentId: string;
  amountStr: string;
  passState: string;
  productName: string | undefined;
  activatedAt: string;
}): unknown[] {
  return [
    base.timestamp,
    base.passCode,
    base.name,
    base.email,
    base.phone,
    base.college,
    base.orderCode,
    base.paymentId,
    base.amountStr,
    base.passState,
    base.productName ?? "Pronite Pass",
    "YES",
    base.activatedAt,
  ];
}

/** A claim older than this is presumed abandoned by a crashed sync. */
const STALE_SYNC_CLAIM_MS = 10 * 60_000;

type SyncClaim =
  | { claimed: true; id: string }
  | { claimed: false; state: "SYNCED" | "IN_PROGRESS" | "ERROR"; error?: string };

/**
 * Claim an order's sheets_sync_items row. The unique key lets exactly one
 * caller insert it; a FAILED row, or an IN_PROGRESS row whose owner died, is
 * reclaimed by a conditional update (atomic per row), so failed syncs can be
 * retried instead of being skipped forever.
 */
async function claimOrderSync(
  sb: ReturnType<typeof createServiceRoleClient>,
  festivalId: string,
  orderId: string
): Promise<SyncClaim> {
  const { data: inserted, error: insertErr } = await sb
    .from("sheets_sync_items")
    .insert({
      festival_id: festivalId,
      entity_type: "ORDER",
      entity_id: orderId,
      entity_version: 1,
      sync_state: "IN_PROGRESS",
    })
    .select("id")
    .maybeSingle();
  if (inserted) return { claimed: true, id: inserted.id };
  if (insertErr && insertErr.code !== "23505") {
    return { claimed: false, state: "ERROR", error: insertErr.message };
  }

  const staleBefore = new Date(Date.now() - STALE_SYNC_CLAIM_MS).toISOString();
  const { data: reclaimed } = await sb
    .from("sheets_sync_items")
    .update({ sync_state: "IN_PROGRESS", updated_at: new Date().toISOString() })
    .eq("festival_id", festivalId)
    .eq("entity_type", "ORDER")
    .eq("entity_id", orderId)
    .eq("entity_version", 1)
    .or(`sync_state.eq.FAILED,and(sync_state.eq.IN_PROGRESS,updated_at.lt."${staleBefore}")`)
    .select("id")
    .maybeSingle();
  if (reclaimed) return { claimed: true, id: reclaimed.id };

  const { data: existing } = await sb
    .from("sheets_sync_items")
    .select("sync_state")
    .eq("festival_id", festivalId)
    .eq("entity_type", "ORDER")
    .eq("entity_id", orderId)
    .eq("entity_version", 1)
    .maybeSingle();
  return {
    claimed: false,
    state: existing?.sync_state === "SYNCED" ? "SYNCED" : "IN_PROGRESS",
  };
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
export async function syncOrderToSpreadsheets(
  orderId: string
): Promise<{ synced: boolean; error?: string; inProgress?: boolean }> {
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

  // 1. Claim this order in the DB BEFORE any network calls, so concurrent
  // callers (browser verify, webhook, outbox) append at most one row.
  const claim = await claimOrderSync(sb, order.festival_id, order.id);
  if (!claim.claimed) {
    if (claim.state === "SYNCED") return { synced: true };
    if (claim.state === "ERROR") return { synced: false, error: claim.error };
    // Another caller holds the claim; the SHEETS_SYNC job re-checks later.
    return { synced: false, inProgress: true, error: "sheets sync already in progress" };
  }
  const lockRow = { id: claim.id };

  // No spreadsheet for this kind: drop the claim so a later config fix plus
  // "Sync all" can still mirror the order.
  const releaseClaim = async () => {
    await sb.from("sheets_sync_items").delete().eq("id", lockRow.id);
  };

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

      const isPronite = isPronitePassOrder(prod);

      const passCode = pass?.public_pass_code ?? `PASS-${order.public_order_code.slice(3)}`;
      const passState = pass?.state ?? "ACTIVE";
      const activatedAt = pass?.activated_at ?? timestamp;

      if (isPronite) {
        const target = resolveSheetTarget("DELEGATE_PASS");
        if (!target.spreadsheetId) {
          logger().warn({ orderId }, "no spreadsheet configured for DELEGATE_PASS");
          await releaseClaim();
          return { synced: true };
        }

        const row = pronitePassRow({
          timestamp,
          passCode,
          name,
          email,
          phone,
          college,
          orderCode: order.public_order_code,
          paymentId,
          amountStr,
          passState,
          productName: prod?.name,
          activatedAt,
        });
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

        logger().info({ orderId, success: res.success, error: res.error }, "pronite pass sync result");
        return { synced: res.success, error: res.error };
      } else {
        const target = resolveSheetTarget("BASIC_PASS");
        if (!target.spreadsheetId) {
          logger().warn({ orderId }, "no spreadsheet configured for BASIC_PASS");
          await releaseClaim();
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
        await releaseClaim();
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
        await releaseClaim();
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
      const address = "Festival Merch Counter";
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
 * - Claims each order in sheets_sync_items before appending (the same claim
 *   the per-order sync uses), so a concurrent per-order sync and this backfill
 *   never both append the same order
 * - Skips SYNCED orders and orders another caller is actively syncing;
 *   reclaims FAILED and abandoned claims
 * - Pages past PostgREST's 1000-row cap and appends in bounded batches
 */
export async function syncAllHistoricalRecordsToSheets(): Promise<{
  basicPasses: number;
  delegatePasses: number;
  events: number;
  merchandise: number;
  total: number;
}> {
  const empty = { basicPasses: 0, delegatePasses: 0, events: 0, merchandise: 0, total: 0 };
  const e = env();
  if (!e.GOOGLE_SHEETS_ENABLED) {
    logger().debug("google sheets sync skipped — GOOGLE_SHEETS_ENABLED is false");
    return empty;
  }

  const sb = createServiceRoleClient();

  // 1. Orders that are already synced, or claimed by a live sync, are skipped.
  type SyncItem = { entity_id: string; sync_state: string; updated_at: string };
  const syncItems = await fetchAllPages<SyncItem>((from, to) =>
    sb
      .from("sheets_sync_items")
      .select("entity_id, sync_state, updated_at")
      .eq("entity_type", "ORDER")
      .in("sync_state", ["SYNCED", "IN_PROGRESS"])
      .order("id")
      .range(from, to)
  );
  const staleBefore = Date.now() - STALE_SYNC_CLAIM_MS;
  const skipOrderIds = new Set(
    syncItems
      .filter(
        (i) => i.sync_state === "SYNCED" || new Date(i.updated_at).getTime() >= staleBefore
      )
      .map((i) => i.entity_id)
  );

  // 2. Every FULFILLED order.
  type OrderRow = {
    id: string;
    purchaser_user_id: string;
    festival_id: string;
    public_order_code: string;
    amount_paise: number | string;
    currency: string;
    kind: string;
    fulfilled_at: string | null;
    created_at: string;
  };
  const orders = await fetchAllPages<OrderRow>((from, to) =>
    sb
      .from("orders")
      .select("id, purchaser_user_id, festival_id, public_order_code, amount_paise, currency, kind, fulfilled_at, created_at")
      .eq("checkout_state", "FULFILLED")
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, to)
  );

  const candidates = orders.filter((o) => !skipOrderIds.has(o.id));
  if (candidates.length === 0) {
    logger().info("all fulfilled orders already synced to google sheets — 0 duplicate rows appended");
    return empty;
  }

  // 3. Claim the candidates: insert fresh claims, reclaim FAILED/abandoned
  // ones. Only orders this call actually claimed are appended.
  const claimedIds = new Set<string>();
  const nowIso = new Date().toISOString();
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200);
    const { data: inserted, error: insertErr } = await sb
      .from("sheets_sync_items")
      .upsert(
        chunk.map((o) => ({
          festival_id: o.festival_id,
          entity_type: "ORDER",
          entity_id: o.id,
          entity_version: 1,
          sync_state: "IN_PROGRESS",
          updated_at: nowIso,
        })),
        { onConflict: "festival_id,entity_type,entity_id,entity_version", ignoreDuplicates: true }
      )
      .select("entity_id");
    if (insertErr) throw new Error(`sheets claim failed: ${insertErr.message}`);
    for (const row of inserted ?? []) claimedIds.add(row.entity_id);

    const { data: reclaimed, error: reclaimErr } = await sb
      .from("sheets_sync_items")
      .update({ sync_state: "IN_PROGRESS", updated_at: nowIso })
      .eq("entity_type", "ORDER")
      .eq("entity_version", 1)
      .in("entity_id", chunk.map((o) => o.id))
      .or(
        `sync_state.eq.FAILED,and(sync_state.eq.IN_PROGRESS,updated_at.lt."${new Date(staleBefore).toISOString()}")`
      )
      .select("entity_id");
    if (reclaimErr) throw new Error(`sheets reclaim failed: ${reclaimErr.message}`);
    for (const row of reclaimed ?? []) claimedIds.add(row.entity_id);
  }

  const unsyncedOrders = candidates.filter((o) => claimedIds.has(o.id));
  if (unsyncedOrders.length === 0) return empty;

  logger().info({ unsyncedCount: unsyncedOrders.length }, "starting incremental sync for unsynced orders");

  const unsyncedOrderIds = unsyncedOrders.map((o) => o.id);
  const unsyncedUserIds = Array.from(new Set(unsyncedOrders.map((o) => o.purchaser_user_id)));

  // Everything from here on fails the claims if it throws, so the next run
  // picks these orders up again instead of waiting for the stale window.
  try {
    // Batch fetch profiles
    const profiles = await fetchInChunks<{
      user_id: string;
      display_name: string | null;
      phone_e164: string | null;
      college_name: string | null;
    }>(unsyncedUserIds, (chunk) =>
      sb.from("profiles").select("user_id, display_name, phone_e164, college_name").in("user_id", chunk)
    );
    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

    // Batch fetch payments (latest payment per order wins)
    const payments = await fetchInChunks<{
      local_order_id: string | null;
      razorpay_payment_id: string | null;
      created_at: string;
    }>(unsyncedOrderIds, (chunk) =>
      sb
        .from("payments")
        .select("local_order_id, razorpay_payment_id, created_at")
        .in("local_order_id", chunk)
        .order("created_at", { ascending: false })
    );
    payments.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const paymentMap = new Map<string, string>();
    for (const p of payments) {
      if (p.local_order_id && !paymentMap.has(p.local_order_id) && p.razorpay_payment_id) {
        paymentMap.set(p.local_order_id, p.razorpay_payment_id);
      }
    }

    type EventInfo = {
      name?: string;
      starts_at?: string;
      categories?: { name?: string } | Array<{ name?: string }> | null;
      venues?: { name?: string } | Array<{ name?: string }> | null;
    };
    type LineRow = {
      id: string;
      order_id: string;
      pass_product_id: string | null;
      event_id: string | null;
      pass_products: PassProductInfo | PassProductInfo[] | null;
      events: EventInfo | EventInfo[] | null;
    };
    const orderLines = await fetchInChunks<LineRow>(unsyncedOrderIds, (chunk) =>
      sb
        .from("order_lines")
        .select(
          `id, order_id, pass_product_id, event_id,
           pass_products ( id, name, slug, is_base_pass ),
           events ( id, name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
        )
        .in("order_id", chunk)
    );
    const orderLinesByOrderId = new Map<string, LineRow[]>();
    for (const line of orderLines) {
      if (!orderLinesByOrderId.has(line.order_id)) orderLinesByOrderId.set(line.order_id, []);
      orderLinesByOrderId.get(line.order_id)!.push(line);
    }

    const lineIds = orderLines.map((l) => l.id);
    const passes = await fetchInChunks<{
      public_pass_code: string;
      state: string;
      activated_at: string | null;
      source_order_line_id: string;
      pass_products: PassProductInfo | PassProductInfo[] | null;
    }>(lineIds, (chunk) =>
      sb
        .from("delegate_passes")
        .select("public_pass_code, state, activated_at, source_order_line_id, pass_products ( name, slug, is_base_pass )")
        .in("source_order_line_id", chunk)
    );
    const passByLineId = new Map(passes.map((p) => [p.source_order_line_id, p]));

    const registrations = await fetchInChunks<{
      public_registration_code: string | null;
      order_line_id: string;
      registration_mode: string;
      team_name: string | null;
      state: string;
      events: EventInfo | EventInfo[] | null;
    }>(lineIds, (chunk) =>
      sb
        .from("registrations")
        .select(
          `public_registration_code, order_line_id, registration_mode, team_name, state,
           events ( name, category_id, starts_at, venue_id, categories ( name ), venues ( name ) )`
        )
        .in("order_line_id", chunk)
    );
    const regByLineId = new Map(registrations.map((r) => [r.order_line_id, r]));

    const merchandiseOrders = await fetchInChunks<{
      order_id: string;
      item_name: string | null;
      selected_size: string | null;
      quantity: number | null;
      unit_price_paise: number | string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      recipient_phone: string | null;
      state: string | null;
    }>(unsyncedOrderIds, (chunk) =>
      sb
        .from("merchandise_orders")
        .select(
          "order_id, item_name, selected_size, quantity, unit_price_paise, recipient_name, recipient_email, recipient_phone, state"
        )
        .in("order_id", chunk)
    );
    const merchByOrderId = new Map(merchandiseOrders.map((m) => [m.order_id, m]));

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

    type OrderRef = { id: string; festival_id: string };
    const buckets: Record<
      "BASIC_PASS" | "DELEGATE_PASS" | "EVENT" | "MERCHANDISE",
      { rows: unknown[][]; orders: OrderRef[] }
    > = {
      BASIC_PASS: { rows: [], orders: [] },
      DELEGATE_PASS: { rows: [], orders: [] },
      EVENT: { rows: [], orders: [] },
      MERCHANDISE: { rows: [], orders: [] },
    };

    for (const order of unsyncedOrders) {
      const prof = profileMap.get(order.purchaser_user_id);
      const email = await getUserEmail(order.purchaser_user_id);
      const name = prof?.display_name || "Participant";
      const phone = prof?.phone_e164 || "—";
      const college = prof?.college_name || "—";
      const timestamp = new Date(order.fulfilled_at ?? order.created_at).toISOString();
      const amountStr = formatPaise(Number(order.amount_paise));
      const paymentId = paymentMap.get(order.id) || "—";
      const ref = { id: order.id, festival_id: order.festival_id };

      const lines = orderLinesByOrderId.get(order.id) ?? [];
      const primaryLine = lines[0];

      if (order.kind === "BASE_PASS") {
        const pass = primaryLine?.id ? passByLineId.get(primaryLine.id) : null;
        const prodFromLine = primaryLine?.pass_products;
        const prodFromPass = pass?.pass_products;
        const prod = (Array.isArray(prodFromPass) ? prodFromPass[0] : prodFromPass) ??
          (Array.isArray(prodFromLine) ? prodFromLine[0] : prodFromLine);

        const passCode = pass?.public_pass_code ?? `PASS-${order.public_order_code.slice(3)}`;
        const passState = pass?.state ?? "ACTIVE";
        const activatedAt = pass?.activated_at ?? timestamp;

        if (isPronitePassOrder(prod)) {
          buckets.DELEGATE_PASS.rows.push(
            pronitePassRow({
              timestamp,
              passCode,
              name,
              email,
              phone,
              college,
              orderCode: order.public_order_code,
              paymentId,
              amountStr,
              passState,
              productName: prod?.name,
              activatedAt,
            })
          );
          buckets.DELEGATE_PASS.orders.push(ref);
        } else {
          buckets.BASIC_PASS.rows.push([
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
          buckets.BASIC_PASS.orders.push(ref);
        }
      } else if (order.kind === "EVENT") {
        const reg = primaryLine?.id ? regByLineId.get(primaryLine.id) : null;
        const evRaw = reg?.events ?? primaryLine?.events;
        const ev = Array.isArray(evRaw) ? evRaw[0] : evRaw;
        const catRaw = ev?.categories;
        const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
        const venueRaw = ev?.venues;
        const venue = Array.isArray(venueRaw) ? venueRaw[0] : venueRaw;

        buckets.EVENT.rows.push([
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
        buckets.EVENT.orders.push(ref);
      } else if (order.kind === "MERCHANDISE") {
        const merchOrder = merchByOrderId.get(order.id);
        buckets.MERCHANDISE.rows.push([
          timestamp,
          order.public_order_code,
          paymentId,
          merchOrder?.item_name || "Fest Merchandise",
          merchOrder?.selected_size || "Standard",
          merchOrder?.quantity || 1,
          merchOrder?.unit_price_paise ? formatPaise(Number(merchOrder.unit_price_paise)) : amountStr,
          formatPaise(Number(order.amount_paise)),
          merchOrder?.recipient_name || name,
          merchOrder?.recipient_email || email,
          merchOrder?.recipient_phone || phone,
          "Campus Pickup",
          "Festival Merch Counter",
          merchOrder?.state || "CONFIRMED",
        ]);
        buckets.MERCHANDISE.orders.push(ref);
      }
    }

    // Orders of a kind with no rows (unknown kind) need no sheet; drop claims.
    const bucketed = new Set(Object.values(buckets).flatMap((b) => b.orders.map((o) => o.id)));
    const unbucketed = unsyncedOrderIds.filter((id) => !bucketed.has(id));
    for (let i = 0; i < unbucketed.length; i += 200) {
      await sb
        .from("sheets_sync_items")
        .delete()
        .eq("entity_type", "ORDER")
        .in("entity_id", unbucketed.slice(i, i + 200));
    }

    const counts = { BASIC_PASS: 0, DELEGATE_PASS: 0, EVENT: 0, MERCHANDISE: 0 };
    const APPEND_BATCH = 500;

    for (const kind of Object.keys(buckets) as (keyof typeof buckets)[]) {
      const { rows, orders: refs } = buckets[kind];
      if (rows.length === 0) continue;
      const target = resolveSheetTarget(kind);

      for (let i = 0; i < rows.length; i += APPEND_BATCH) {
        const batchRows = rows.slice(i, i + APPEND_BATCH);
        const batchRefs = refs.slice(i, i + APPEND_BATCH);
        const batchIds = batchRefs.map((r) => r.id);

        if (!target.spreadsheetId) {
          // Not configured: release the claims so a later run can sync them.
          await sb.from("sheets_sync_items").delete().eq("entity_type", "ORDER").in("entity_id", batchIds);
          continue;
        }

        const res = await appendToGoogleSheet(target.spreadsheetId, target.range, batchRows, {
          sheetKind: kind,
          sheetName: target.sheetName,
        });

        await sb
          .from("sheets_sync_items")
          .update({ sync_state: res.success ? "SYNCED" : "FAILED", updated_at: new Date().toISOString() })
          .eq("entity_type", "ORDER")
          .in("entity_id", batchIds);

        if (!res.success) {
          logger().error({ err: res.error, kind }, "failed to append batch to google sheets");
          continue;
        }
        counts[kind] += batchRows.length;
        if (kind === "MERCHANDISE") {
          await sb.from("merchandise_orders").update({ synced_to_sheets: true }).in("order_id", batchIds);
        }
      }
    }

    const result = {
      basicPasses: counts.BASIC_PASS,
      delegatePasses: counts.DELEGATE_PASS,
      events: counts.EVENT,
      merchandise: counts.MERCHANDISE,
      total: counts.BASIC_PASS + counts.DELEGATE_PASS + counts.EVENT + counts.MERCHANDISE,
    };
    logger().info(result, "incremental google sheets sync completed");
    return result;
  } catch (err) {
    for (let i = 0; i < unsyncedOrderIds.length; i += 200) {
      await sb
        .from("sheets_sync_items")
        .update({ sync_state: "FAILED", updated_at: new Date().toISOString() })
        .eq("entity_type", "ORDER")
        .eq("sync_state", "IN_PROGRESS")
        .in("entity_id", unsyncedOrderIds.slice(i, i + 200));
    }
    throw err;
  }
}
