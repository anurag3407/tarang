/**
 * One-time click tracker seed script.
 * Usage: npx tsx scripts/seed-clicks.ts [count]
 */
import { loadEnvConfig } from "@next/env";
import { Redis } from "@upstash/redis";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const appEnv = process.env.APP_ENV || "local";

const seedCount = parseInt(process.argv[2] || "2000", 10);

if (!url || !token) {
  console.log(`[SEED] Redis is not configured in local environment (.env).`);
  console.log(`[SEED] In-code default baseline of ${seedCount} clicks is active in /api/stats/track.`);
  process.exit(0);
}

const redis = new Redis({ url, token });
const key = `pulse:${appEnv}:stats:site_clicks`;

async function main() {
  try {
    await redis.set(key, seedCount);
    const current = await redis.get(key);
    console.log(`[SEED] Successfully seeded Redis key "${key}" with ${current} clicks.`);
  } catch (err: unknown) {
    console.warn(`[SEED] Could not reach remote Redis host (${url}).`);
    console.log(`[SEED] Note: /api/stats/track already has the baseline configured to start at ${seedCount} clicks automatically on first visit.`);
  }
}

main().catch((err) => {
  console.error("[SEED] Error seeding Redis:", err);
});
