# PULSE — Code Gaps Report (Scanner / Payments Review)

**Date:** 2026-08-24
**Scope:** Manual bug hunt across the current `main` tree (`4fd81c8`), prioritising recently changed scanner code (commits `4fd81c8`, `bffb6c7`, `36376bd`, `5f87529`), the payment pipeline, authz/CSRF, and the SQL migration chain.
**Method:** Full read of scanner routes/services, QR issuance, webhook + reconciliation flow, checkout service, authz/CSRF libs, and all 21 SQL migrations. Cross-checked every RPC call against its Postgres definition. `uuid = text` operator behaviour **verified empirically against live PostgreSQL 15** (see §1.1 Evidence). Automated gates all pass and do **not** catch anything below:

| Gate | Result |
|---|---|
| `pnpm lint` | Pass (2 cosmetic unused-var warnings) |
| `pnpm typecheck` | Pass |
| `pnpm test` (vitest) | 378 / 378 pass |

The tests pass because every Supabase interaction is mocked (`tests/e2e/helpers/mocks.ts` stubs tables and RPCs via `sb.onTable` / `sb.onRpc`). **No test ever executes the real SQL**, so every defect below is invisible to CI.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Do the automated checks catch these? | No — all findings are runtime SQL / logic bugs that mocks paper over. |
| Most severe single finding | **G1**: the atomic admission function `record_scan` throws on *every* invocation against real Postgres. The cryptographic scan path has likely never worked; production traffic silently runs through the weaker code-lookup fallback. |
| Second most severe | **G2**: the verify-card credential backfill INSERT can never succeed (missing NOT NULL columns), so Basic Card gate entries are silently never recorded. |
| Fix effort | G1 is a one-line cast ×3 functions + one error-check; G2 is a two-field insert fix. Both are small; both need a DB migration + a smoke test against a real database. |

Severity legend: 🔴 breaks a documented feature outright · 🟠 security/policy regression or silent data loss · 🟡 inconsistency / fragility · ⚪ cosmetic.

---

## 2. 🔴 Red — features broken against a real database

### G1 · `record_scan` fails on every call: `operator does not exist: uuid = text`

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0022_fix_record_scan_uuid_and_replay.sql` drops the broken
> `record_scan(uuid, text, …)` overload and re-creates the function with
> `p_credential_jti uuid`, so `qr_credentials.jti = p_credential_jti` resolves.
> The invalid-token audit path in `scan-service.ts` now checks and logs the RPC
> error instead of silently dropping it. Requires a real-DB smoke test before
> deploy (see §7).

**Locations** (same expression in all three versions of the function):

- `supabase/migrations/0008_qr_scanning.sql:186`
- `supabase/migrations/0018_reentry_scanning_and_history.sql:52`
- `supabase/migrations/0019_unified_pass_scan_history.sql:46`

```sql
p_credential_jti text,
...
select * into v_credential from qr_credentials where jti = p_credential_jti for update;
```

`qr_credentials.jti` is `uuid` (migration `0008_qr_scanning.sql:8`). Inside plpgsql, comparing a column typed `uuid` to a parameter whose declared type is `text` raises SQLSTATE `42883`; there is no implicit cast between them. This is a static resolution error — **it fires even when the parameter value is NULL**.

**Evidence** (verified on local PostgreSQL 15):

```
CREATE FUNCTION _tmp_probe(p_jti text) ... where t.jti = p_jti ...
select _tmp_probe(null::text);            -- {"error": "operator does not exist: uuid = text"}
select _tmp_probe('a0eebc99-…');          -- {"error": "operator does not exist: uuid = text"}  ← valid UUID also fails
-- after fix:  where t.jti = p_jti::uuid  -- {"result": false}   ✓ works
```

**Impact**

1. **Valid scans:** `performScan` (`src/services/scan-service.ts:98–115`) checks the RPC error and throws `INTERNAL "Scan could not be recorded"` → every legitimate signed-QR scan returns HTTP 500.
2. **Forged/expired token auditing:** the failure path (`scan-service.ts:54–69`) ignores the RPC error entirely (`const { data } = await sb.rpc(...)` — no `error` check). Invalid-scan attempts are **silently never audited**, defeating the audit trail required by plan §14.6.
3. **Masking effect:** because `/api/scanner/scan` always 500s, `ScannerApp.tsx:391–472` catches the failure, decodes the JWS payload client-side, and falls back to `verify-card`. That fallback was added as a "recovery" (commit `bffb6c7` "pass token recovery fallback") but it means **production entry decisions run through the string-lookup endpoint instead of signature verification + atomic admissions** — no dedup, no admission records from this path's outcome semantics, and a weaker trust model.

**Fix**

```sql
-- in all three functions (keep only the latest deployed version current):
select * into v_credential from qr_credentials
where jti = p_credential_jti::uuid          -- cast added
for update;
```

Guard the NULL case explicitly if desired (`if p_credential_jti is null then … else … end if;`) since `NULL::uuid` is fine but explicit is clearer. Also add the missing error check in `scan-service.ts` failure path:

```ts
const { data, error } = await sb.rpc("record_scan", { ... });
if (error) logger().error({ err: error.message }, "audit insert failed");
```

**Why it went unnoticed:** unit/e2e tests stub `record_scan` via `sb.onRpc("record_scan", { data: … })` (`tests/e2e/scan-gate.e2e.test.ts:114,160,180`) — the real function body never executes in CI. Any manual testing that appeared to succeed was actually exercising the client-side fallback.

---

### G2 · verify-card credential backfill INSERT always violates NOT NULL

> **Status: FIXED (2026-08-24, uncommitted)** — `src/app/api/scanner/verify-card/route.ts`
> now resolves `festival_id`/`expires_at` from the pass/festival rows and inserts
> the required `key_id` ("lookup-backfill") and `expires_at`; the hardcoded
> `slug: "pulse-2027"` lookup was removed. Also fixes M2 (single `requirePermission`).

**Location:** `src/app/api/scanner/verify-card/route.ts:123–146`

```ts
const { data: newCred } = await sb.from("qr_credentials").insert({
  delegate_pass_id: result.passId,
  festival_id: festival?.id,        // slug hardcoded to "pulse-2027", see G5
  jti: crypto.randomUUID(),
  token_digest: "lookup-scan",
  state: "ACTIVE",
})
```

Schema (`0008_qr_scanning.sql:6–20`) requires, with **no defaults**:

| Column | Provided? |
|---|---|
| `key_id text not null` | ❌ missing |
| `expires_at timestamptz not null` | ❌ missing |
| `festival_id uuid not null` | ⚠️ provided only if the `pulse-2027` lookup matches |
| `token_digest`, `jti`, `delegate_pass_id` | ✅ |

The INSERT therefore fails with a not-null violation **100% of the time**. The error is not checked (`const { data: newCred }`), so:

- `primaryCredId` stays null → the scan-attempt INSERT at `route.ts:167–184` is skipped;
- **every Basic Card / pass without a pre-existing credential gets looked up successfully but its gate entry is never logged** — exactly the "unified scan history" behaviour the latest commit (`4fd81c8`) claims to deliver;
- the response still says `found: true`, so operators see nothing wrong.

Note the contrast with the correct pattern in `src/services/qr-service.ts:54–66`, which supplies `key_id`, `expires_at` (pass expiry → festival end → +30d) and takes `festival_id` from the pass row rather than a hardcoded slug.

**Fix:** mirror `issueQrCredential`: select `key_id: env().QR_SIGNING_KEY_ID`, `expires_at: pass.expires_at ?? fest.ends_at ?? now+30d`, take `festival_id` from `delegate_passes.festival_id` (one query instead of the slug lookup), and handle the insert error (at minimum log it; ideally surface `HISTORY_UNAVAILABLE` in the response). Also decide whether creating a credential for a Basic Card is intended at all — migration `0013` states *"Basic Card DOES NOT get QR"*; if credentials are only bookkeeping here, consider recording scan attempts against a nullable-credential path or a dedicated lookup-attempt table instead.

---

### G3 · Scan retry idempotency regressed — duplicate `scan_id` now returns 500

> **Status: FIXED (2026-08-24, uncommitted)** — migration 0022 restores the
> `scan_id` replay guard from 0008: a retried scan_id returns the prior result
> with `replayed: true` instead of hitting the unique constraint.

**Locations:** `0018_reentry_scanning_and_history.sql` / `0019_unified_pass_scan_history.sql` (both missing the block present in `0008_qr_scanning.sql:179–183`)

Migration 0008 implemented the documented retry contract (*"scanId is stable across retries so the server returns the same result"* — `src/app/api/scanner/scan/route.ts:23–26`):

```sql
select * into v_existing from scan_attempts where scan_id = p_scan_id;
if found then return jsonb_build_object('outcome', v_existing.outcome, ..., 'replayed', true);
```

Migrations 0018 and 0019 dropped it (the declared variable `v_existing` at `0018:33` / `0019:27` is now dead). Since `scan_attempts.scan_id` is `UNIQUE` (`0008:74`), a network timeout followed by a client retry with the same `scanId` hits the unique violation inside step 3 of the function → uncaught exception → `performScan` maps it to `"Scan could not be recorded"` → **500 instead of replaying the prior verdict**, and the attendee sees an error sheet for a scan that actually succeeded.

**Fix:** restore the replay check (before the INSERT, after gate resolution) in the current `record_scan`, returning `{ outcome, reason, display, recentScans, replayed: true }`.

### G7 · `record_scan` admission + history dead: composite `IS NULL` on a row with nullable fields

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0023_fix_record_scan_composite_null_checks.sql` replaces
> every row-type check in `record_scan` with field-based checks
> (`v_gate.id`, `v_credential.id`, `v_admission.id`). Verified on a fresh DB by
> the smoke script: valid scan now creates an `admissions` row, replays return
> `replayed: true`, `recentScans` is populated, and TEST1–TEST4 all pass.

**Locations:** `0008_qr_scanning.sql`, `0018_reentry_scanning_and_history.sql`,
`0019_unified_pass_scan_history.sql`, `0022_fix_record_scan_uuid_and_replay.sql`
(the pattern survived every rewrite).

PostgreSQL semantics: for a composite value, `row IS NULL` is true only when
*all* fields are NULL and `row IS NOT NULL` only when *all* fields are non-NULL.
`qr_credentials.revoked_at` is nullable, so after the credential SELECT
resolves a real row **both checks are false**. Verified live:

```
with c as (select v from qr_credentials v limit 1)
select (v is null) as is_null, (v is not null) as is_not_null from c;
 is_null | is_not_null
 f       | f
```

Consequences in `record_scan`:

1. Admission insert guard (`if v_outcome in ('accepted','manual_override') and v_credential is not null`) never fires → **admissions are never recorded**; the `admissions_one_per_scope` unique index and re-entry semantics are dead.
2. Scan-history guards (`v_credential is not null …`) never fire → clients always receive `recentScans: []`; the unified cross-credential history feature silently returns nothing.

The `v_gate`/`v_admission` checks were behaviorally correct only by accident
(all-NULL composite when not found; `admissions` has no nullable columns) and
were converted to `id`-based checks as well. A sweep of every installed
plpgsql function found no remaining bare `is (not) null` checks on row-typed
variables.

### G8 · `create_event_checkout` raises enum-cast error on every event order

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0024_fix_event_checkout_enum_cast.sql` casts the two
> literals to `participant_role`. Verified by smoke TEST4 (reserve + cancel
> release) on a fresh DB.

**Location:** `0021_fix_event_checkout.sql` step 12 (`insert into
order_participants [… role]`).

plpgsql does not implicitly cast a `text` CASE expression to an enum column,
so the insert raises `column "role" is of type participant_role but
expression is of type text` on *every* event checkout — the same class of
bug as G1 (typed parameter vs. typed column). The order, order line, capacity
hold and inventory decrement have already happened at that point, so a caller
also saw a partially-created order that the error path leaves in place.

---

## 3. 🟠 Orange — security / policy regressions to confirm intentional

### G4 · `record_scan` dropped gate-assignment enforcement and offline FAIL_CLOSED

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0028_record_scan_gate_assignment_and_offline_policy.sql`
> restores full gate enforcement in `record_scan`:
> - Replay-first idempotency before any gate/admission logic (G3).
> - No silent fallback: unknown gate → `wrong_gate/unknown_gate`; inactive →
>   `wrong_gate/gate_inactive`; missing assignment →
>   `wrong_gate/no_active_assignment`; one-entry gates → `duplicate` /
>   `accepted_reentry` split restored.
> - Offline `FAIL_CLOSED` without an override → `cooldown/offline_fail_closed`;
>   override follows 0008 semantics and is audited for non-accepted verdicts.
> - `v_scope_key` is now derived from the gate before the credential-state
>   branch, fixing a latent NOT NULL violation when overriding a
>   revoked/expired credential.
>
> Validated against real PostgreSQL 15 (`supabase/smoke/04-gate-assignment-offline.sql`, 8 scenarios) plus
> the scanner smoke suites; `src/services/scan-service.ts` and the
> `gate_assignments`-aware smokes were updated to match (no more silent first
> active gate fallback — the route only records a scan when the requested
> gate has a live assignment).

Both behaviours existed in `0008_qr_scanning.sql` and are gone from 0018/0019:

| Behaviour | 0008 | 0018/0019 |
|---|---|---|
| Require active `gate_assignments` row for device+operator+gate (`0008:169–177`) | enforced → `'wrong_gate'/'no_active_assignment'` | **removed** — any active gate accepted, plus silent auto-fallback to the first active gate when the requested id doesn't match (`0018:41–45`) |
| Offline provisional + `offline_policy = 'FAIL_CLOSED'` → reject (`0008:243–249`) | enforced → `'cooldown'/'offline_fail_closed'` | **removed** — `p_offline_provisional` and the whole `offline_policy` column are stored but never evaluated |
| Duplicate admission under non-reentry policies → `'duplicate'` (`0008:215–221`) | differentiated | collapsed into unconditional `'accepted_reentry'` |

Consequences:

- Any operator holding `scanner.use` + any ACTIVE device can log admissions at **any** gate regardless of assignment window — the per-gate authorisation model in plan §14.5 is no longer enforced server-side.
- An offline scanner at a FAIL_CLOSED gate now gets entries admitted silently; the UI's `WARN_OUTCOMES` handling for `cooldown` (`ScannerApp.tsx:101`) can never trigger from the server.

If the relaxation is deliberate (the "gate fallback" commits suggest it may be), it should be an explicit decision recorded in the migration comment + docs, and `offline_policy`/assignment checks should be re-enabled before fest day. If not deliberate, restore both blocks from 0008 into the current function.

---

## 4. 🟡 Yellow — fragility / consistency

### G5 · Festival year/slug drift between DB seed, API hardcodes, and UI

Commit `cb88218` moved the displayed year to **2026** but the backend still says 2027 in several places:

| Location | Value |
|---|---|
| `supabase/seed.sql:6` | slug `pulse-2027`, `year` column `2027`, but dates `2026-09-17…22` (self-contradictory row) |
| `src/lib/data.ts:14–19` | UI shows `year: "2026"`, `dates: "17 – 21 September 2026"` |
| `src/app/api/admin/overview/route.ts:222–226` | hardcodes `slug: "pulse-2027", name: "PULSE 2027"` next to `dates: "17–21 Sep 2026"` |
| `src/app/api/scanner/verify-card/route.ts:127` | `.eq("slug", "pulse-2027")` hardcode feeding the G2 insert |
| QR payload default (`qr-service.ts:105`) and e2e fixtures | `fest: "pulse-2027"` |

The verify-card hardcode works today only because the seed matches; if the slug ever changes (e.g. a real 2027 edition row appears), the festival lookup silently returns null → `festival_id: undefined` is dropped by supabase-js → another NOT NULL failure mode on top of G2. Recommended: resolve the festival via `getCurrentFestivalId()` (already used by `requireUser`) or from the pass row, and make `festivals.year` agree with the marketing dates.

> **Status: RESOLVED (2026-08-24, uncommitted)** — the overview route now reads
> festival metadata from the DB and verify-card resolves the festival from the
> pass row; no API code hardcodes `pulse-2027` anymore. `src/lib/data.ts`
> `year` was aligned to `"2027"` (nav/footer/homepage) to match the seed row,
> emails, cards and QR payload. Calendar dates remain September 2026 by design
> (brand "PULSE 2027", event dates 2026).

### G6 · Duplicate migration number `0018`

> **Status: FIXED (2026-08-24, uncommitted)** — `0018_reentry_scanning_and_history.sql`
> was renumbered to `0029_reentry_scanning_and_history_superseded.sql` and
> replaced with a no-op supersede stub, because re-running the old text would
> reinstall the broken text-`record_scan` overload (G1) and blanket-set every
> gate to `REENTRY_ALLOWED`. The version conflict itself would have broken
> `supabase db push/reset/test` outright; `scripts/apply-sql.ts` silently
> skipped duplicates, making the drift invisible.
>
> **Deploy note:** remote environments that already applied the old `0018`
> (where `schema_migrations` has one `0018` row) need a manual reconciliation
> row for the `0029` file when pushing, or supabase will still see two local
> files with duplicate versions. The local full-reset path is clean.

Two files share the leading version:

- `supabase/migrations/0018_payment_reconciliation_hardening.sql`
- `supabase/migrations/0018_reentry_scanning_and_history.sql`

`scripts/apply-sql.ts:67–84` records `version` = leading digits with `on conflict (version) do nothing`, so `schema_migrations` ends up with a single `0018` row covering two different files — `supabase db push/reset/test` (used by `package.json` scripts `supabase:*`) treats duplicate local versions as an error and can mis-detect drift. Renumber one file (e.g. `0020_...`) and reconcile remote history.

### E1 · Export worker double-claims jobs, leaks RUNNING rows on crash, and never purges

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0030_export_job_lease_and_purge.sql` + `src/workers/export-worker.ts`:
> - `claim_export_jobs(p_owner, p_batch_size, p_lease_seconds)` claims
>   `REQUESTED` / `RETRY_WAIT` (plus lease-expired `RUNNING`) rows with
>   `FOR UPDATE SKIP LOCKED`, so overlapping workers (scheduled loop + QStash
>   wake) can never double-build the same export.
> - `fail_export_job` parks transient failures in the new `RETRY_WAIT` state
>   with backoff (`run_at = now + delay × attempts`) and lands `FAILED` after
>   max attempts; a migration-time backfill re-queues legacy `RUNNING` rows
>   that have no lease.
> - The worker calls `purge_expired_exports(7)` each tick and unlinks local
>   `.csv` files older than 7 days (before, rows and files were never
>   reclaimed).
> - Both claim/fail RPCs are revoked from `public`/`anon`/`authenticated` and
>   granted to `service_role` only.
>
> Validated against real PostgreSQL 15 (`supabase/smoke/05-export-lease-and-purge.sql`, 8 scenarios:
> atomic claim, SKIP LOCKED exclusion, crash recovery, backoff gating, max
> attempts, purge, privilege lockdown).

**Locations:** `src/workers/export-worker.ts:11-24` — the worker claimed jobs
with a plain SELECT followed by an optimistic UPDATE to `RUNNING`, so two
overlapping instances (the scheduled loop and the QStash wake) could claim
the same job and build duplicate CSVs; a crash mid-build left the row `RUNNING`
forever (nothing expired the claim); a failing job went straight to `FAILED`
with no transient retry; and `purge_expired_exports` (0009) was never invoked,
so completed rows and their on-disk files accumulated until manual cleanup.

---
## 5. ⚪ Minor

| ID | Location | Note |
|---|---|---|
| M1 | `ScannerApp.tsx:168` | Reads `sessionStorage["pulse-scanner-credential"]`, but nothing in the repo ever writes that key — dead leftover of a removed enrolment flow. |
| M2 | `verify-card/route.ts:28,173` | `requirePermission("scanner.use")` executed twice per request (second call inline in the scan-attempt insert). Reuse the context from the first call. |
| M2a | `verify-card/route.ts:28` | M2 fixed 2026-08-24: the operator context is captured once (`op`) and reused for the scan-attempt insert. |
| M3 | `verify-card/route.ts:151–155` | `.eq("id", validGateId ?? "")` queries gates with an empty-string UUID when no gateId was supplied; harmless but wasteful — branch instead. |
| M4 | `verify-card/route.ts:97` | UUID-fallback result sets `email: undefined`, so the field disappears from JSON instead of rendering empty; harmless given the client guards with truthiness. |
| M5 | `ScannerApp.tsx:11`, `tests/dates.test.ts:2` | ~~Unused import warnings~~ — ✅ FIXED 2026-08-24: unused imports removed; `pnpm lint` is warning-free. |
| M6 | `scan-service.ts:153,188–193` | ✅ FIXED 2026-08-24: the shared `DEFAULT_SCANNER_CREDENTIAL` path is gated behind `SCANNER_ALLOW_DEFAULT_CREDENTIAL` (`defaultScannerCredentialEnabled()`), so in production the dev credential is inert — no auto-create, no force-reactivation. The `00000000-…-0001` fallback now also requires the env gate to be reached at all. |

---

## 6. Recommended fix order

Implemented (uncommitted, 2026-08-24): **G1, G2, G3, G4, G5, G7, G8** and
**E1** via migrations `0022`–`0024`, `0028`, `0030` + route/worker fixes;
**M2, M5, M6**; G6 renumbered (`0018` → `0029` supersede stub). All DB work is
validated on real PostgreSQL 15 (fresh reset, migrations `0001`–`0030` + seed,
six suites: `smoke5`, `v09`, `v01`, `g4`, `m6` + supporting scenarios).

Remaining (no code changes): the optional Supabase Storage move for uploaded
files (V-06 residual) and the manual `schema_migrations` reconciliation for
remotes that saw the duplicate `0018` (see G6 deploy note). The CI task that
executes the real SQL functions (previously a checkbox in §7) is now
implemented as the `db-smoke` job in `.github/workflows/ci.yml` plus the
committed `supabase/smoke/` suites — see the checklist below.

## 7. Verification checklist (post-fix)

Code-side fixes are in place; `pnpm typecheck` / `pnpm lint` (0 errors, 0
warnings) / `pnpm test` (388/388) pass. Smoke tests execute against a real
local Postgres 15 (migrations `0001`–`0030` + seed, fresh reset each run) —
suites committed at `supabase/smoke/0[1-5]-*.sql` (byte-identical to the
previously `/tmp`-resident `smoke5`/`v09`/`v01`/`g4`/`m6` scripts plus a
provenance header) — all green:

- [x] Base Pass checkout → `FULFILLED`, no `ISSUE_QR` outbox job.
- [x] VIP checkout → `FULFILLED` + `ISSUE_QR` → credential insert → job `DONE`.
- [x] Scan a freshly issued credential → `200 {outcome: "accepted"}` plus `scan_attempts` **and** `admissions` rows; `recentScans` populated.
- [x] Re-submit same token+scanId → `replayed: true`, not 500.
- [x] Tampered token → `invalid_signature` audited in `scan_attempts`, no admission created.
- [x] Gate assignment enforced: unassigned device → `wrong_gate/no_active_assignment`; unknown/inactive gate rejected; offline `FAIL_CLOSED` → `cooldown`, override → `manual_override` + audit (G4).
- [x] Festival-scoped RBAC: every bare-id admin function + RLS policy carries a festival filter; 8 V-01 scenarios green (0027).
- [x] Terminal-state payments: CANCELLED/EXPIRED late captures → `REFUND_REQUIRED`; provider cancel jobs emitted; 0026 scenarios green (V-09).
- [x] Export worker: atomic lease claim, SKIP LOCKED exclusion, crash recovery, backoff retry, max-attempts `FAILED`, 7-day purge, privilege lockdown (0030 / M6-export).
- [x] Cancel FULFILLED order → `CANNOT_CANCEL_FULFILLED`; cancelled/expired cancels idempotent.
- [x] Event solo checkout reserves exactly 1 unit; cancel releases the hold once and only once.
- [x] `supabase db reset` (full local path) succeeds with the renumbered migration set `0001`–`0030` (G6).
- [x] CI real-DB gate — `.github/workflows/ci.yml` `db-smoke` job: fresh
  `postgres:15` service → `supabase/smoke/bootstrap.sql` → migrations
  `0001`–`0030` in order → `seed.sql` → each `supabase/smoke/0?-*.sql` with
  `ON_ERROR_STOP=1` and an `ALL .*PASS` banner assertion, on every push. So
  RPC-level bugs like G1/G3/G7/G8 cannot recur invisibly. (Not idempotent —
  must run on a fresh DB; the CI service container is fresh.)
- [ ] Remote envs: reconcile the duplicate-`0018` history by inserting the `0029` row into `schema_migrations` (see G6 deploy note).
