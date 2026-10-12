# PULSE Codebase Documentation

Plain-language documentation for understanding every part of this project and diagnosing problems.

Read in order the first time. When something breaks, jump to the relevant doc — each one ends with "What can go wrong".

| # | Doc | Covers |
|---|-----|--------|
| 01 | [Overview](./01-overview.md) | What this project is, the people involved, the 5-second tour |
| 02 | [Architecture](./02-architecture.md) | How the pieces fit together, what talks to what, a request's journey |
| 03 | [Users, Login & Permissions](./03-auth-rbac.md) | Accounts, profiles, staff, roles, permissions, admin access |
| 04 | [Checkout & Payments](./04-checkout-payments.md) | Buying passes, capacity holds, Razorpay, webhooks, refunds |
| 05 | [Background Workers & Jobs](./05-workers-jobs.md) | The worker process, outbox, emails, hold reaper, reconciler, exports |
| 06 | [QR Passes & Gate Scanning](./06-qr-scanning.md) | QR passes, signing keys, scanners at venues, admission records |
| 07 | [Database](./07-database.md) | All tables grouped by purpose, migrations, where data lives |
| 08 | [Caching & Rate Limiting](./08-caching-rate-limiting.md) | Redis, content cache, availability, feature flags, rate limits, health checks |
| 09 | [Deployment & Operations](./09-deployment-operations.md) | Docker, nginx, deploy/rollback, env vars, monitoring |
| 10 | [Troubleshooting Guide](./10-troubleshooting.md) | Symptom → likely cause → what to check |
| 11 | [VPS Go-Live & Razorpay Webhooks](./11-vps-razorpay-golive.md) | Step-by-step first deploy: VPS, Cloudflare, TLS, GHCR, registering and testing the Razorpay webhook |
| 12 | [Migrating an Existing VPS](./12-vps-migration.md) | Reusing a VPS that already runs another project: wipe vs in-place, Cloudflare cleanup, building without CI admin rights |

## Glossary (used throughout)

| Term | Meaning |
|------|---------|
| Festival | One edition of PULSE (e.g. PULSE 2026). Most data belongs to a festival. |
| Delegate | A participant (attendee) of the fest. |
| Base pass | The entry ticket every delegate must buy first. Unlocks event registration. |
| Event | A competition/workshop/show within the fest. |
| Registration | A delegate (or team) signed up for an event. |
| Order | A purchase attempt. Has states: PROVISIONING → AWAITING_PAYMENT → CAPTURED → FULFILLED. |
| Capacity hold | Temporary "seat reservation" during checkout, expires if unpaid. |
| Idempotency key | A unique ID the client sends so retrying a request never creates duplicates. |
| Outbox | Database queue of background jobs (send email, issue QR, etc.). |
| Webhook | External services (Razorpay, Resend) pushing events to our API. |
| QStash | Upstash service that pings job endpoints on a schedule (backup trigger). |
| Reconciler | Fixes "stuck" orders/refunds by checking provider state. |
| RLS | Row Level Security — Supabase's per-row permission system. |
| Service role | A Supabase key that bypasses RLS. Server-only, never bundled to browser. |
