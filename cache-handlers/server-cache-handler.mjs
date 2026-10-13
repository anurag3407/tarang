/**
 * Shared Next.js server cache handler (plan §10.6, §15.3).
 *
 * Backs ISR, route-handler responses, and `unstable_cache` with Upstash Redis
 * so every Next process and origin shares one cache and revalidates together.
 *
 * Contract (from the installed Next 16.3.1 docs):
 *   get(key, ctx)                 -> cached value or null
 *   set(key, data, ctx)           -> store under key with ctx.tags
 *   revalidateTag(tag | tag[])    -> invalidate by tag
 *   resetRequestCache()           -> clear per-request scratch
 *
 * Hard rules honored here:
 *   - Reads fail as cache MISSES, never whole-site 500s (§10.6.5).
 *   - Writes are atomic (single Redis SET) — no partial entries (§10.6.6).
 *   - Keys are namespaced by environment + deployment (§10.6.7).
 *   - Tag invalidation uses per-tag timestamp keys, never keyspace scans
 *     (§10.6.8).
 *   - Large image-optimization buffers are NOT pushed to Upstash (§10.6.4);
 *     they fall back to the local bounded store.
 *
 * If Upstash is not configured (local dev) the handler degrades to a bounded
 * in-process LRU so single-instance development still works.
 */

const APP_ENV = process.env.APP_ENV || "local";
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID || "dev";
const KEY_PREFIX = `tarang:${APP_ENV}:next-cache:${DEPLOYMENT_ID}`;
const TAG_PREFIX = `tarang:${APP_ENV}:next-cache-tags:${DEPLOYMENT_ID}`;

// Never push entries larger than this to Upstash (protects against image
// buffers and huge RSC payloads). Oversized entries stay local-only.
const MAX_REMOTE_BYTES = 512 * 1024;
// Default TTL when Next gives us no revalidate bound.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
// How long the local tag-timestamp mirror stays fresh before re-reading Redis.
const TAG_CACHE_TTL_MS = 1000;
// Bounded local fallback / oversized-entry store.
const LOCAL_MAX_ENTRIES = 500;

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

// Local bounded LRU used as fallback and for oversized entries.
const localStore = new Map();
function localSet(key, value) {
  if (localStore.size >= LOCAL_MAX_ENTRIES) {
    const first = localStore.keys().next().value;
    if (first !== undefined) localStore.delete(first);
  }
  localStore.set(key, value);
}

// Local mirror of tag revalidation timestamps.
const localTagTimes = new Map();
let localTagFetchedAt = 0;

function entryKey(key) {
  return `${KEY_PREFIX}:${key}`;
}
function tagKey(tag) {
  return `${TAG_PREFIX}:${tag}`;
}

function serialize(data) {
  return JSON.stringify(data, (_k, v) =>
    v && v.type === "Buffer" && Array.isArray(v.data)
      ? { __b64: Buffer.from(v.data).toString("base64") }
      : v
  );
}

function deserialize(text) {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && typeof v.__b64 === "string"
      ? Buffer.from(v.__b64, "base64")
      : v
  );
}

async function refreshTagTimes(tags) {
  const now = Date.now();
  if (now - localTagFetchedAt < TAG_CACHE_TTL_MS) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    const keys = tags.map(tagKey);
    const values = await redis.mget(...keys);
    for (let i = 0; i < tags.length; i++) {
      const v = values[i];
      if (v !== null && v !== undefined) {
        localTagTimes.set(tags[i], Number(v));
      }
    }
    localTagFetchedAt = now;
  } catch {
    // Tag refresh failure just means we may serve slightly stale content for
    // up to the TTL window — never an error.
  }
}

function isTagStale(tags, lastModified) {
  for (const tag of tags) {
    const t = localTagTimes.get(tag);
    if (t !== undefined && t > lastModified) return true;
  }
  return false;
}

export default class CacheHandler {
  constructor(options) {
    this.options = options;
    this.requestCache = new Map();
  }

  async get(key, ctx) {
    // Per-request scratch wins first. Returns the full entry wrapper
    // ({ value, lastModified }) as Next expects.
    if (this.requestCache.has(key)) {
      return this.requestCache.get(key);
    }

    const tags = (ctx && ctx.tags) || [];
    await refreshTagTimes(tags);

    // Local fallback / oversized entries.
    const local = localStore.get(key);
    if (local) {
      if (isTagStale(local.tags || [], local.lastModified || 0)) {
        localStore.delete(key);
        return null;
      }
      return { value: local.value, lastModified: local.lastModified };
    }

    const redis = await getRedis();
    if (!redis) return null;
    try {
      const raw = await redis.get(entryKey(key));
      if (!raw) return null;
      const entry = typeof raw === "string" ? deserialize(raw) : raw;
      if (!entry || entry.value === undefined) return null;
      if (isTagStale(entry.tags || [], entry.lastModified || 0)) {
        return null;
      }
      return { value: entry.value, lastModified: entry.lastModified };
    } catch {
      return null; // miss, not a 500
    }
  }

  async set(key, data, ctx) {
    const tags = (ctx && ctx.tags) || [];
    const record = {
      value: data,
      lastModified: Date.now(),
      tags,
    };

    // Always keep a local copy (fast path + oversized fallback).
    localSet(key, record);
    this.requestCache.set(key, { value: data, lastModified: record.lastModified });

    const kind = data && data.kind;
    const serialized = safeSerialize(record);
    if (serialized === null || serialized.length > MAX_REMOTE_BYTES) {
      // Too large for Upstash (e.g. image buffers) — local only (§10.6.4).
      return;
    }
    if (kind === "IMAGE") {
      // Keep optimized images out of Upstash by default (§10.6.4).
      return;
    }

    const redis = await getRedis();
    if (!redis) return;
    try {
      const ttl =
        data && typeof data.revalidate === "number" && data.revalidate > 0
          ? data.revalidate
          : DEFAULT_TTL_SECONDS;
      await redis.set(entryKey(key), serialized, { ex: ttl });
    } catch {
      // set() runs after the response is flowing; a failure just loses the
      // cache entry, it never breaks the request.
    }
  }

  async revalidateTag(tags) {
    const list = [tags].flat();
    const now = Date.now();
    for (const tag of list) {
      localTagTimes.set(tag, now);
    }
    const redis = await getRedis();
    if (!redis) return;
    try {
      const pipeline = redis.pipeline();
      for (const tag of list) {
        pipeline.set(tagKey(tag), String(now));
      }
      await pipeline.exec();
    } catch {
      // Local timestamps already updated; other processes catch up on their
      // next tag refresh within the TTL window.
    }
  }

  resetRequestCache() {
    this.requestCache.clear();
  }
};

function safeSerialize(record) {
  try {
    return serialize(record);
  } catch {
    return null;
  }
}
