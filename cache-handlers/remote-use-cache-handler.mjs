/**
 * Remote `'use cache'` handler (plan §10.6.2, tree §5.2).
 *
 * Implements the plural `cacheHandlers.remote` interface exactly as specified
 * by the installed Next 16.3.1 docs:
 *
 *   get(cacheKey, softTags)              -> CacheEntry | undefined
 *   set(cacheKey, pendingEntry)          -> Promise<void>
 *   refreshTags()                        -> Promise<void>
 *   getExpiration(tags)                  -> Promise<number>
 *   updateTags(tags, durations?)         -> Promise<void>
 *
 * CacheEntry: { value: ReadableStream<Uint8Array>, tags, stale, timestamp,
 * expire, revalidate }.
 *
 * Storage is Upstash Redis, namespaced by environment + deployment. Reads
 * fail as misses (never render errors); partial stream writes are discarded;
 * tag coordination uses per-tag timestamp keys (no keyspace scans).
 *
 * The app currently uses `unstable_cache` (server cache) rather than
 * `'use cache: remote'` directives, so this handler stays dormant until those
 * directives are adopted — it is wired in next.config.ts so the switch is a
 * one-line code change.
 */

const APP_ENV = process.env.APP_ENV || "local";
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID || "dev";
const KEY_PREFIX = `tarang:${APP_ENV}:use-cache:${DEPLOYMENT_ID}`;
const TAG_PREFIX = `tarang:${APP_ENV}:use-cache-tags:${DEPLOYMENT_ID}`;

const MAX_REMOTE_BYTES = 512 * 1024;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const TAG_CACHE_TTL_MS = 1000;

let redisPromise;
async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redisPromise) {
    redisPromise = import("@upstash/redis").then(({ Redis }) =>
      Redis.fromEnv()
    );
  }
  try {
    return await redisPromise;
  } catch {
    redisPromise = null;
    return null;
  }
}

function entryKey(cacheKey) {
  return `${KEY_PREFIX}:${cacheKey}`;
}
function tagKey(tag) {
  return `${TAG_PREFIX}:${tag}`;
}

// Local mirror of tag revalidation timestamps + the tags we know about
// (avoids unbounded Redis scans on refresh — §10.6.8).
const localTagTimes = new Map();
const knownTags = new Set();
let localTagFetchedAt = 0;

async function refreshLocalTags() {
  const now = Date.now();
  if (now - localTagFetchedAt < TAG_CACHE_TTL_MS) return;
  const redis = await getRedis();
  if (!redis || knownTags.size === 0) {
    localTagFetchedAt = now;
    return;
  }
  try {
    const tags = [...knownTags];
    const values = await redis.mget(...tags.map(tagKey));
    for (let i = 0; i < tags.length; i++) {
      const v = values[i];
      if (v !== null && v !== undefined) {
        localTagTimes.set(tags[i], Number(v));
      }
    }
    localTagFetchedAt = now;
  } catch {
    // Stale-while-revalidate: keep serving with the last known tag state.
  }
}

async function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function streamFromBytes(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const handler = {
  async get(cacheKey, softTags) {
    const redis = await getRedis();
    if (!redis) return undefined;
    try {
      const raw = await redis.get(entryKey(cacheKey));
      if (!raw) return undefined;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!data || typeof data.value !== "string") return undefined;

      // Hard expiry.
      const now = Date.now();
      if (now > data.timestamp + data.revalidate * 1000) return undefined;

      // Tag invalidation: any hard tag revalidated after the entry was
      // written makes it stale.
      await refreshLocalTags();
      for (const tag of data.tags || []) {
        const t = localTagTimes.get(tag);
        if (t !== undefined && t > data.timestamp) return undefined;
      }
      // Soft tags (route-path implicit tags) checked the same way.
      for (const tag of softTags || []) {
        const t = localTagTimes.get(tag);
        if (t !== undefined && t > data.timestamp) return undefined;
      }

      return {
        value: streamFromBytes(Uint8Array.from(Buffer.from(data.value, "base64"))),
        tags: data.tags || [],
        stale: data.stale,
        timestamp: data.timestamp,
        expire: data.expire,
        revalidate: data.revalidate,
      };
    } catch {
      return undefined; // miss, never a render error
    }
  },

  async set(cacheKey, pendingEntry) {
    let entry;
    try {
      entry = await pendingEntry;
    } catch {
      return; // generation failed — nothing to store
    }
    if (!entry) return;

    let bytes;
    try {
      bytes = await readStream(entry.value);
    } catch {
      return; // partial/errored stream — discard, never store partials
    }
    if (bytes.byteLength > MAX_REMOTE_BYTES) return;

    const redis = await getRedis();
    if (!redis) return;
    try {
      const payload = {
        value: Buffer.from(bytes).toString("base64"),
        tags: entry.tags || [],
        stale: entry.stale,
        timestamp: entry.timestamp,
        expire: entry.expire,
        revalidate: entry.revalidate,
      };
      const ttl =
        entry.expire > 0
          ? Math.ceil((entry.timestamp + entry.expire * 1000 - Date.now()) / 1000)
          : entry.revalidate > 0
            ? entry.revalidate
            : DEFAULT_TTL_SECONDS;
      if (ttl > 0) {
        await redis.set(entryKey(cacheKey), JSON.stringify(payload), { ex: ttl });
      }
    } catch {
      // Losing a cache entry is acceptable; the next request re-renders.
    }
  },

  async refreshTags() {
    await refreshLocalTags();
  },

  async getExpiration(tags) {
    await refreshLocalTags();
    let max = 0;
    for (const tag of tags) {
      const t = localTagTimes.get(tag) || 0;
      if (t > max) max = t;
    }
    return max;
  },

  async updateTags(tags, _durations) {
    const now = Date.now();
    for (const tag of tags) {
      localTagTimes.set(tag, now);
      knownTags.add(tag);
    }
    const redis = await getRedis();
    if (!redis) return;
    try {
      const pipeline = redis.pipeline();
      for (const tag of tags) {
        pipeline.set(tagKey(tag), String(now));
      }
      await pipeline.exec();
    } catch {
      // Local state already updated; other instances converge on refresh.
    }
  },
};

module.exports = handler;
