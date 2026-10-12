import { describe, expect, it } from "vitest";
import { checkRateLimit, enforceRateLimit } from "@/lib/redis/rate-limits";

// UPSTASH_REDIS_REST_URL is intentionally unset in the test env, so
// getRedis() returns null — exercising the documented Redis-outage paths.

describe("rate limiting when Redis is unavailable (plan §10.4)", () => {
  it("critical writes FAIL CLOSED with RATE_LIMIT_UNAVAILABLE", async () => {
    await expect(
      checkRateLimit("order", "user:x", { failClosed: true })
    ).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    await expect(
      enforceRateLimit("order", "user:x", { failClosed: true })
    ).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
  });

  it("public reads FAIL OPEN (allow) so the site keeps serving", async () => {
    const res = await checkRateLimit("public", "ip:x");
    expect(res.success).toBe(true);
  });

  it("fail-open never throws", async () => {
    await expect(enforceRateLimit("public", "ip:x")).resolves.toBeUndefined();
  });
});
