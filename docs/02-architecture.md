# 02 — Architecture

## Big picture diagram

```
                     ┌─────────────────────────────────────────────────────────┐
   Delegates         │                    DEVICES                              │
   (browsers) ──────▶│  Browser → Cloudflare → Nginx (VM) ─┐                  │
                     └─────────────────────────┘            │                  │
                                                           ▼
                                                    ┌─────────────┐
                                                    │  Next.js    │
                                                    │  (web)      │  ← Docker "web"
                                                    └──┬──┬───────┘
                                                       │  │
         ┌────────────────────────────────────────────┘  └─────────────┐
         ▼                                                             ▼
  ┌────────────┐                                            ┌────────────────────┐
  │ Supabase   │◀───────────────────────────────────────── │  worker            │
  │  Postgres  │                                            │  (background loop) │
  │            │─── triggers QStash ──┐                    │  Docker "worker"    │
  └────────────┘                      │                    └────────────────────┘
         ▲                            ▼                            ▲
         │                    ┌──────────────┐                     │
         │                    │  QStash      │── POST /api/jobs/* │
         │                    │ (scheduler)  │   (recovery wake)   │
         │                    └──────────────┘                     │
         │                                                        │
  ┌──────┴────┐   ┌──────────────┐   ┌──────────┐          ┌─────┴───────┐
  │  Upstash  │   │   Razorpay   │   │  Resend  │          │  Redis      │
  │   cache   │   │  (payments)  │   │ (email)  │          │ (cache/     │
  └───────────┘   └──────────────┘   └──────────┘          │  rate limit)│
                                                            └─────────────┘
                              ▲                    ▲
                              │ webhooks           │ webhooks
                              /api/webhooks/razorpay    /api/webhooks/resend
```

## Two processes, one image

The production Docker image is built once and run in two different ways:

```
  web container      →  node server.js        → serves pages + API routes
  worker container   →  node dist/worker.cjs  → runs the job loop, no HTTP server
```

They share:
- The same code and env vars (needed so worker can talk to the DB, Redis, Razorpay, Resend).
- Docker volume (`.exports`) for files the export worker writes.

**Why this split?** The Next.js server lives and dies with HTTP requests. If a payment
succeeds at 3am and needs to trigger an email, we don't want to wait for the next request —
the worker runs on its own timetable. And it's non-blocking so high web traffic doesn't delay
jobs. See doc [05](./05-workers-jobs.md).

## A request's journey (e.g. "load /events")

1. Browser → Cloudflare (CDN/DDoS) → Nginx (reverse proxy on the VM).
2. Nginx hands off to Next.js on port 3000.
3. Next 16's `proxy.ts` (middleware equivalent) runs — refreshes the Supabase session,
   redirects to login for protected pages. It does NOT check permissions.
4. `src/app/events/page.tsx` (Server Component) fetches from the `repositories/public-content.ts`.
5. Repository queries Supabase, returns typed data to the page.
6. Page renders and returns HTML; data can be cached in Next's ISR.

## The three layers inside `src/`

```
   Next.js pages/routes
        │        app/
        ▼
   services/       Business logic (checkout, refund, scan, authz)
        │
        ▼
   repositories/   DB read models (query, shape data)
        │
        ▼
   Supabase Postgres   ← SQL functions enforce the rules
```

Services never talk to HTTP handlers; pages never talk to DB directly.
This keeps the logic testable and reusable between web + admin + scanner.

## Main external services & failure modes

| Service | What it does | If it's down |
|---------|-------------|-------------|
| **Supabase** | DB + Auth | Everything breaks. Core dependency. |
| **Upstash Redis** | Caches public content, rate limits | Reads fall back to DB. Checkout fails closed (safer). |
| **QStash** | Triggers jobs if worker misses them | Only backup driver lost; worker still runs. |
| **Razorpay** | Payments | Checkout: order created but stays "paused", reconciler fixes if provider down once paid. |
| **Resend** | Emails | Email jobs park for retry; no data loss. |
| **Cloudflare** | CDN | Site may slow; Turnstile CAPTCHAs fail. |

## Design principles baked into every file (take them seriously, they exist for real reasons)

1. **DB is source of truth.** Webhooks, reconciliation and leases mean we survive cache loss.
2. **Never trust the browser.** Amount is never sent by the client; server computes from DB price.
3. **Idempotency everywhere.** Every mutation endpoints take an `Idempotency-Key`, every job
   handler is safe to run twice.
4. **Leases, not locks.** Worker jobs are "claimed" (time-limited), so 2+ workers can run safely.
5. **Fail closed for money, fail open for reads.** Critical paths reject uncertain states;
   public reads allow traffic through on Redis errors.
6. **One immutable image.** You deploy exact digests, never mutable tags (`latest`).

## What can go wrong?

- **Web container memory bloat** → runs standalone Next; check `docker stats`.
- **Session expired mid-render** → proxy.ts refresh timeout; see log `auth.getUser`.
- **Changes to services not reflected in worker** → worker is a snapped build, needed to
  rebuild (`pnpm build:worker`) before deploying new worker image.
