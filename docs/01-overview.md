# 01 — Overview

## What this project is

**PULSE** is the website + ticketing system for AIIMS Delhi's college fest. It started as a
static event website and grew into a full platform:

- **Public site** — browse events, schedule, notices, venues, FAQs.
- **Ticketing** — delegates buy a *base pass*, then register for individual/team events via Razorpay.
- **QR passes** — every paid pass gets a signed QR credential.
- **Gate scanning** — staff scan QR codes at entrances to admit people.
- **Admin panel** — staff manage events, schedule, notices, support, exports, RBAC.
- **Emails** — order confirmations and other transactional emails via Resend.

## The moving parts (30-second tour)

| Piece | Tech | Role |
|------|------|------|
| Frontend + API | Next.js 16 (App Router), React 19, Tailwind v4 | Pages + Route Handlers |
| Database + Auth | Supabase (Postgres + Supabase Auth) | All data, user accounts, RLS |
| Payments | Razorpay | Indian payment gateway |
| Email | Resend | Transactional email delivery |
| Cache + rate limits + job wake | Upstash (Redis + QStash) | Fast cache, limits, scheduled triggers |
| Background jobs | A Node worker process | Emails, refunds, hold expiry, reconciliation, CSV exports |
| Infra | Docker Compose + Nginx on a VM | Production hosting |

**Key idea:** the app server (`web`) and the background worker (`worker`) are built from the SAME
Docker image, just run with different commands. The DB holds all the truth; the worker only executes.

## The user journey (happy path)

1. Visitor browses `/`, `/events`, `/schedule` (public, no login).
2. Visitor signs up/logs in via Supabase Auth, completes profile (`/complete-profile`).
3. Buys base pass → Razorpay checkout → payment captured → order fulfilled → **delegate pass** created.
4. Registers for events (solo or with a team). Team events need every member's base pass.
5. Worker issues a **QR credential** for the pass; delegate sees it at `/dashboard/pass/[passId]`.
6. At the fest, staff scanner scans QR → admission recorded → entry granted.

## Key concepts explained simply

### The Base Pass (everything hinges on this)
A delegate can't register for any event until they own an **active base pass**. It's the entry fee to
the fest. This is enforced in checkout: `BASE_PASS_REQUIRED` error if you skip it, and
`BASE_PASS_EXISTS` if you try to buy a second one.

### Orders are **never** created, paid, then lost
Payments are only "applied" when Razorpay confirms they're **captured** (money actually taken).
The system never trusts the browser — only the provider + webhooks.

### Capacity holds prevent overselling
When you start checkout, we "hold" your seat for a few minutes. If you pay, it becomes permanent.
If you abandon, the hold expires and the seat frees up. This is how we never sell more tickets than
seats. See doc [04](./04-checkout-payments.md).

## Code layout map

```
src/
├── app/           # Next.js pages + API routes (public/admin/api/...)
├── components/     # UI pieces
├── domain/         # Pure TypeScript types (no framework)
├── emails/         # Email templates (React Email)
├── lib/            # Shared helpers (env, api, redis, razorpay, qr, supabase)
├── repositories/   # DB read models (build UI-shaped data from tables)
├── services/       # Business logic (checkout, refunds, scanning, authz)
├── workers/        # Background job loop (runs outside Next)
└── proxy.ts        # Route protection (auth redirect), runs on edge
supabase/
└── migrations/     # All SQL that creates tables, functions, triggers
infra/              # Nginx config, deploy/rollback scripts, systemd
```

## Where things are enforced

Many rules live in **database functions**, not in TypeScript. This is deliberate:
handlers can be called from anywhere, and if a rule lives in SQL, it can't be skipped.

Examples: `has_permission`, `create_event_checkout`, `apply_captured_payment`, `expire_holds_batch`.

When a bug shows up, check **both** the service code *and* the SQL function it calls (doc [07](./07-database.md)).
