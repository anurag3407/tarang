import "server-only";
import { z } from "zod";

/**
 * Environment contract (plan §6.2).
 *
 * Every variable is validated once at process startup. Public variables use
 * the `NEXT_PUBLIC_` prefix; everything else stays server-only (this module
 * imports `server-only` so it can never be bundled into the browser).
 *
 * Variables are grouped by provider. In local development most provider
 * credentials are optional so the app can boot with just Supabase; each
 * integration reads its own block and fails closed when a required value is
 * missing at the point of use.
 */

const boolFromString = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1")
  .default(false);

const url = z.string().url().optional();

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),

  APP_BASE_URL: url,
  PUBLIC_SITE_URL: url,
  REGISTRATION_SITE_URL: url,
  ADMIN_SITE_URL: url,
  SCANNER_SITE_URL: url,
  HOOKS_BASE_URL: url,

  APP_TIMEZONE: z.string().default("Asia/Kolkata"),
  DEPLOYMENT_ID: z.string().optional(),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_SESSION_URL: z.string().optional(),
  SUPABASE_DB_DIRECT_URL: z.string().optional(),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  UPSTASH_REDIS_READONLY_TOKEN: z.string().optional(),

  // QStash
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  QSTASH_URL: z.string().optional(),

  // Razorpay
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET_CURRENT: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default("TARANG 2026 <no-reply@pulseasa.org>"),
  EMAIL_REPLY_TO: z.string().optional(),

  // QR signing
  QR_SIGNING_KEY_ID: z.string().default("k1"),
  QR_ED25519_PRIVATE_KEY_BASE64: z.string().optional(),
  QR_ED25519_PUBLIC_KEY_BASE64: z.string().optional(),

  // Google Sheets (Spreadsheet Audit & Backup Mirror)
  GOOGLE_SHEETS_ENABLED: boolFromString,
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
  GOOGLE_MASTER_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_BASIC_PASS_ID: z.string().optional(),
  GOOGLE_SHEETS_DELEGATE_PASS_ID: z.string().optional(),
  GOOGLE_SHEETS_EVENTS_ID: z.string().optional(),
  GOOGLE_SHEETS_MERCHANDISE_ID: z.string().optional(),
  GOOGLE_SHEETS_GROUP_ENTRY_ID: z.string().optional(),
  GOOGLE_SHEETS_WEBHOOK_URL: z.string().optional(),

  // Cloudflare
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),

  // Backups
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_AGE_RECIPIENT: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),

  // Turnstile (anti-bot on public forms)
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // Easy web-scanner mode: allows volunteers to log in on any browser/phone
  // and scan immediately without requiring prior hardware enrollment.
  SCANNER_ALLOW_DEFAULT_CREDENTIAL: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? true : v === "true" || v === "1"))
    .default(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Normalize the raw process environment: empty strings are treated as unset.
 * `.env.example` ships empty placeholders, and `.optional()` only accepts
 * `undefined` — without this, a blank `FOO=` would fail `.url()`/`.min()`
 * validation instead of being read as "not configured".
 */
function normalizedEnv(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

/** Parse and cache the process environment. Throws on invalid values. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(normalizedEnv());
  if (!parsed.success) {
    // Surface a readable startup error rather than a deep Zod stack.
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const e = parsed.data;

  // Production fail-fast (plan §6): a production boot without these would
  // silently degrade security-critical behavior — CSRF origin validation
  // falls back to localhost, and checkout cannot work without Supabase.
  if (e.APP_ENV === "production") {
    const missing: string[] = [];
    if (!e.APP_BASE_URL) missing.push("APP_BASE_URL");
    if (!e.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
      missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    if (!e.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment configuration — required in production: ${missing.join(", ")}`
      );
    }
  }

  cached = e;
  return cached;
}

/** True when Supabase credentials are present (app can talk to the DB). */
export function supabaseConfigured(): boolean {
  const e = env();
  return Boolean(
    e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/** True when Upstash Redis credentials are present. */
export function redisConfigured(): boolean {
  const e = env();
  return Boolean(e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN);
}

/** True when Razorpay server credentials are present. */
export function razorpayConfigured(): boolean {
  const e = env();
  return Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET);
}

/** True when Resend credentials are present. */
export function resendConfigured(): boolean {
  const e = env();
  return Boolean(e.RESEND_API_KEY);
}
