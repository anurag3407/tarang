# 10 — Troubleshooting Guide

Symptom-first. Find what you're seeing, follow the checks. Each section ends with the
commands/queries to run.

## Quick health check (do this first for any incident)

```bash
# Containers alive? (web-blue @ 3001, web-green @ 3002, worker)
docker compose ps

# Which slot is serving traffic?
cat /var/lib/tarang/active-slot   # blue or green

# Recent errors?
ACTIVE=$([ "$(cat /var/lib/tarang/active-slot 2>/dev/null)" = green ] && echo web-green || echo web-blue)
docker compose logs "$ACTIVE" --tail 100 --since 10m | grep -i error
docker compose logs worker --tail 100 --since 10m | grep -i error

# Health endpoints (on the active slot's loopback port)
PORT=$([ "$(cat /var/lib/tarang/active-slot 2>/dev/null)" = green ] && echo 3002 || echo 3001)
curl -s "http://127.0.0.1:${PORT}/api/health/live"
curl -s "http://127.0.0.1:${PORT}/api/health/ready"
curl -s "http://127.0.0.1:${PORT}/api/health/dependencies"
```

If `ready` returns 503 → Supabase problem. If `live` fails → that slot's container is
down (nginx should be pointing at the other slot; check
`/etc/nginx/conf.d/tarang-upstream.conf`).

## Checkout & payments

### "SOLD_OUT but capacity should exist"

1. Check real inventory:
   ```sql
   SELECT capacity_units, held_units, confirmed_units,
          capacity_units - held_units - confirmed_units AS available
   FROM event_inventory WHERE event_id = '<event-id>';
   ```
2. If `held_units` is large → abandoned checkouts still holding seats:
   ```sql
   SELECT count(*), min(expires_at), max(expires_at)
   FROM capacity_holds WHERE expires_at > now() GROUP BY order_line_id;
   ```
3. If holds are past `expires_at` but `held_units` didn't drop → **hold reaper not running**.
   Check worker: `docker compose logs worker --tail 50`. Worker down = holds never expire.

### "Paid but order stuck / not fulfilled"

1. Find the order:
   ```sql
   SELECT o.public_order_code, o.checkout_state, o.updated_at,
          rp.razorpay_order_id, p.razorpay_payment_id, p.provider_status
   FROM orders o
   LEFT JOIN razorpay_orders rp ON rp.local_order_id = o.id
   LEFT JOIN payments p ON p.razorpay_order_id = rp.razorpay_order_id
   WHERE o.public_order_code = 'PO-XXXX' OR rp.razorpay_order_id = 'order_...';
   ```
2. If `provider_status = 'captured'` but `checkout_state` not FULFILLED → reconciler will fix
   within ~2 min. If still stuck after 5 min:
   - Razorpay env missing? (`RAZORPAY_KEY_ID`/`SECRET` in worker's env)
   - Worker down?
   - `apply_captured_payment` error? Check worker logs for the payment id.
3. If Razorpay dashboard shows captured but our `payments` row missing → webhook failed:
   ```sql
   SELECT event_type, processing_state, last_error, processed_at
   FROM webhook_events WHERE raw_body->'payload'->'payment'->'entity'->>'order_id' = 'order_...';
   ```
   - `RETRY` state means it'll retry; `RECEIVED`+old means processing crashed → retrigger by
     fixing whatever `last_error` says.

### "Webhook 401 errors in Razorpay dashboard"

- Signature mismatch → `RAZORPAY_WEBHOOK_SECRET_CURRENT`/`_PREVIOUS` wrong.
- Razorpay sends the event-id header `x-razorpay-event-id`; verify in Razorpay webhook config
  that URLs point at `hooks.<domain>/api/webhooks/razorpay`.
- Secret rotation: set `_CURRENT` to new, `_PREVIOUS` to old, then rotate.

### "503 RATE_LIMIT_UNAVAILABLE on checkout"

Upstash Redis down + fail-closed design. This is intentional (protects against abuse).
Restore Redis or wait. Public browsing should still work (fails open).

### "IDEMPOTENCY_MISMATCH"

Client-side bug: a new action is reusing an old `Idempotency-Key`. Each "Buy" click must
generate a fresh UUID. Check the frontend for key reuse.

## Emails

### "Confirmation email not received"

```sql
-- 1. Was the email job created?
SELECT state, last_error, attempts, updated_at
FROM email_jobs WHERE logical_key = 'order-confirmation:<order-id>';

-- 2. If no row at all → outbox dispatcher not processing SEND_EMAIL
SELECT state, count(*) FROM outbox_jobs WHERE job_type = 'SEND_EMAIL' GROUP BY state;
```

| email_jobs state | Meaning / action |
|------------------|------------------|
| (no row) | Outbox job never enqueued or worker dead |
| PENDING / RETRY_WAIT | Retrying; check worker logs; Resend may be misconfigured |
| DEAD | Resend rejected (bad sender domain/address) — check `last_error` |
| SUPPRESSED | Recipient bounced before — intentional block |
| SUBMITTED | Handed to Resend → check Resend dashboard + delivery webhooks |

### "All emails stuck with 'Resend not configured'"

`RESEND_API_KEY` missing from worker env. Jobs park as RETRY_WAIT and resume once set.

### "Email marked bounced in Resend but user says inbox fine"

Check `email_suppressions` and `email_events`; verify Resend webhook secret
(`RESEND_WEBHOOK_SECRET`) so delivery events are recorded.

## Worker

### "Worker not running"

```bash
docker compose ps worker            # shows status
docker compose logs worker --tail 100
```

Common causes: env validation error at startup (log line says which var), service-role key
wrong, image stale.

### "Jobs piling up"

```sql
SELECT job_type, state, count(*) FROM outbox_jobs GROUP BY 1,2 ORDER BY count(*) DESC;
SELECT state, count(*) FROM email_jobs GROUP BY 1;
SELECT state, count(*) FROM export_jobs GROUP BY 1;
```

`PENDING`/`RETRY_WAIT` growing = worker can't keep up or is failing on each job (check
`last_error`). Leases expire after 120s, so a crashed worker's jobs re-appear automatically.

### "Hold reaper / reconciler not doing anything"

- They silently no-op if dependencies missing (Razorpay env for reconciler; no current
  festival id for reaper cache invalidation).
- Confirm schedules run: logs say nothing on success — check by effect: expired holds count
  (`expire_holds_batch`), resolved orders in `payment_applications`.

## QR & scanning

| Symptom | Go to |
|---------|-------|
| Every QR says invalid signature | Doc 06 → signing key mismatch |
| Valid QR denied as duplicate | Doc 06 → admissions scope; query `admissions` |
| Scanner shows "device not enrolled" | Doc 06 → `scanner_devices.state` + header |
| No QR on user's dashboard | Doc 05 → ISSUE_QR outbox job; doc 06 → credential creation |

Fast scan-logs query:
```sql
SELECT received_at_server, gate_id, outcome, reason_code
FROM scan_attempts
ORDER BY received_at_server DESC LIMIT 50;
```

## Admin / permissions

| Symptom | Check |
|---------|-------|
| Staff sees "Access denied" | `staff_assignments.status = 'ACTIVE'` for their user_id (doc 03) |
| 403 on specific admin action | Role lacks the exact permission code for that route (doc 03 table) |
| Admin action succeeds but public site doesn't change | Cache invalidation — wait ≤60s (TTL), else check `invalidateContentCache` ran (doc 08) |
| `resolve_user_id_by_email` error | Service-role only; check `SUPABASE_SERVICE_ROLE_KEY` |

## Site / infra

| Symptom | Check |
|---------|-------|
| 502 Bad Gateway everywhere | Active web slot down — compare the port in `/etc/nginx/conf.d/tarang-upstream.conf` (3001=blue / 3002=green) against `docker compose ps`; restart that slot |
| 502 only on one path/surface | Single domain, one upstream — if only some routes fail it's app-level, not nginx; check slot container logs |
| Site works locally, 403/444 in prod | Direct-hit to origin (Cloudflare AOP rejects non-CF requests) — ensure traffic flows through Cloudflare |
| Deploy fails ready check | Candidate auto-torn-down, old slot keeps serving; `docker compose logs web-blue` / `web-green` for the crash — often env or DB connectivity |
| Need to revert fast | `./rollback.sh` on the origin — same blue/green path, previous digest from `/var/lib/tarang/previous-image` (doc 09) |
| Stale content stuck | Redis del + `revalidateTag`; TTL guarantees fix within 60s anyway |

## Data-level sanity queries

```sql
-- Money audit: captured payments without fulfillment
SELECT p.razorpay_payment_id, p.created_at
FROM payments p
WHERE p.provider_status = 'captured'
  AND p.disposition IS DISTINCT FROM 'APPLIED'
ORDER BY p.created_at DESC;

-- Refunds stuck
SELECT id, state, attempts, last_error, amount_paise FROM refunds WHERE state IN ('PENDING','SUBMITTING','REQUESTED');

-- Webhook backlog
SELECT processing_state, count(*) FROM webhook_events GROUP BY 1;

-- Suppressed emails
SELECT email, reason, created_at FROM email_suppressions;
```

## Golden rules when debugging here

1. **Check worker logs for money/email issues** — most async failures surface there.
2. **Trust DB state, not UI** — caches are advisory; SQL is truth.
3. **Read the SQL function** — behavior lives in migrations, not just TypeScript.
4. **Every mutation is idempotent** — it's safe to retry a stuck flow (webhook replay,
   job re-run); fear duplicate side effects only if code broke that promise.
5. **Env vars at point-of-use, fail closed** — missing key = feature off (503/401), not crash.
   First suspect in any "works locally" situation: production env var.

## "Too many requests" on campus Wi-Fi / mobile data

A whole college on one Wi-Fi network — or thousands of phones behind a carrier's CGNAT
(Jio, Airtel) — reaches us from **one public IP**. Anything limited per IP is shared by
all of them.

**In the app** (`src/lib/redis/rate-limits.ts`), every per-IP class (`loginIp`, `askIp`,
`verifyIp`, `adminIp`, `discountIp`, `auth`, `public`) is sized for a crowd; the strict
limits are per user / per email (`login`, `ask`, `verify`, `discount`, `order`). Scanner
limits are per operator, so volunteers sharing the web-scanner credential do not share a
bucket. If Redis is down or over quota, critical writes fall back to an in-process limiter
(log line: `rate limiter: Redis unavailable, using in-process fallback`) instead of
blocking sales.

**Outside the app — set these before ticket launch:**

1. **Supabase → Authentication → Rate Limits.** GoTrue limits per IP and the browser
   calls it directly. Match `supabase/config.toml` `[auth.rate_limit]`: sign-ins/sign-ups
   1500, token refreshes 5000, token verifications 1500 (per 5 min).
2. **Supabase → Authentication → SMTP.** The built-in mailer sends only a few auth emails
   per hour for the whole project; sign-up confirmations and password resets stall at
   launch without custom SMTP (use the SES/Resend credentials already configured).
3. **Cloudflare.** Check that no WAF rate-limiting rule, Bot Fight Mode or
   "Under Attack" mode keys on IP for `/api/*`, `/login`, `/auth/*` or `/pronite-pass`.
4. **Upstash.** Confirm the plan's request quota covers launch-day traffic; when it runs
   out every limiter call errors (see the fallback above).
