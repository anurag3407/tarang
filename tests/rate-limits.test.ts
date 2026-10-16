import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, enforceRateLimit, resetMemoryRateLimits } from "@/lib/redis/rate-limits";

// UPSTASH_REDIS_REST_URL is intentionally unset in the test env, so
// getRedis() returns null — exercising the documented Redis-outage paths.

beforeEach(() => resetMemoryRateLimits());

describe("rate limiting when Redis is unavailable (plan §10.4)", () => {
  it("critical writes keep working on the in-process fallback instead of blocking every sale", async () => {
    const res = await checkRateLimit("order", "user:x", { failClosed: true });
    expect(res.success).toBe(true);
    await expect(enforceRateLimit("order", "user:y", { failClosed: true })).resolves.toBeUndefined();
  });

  it("the fallback still enforces the same limit", async () => {
    // order: 30 per minute
    for (let i = 0; i < 30; i++) {
      await enforceRateLimit("order", "user:burst", { failClosed: true });
    }
    await expect(enforceRateLimit("order", "user:burst", { failClosed: true })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    // Another identifier has its own budget.
    await expect(enforceRateLimit("order", "user:other", { failClosed: true })).resolves.toBeUndefined();
  });

  it("per-IP discount budget is far above the per-user one (shared campus/carrier NAT)", async () => {
    for (let i = 0; i < 100; i++) {
      await enforceRateLimit("discountIp", "ip:campus", { failClosed: true });
    }
    for (let i = 0; i < 20; i++) {
      await enforceRateLimit("discount", "user:guesser", { failClosed: true });
    }
    await expect(enforceRateLimit("discount", "user:guesser", { failClosed: true })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("a whole campus behind one IP is not capped at one person's budget", async () => {
    // 200 different students signing in from the same college Wi-Fi.
    for (let i = 0; i < 200; i++) {
      await enforceRateLimit("loginIp", "ip:college", { failClosed: true });
      await enforceRateLimit("askIp", "ip:college", { failClosed: true });
      await enforceRateLimit("verifyIp", "ip:college", { failClosed: true });
    }
    // …while one email address is still held to the strict per-identity limit.
    for (let i = 0; i < 20; i++) {
      await enforceRateLimit("login", "email:one", { failClosed: true });
    }
    await expect(enforceRateLimit("login", "email:one", { failClosed: true })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("public reads FAIL OPEN (allow) so the site keeps serving", async () => {
    const res = await checkRateLimit("public", "ip:x");
    expect(res.success).toBe(true);
  });

  it("fail-open never throws", async () => {
    await expect(enforceRateLimit("public", "ip:x")).resolves.toBeUndefined();
  });
});
