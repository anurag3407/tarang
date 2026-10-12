import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis/client";
import { redisKeys } from "@/lib/redis/keys";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const INITIAL_SEED_CLICKS = 2000;

// In-memory fallback when Redis is not configured in local/test environments
let inMemoryClicks = INITIAL_SEED_CLICKS;

/**
 * POST /api/stats/track — Records a page visit/click and increments the Redis counter atomically.
 */
export async function POST() {
  try {
    const redis = getRedis();

    if (redis) {
      const clickKey = redisKeys.siteClicks();
      // Ensure the key exists with the baseline seed before incrementing
      await redis.setnx(clickKey, INITIAL_SEED_CLICKS);
      const clicks = await redis.incr(clickKey);

      return NextResponse.json(
        { clicks, success: true },
        {
          status: 200,
          headers: {
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    // Fallback if Redis is not configured
    inMemoryClicks += 1;
    return NextResponse.json(
      { clicks: inMemoryClicks, success: true },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    logger().warn({ error }, "Failed to track website click in Redis");
    inMemoryClicks += 1;
    return NextResponse.json(
      { clicks: inMemoryClicks, success: true },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}

/**
 * GET /api/stats/track — Fetches current website clicks count without incrementing.
 */
export async function GET() {
  try {
    const redis = getRedis();

    if (redis) {
      const clickKey = redisKeys.siteClicks();
      let raw = await redis.get<number | string>(clickKey);

      if (raw === null || raw === undefined) {
        await redis.setnx(clickKey, INITIAL_SEED_CLICKS);
        raw = INITIAL_SEED_CLICKS;
      }

      const clicks = Math.max(Number(raw) || 0, INITIAL_SEED_CLICKS);

      return NextResponse.json(
        { clicks, success: true },
        {
          status: 200,
          headers: {
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    return NextResponse.json(
      { clicks: inMemoryClicks, success: true },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    logger().warn({ error }, "Failed to read website clicks from Redis");
    return NextResponse.json(
      { clicks: inMemoryClicks, success: true },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
