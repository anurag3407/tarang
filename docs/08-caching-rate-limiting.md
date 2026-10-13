# 08 — Caching, Rate Limiting & Health

## Three caching layers (understand all three)

### 1. Next.js server cache (ISR) — shared via Upstash Redis

Next's built-in cache (ISR pages, `unstable_cache`) is backed by Redis through a custom
handler: `cache-handlers/server-cache-handler.mjs` (wired in `next.config.ts` via `cacheHandler`).

Why custom? Two origins / multiple processes must share ONE cache. With the default
in-memory cache, origin A and origin B would render different content.

Behavior rules (important for debugging):
- Redis down → reads behave as cache **misses** (fresh render), never a 500.
- Entries > 512KB stay local-only (never pushed to Upstash).
- Tag invalidation uses timestamp keys, not key scans.
- Keys namespaced by `APP_ENV` + `DEPLOYMENT_ID` → a deploy automatically orphans old cache.
- No Upstash configured (local dev) → falls back to a bounded in-process LRU.

`next.config.ts` also sets `cacheMaxMemorySize: 0` (in-process LRU disabled in prod — the
shared handler is authoritative).

### 2. Application content cache — Redis with short TTLs

`src/lib/redis/content-cache.ts` caches public read data:

| Data | TTL |
|------|-----|
| Event list | 60s |
| Schedule | 60s |
| Notices | 30s |
| Feature flags | 5s |
| Availability badges | 8s (sales open) / 30s (sales closed) |

**Availability is advisory.** The "X seats left" badge on a page can be up to 30s stale.
The real check is always the conditional Postgres update inside checkout — so a stale badge
can NEVER cause overselling.

### 3. Invalidate both when content changes

When an admin edits events/schedule/notices, `src/lib/invalidation.ts` does both:
1. `revalidateTag("festival:<id>:<kind>", "max")` — purge Next cache.
2. Delete Redis content keys — purge app cache.

Availability invalidation lives in `src/lib/redis/availability.ts` (deliberately does NOT
import `next/cache` so worker can call it).

## Cache keys

All Redis keys follow `tarang:<APP_ENV>:...` (`src/lib/redis/keys.ts`):
- `tarang:prod:content:events:<festivalId>:<version>`
- `tarang:prod:availability:<festivalId>:<eventId>`
- `tarang:prod:ratelimit:<class>:<identifier>`
- etc.

Never store email/phone/raw IP/raw QR in keys.

## Rate limiting

`src/lib/redis/rate-limits.ts` — Upstash sliding-window limits:

| Class | Limit | Used by |
|-------|-------|---------|
| login | 20 / 15m | Login attempts |
| order | 5 / 1m | Checkout |
| team | 20 / 10m | Team creation/join |
| ask | 3 / 1h | Question form |
| verify | 10 / 1m | Pass verifier |
| admin | 60 / 1m | Admin mutations |
| export | 3 / 1h | Export requests |
| scanner | 20 / 1s | Scans |
| public | 300 / 1m | Public reads |

Failure policy:
- **Critical writes** (checkout etc.) use `failClosed` — if Redis is down, return 503
  `RATE_LIMIT_UNAVAILABLE` rather than allowing unlimited writes.
- **Public reads** fail open — Redis down never breaks browsing.

Turnstile (Cloudflare bot protection) guards public forms when `TURNSTILE_*` envs set
(`src/lib/turnstile.ts`).

## Health checks

| Endpoint | Purpose | Behavior |
|----------|---------|----------|
| `/api/health/live` | Liveness (process up) | Always 200 if server responds |
| `/api/health/ready` | Readiness (can serve) | Checks Supabase reachable, cached 5s. Used by Docker healthcheck + deploy script. |
| `/api/health/dependencies` | Dependency details | Reports which external services are reachable |

## Email deliverability tracking

Resend webhooks (`/api/webhooks/resend`) record delivery events into `email_events` and
mark bad recipients (bounced/complained) into `email_suppressions`. Suppressed recipients
never receive emails again (by design). Check these tables when "emails not arriving".

## What can go wrong?

| Symptom | Cause | Check |
|---------|-------|-------|
| Stale event on site after admin edit | Cache not invalidated | `revalidateTag` ran? Redis key deleted? TTL ≤60s, wait + refresh |
| Badge says available but checkout SOLD_OUT | Availability cache advisory, real capacity is 0 | Query `event_inventory` for real numbers |
| 503 RATE_LIMIT_UNAVAILABLE | Upstash down + fail-closed write | Wait/restore Upstash; intentional design |
| Different content on two origins | Cache handler not shared, or deployment id differs | Ensure both origins use same `server-cache-handler.mjs` and `DEPLOYMENT_ID` |
| Huge Redis cost | Big entries being pushed | Entries >512KB stay local, but RSC payloads can still add up; check Upstash usage |
| Turnstile errors on forms | `TURNSTILE_SECRET_KEY`/`SITE_KEY` missing or mismatched | Verify both set; secret used server-side, site key public |
| /api/health/ready failing | Supabase round-trip failing | `ready` uses service-role; Supabase outage or wrong key |
