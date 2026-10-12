# PULSE 2026 — Deployment Gaps Report

**Date:** 2026-08-23
**Scope:** Deploy scripts, infra config, CI/CD, and production-readiness approximation at 3000 concurrent users. No load test executed (analysis only; prior measured data from `report.md` §2 used as baseline).
**Baseline:** Supersedes the deploy-script findings in `report.md` — several were fixed in today's working tree. This document reflects the **current** state.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Are deploy scripts safe for a single-box production deploy? | **Yes** — digest deploys, migration gate with hard-fail, real blue/green cutover, and auto-rollback now exist. The red-severity defects below are closed. |
| Will it hold at 3000 concurrent users? | **Borderline / depends on Supabase sizing.** App-side fixes (timeouts, cache handler wiring, anonymous fast-path) remove the previous collapse modes. The remaining ceiling is upstream capacity: Supabase Auth + Postgres under logged-in burst traffic. |
| Biggest single risk | Supabase compute sized below logged-in burst load (§4); systemd units fixed (D4) but not yet installed/validated on the target host (Q1). |

---

## 2. Fixed since `report.md` (verified in current tree)

| Old finding | Fix location |
|---|---|
| No migration step anywhere in deploy path | `infra/scripts/deploy.sh:42–50` runs `pnpm db:apply --migrations` before starting new containers |
| Failed readiness leaves broken candidate serving | `deploy.sh:52–58` triggers automatic rollback |
| Trivy scan after image already pushed | `.github/workflows/ci.yml:105–135` — build (`load: true`) → SBOM → scan → push |
| Unvalidated `promote_digest` input | `ci.yml:175–180` format regex check |
| CI builds silently without NEXT_PUBLIC_* Variables | `ci.yml:98–103` emptiness guard |
| Dirty tree only warned | `infra/scripts/deploy-local.sh:60–67` hard-fails unless `ALLOW_DIRTY=1` |
| Shared cache handler dead code (C5) | `next.config.ts:25–29` wires `cacheHandler` |
| Browser bundle throws on empty env strings (C4) | `src/lib/env-public.ts:19–21` normalization |
| Worker SIGTERM never drains (C6) | `src/workers/main.ts:91–105` drain with 10s forced exit |
| Log flood from full HTML error pages | `src/lib/logger.ts:29–39` truncation + redaction |
| Zero-timeout upstream calls | `src/lib/supabase/server.ts`, `service-role.ts` — 15s AbortSignal default |
| `getUser()` on every public page request (R18) | `src/proxy.ts:79–81` anonymous fast-path when no auth cookie present |
| Anonymous PII via verify-card endpoint (C1 app half) | `src/app/api/scanner/verify-card/route.ts:24,42` — `requirePermission("scanner.use")` + device check + rate limit |
| D1: deploy recreated containers stop→start (hard downtime) | `infra/scripts/deploy.sh:56-156` — true blue/green: candidate slot on idle loopback port (web-blue 3001 / web-green 3002), readiness on candidate port, generated `pulse-upstream.conf` + `nginx -t` + atomic reload, drain then stop old slot. Auto-teardown of a failed candidate keeps traffic on the old slot (`deploy.sh:82-89`) |
| D2: migrations silently skipped when pnpm absent | `deploy.sh:42-53` — credentials present but pnpm missing now **hard-fails** the deploy instead of skipping |
| D3: `DRAIN_SECONDS` sleep drained nothing | Now drains for real — old slot keeps serving during the sleep, then is stopped (`deploy.sh:152-156`); same pattern in `rollback.sh:106-109` |

---

## 3. Open gaps

### 3.1 Red — will break production

_None remaining._ Both former reds (D1 deploy downtime, D2 silent migration skip) are
fixed by the blue/green deployment work (commit `9ce79de`).

### 3.2 Yellow — risk / edge case

| # | Location | Gap | Notes |
|---|---|---|---|
| D9 | `docker-compose.yml:38` vs header comment | `exports-data` named volume is per-host, but export downloads read the local file. Export created on origin A 404s on origin B. Comment claims the compose file can be copied to a second origin unchanged — it can't, for exports. |
| D11 | `ci.yml` `deploy-staging` job | Staging smoke exercises health + public-content GETs only. Checkout/auth HTTP surfaces still never exercised before the production approval gate. The DB/SQL layer is now covered by the `db-smoke` CI job (3.2b), so this shrinks to the HTTP-only remainder: add an auth/checkout e2e against staging before the promote gate. |

### 3.2b Closed during the 2026-08-24 hardening session

| # | Resolution |
|---|---|
| D4 | ✅ Closed at HEAD (blue/green commit `9ce79de`): `pulse-compose.service` is `Type=oneshot` + `RemainAfterExit=yes` (docker is the primary supervisor; the unit only bootstraps/reboots the stack), **no** `Restart=on-failure`, **no** `EnvironmentFile` (compose parses `/opt/pulse/.env` itself, so secrets never appear in `systemctl show`/`/proc/<pid>/environ`). Remaining: confirm `systemctl enable --now pulse-compose` on the target host (Q1). |
| D5 | ✅ Fixed: `rollback.sh` refuses a no-op flip-flop — if `$STATE_DIR/current-image` equals the requested image it exits 1 and requires an explicit digest, so a double rollback cannot land back on the broken image. Functionally verified 11/11 (no-op refusal, valid rollback to a different digest incl. state+history+nginx cutover, legacy path, usage error). |
| D6 | ✅ Fixed + hardened: `restore-drill.sh` already required `CONFIRM_ISOLATED_TARGET=1`; the production guard now also does an exact-host comparison (scheme/userinfo stripped, port/path cut, IPv6 bracket hosts `[::1]` handled) on top of the substring check. Functionally verified 18/18 (refusals for exact host, subdomain-lookalike, IPv6 literal; pass-through for trusted isolated hosts; host-extraction unit cases). |
| D7 | ✅ Closed at HEAD: `infra/systemd/pulse-cloudflare-cidrs.service` + `.timer` are committed (weekly `Sun *-*-* 03:00:00 UTC`, `Persistent=true`); `update-cloudflare-cidrs.sh` uses `mktemp -d` and tolerates a missing `$CONF` (`cp … || true`). Remaining: install/enable the timer on the VPS. |
| D8 | ✅ Fixed: `backup-db.sh` gains `RETENTION_DAYS` (default 30; `0` disables) — `s3api list-objects-v2` → parse `pulse-<YYYYMMDDTHHMMSSZ>.sql.age` stamps → `s3 rm` older than cutoff, best-effort with `send_alert` on list/delete failures; GNU/BSD `date` handled; missing-CLI alerting already present. Functionally verified 30/30 (prune/keep/disable on both date branches, list-failure alert, object-lock refusal alert). |
| D10 | ✅ Fixed: `deploy.sh` inspects the candidate container after switch-over (`docker inspect` compose health) and warns on stderr when `unhealthy`; the deploy decision remains ready-endpoint-based. Verified with a mocked docker (unhealthy → WARN; healthy / no healthcheck → silent). |

The CI "real-DB gate" item (gaps.md §6/§7) is also closed: `.github/workflows/ci.yml` gains a `db-smoke` job (postgres:15 service) that bootstraps the Supabase stand-ins, applies migrations `0001`–`0030` + seed, then runs `supabase/smoke/0[1-5]-*.sql` with `ON_ERROR_STOP=1` and an `ALL .*PASS` banner assertion on every push. Local-equivalent run verified green (migrations + seed + all five suites). The suites live in `supabase/smoke/` with a provenance header; they are not idempotent and must run on a fresh database.

### 3.3 Questions

| # | Location | Question |
|---|---|---|
| Q1 | `pulse-single-domain.conf` | Does the target host run nginx ≥ 1.25.1? Older distro nginx rejects `http2 on;`, so `nginx -t` fails and **every deploy aborts**. Verify before first deploy. |
| Q2 | Working tree | Tree currently dirty: **50 modified + 18 new/untracked files + 1 deletion** (incl. migrations `0020`–`0030`, the auth-guard route/client, `infra/nginx/conf.d/security-headers.conf`, `supabase/smoke/`, infra-script fixes, and the deleted/replaced `0018` stub — see §6). `deploy-local.sh` correctly refuses it; CI path unaffected. Commit/stash before any local deploy. |

---

## 4. Capacity approximation @ 3000 concurrent users

No test run (per instruction). Arithmetic + prior measured baseline.

### 4.1 Traffic model

- 3000 users × ~10s think time ≈ **300 req/s aggregate peak** at origin.
- Cloudflare edge absorbs static assets and any cached HTML; origin sees less.
- Sale-open burst concentrates on `register.*` (login → dashboard → checkout).

### 4.2 Layer-by-layer

| Layer | Assessment |
|---|---|
| Nginx | `worker_connections 8192`, keepalive upstream 32 — comfortable at 300 r/s. ✅ |
| Node web container (2g limit) | Cached public reads are <1ms CPU each; several thousand r/s achievable on 2 vCPU. Memory steady-state well under limit now that hangs are capped at 15s. ✅ |
| Public content path | `unstable_cache` → shared Redis handler (`src/lib/content-loader.ts:48+`). Warm hits never touch Supabase. ✅ |
| Upstash Redis | Each public request ≈ 1 cache read + ~2–3 ratelimit ops → **~900–1200 REST ops/s at peak**. Fine technically; verify plan quota/cost and that latency budget (~15–60ms serial chain) holds. ⚠️ cost/quota check |
| Supabase Auth + Postgres | The ceiling. Prior measurement: origin saturated at ~50 req/s aggregate (CF 522s). Public paths no longer hit it, but logged-in traffic does `getUser()` + RLS queries per request. At sale-open expect ~100+ auth/DB req/s → needs ≥ small-compute tier and the planned Cloudflare Waiting Room on `register.*`. 🔴 decides pass/fail |
| Worker container (1g) | Lease-based duplicate safety; drain implemented. Single instance fine at this scale. ✅ |

### 4.3 Residual failure mode

Timeouts bound each hang at 15s, but there is no circuit breaker or bounded request queue. A full Supabase outage still accumulates ~(arrival rate × 15s) in-flight requests before shedding — e.g., 100 authed req/s × 15s = ~1500 hanging requests ≈ tens of MB heap. Survivable now (vs OOM death before), but latency collapses to timeout-level rather than failing fast. Acceptable for v1; note as follow-up.

### 4.4 Bottom line

The VPS layer will not break at 3000 users. Pass/fail hinges on Supabase compute sized to logged-in burst traffic. Re-run `load/concurrent-3k.k6.ts` against prod-like Supabase before the event — gates are p95<750ms, p99<1.5s, errors<0.1% (plan §16.3).

---

## 5. Pre-go-live checklist

1. ~~Fix D1 (deploy downtime)~~ — **done**: blue/green cutover implemented (`9ce79de`). Keep the deploy freeze during the event window anyway if Supabase stays small.
2. ~~Fix D2 (silent migration skip)~~ — **done**: hard-fail when pnpm missing (`deploy.sh:44-48`).
3. Validate systemd unit on target host (Q1/D4); verify nginx ≥ 1.25.1.
4. Size Supabase compute to measured auth-path load; confirm Waiting Room active on `register.*`.
5. Confirm Upstash plan covers ~1200 ops/s burst + daily volume.
6. ~~Wire CIDR update timer (D7), backup alerting + retention (D8)~~ — **done**: timer/service committed at HEAD (D7); retention + alerting merged into `backup-db.sh` (D8). Remaining: install/enable the systemd units on the VPS.
7. Commit the working tree (Q2) — the hardening session's migrations and config (see §6) must not ship accidentally or half-there.
8. Full restore drill against isolated project — the D6 guard is fixed + hardened (3.2b); the drill itself has not been executed yet.
9. Re-run 3k load test post-sizing; record results here.
10. Land the CI DB gate — `supabase/smoke/` + the `db-smoke` job in `ci.yml` ship with the hardening commit; confirm the first green push exercises all five suites.

## 6. 2026-08-24 hardening session — what the next deploy must ship

One commit with the current working tree covers all of this; nothing below is
optional for the event build:

### 6.1 Migrations `0020`–`0030` (all new, all validated on real Postgres 15)

| Migration | Fix |
|---|---|
| `0020_atomic_order_cancel.sql` | Order cancel is one locked transaction (V-03/V-04): state-guarded transition, atomic hold release, no TOCTOU |
| `0021_fix_event_checkout.sql` / `0024_fix_event_checkout_enum_cast.sql` | Event checkout against real tables + explicit `participant_role` casts (V-05, G1) |
| `0022_fix_record_scan_uuid_and_replay.sql` / `0023_fix_record_scan_composite_null_checks.sql` | Scan replay returns prior verdict instead of 500; row-typed null checks fixed → `admissions` + history actually write (V-13/G1–G3) |
| `0025_anchor_verify_gate_pass_lookup.sql` | Gate pass lookup anchored (exact email / prefix code, wildcards escaped) (V-12c) |
| `0026_captured_payment_terminal_states_and_provider_cancel.sql` | Terminal-state payment policy + Razorpay order-cancel outbox (V-09) |
| `0027_festival_scoped_rbac.sql` | `has_permission(p_festival_id)` + festival guards on every bare-id admin function (V-01) |
| `0028_record_scan_gate_assignment_and_offline_policy.sql` | Gate-assignment enforcement + offline fail-closed cooldown (G4) |
| `0029_reentry_scanning_and_history_superseded.sql` | Renumbered supersede stub — see 6.2 |
| `0030_export_job_lease_and_purge.sql` | Atomic export lease (`FOR UPDATE SKIP LOCKED`), `RETRY_WAIT` backoff, `FAILED`, 7-day purge (E1) |

`deploy.sh:42-50` already runs `pnpm db:apply --migrations` on the candidate
slot before cutover — the sequence above is exactly what it will apply.

### 6.2 Remote `schema_migrations` reconciliation (0018/0029) — **manual, one-time**

The original duplicate-`0018` reentry migration was renumbered to `0029`
(old file deleted, stub added). Remotes that already applied the old `0018`
hold a single `0018` row in `supabase_migrations.schema_migrations`, while
`scripts/apply-sql.ts` records versions with `on conflict (version) do nothing`
— so the `0029` row must be inserted manually on each remote **before or right
after** the deploy, or supabase will keep seeing two local files with
duplicate versions and report drift. See the G6 deploy note in `gaps.md` for
the exact row.

### 6.3 Infra/config files that must ship

- `infra/nginx/conf.d/security-headers.conf` — new shared block
  (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP
  `frame-ancestors`) included from every server block in `pulse.conf` (5×) and
  `pulse-single-domain.conf` (V-07). The include target is
  `/etc/nginx/conf.d/security-headers.conf` — verify the file lands on the
  host nginx (or is synced with the other conf files) and that `nginx -t`
  passes on both configs.
- `docker-compose.yml` — new `uploads-data` volume mounted at
  `/app/public/uploads` on both web slots (V-06: sponsor uploads write to a
  writable volume instead of the read-only rootfs), and `EXPORT_DIR:
  /app/.exports` on the worker (already wired to `exports-data`).
- `.env` on the target host — **must** set `SCANNER_ALLOW_DEFAULT_CREDENTIAL=false`
  (or leave unset) so the shared dev scanner credential is inert in
  production (M6); set `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  when forms ship the widget — auth throttling is app-layer now (V-08) but a
  missing Turnstile secret causes verify/ask and guard-bot checks to **fail
  closed** in production (`src/lib/turnstile.ts:19`), so leaving it unset
  degrades those forms until a key is configured.

### 6.4 Why no app-side DB revert is needed

All eleven migrations are additive or corrective on functions/policies; the
`0029` stub is a no-op placeholder, and `alter type … add value if not exists`
is used for the new `RETRY_WAIT` export state, so the old image can keep
running against the new schema during the blue/green drain window.

### 6.5 Infra scripts + CI gate in the same commit

- `infra/scripts/rollback.sh` (D5), `restore-drill.sh` (D6), `backup-db.sh` (D8),
  `deploy.sh` (D10) — hardened per 3.2b; all `bash -n` clean and functionally
  verified with shimmed `docker`/`aws`/`age`/`pg_dump`/`curl` binaries.
- `supabase/smoke/*.sql` + `.github/workflows/ci.yml` `db-smoke` job — the
  real-DB regression gate (see 3.2b).
- `.env.example` — new `SCANNER_ALLOW_DEFAULT_CREDENTIAL=false` entry (M6); the
  backup script's `RETENTION_DAYS` / `ALERT_WEBHOOK_URL` are documented in
  `infra/scripts/backup-db.sh`'s header and default safely when unset.
