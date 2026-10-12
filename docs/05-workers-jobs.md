# 05 — Background Workers & Jobs

## Why workers exist

Some things can't wait for a user's next HTTP request:

- Sending confirmation emails after payment
- Expiring abandoned checkout seats (so they free up for others)
- Detecting stuck payments that were paid but never fulfilled
- Generating CSV exports on demand
- Syncing state with Razorpay after network failures

The **worker** is a separate Node process running a `setInterval`-based loop.

## How it runs

```
Production:  docker compose (service: worker) → node dist/worker.cjs
Local dev:   pnpm worker:dev  (uses tsx + --conditions=react-server)
```

The worker is bundled by esbuild (`scripts/build-worker.mjs`) into one file (`dist/worker.cjs`),
so it doesn't need `node_modules` at runtime. That means it's a snapshot — if you change
service code, rebuild (`pnpm build:worker`) before redeploying.

Entry point: `src/workers/entry.ts` → `src/workers/main.ts:startWorkerLoop`.

**"Leased" safety:** every job is "claimed" with a timestamp lease. Two workers can run
simultaneously (e.g. during rollout) without double-sending — the SQL claim function uses
`FOR UPDATE SKIP LOCKED` so each job is only given to one worker at a time.

## The five jobs and their cadence

From `src/workers/main.ts:23`:

| Job | Interval | What it does | File |
|-----|---------|--------------|------|
| **Hold reaper** | 10s | Expires capacity holds past their window; frees seats | `hold-reaper.ts` |
| **Outbox dispatcher** | 5s | Claims outbox jobs, performs side effects (QR, cache invalidation, refunds, email enqueue) | `outbox-dispatcher.ts` |
| **Email dispatcher** | 10s | Renders and sends email via Resend | `outbox-dispatcher.ts` (2nd export) |
| **Payment reconciler** | 60s | Fixes stuck orders + stuck refunds | `payment-reconciler.ts` |
| **Export worker** | 30s | Builds requested CSV exports | `export-worker.ts` |

Note: hold reaper cadence is set to 10s; the plan comment says 5-15s is acceptable.

## The outbox pattern (critical pattern)

When checkout fulfills an order, the DB transaction atomically inserts the result
(delegates, registrations) **and** outbox job rows describing follow-up side effects.

```
outbox_jobs table
┌────────┬──────────┬────────────────────┬───────────┬──────────┐
│ job_id │ job_type │ aggregate_id       │ attempts  │ state    │
├────────┼──────────┼────────────────────┼───────────┼──────────┤
│ u1     │ SEND_EMAIL    │ order-abc    │ 0         │ PENDING  │
│ u2     │ ISSUE_QR      │ pass-xyz     │ 2         │ RETRY_WAIT│
└────────┴──────────┴────────────────────┴───────────┴──────────┘
```

**The outbox dispatcher** (every 5s):
1. Claims a batch via `claim_outbox_jobs` RPC (batch size 20, lease 120s).
2. For each job, switches on `job_type`:

| job_type | Action |
|----------|--------|
| `SEND_EMAIL` | Translates to an email job (upsert into `email_jobs`, deduplicated by `logical_key`) |
| `ISSUE_QR` | Creates a QR credential for the delegate pass |
| `INVALIDATE_CACHE` | Deletes Redis availability keys for affected events |
| `SUBMIT_REFUND` | Kicks off a refund via Razorpay |

3. Success → `complete_outbox_job`.
4. Failure → `fail_outbox_job` (retry in 30s, up to max attempts).

**Why go through two layers?** Email sending is slow and can fail. By first just recording
"we should send this email" in the outbox (fast, durable), then sending in a separate
dispatcher (slow, retries), the fulfillment transaction stays fast and reliable.

## Email pipeline

`runEmailDispatcher` in `outbox-dispatcher.ts`:

```
email_jobs
  PENDING ──▶ SUBMITTED ──▶ (webhook marks DELIVERED/BOUNCED/COMPLAINED)
     │           │
     │           └──▶ DEAD (deterministic 4xx, don't retry)
     │
     ├──▶ RETRY_WAIT (5xx/network/429, will retry with backoff)
     └──▶ SUPPRESSED (recipient on suppression list)
```

Before sending:
- Check `email_suppressions` table — if recipient is suppressed (bounced before),
  mark `SUPPRESSED` without trying.
- Render React Email template → HTML + plain text.
- Send via Resend with `idempotencyKey` = DB-generated key. If Resend sees the same key
  again it returns the original result instead of double-sending.

Template data is snapshotted at enqueue time (name, amount, order code). If user's
email changes later, the old snapshot is still what gets emailed — this is intentional.

## Hold reaper

`runHoldReaper` calls `expire_holds_batch` (SQL function). This:

1. Finds holds where `expires_at < now()`.
2. Uses `FOR UPDATE SKIP LOCKED` so two workers + QStash wake don't collide.
3. Atomically: releases the hold, decrements `event_inventory.held_units`, updates order
   state, frees any team claims.
4. Returns list of events whose inventory changed → worker invalidates their Redis
   availability keys.

**If holds aren't expiring:** the worker is down or the SQL function is erroring.
This shows up as "sold out" errors when capacity should be available. See troubleshooting.

## Payment reconciler

Every 60s, finds orders stuck in uncertain states:

1. Orders in `PROVISIONING_PROVIDER` or `AWAITING_PAYMENT` older than 2 minutes,
   with a Razorpay order ID.
2. For each, fetches payment state from Razorpay API.
3. If provider says "captured" → calls `apply_captured_payment` (same as webhook path).
4. Also: finds refunds stuck in `PENDING`/`SUBMITTING` and asks Razorpay their real status.

This is the safety net for network failures: even if the webhook never arrives and the
browser callback was cut off, this job eventually corrects the state.

**Require both:** `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` env vars must be set. Without
them, reconciler skips everything (no-op).

## Export worker

Admin requests an export (e.g. all finance data) via `/admin/exports`. This inserts an
`export_jobs` row with status `REQUESTED`. Worker picks it up:

1. Claims up to 3 jobs at a time in FIFO order.
2. Builds rows from DB, filtered by `filter_snapshot` (e.g. `eventId`).
3. Writes CSV to `EXPORT_DIR` (defaults to `.exports/`).
4. Records SHA-256 checksum so admins can verify file integrity.
5. Files expire after 24h (purged by another job).

Export types: `EVENT_REGISTRATIONS`, `ROSTER`, `FINANCE_LEDGER`, `SCAN_HISTORY`.

## QStash wake (recovery driver)

QStash is Upstash's scheduler. It pings our job routes on a schedule as a **recovery
trigger** in case the worker misses something. These routes are in `src/app/api/jobs/*`:

| Endpoint | Triggered by QStash to run |
|----------|---------------------------|
| POST /api/jobs/outbox | Outbox dispatcher |
| POST /api/jobs/email | Email dispatcher |
| POST /api/jobs/hold-reaper | Hold reaper |
| POST /api/jobs/reconcile | Payment reconciler |
| POST /api/jobs/exports | Export worker |

Each verifies an `Upstash-Signature` header before running. Without `QSTASH_CURRENT_SIGNING_KEY`
env set, these routes fail closed (401). So QStash is strictly optional — the worker loop
is the primary driver.

## Duplicate delivery safety

Every handler is idempotent:
- Outbox jobs: `logical_key` unique constraint prevents duplicate enqueue.
- Emails: `idempotency_key` prevents Resend double-send.
- Applies: `apply_captured_payment` checks payment already applied.
- Refunds: stable idempotency key per refund.

## "at-least-once" vs "exactly-once"

QStash guarantees "at least once" delivery — meaning a job might run multiple times. We
never try for "exactly once" (impossible across networks); instead we make every handler
safe to repeat.

## What can go wrong?

| Symptom | Cause | Check |
|---------|-------|-------|
| Emails not sending | Resend API key not set | `email_jobs` state = RETRY_WAIT with error "Resend not configured" |
| Email stuck RETRY_WAIT | Transient provider error | Let it retry; check `attempts`; DEAD = give up |
| Email marked DEAD | 4xx from Resend (bad address, invalid sender) | Check `last_error` in email_jobs |
| Recipient should have received but Supabase says suppressed | Email bounced previously | `SELECT * FROM email_suppressions WHERE email = '...';` |
| Holds not freeing (sold_out but capacity exists) | Worker down, or SQL error | `docker compose logs worker` for errors; check `capacity_holds` rows with expired times |
| Paid but not fulfilled for >3 minutes | Reconciler won't run | Check `RAZORPAY_KEY_ID`/`SECRET` env set; check worker alive; check `orders.checkout_state` |
| Export finishes but file missing | Wrong volume mount | Worker writes to `/app/.exports` in Docker; web container shares it via `exports-data` volume |
| Export fails with "Unknown export type" | Stale worker image or bad job record | Rebuild worker; check `export_jobs.export_type` |
| QStash endpoint returns 401 | Signing key mismatch | Verify `QSTASH_CURRENT_SIGNING_KEY` matches what's in Upstash dashboard |
| Worker starts then exits immediately | env validation fails at startup | Check `docker compose logs worker` first line |
| Worker duplicate processing | Two workers both running without lease contention | Expected — `SKIP LOCKED` handles it, not a bug |

### Worker health checks

```bash
# Is worker running?
docker compose ps worker
docker compose logs worker --tail 50

# Are jobs piling up? (sign of stuck worker)
SELECT job_type, COUNT(*) FROM outbox_jobs WHERE state IN ('PENDING','RETRY_WAIT') GROUP BY job_type;
SELECT COUNT(*) FROM email_jobs WHERE state IN ('PENDING','RETRY_WAIT');
```
