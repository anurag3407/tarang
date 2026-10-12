import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  revalidateLog,
  resetWorld,
  rzp,
  sb,
  userSb,
} from "./helpers/mocks";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

import { GET as healthLive } from "@/app/api/health/live/route";
import { GET as healthReady } from "@/app/api/health/ready/route";
import { GET as healthDeps } from "@/app/api/health/dependencies/route";

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // Expire the in-process festival-id cache (30s TTL) between tests.
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
});

describe("GET /api/health/live", () => {
  it("reports liveness without touching any dependency", async () => {
    const res = await healthLive();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { status: string; uptimeSeconds: number };
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // Liveness deliberately checks NO dependencies.
    expect(sb.calls.length).toBe(0);
    expect(userSb.calls.length).toBe(0);
  });
});

describe("GET /api/health/ready", () => {
  it("is ready when the database probe succeeds", async () => {
    sb.onTable("festivals", { data: [], error: null });

    const first = await healthReady();
    expect(first.status).toBe(200);
    const body1 = (await first.json()) as { status: string };
    expect(body1.status).toBe("ready");

    // Second probe within the 5s cache window must not hit the DB again.
    const second = await healthReady();
    expect(second.status).toBe(200);
    const festivalQueries = sb.callsFor("festivals").length;
    expect(festivalQueries).toBe(1);

    vi.advanceTimersByTime(6_000);
  });

  it("degrades to 503 when the probe fails after the cache expires", async () => {
    resetWorld({ actor: null, festival: false });
    sb.onTable("festivals", { data: null, error: { message: "connection refused" } });

    const res = await healthReady();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("not_ready");
  });
});

describe("GET /api/health/dependencies", () => {
  it("rejects callers without admin.access with 403", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });

    const res = await healthDeps();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("reports configured + live state per dependency and never leaks secrets", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("festivals", { data: { id: "f" }, error: null }); // requireUser prelude
    sb.onTable("festivals", { data: [{ id: "f" }], error: null }); // live probe

    const res = await healthDeps();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      appEnv: string;
      deploymentId: string | null;
      dependencies: Record<string, { configured: boolean; live: boolean | null }>;
    };

    expect(body.appEnv).toBe("test");
    expect(body.dependencies.supabase).toEqual({ configured: true, live: true });
    // Razorpay test keys are set; no free live probe is performed.
    expect(body.dependencies.razorpay).toEqual({ configured: true, live: null });
    // Redis/QStash/Resend are intentionally unset in the test env.
    expect(body.dependencies.redis.configured).toBe(false);
    expect(body.dependencies.qstash.configured).toBe(false);
    expect(body.dependencies.resend.configured).toBe(false);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("test-service-role-key");
    expect(raw).not.toContain("test_razorpay_secret_0123456789");
    expect(revalidateLog).toEqual([]);
    expect(rzp.orders.create).not.toHaveBeenCalled();
  });
});
