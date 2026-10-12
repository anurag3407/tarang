# PULSE 2026 — Pre-Deployment Review Report

**Date:** 2026-08-23
**Scope:** Full code review (app + DB migrations + workers + cache handlers), deploy/infra script audit, load test at 3000 concurrent users.
**Verdict:** **NOT deployment-ready.** 8 critical bugs, 21 risks, and the site fails the 3000-concurrent-user target by a wide margin.

> **Addendum (2026-08-24) — supersedes the verdict above.** A follow-up
> hardening session closed every application/DB finding from this report:
> all 8 critical bugs and 21 risks are fixed in the working tree via
> migrations `0020`–`0030` (atomic order cancel, event-checkout repairs,
> scan replay + admission writes, gate-assignment enforcement, terminal-state
> payments + provider cancel, festival-scoped RBAC, export job leases) plus
> route/service fixes, and validated on real PostgreSQL 15 (fresh reset +
> smoke suites) with `typecheck`/`lint` clean and 388/388 tests passing.
> The deploy-path reds (D1 downtime, D2 silent migration skip) were also
> closed by the blue/green deploy work. The deployment-gap list was then
> reduced too: D4/D7 (systemd unit shape, CIDR update timer) were already
> fixed at HEAD; D5 (rollback flip-flop), D6 (restore-drill exact-host
> guard), D8 (backup retention pruning), and D10 (healthcheck visibility in
> deploy) were fixed and functionally verified this session (see
> `deploy_gaps.md` §3.2b), and the CI "real-DB gate" is now the `db-smoke`
> job + `supabase/smoke/` suites in `.github/workflows/ci.yml`. What remains
> is still infra, not app code — Supabase compute sizing + 3k re-test,
> install/enable the systemd units + CIDR timer on the VPS, HSTS at the
> Cloudflare zone, D9 (multi-origin export storage), a staging checkout/auth
> e2e, one-time `schema_migrations` reconciliation — and
> `vulnerabilities.md` §5 (only residual: moving sponsor uploads out of the
> served web root). This addendum is a status pointer; the dated findings
> below (incl. the load-test numbers) are kept as the historical record.

---

## 1. Executive Summary

| Area | Result |
|---|---|
| Load test — 3000 concurrent users | **FAILED** (95.71% errors; breaking point ≈ 51 req/s) |
| Deploy scripts | Multiple production-breakage defects (downtime on every deploy, no migration step, post-push vulnerability scan, unvalidated promotion input) |
| Application / database | 8 🔴 critical bugs incl. anonymous PII enumeration via Supabase RPC, payment fulfillment dead-ends, browser-crashing env bug, dead cache-handler wiring |
| Repo state | Dirty tree — uncommitted sponsors feature with an unapplied migration |

The single most urgent issue is security finding C1: any anonymous internet user can enumerate participant personal data through the Supabase REST API without authentication.

---

## 2. Load Test — 3000 Concurrent Users

### 2.1 Setup

- Production standalone build (`next build`, `output: "standalone"`), static assets copied in.
- Server: `node .next/standalone/server.js` with the real `.env` (real Supabase / Upstash / Razorpay endpoints) — same topology as production minus nginx/Cloudflare edge.
- Tool: k6 v2.2.0. Scenario: ramping-vus, 0 → 3000 VUs over 60s, hold 3000 VUs for 180s, ramp down 30s.
- Traffic: read-only public paths (`/api/public/events`, `/api/public/schedule`, `/api/public/notices`, `/api/public/pass-products`, `/events`, `/schedule`, `/notices`) with realistic ~10s think time. No mutations, no checkout.
- Gates: repo's own plan §16.3 thresholds (p95 < 750 ms, p99 < 1500 ms, error rate < 0.1%).

### 2.2 Results

```
RESULT
  requests............ 15,310
  succeeded........... 656   (4.28%)
  failed.............. 14,654 (95.71%)
  TTFB median......... 60s   (k6 timeout ceiling)
  TTFB p95 (successes) 35.6s
  TTFB avg............ 35.2s
  effective throughput 51 req/s   (expected ≈ 300 req/s at 10s think time)

GATES (plan §16.3)
  http_req_duration  p95<750ms, p99<1.5s  ❌ FAILED
  public_errors      rate<0.001           ❌ FAILED (95.71%)
  http_req_failed    rate<0.001           ❌ FAILED (95.71%)
```

### 2.3 Failure chain (evidence from server log, `/tmp/pulse-server.log`)

1. **Supabase origin saturated.** At roughly 50 req/s aggregate, upstream `fsprybjoqrlgxzlwnhdf.supabase.co` stopped answering; Cloudflare returned **522 "Connection timed out"** error pages from the Supabase edge. 44,167 occurrences of `522` in the server log within the test window.
2. **No upstream timeout in the app.** Supabase/Razorpay client calls have no fetch timeout and there is no circuit breaker or bounded request queue. Every request hung for the full 60s; sockets and queued requests accumulated without bound.
3. **Log flood amplified memory pressure.** Every upstream failure logged the *entire Cloudflare HTML error page* as `err.message` via pino. Log grew to **119 MB in ~4 minutes** (6,542 warn-level entries).
4. **Node process died silently mid-test.** No crash record in stdout/stderr — consistent with OS OOM kill. The server did not recover during the test window and was unresponsive to single probes afterward.

### 2.4 Interpretation

- The bottleneck is not Node HTTP handling — it is (a) Supabase compute capacity under burst and (b) the application's zero-timeout, no-backpressure design that turns one slow dependency into total outage plus OOM death.
- On the production VPS the same failure mode reproduces as: container hits its 2 GB memory limit → Docker OOMKill → `restart: unless-stopped` restart loop while traffic persists.
- `src/proxy.ts:81` runs `supabase.auth.getUser()` (a network round-trip to Supabase Auth) on **every page request**, which multiplies upstream load during bursts and was the primary driver of auth-path saturation.
- Re-test required after capacity changes. Current measured capacity (~51 req/s effective) supports roughly 500 simultaneous browsing users at 10s think time — **~6× below the 3000-user target**.

---

## 3. Deploy Scripts & Infrastructure Findings

Severity legend: 🔴 will break production · 🟡 risk/edge case · ❓ needs author intent.

### infra/scripts/deploy.sh

| Line | Sev | Finding |
|---|---|---|
| 48 | 🔴 | `docker compose up -d --no-deps web worker` recreates containers stop→start. Hard downtime on every deploy; zero-downtime claim in comments does not hold. |
| 68–69 | 🔴 | `DRAIN_SECONDS` sleep after nginx reload drains nothing — the old container was already replaced at line 48 before readiness. Cosmetic step presented as graceful drain. |
| 52–59 | 🔴 | Readiness failure exits 1 but leaves the broken candidate running and nginx serving it until someone runs rollback.sh manually. |
| — | 🟡 | No database migration step exists anywhere in the deploy path (deploy.sh, ci.yml, deploy-local.sh). Image deploys ahead of schema; any release containing migrations breaks at runtime. Observed live during this review (§5). |

### .github/workflows/ci.yml

| Line | Sev | Finding |
|---|---|---|
| 103 vs 118 | 🟡 | Trivy scan runs AFTER the image was already pushed (`push: true` in build step). A CRITICAL/HIGH finding blocks nothing — vulnerable image is already in the registry and promotable. |
| 167 | 🟡 | `promote_digest` is a free-form workflow_dispatch input, never validated against digests actually built/pushed/stage-tested by this pipeline. Arbitrary refs can be promoted. |
| 147–153 | 🟡 | Staging smoke = three GETs (live, ready, events). Checkout/auth surfaces never exercised before the production gate. |
| 106–108 | 🟡 | CI image build reads NEXT_PUBLIC_* from repository Variables with no emptiness guard (unlike deploy-local.sh which fails fast). Missing Variables produce a broken image silently. |

### infra/scripts/deploy-local.sh

| Line | Sev | Finding |
|---|---|---|
| 60–62 | 🟡 | Dirty-tree state produces only a warning. Currently applicable: the tree IS dirty (sponsors WIP), so `pulse:local-$SHA` would be tagged with a commit hash whose bytes do not match the image — rollback state points at the wrong artifact. |

### infra/scripts/restore-drill.sh

| Line | Sev | Finding |
|---|---|---|
| 19–24 | 🟡 | Production guard is substring match against default placeholder `db.PRODUCTION.supabase.co`. Wrong/unset PROD_HOST lets a `--clean --if-exists` restore run against production. |

### infra/scripts/update-cloudflare-cidrs.sh

| Line | Sev | Finding |
|---|---|---|
| 18–19 | 🟡 | Fixed `/tmp/cf-v4.txt` paths — predictable temp names on a multi-user host; stale file reused if curl partially fails. |
| 44 | 🟡 | First run fails if `$CONF` doesn't exist yet (`cp "$CONF" "${CONF}.bak"` under `set -e`). |
| — | 🟡 | No cron/systemd timer wired anywhere — CIDR list rots silently unless manually run. |

### infra/scripts/backup-db.sh

| Line | Sev | Finding |
|---|---|---|
| 49–57 | 🟡 | Without aws CLI the backup is encrypted locally then exits 1 — never uploaded, no alerting hook beyond stderr. |
| — | 🟡 | No retention/pruning of uploaded backups — Object-Lock bucket grows forever. |

### infra/systemd/pulse-compose.service

| Line | Sev | Finding |
|---|---|---|
| 21 | 🟡 | `EnvironmentFile=/opt/pulse/.env` injects all secrets into the unit environment — readable via `systemctl show` and `/proc/<pid>/environ`. |
| 25 | 🟡 | ExecStop runs `docker compose down` on every stop/reboot — full teardown instead of stop; slow recovery after reboot. |
| 18–19,28 | ❓ | `Type=oneshot` + `RemainAfterExit=yes` + `Restart=on-failure`: Restart never fires if the stack dies after a successful start. Intent unclear. |

### docker-compose.yml

| Line | Sev | Finding |
|---|---|---|
| 38 | 🟡 | `exports-data` named volume is per-host, but download route reads the local file — export job created on origin A 404s on origin B. Contradicts header comment claiming the file can be copied unchanged to a second origin. |

### infra/nginx/conf.d/pulse-single-domain.conf

| Line | Sev | Finding |
|---|---|---|
| 23,41–43 | ❓ | `http2 on;` requires nginx ≥ 1.25.1; Ubuntu distro nginx (1.24) rejects the config, so `nginx -t` fails and every deploy aborts. Documented in-file but environment-dependent blocker. |

---

## 4. Application & Database Bugs

### 🔴 Critical (8)

| # | Location | Finding |
|---|---|---|
| C1 | `supabase/migrations/0013_independent_entities_and_verification.sql:397` + `src/app/api/scanner/verify-card/route.ts:19` | **Anonymous PII enumeration.** `verify_gate_pass_lookup` is SECURITY DEFINER, created AFTER migration 0011's lockdown list, and keeps Postgres' default PUBLIC EXECUTE grant. Any anonymous caller can hit `/rest/v1/rpc/verify_gate_pass_lookup`; the `ilike` wildcard match returns ACTIVE passes with email, display name, college name, and pass codes. The app-side endpoint mirrors the hole: device-header-only auth, no operator permission check, no rate limit. |
| C2 | `supabase/migrations/0015_fix_event_payment_fulfillment.sql:189–190` | Captured EVENT payment with no recoverable hold row returns a success-shaped `{result:'NO_HOLD'}` — no REFUND_REQUIRED disposition, no REVIEW flag, order stuck AWAITING_PAYMENT, reconciler loops forever. Money taken, nothing delivered, nothing surfaced. |
| C3 | `src/app/api/admin/overview/route.ts:121` | Admin overview counts from nonexistent table `questions` (real table is `support_questions`, migration 0003). openQuestions count silently always 0. |
| C4 | `src/lib/env-public.ts:21` | Public env parse throws on empty strings (no empty→undefined normalization, unlike `src/lib/env.ts:124`). Dockerfile ARG defaults are empty strings — an image built without build args ships `""` and the browser bundle throws on page load. Silent default build path. |
| C5 | `next.config.ts:19` | `cacheHandler` config key absent while `cache-handlers/server-cache-handler.mjs` exists — the shared cache handler is dead code despite config comments claiming cross-instance shared ISR/cache. Invalidation does not propagate between processes; each serves independently stale content up to TTL. |
| C6 | `src/workers/main.ts:69` (+ :46) | SIGTERM handler only clears intervals — never drains in-flight jobs or exits. Hung SDK call (no timeouts anywhere) → Docker SIGKILL at 30s grace mid-write (CSV write, Resend send). Additionally one hung tick permanently sets the slot `running=true`, silently disabling that worker function until restart. |
| C7 | `supabase/migrations/0013...sql:200` + index at :13 (context) | BASE_PASS fulfillment inserts into `delegate_passes` without the prior-existence guard dropped from earlier versions; duplicate active pass violates unique index → whole apply transaction rolls back → webhook retries to DEAD. Money captured, order AWAITING_PAYMENT, reconciler repeats the same exception forever. |
| C8 | Load test §2 | Site cannot serve 3000 concurrent users: 95.71% failures at ~51 req/s effective, node process death via unbounded hang + log flood + OOM. |

### 🟡 Risks (21)

| # | Location | Finding |
|---|---|---|
| R1 | `supabase/migrations/0004_content_rls_and_functions.sql:73` | `profiles_own_update` has no column restrictions — authenticated users can PATCH their own profile row directly via Supabase REST: set `status='ACTIVE'` (self-unban), forge `public_member_code`, consent/completion columns. |
| R2 | `supabase/migrations/0002_profiles_and_rbac.sql:56` | `handle_new_user` swallows ALL exceptions — signup can succeed with no profile row; downstream profile-dependent flows silently match zero rows. |
| R3 | `src/services/payment-service.ts:73` | Browser callback passes local `order.currency` rather than the provider payment's currency fetched at :54 — currency equality check tautological on this path. |
| R4 | `src/services/payment-service.ts:121–124` | Webhook PROCESSING transition has no compare-and-swap; attempts incremented read-modify-write (lost updates defeat maxAttempts poison cap); crashed PROCESSING rows never re-selected (:279 selects RECEIVED/RETRY only). |
| R5 | `src/services/payment-service.ts:285` | Reconciler destructures away query errors (`return 0`) — reconciliation cycles silently skipped, no logging. |
| R6 | `0005_checkout_and_inventory.sql:600–612` vs `0015:63→90` | Opposite lock ordering (reaper: hold→order; apply: order→hold) — ABBA deadlock under concurrent expiry+capture; Postgres aborts one side → spurious 500s/webhook RETRYs. |
| R7 | `supabase/migrations/0007_outbox_email_exports.sql:63` | `claim_email_jobs`: RETRY_WAIT rows have zero backoff delay and no attempts cap (contrast fail_outbox_job 0006) — failing email retried every ~10s tick indefinitely, hammering Resend. |
| R8 | `src/workers/export-worker.ts:34,50–54` | Export job claim is plain SELECT on REQUESTED — no SKIP LOCKED, no lease; RUNNING transition result never checked → two replicas run the same export and concurrently writeFile the same CSV path. |
| R9 | `src/workers/export-worker.ts:52` | Crash mid-export leaves job RUNNING forever — no code path resets stuck RUNNING rows. |
| R10 | `supabase/migrations/0009_indexes_and_retention.sql:73` | `purge_expired_exports` has no caller anywhere; CSV files never unlinked — exports volume and table grow unbounded. |
| R11 | `cache-handlers/server-cache-handler.mjs:217,46` | revalidateTag swallows Redis pipeline failure — other processes never learn of invalidation (stale until TTL); cached redisPromise poisoned forever after first rejection. Same patterns in remote-use-cache-handler.mjs:40,69,134,218. |
| R12 | `src/lib/csrf.ts:36–40,60–62` | Absent Origin header always allowed — CSRF protection reduces to SameSite=Lax cookies alone; requests without content-length bypass the content-type check (chunked bodies bypass size cap). |
| R13 | `src/lib/request-context.ts:23–24` | Trusts client-supplied `x-real-ip` (spoofable when app reachable without trusted proxy); `"unknown"` fallback funnels all header-less clients into ONE shared rate-limit bucket — one attacker locks out everyone behind such a path. |
| R14 | `src/lib/turnstile.ts:15` | Turnstile bot protection silently disabled when secret unset — including production (env fail-fast doesn't require it). |
| R15 | `supabase/migrations/0014_order_cancel_on_abandon.sql:109` | Event-checkout auto-cancel kills ANY open BASE_PASS order regardless of product — starting a Basic Card checkout cancels a pending VIP order (contradicts 0013 independent-entities model). |
| R16 | `supabase/migrations/0014_order_cancel_on_abandon.sql:265–275` | Stale-order loop releases holds but not HELD participant claims — `one_live_event_claim_per_participant` then blocks re-checkout for that event until claim expiry. |
| R17 | `supabase/migrations/0004_content_rls_and_functions.sql:46,67` | Price-version read policies use `using (true)` — anon can read pricing of DRAFT/unpublished events and passes. |
| R18 | `src/proxy.ts:81` | `auth.getUser()` network round-trip on every page request — primary multiplier of upstream saturation observed in §2. |
| R19 | `src/workers/payment-reconciler.ts` + `entry.ts` | Worker entry has no `unhandledRejection`/`uncaughtException` handlers — stray rejection kills process; combined with `restart: unless-stopped` becomes a crash loop. Reconciler also swallows a Supabase query error by destructuring (`{ data: uncertain }`). |
| R20 | `src/app/api/admin/exports/[id]/download/route.ts:20` + `admin/staff/[assignmentId]/route.ts:40` + `admin/roles/[id]/route.ts:47` + `admin/staff/invitations/route.ts:50` | Cross-festival scoping gaps: finance-ledger downloads gated by `registration.export` instead of `finance.read`; staff assignments, custom roles, invitations, and eventIds fetched/updated by bare id with service-role and no `festival_id` filter — fest-A admin can touch fest-B records. |
| R21 | `docker-compose.yml` healthcheck vs `deploy.sh` timing | Container marked unhealthy at ~60s (start_period 15s + 15s interval × 3) while compose health state never gates deploy.sh readiness logic — unhealthy candidate can pass deploy. |

### ❓ Questions (2)

| # | Location | Question |
|---|---|---|
| Q1 | `infra/systemd/pulse-compose.service:18–28` | Is Restart=on-failure intended to recover a stack that dies after successful start? As written it cannot. |
| Q2 | `infra/nginx/conf.d/pulse-single-domain.conf:23` | Confirm target host runs nginx ≥ 1.25.1, else every `nginx -t` (and therefore every deploy) fails on `http2 on;`. |

---

## 5. Live-Observed Migration Skew

During smoke testing the server logged repeated `PGRST205: Could not find the table 'public.sponsors'` — the repo contains `supabase/migrations/0016_sponsors.sql` (untracked, part of a dirty working tree: 14 modified files + new sponsors pages/API) but the remote database has not had it applied. This is concrete proof that the deploy path (which contains no migration step, §3) will ship code ahead of schema.

---

## 6. Verified-Clean Areas

For completeness — areas examined and found sound:

- **Payment signature integrity:** checkout HMAC (`order|payment`) constant-time compare; Razorpay webhook verifies raw body against current+previous secrets BEFORE durable insert and returns non-2xx on insert failure so Razorpay retries.
- **Amount integrity:** browser never submits amounts; price snapshotted in SQL transaction; exact amount+currency equality enforced inside `apply_captured_payment` with mismatch routed to REVIEW.
- **Order IDOR:** order GET/cancel/verify all enforce purchaser ownership; `/api/me/*` filters by caller.
- **Scanner double-scan prevention:** unique `scan_attempts.scan_id` + `admissions_one_per_scope` unique index + row locks.
- **Mass assignment:** mutating endpoints parse through Zod `.strict()` schemas or explicit column maps.
- **XSS:** no `dangerouslySetInnerHTML` anywhere in `src/`.
- **Secrets:** `.env`/`.env.local` not git-tracked (only `.env.example`).
- **Hold reservation race:** reserve path uses single conditional UPDATE guarded by DB CHECK `held_units + confirmed_units <= capacity_units` — no check-then-insert overbooking on reservation itself.
- **Env fail-fast:** production boot refuses missing APP_BASE_URL / Supabase URL / publishable key / service-role key.

---

## 7. Blockers Before Deployment

1. C1 — revoke/grant lockdown for `verify_gate_pass_lookup`; add permission check + rate limit on verify-card endpoint.
2. C2/C7 — captured-payment dead ends (NO_HOLD orphan; duplicate-pass rollback loop).
3. C4 — env-public normalization (image built without build args bricks the browser bundle).
4. C5 — wire or remove cacheHandler; comments currently promise behavior that doesn't exist.
5. C6 — worker SIGTERM drain + per-tick deadlines.
6. C3 — overview queries wrong table.
7. Deploy path: add migration step; fix recreate-downtime + fake drain + no-auto-rollback; move Trivy gate before push; validate promote_digest.
8. Capacity: Supabase plan/compute must be sized for target load; add upstream timeouts + backpressure + log-size bounds; re-run the 3k test to gates.
9. Commit or stash the dirty sponsors tree; apply migration 0016 before any deploy containing it.

---

## Appendix A — Test Artifacts

- Load script: `load/concurrent-3k.k6.ts` (added by review; mirrors `load/public-burst.k6.ts` profiles/gates with short hold).
- Server log analyzed: `/tmp/pulse-server.log` (119 MB, deleted post-analysis).
- Build: `.next/standalone` from current tree (includes sponsors WIP).

## Appendix B — Totals

```
8🔴  21🟡  2❓
Load test: FAILED — 95.71% errors @ 3000 VUs; effective capacity ≈ 51 req/s;
node process died mid-test (hang pile-up → log flood → OOM);
root cause: Supabase origin saturation + app-side zero-timeout design.
```
