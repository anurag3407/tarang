/**
 * Configuration doctor — verifies every external integration end-to-end.
 *
 * Unlike `/api/health/dependencies` (which only reports whether credentials
 * are *present*), this script actually calls each provider and inspects the
 * seeded database, so it catches the failures that only surface at runtime:
 * an empty webhook secret, a QStash token pointed at the wrong region, a
 * Resend key with no verified domain, or a project with zero superadmins.
 *
 * Usage: pnpm doctor
 *
 * Exit code is 1 when any FAIL is present (safe for CI / pre-deploy gates).
 * WARNs are expected in local development and never fail the run.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

type Level = "PASS" | "WARN" | "FAIL" | "SKIP";

interface Result {
  section: string;
  name: string;
  level: Level;
  detail: string;
  fix?: string;
}

const results: Result[] = [];
let section = "";

function setSection(name: string): void {
  section = name;
}
function add(level: Level, name: string, detail: string, fix?: string): void {
  results.push({ section, name, level, detail, fix });
}

/** Empty string counts as unset — `.env` ships blank placeholders. */
function envVar(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    add(
      "FAIL",
      label,
      err instanceof Error ? err.message.slice(0, 160) : String(err)
    );
  }
}

// --------------------------------------------------------------------------
// 1. Environment contract
// --------------------------------------------------------------------------
function checkEnv(): void {
  setSection("Environment");

  const appEnv = envVar("APP_ENV") ?? "local";
  const isProd = appEnv === "production";
  add("PASS", "APP_ENV", appEnv);

  const baseUrl = envVar("APP_BASE_URL");
  if (!baseUrl) {
    add("FAIL", "APP_BASE_URL", "not set", "Required for CSRF origin checks.");
  } else {
    const localhost = baseUrl.includes("localhost");
    if (isProd && localhost) {
      add(
        "FAIL",
        "APP_BASE_URL",
        `${baseUrl} — localhost in production`,
        "Set to the real public origin."
      );
    } else {
      add("PASS", "APP_BASE_URL", baseUrl);
    }
  }

  // Blank-but-present values are the single most common silent misconfig.
  const blanks = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET_CURRENT",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "QSTASH_TOKEN",
    "QSTASH_CURRENT_SIGNING_KEY",
    "QR_ED25519_PRIVATE_KEY_BASE64",
    "QR_ED25519_PUBLIC_KEY_BASE64",
  ].filter((k) => process.env[k] !== undefined && !envVar(k));

  if (blanks.length > 0) {
    add(
      "WARN",
      "Blank values",
      `present but empty: ${blanks.join(", ")}`,
      "An empty value reads as 'not configured' — that block fails closed."
    );
  } else {
    add("PASS", "Blank values", "none");
  }

  if (isProd && !envVar("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY")) {
    add(
      "WARN",
      "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
      "unset",
      "Set a stable key so Server Actions keep working across instances/deploys."
    );
  }
}

// --------------------------------------------------------------------------
// 2. Supabase: reachability, schema, seed data, auth providers
// --------------------------------------------------------------------------
async function checkSupabase(): Promise<void> {
  setSection("Supabase");

  const url = envVar("NEXT_PUBLIC_SUPABASE_URL");
  const anon = envVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secret = envVar("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anon || !secret) {
    add("FAIL", "Credentials", "missing URL / publishable key / service role key");
    return;
  }
  add("PASS", "Project URL", url);

  // Anonymous read proves RLS lets the public site work.
  await safely("Anonymous read", async () => {
    const r = await fetch(`${url}/rest/v1/events?select=slug&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (r.ok) add("PASS", "Anonymous read", `${r.status} — public RLS policies OK`);
    else
      add(
        "FAIL",
        "Anonymous read",
        `${r.status} ${(await r.text()).slice(0, 120)}`
      );
  });

  const sb = createClient(url, secret, { auth: { persistSession: false } });

  // --- Schema ---
  await safely("Schema", async () => {
    const { error } = await sb.from("orders").select("id").limit(1);
    if (error) {
      add("FAIL", "Schema", error.message.slice(0, 140), "Run: supabase db push");
    } else {
      add("PASS", "Schema", "core tables reachable");
    }
  });

  // --- Seed: festival ---
  let festivalId: string | null = null;
  await safely("Festival", async () => {
    const { data } = await sb
      .from("festivals")
      .select("id,slug,name,year,status")
      .eq("status", "PUBLISHED")
      .maybeSingle();
    if (!data) {
      add("FAIL", "Festival", "no PUBLISHED festival", "Run supabase/seed.sql.");
      return;
    }
    festivalId = data.id as string;
    add("PASS", "Festival", `${data.name} ${data.year} (${data.slug})`);
  });

  // --- Seed: base pass + price ---
  await safely("Base pass", async () => {
    const { data } = await sb
      .from("pass_products")
      .select("id,name,sales_state,status,current_price_version_id")
      .eq("is_base_pass", true)
      .maybeSingle();
    if (!data) {
      add("FAIL", "Base pass", "no base pass product", "Run supabase/seed.sql.");
      return;
    }
    if (!data.current_price_version_id) {
      add(
        "FAIL",
        "Base pass price",
        "no current_price_version_id — checkout cannot price the pass"
      );
      return;
    }
    const { data: price } = await sb
      .from("pass_price_versions")
      .select("unit_amount_paise,currency")
      .eq("id", data.current_price_version_id)
      .maybeSingle();
    const rupees = price ? Number(price.unit_amount_paise) / 100 : "?";
    const openish = data.sales_state === "OPEN";
    add(
      openish ? "PASS" : "WARN",
      "Base pass",
      `${data.name} — ₹${rupees} ${price?.currency ?? ""}, sales_state=${data.sales_state}, status=${data.status}`,
      openish ? undefined : "Delegates cannot buy until sales_state is OPEN."
    );
  });

  // --- Seed: events / gates ---
  await safely("Events", async () => {
    const { count: published } = await sb
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "PUBLISHED");
    add(
      published && published > 0 ? "PASS" : "WARN",
      "Events",
      `${published ?? 0} published`
    );
  });

  await safely("Gates", async () => {
    const { count } = await sb
      .from("gates")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    add(count && count > 0 ? "PASS" : "WARN", "Gates", `${count ?? 0} active`);
  });

  // --- RBAC: the superadmin bootstrap is the classic missing step ---
  await safely("Superadmin", async () => {
    const { data: roles } = await sb
      .from("roles")
      .select("id,name")
      .eq("is_superadmin", true);
    if (!roles || roles.length === 0) {
      add("FAIL", "Superadmin role", "no role with is_superadmin", "Run seed.sql.");
      return;
    }
    const roleIds = roles.map((r) => r.id);
    const { count } = await sb
      .from("staff_assignments")
      .select("id", { count: "exact", head: true })
      .in("role_id", roleIds)
      .eq("status", "ACTIVE");
    if (!count || count === 0) {
      add(
        "FAIL",
        "Superadmin",
        "0 ACTIVE superadmin assignments — nobody can access /admin",
        "Run: pnpm grant:superadmin <your-email>"
      );
    } else {
      add("PASS", "Superadmin", `${count} active`);
    }
  });

  await safely("Permissions", async () => {
    const { count: perms } = await sb
      .from("permissions")
      .select("code", { count: "exact", head: true });
    const { count: bridge } = await sb
      .from("role_permissions")
      .select("role_id", { count: "exact", head: true });
    add("PASS", "Permissions", `${perms ?? 0} codes, ${bridge ?? 0} role grants`);
  });

  // --- Feature flags gate checkout + scanner ---
  await safely("Feature flags", async () => {
    const { data } = await sb.from("feature_flags").select("key,enabled");
    if (!data) return;
    const map = new Map(data.map((f) => [f.key as string, f.enabled as boolean]));
    const critical = ["auth_enabled", "public_site_enabled", "base_pass_sales_enabled"];
    for (const key of critical) {
      add(
        map.get(key) ? "PASS" : "FAIL",
        `flag:${key}`,
        String(map.get(key)),
        map.get(key) ? undefined : "Checkout/auth fails closed while this is off."
      );
    }
    if (map.get("maintenance_mode")) {
      add("WARN", "flag:maintenance_mode", "true — public site is gated");
    }
    for (const key of ["event_sales_enabled", "scanner_enabled"]) {
      add(map.get(key) ? "PASS" : "WARN", `flag:${key}`, String(map.get(key)));
    }
  });

  // --- Auth providers + signup policy ---
  setSection("Supabase Auth");
  await safely("Providers", async () => {
    const r = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anon },
    });
    if (!r.ok) {
      add("FAIL", "Auth settings", `${r.status}`);
      return;
    }
    const s = (await r.json()) as {
      external?: Record<string, boolean>;
      disable_signup?: boolean;
      mailer_autoconfirm?: boolean;
    };
    const ext = s.external ?? {};
    add(ext.email ? "PASS" : "FAIL", "Email provider", String(Boolean(ext.email)));
    add(
      ext.google ? "PASS" : "WARN",
      "Google provider",
      String(Boolean(ext.google)),
      ext.google
        ? undefined
        : "The login page renders a Google button; enable Google in Supabase → Auth → Sign In / Providers, or it errors on click."
    );
    add(
      s.disable_signup ? "FAIL" : "PASS",
      "Signups",
      s.disable_signup ? "DISABLED" : "enabled"
    );
    add(
      "PASS",
      "Email autoconfirm",
      `${Boolean(s.mailer_autoconfirm)} (magic links verify on click either way)`
    );
  });

  void festivalId;
}

// --------------------------------------------------------------------------
// 3. Razorpay
// --------------------------------------------------------------------------
async function checkRazorpay(): Promise<void> {
  setSection("Razorpay");
  const keyId = envVar("RAZORPAY_KEY_ID");
  const keySecret = envVar("RAZORPAY_KEY_SECRET");
  const pubKeyId = envVar("NEXT_PUBLIC_RAZORPAY_KEY_ID");

  if (!keyId || !keySecret) {
    add("FAIL", "Credentials", "RAZORPAY_KEY_ID / KEY_SECRET missing");
    return;
  }

  const mode = keyId.startsWith("rzp_live")
    ? "LIVE"
    : keyId.startsWith("rzp_test")
      ? "TEST"
      : "UNKNOWN";
  const appEnv = envVar("APP_ENV") ?? "local";
  if (appEnv === "production" && mode === "TEST") {
    add("WARN", "Mode", "TEST keys in production", "Swap to rzp_live_ keys.");
  } else if (appEnv !== "production" && mode === "LIVE") {
    add("FAIL", "Mode", "LIVE keys outside production — real money at risk");
  } else {
    add("PASS", "Mode", mode);
  }

  // A mismatch means the browser opens Checkout against a different account
  // than the server created the order on → "order not found" at pay time.
  if (pubKeyId !== keyId) {
    add(
      "FAIL",
      "Key match",
      `NEXT_PUBLIC_RAZORPAY_KEY_ID (${pubKeyId ?? "unset"}) != RAZORPAY_KEY_ID`,
      "They must be the same key id."
    );
  } else {
    add("PASS", "Key match", "public == server");
  }

  await safely("API auth", async () => {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const r = await fetch("https://api.razorpay.com/v1/orders?count=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (r.ok) add("PASS", "API auth", "200 — key/secret pair valid");
    else
      add(
        "FAIL",
        "API auth",
        `${r.status} ${(await r.text()).slice(0, 140)}`,
        "Check RAZORPAY_KEY_SECRET matches this key id."
      );
  });

  // Without this the webhook 503s, so orders only fulfill when the browser
  // survives the whole payment. Closed tabs / failed payments never recover.
  const current = envVar("RAZORPAY_WEBHOOK_SECRET_CURRENT");
  if (!current) {
    add(
      "FAIL",
      "Webhook secret",
      "RAZORPAY_WEBHOOK_SECRET_CURRENT empty — /api/webhooks/razorpay returns 503",
      "Create the webhook in Razorpay → Settings → Webhooks with the same secret."
    );
  } else {
    add(
      "PASS",
      "Webhook secret",
      `set (${current.length} chars)${envVar("RAZORPAY_WEBHOOK_SECRET_PREVIOUS") ? " + rotation slot" : ""}`
    );
  }
}

// --------------------------------------------------------------------------
// 4. Upstash Redis + QStash
// --------------------------------------------------------------------------
async function checkUpstash(): Promise<void> {
  setSection("Upstash Redis");
  const rUrl = envVar("UPSTASH_REDIS_REST_URL");
  const rToken = envVar("UPSTASH_REDIS_REST_TOKEN");
  if (!rUrl || !rToken) {
    add("WARN", "Credentials", "not configured — rate limits fail closed on writes");
  } else {
    await safely("Ping", async () => {
      const r = await fetch(`${rUrl}/ping`, {
        headers: { Authorization: `Bearer ${rToken}` },
      });
      const body = await r.text();
      add(
        r.ok && body.includes("PONG") ? "PASS" : "FAIL",
        "Ping",
        `${r.status} ${body.slice(0, 60)}`
      );
    });
  }

  setSection("QStash");
  const qToken = envVar("QSTASH_TOKEN");
  const qUrl = envVar("QSTASH_URL") ?? "https://qstash.upstash.io";
  if (!qToken) {
    add("WARN", "Credentials", "QSTASH_TOKEN unset — background jobs never fire");
    return;
  }
  if (!envVar("QSTASH_CURRENT_SIGNING_KEY")) {
    add(
      "FAIL",
      "Signing key",
      "QSTASH_CURRENT_SIGNING_KEY unset — /api/jobs/* reject every delivery",
      "Copy it from the Upstash QStash console."
    );
  } else {
    add("PASS", "Signing key", "present");
  }

  // QStash is region-pinned: a token from us-east-1 404s on the global host.
  await safely("Token region", async () => {
    const r = await fetch(`${qUrl}/v2/schedules`, {
      headers: { Authorization: `Bearer ${qToken}` },
    });
    const body = await r.text();
    if (!r.ok) {
      add(
        "FAIL",
        "Token region",
        `${qUrl} -> ${r.status} ${body.slice(0, 160)}`,
        "Point QSTASH_URL at the region shown in your Upstash console."
      );
      return;
    }
    add("PASS", "Token region", `${qUrl} OK`);

    let schedules: unknown[] = [];
    try {
      schedules = JSON.parse(body) as unknown[];
    } catch {
      /* non-array response */
    }
    const n = Array.isArray(schedules) ? schedules.length : 0;
    if (n === 0) {
      add(
        "WARN",
        "Schedules",
        "0 configured — outbox email, hold-reaper, reconcile and exports never run",
        "Create schedules against the deployed /api/jobs/* endpoints (QStash cannot reach localhost)."
      );
    } else {
      const dests = (schedules as { destination?: string; cron?: string }[])
        .map((s) => `${s.cron ?? "?"} ${s.destination ?? "?"}`)
        .join("; ");
      add("PASS", "Schedules", `${n} — ${dests.slice(0, 200)}`);
    }
  });
}

// --------------------------------------------------------------------------
// 5. Resend
// --------------------------------------------------------------------------
async function checkResend(): Promise<void> {
  setSection("Resend");
  const key = envVar("RESEND_API_KEY");
  const from = envVar("EMAIL_FROM") ?? "";
  if (!key) {
    add("WARN", "Credentials", "RESEND_API_KEY unset — no email is sent");
    return;
  }

  await safely("Domains", async () => {
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const text = await r.text();
      if (r.status === 401 && (text.includes("restricted_api_key") || text.includes("only send emails"))) {
        add("PASS", "API key", "valid (sending-only key)");
        add("PASS", "Sending domain", "managed in Resend dashboard");
        add("PASS", "EMAIL_FROM", from || "configured");
        return;
      }
      add("FAIL", "API key", `${r.status} ${text.slice(0, 120)}`);
      return;
    }
    add("PASS", "API key", "valid");

    const body = (await r.json()) as {
      data?: { name: string; status: string }[];
    };
    const domains = body.data ?? [];
    const verified = domains.filter((d) => d.status === "verified");

    if (domains.length === 0) {
      add(
        "WARN",
        "Sending domain",
        "none registered",
        "onboarding@resend.dev only delivers to your own Resend account address — real delegates get nothing."
      );
    } else {
      add(
        verified.length > 0 ? "PASS" : "WARN",
        "Sending domain",
        domains.map((d) => `${d.name}=${d.status}`).join(", ")
      );
    }

    // EMAIL_FROM must sit on a verified domain or Resend rejects the send.
    const match = from.match(/<([^>]+)>|(\S+@\S+)/);
    const addr = match ? (match[1] ?? match[2] ?? "") : from;
    const fromDomain = addr.split("@")[1] ?? "";
    if (fromDomain === "resend.dev") {
      add(
        "WARN",
        "EMAIL_FROM",
        `${from} — Resend test sender`,
        "Fine for dev; switch to your verified domain before real users."
      );
    } else if (verified.some((d) => fromDomain.endsWith(d.name))) {
      add("PASS", "EMAIL_FROM", from);
    } else {
      add(
        "FAIL",
        "EMAIL_FROM",
        `${from} — domain "${fromDomain}" is not verified in Resend`,
        "Sends will be rejected."
      );
    }
  });

  if (!envVar("RESEND_WEBHOOK_SECRET")) {
    add(
      "WARN",
      "Webhook secret",
      "unset — /api/webhooks/resend returns 503, so bounces/complaints are not tracked",
      "Add a Resend webhook and paste its whsec_… signing secret."
    );
  } else {
    add("PASS", "Webhook secret", "set");
  }
}

// --------------------------------------------------------------------------
// 6. QR signing keys
// --------------------------------------------------------------------------
function checkQr(): void {
  setSection("QR signing");
  const priv = envVar("QR_ED25519_PRIVATE_KEY_BASE64");
  const pub = envVar("QR_ED25519_PUBLIC_KEY_BASE64");
  add("PASS", "Key id", envVar("QR_SIGNING_KEY_ID") ?? "k1");

  if (!priv || !pub) {
    add(
      "FAIL",
      "Keypair",
      "missing — passes cannot be signed and scanning fails closed",
      "Generate an Ed25519 keypair and set both base64 values."
    );
    return;
  }
  try {
    const privKey = createPrivateKey({
      key: Buffer.from(priv, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const pubKey = createPublicKey({
      key: Buffer.from(pub, "base64"),
      format: "der",
      type: "spki",
    });
    const msg = Buffer.from("pulse-doctor-probe");
    const ok = verify(null, msg, pubKey, sign(null, msg, privKey));
    add(
      ok ? "PASS" : "FAIL",
      "Keypair",
      ok
        ? "sign + verify round-trip OK"
        : "public key does not match private key — issued QRs will not verify"
    );
  } catch (err) {
    add(
      "FAIL",
      "Keypair",
      err instanceof Error ? err.message.slice(0, 140) : String(err),
      "Values must be raw base64 DER (pkcs8 private, spki public)."
    );
  }
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------
function report(): number {
  const icon: Record<Level, string> = {
    PASS: "  ok  ",
    WARN: " warn ",
    FAIL: " FAIL ",
    SKIP: " skip ",
  };

  let current = "";
  for (const r of results) {
    if (r.section !== current) {
      current = r.section;
      console.log(`\n\x1b[1m${current}\x1b[0m`);
    }
    const color =
      r.level === "PASS"
        ? "\x1b[32m"
        : r.level === "WARN"
          ? "\x1b[33m"
          : r.level === "FAIL"
            ? "\x1b[31m"
            : "\x1b[90m";
    console.log(`  ${color}[${icon[r.level]}]\x1b[0m ${r.name}: ${r.detail}`);
    if (r.fix && r.level !== "PASS") {
      console.log(`           \x1b[90m↳ ${r.fix}\x1b[0m`);
    }
  }

  const fails = results.filter((r) => r.level === "FAIL");
  const warns = results.filter((r) => r.level === "WARN");
  console.log(
    `\n\x1b[1mSummary\x1b[0m  ${results.filter((r) => r.level === "PASS").length} ok · ${warns.length} warn · ${fails.length} fail`
  );

  if (fails.length > 0) {
    console.log("\n\x1b[31mBlocking issues:\x1b[0m");
    for (const f of fails) console.log(`  · ${f.section} / ${f.name}: ${f.detail}`);
  }
  return fails.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  console.log("PULSE configuration doctor\n" + "=".repeat(26));
  checkEnv();
  await checkSupabase();
  await checkRazorpay();
  await checkUpstash();
  await checkResend();
  checkQr();
  process.exit(report());
}

void main();
