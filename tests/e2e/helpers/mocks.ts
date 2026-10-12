import { vi } from "vitest";
import { AppError } from "@/lib/errors";
import { MockSupabase } from "../../helpers/supabase-mock";

/**
 * Shared singletons for the E2E suite.
 *
 * Each test file installs the same small set of vi.mock factories that route
 * these singletons into the app's infrastructure boundaries (service-role
 * Supabase, session Supabase, rate limiting, Razorpay SDK). Everything above
 * those boundaries — Route Handlers, CSRF guards, Zod validation, services,
 * workers, QR signing, webhook HMACs — runs for real.
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

// Test files run in shared workers: normalize provider credentials that
// individual suites set at module scope, so every file's first env() parse
// sees the same baseline regardless of execution order.
delete process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT;
delete process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
delete process.env.RESEND_WEBHOOK_SECRET;
delete process.env.TURNSTILE_SECRET_KEY;

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
export const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
export const FESTIVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const ORDER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const PASS_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const TEAM_ID = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
export const ROLE_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

export interface TestActor {
  id: string;
  email: string;
  /** false simulates an unconfirmed signup. */
  confirmed?: boolean;
}

/** Service-role client mock (bypasses RLS in production code). */
class ServiceMock extends MockSupabase {}
export const sb = new ServiceMock();

/**
 * Session (cookie-bound) client mock. Carries the current actor so
 * requireUser()/requirePermission() behave like real auth.
 */
class SessionMock extends MockSupabase {
  private actor: TestActor | null = null;
  private authFailure: string | null = null;

  constructor() {
    super();
    this.rewire();
  }

  setActor(actor: TestActor | null): this {
    this.actor = actor;
    this.authFailure = null;
    this.rewire();
    return this;
  }

  failAuth(message = "Invalid login credentials"): this {
    this.actor = null;
    this.authFailure = message;
    this.rewire();
    return this;
  }

  private rewire(): void {
    const readActor = (): { data: { user: unknown }; error: { message: string } | null } => {
      if (this.authFailure) {
        return { data: { user: null }, error: { message: this.authFailure } };
      }
      if (!this.actor) return { data: { user: null }, error: null };
      const u = this.actor;
      return {
        data: {
          user: {
            id: u.id,
            email: u.email,
            aud: "authenticated",
            email_confirmed_at:
              u.confirmed === false ? null : new Date().toISOString(),
          },
        },
        error: null,
      };
    };
    this.auth = {
      getUser: async () => readActor(),
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, email: `${id.slice(0, 6)}@example.com` } },
          error: null,
        }),
        createUser: async (params: { email?: string; user_metadata?: Record<string, unknown> }) => ({
          data: { user: { id: "user-mock-created-id", email: params.email ?? "mock@example.com" } },
          error: null,
        }),
      },
    };
  }
}
export const userSb = new SessionMock();

/** Razorpay SDK mock — pure crypto helpers stay REAL via importOriginal. */
export const rzp = {
  orders: { create: vi.fn(), fetchPayments: vi.fn() },
  payments: { fetch: vi.fn() },
};

export type RateMode = "ok" | "limited" | "unavailable";

/** Controllable rate limiter standing in for @/lib/redis/rate-limits. */
export const rateLimiter = {
  mode: "ok" as RateMode,
  calls: [] as { cls: string; identifier: string }[],

  reset(mode: RateMode = "ok"): void {
    this.mode = mode;
    this.calls = [];
  },

  async checkRateLimit(cls: string, identifier: string) {
    this.calls.push({ cls, identifier });
    if (this.mode === "unavailable") {
      throw new AppError(
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting is temporarily unavailable. Please retry shortly."
      );
    }
    if (this.mode === "limited") {
      throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
    }
    return { success: true as const, remaining: 10, reset: 0 };
  },

  async enforceRateLimit(cls: string, identifier: string): Promise<void> {
    await this.checkRateLimit(cls, identifier);
  },
};

/** `after()` callbacks captured from the razorpay webhook route. */
const afterQueue: Promise<unknown>[] = [];

/** Register a next/server after() callback for later flushing. */
export function enqueueAfter(fn: () => unknown): void {
  afterQueue.push(Promise.resolve().then(fn));
}

export function flushAfter(): Promise<unknown[]> {
  const jobs = afterQueue.splice(0);
  return Promise.allSettled(jobs);
}

/** revalidateTag calls recorded by the next/cache stub. */
export const revalidateLog: string[] = [];

/** Reset everything to a pristine state between tests. */
export function resetWorld(
  opts: { actor?: TestActor | null; festival?: boolean } = {}
): void {
  sb.reset();
  userSb.reset();
  // Every authenticated request re-reads the active festival (the module
  // cache expires between tests), so provide a healthy default response.
  if (opts.festival !== false) {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
  }
  userSb.setActor(opts.actor === undefined ? { id: USER_ID, email: "student@example.com", confirmed: true } : opts.actor);
  rzp.orders.create.mockReset();
  rzp.orders.fetchPayments.mockReset();
  rzp.payments.fetch.mockReset();
  rateLimiter.reset();
  afterQueue.length = 0;
  revalidateLog.length = 0;
}

/** Debug helper: number of queued after() callbacks. */
export function afterQueueLen(): number {
  return afterQueue.length;
}
