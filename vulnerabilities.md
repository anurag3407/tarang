# TARANG 2026 — Security Vulnerability Report (post-hardening)

**Date:** 2026-08-23
**Baseline:** commit `9ce79de` (HEAD at audit time)
**Scope:** Full security sweep of `src/` (198 files), all 17 Supabase migrations, workers, cache handlers, nginx/Docker/compose infra, CI workflows, git history for secret leakage.
**Method:** Manual review of every API route + shared authz/CSRF/rate-limit primitives, three parallel domain audits (access control, payments/races/replay, secrets/config/rate limits), plus targeted verification of XSS sinks, upload paths, redirects, RLS policies, and CSV handling.

**Exclusions by design:**
- Everything in `report.md` that was fixed by commit `4d5069e` / migration `0017` is **not** repeated here (C1 anon RPC leak, C2 NO_HOLD dead-end, C3 wrong overview table, C4 env-public normalization, C5 cacheHandler wiring, C7 duplicate-pass rollback, R1 profile self-unban, R17 price-version reads, R18 proxy load path, R19 worker crash handlers — all re-verified fixed).
- Still-open items already documented in `report.md` are intentionally omitted here; consult `report.md` alongside this document before launch.

Severity legend: 🔴 launch blocker · 🟡 fix before tickets go live · 🟢 hardening.

---

## 1. Critical findings

### V-01 🔴 Festival-blind RBAC — one assignment grants permissions across all festivals

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0027_festival_scoped_rbac.sql`:
> - `has_permission` carries a `p_festival_id` parameter (defaulted to the
>   caller's active festival) and staff assignments are matched on both
>   permission code AND `festival_id`.
> - Every bare-id admin function (`admin_upsert_schedule_entry`,
>   `admin_upsert_notice`, `admin_upsert_event`, `admin_upsert_sponsor`, and the
>   delete/deprecate companions) now guards `v_existing.festival_id =
>   p_festival_id` before any UPDATE/DELETE, returning `FESTIVAL_MISMATCH`
>   otherwise.
> - All admin RLS policies are recreated festival-scoped; `src/services/authz.ts`
>   passes `ctx.festivalId` on every permission check.
>
> Validated on real PostgreSQL 15 by `supabase/smoke/03-festival-rbac.sql` — 8 scenarios
> (cross-festival denial, per-festival grant, policy scope) all pass.

**Categories:** Access Control Bypass · Privilege Escalation · Shadow Admin Access

**Locations:**
- Root cause: `supabase/migrations/0002_profiles_and_rbac.sql:167-203` — `has_permission()` filters staff assignments only on `sa.status = 'ACTIVE'`; it never compares `staff_assignments.festival_id` against the festival context of the request.
- Same defect inside content-mutation SQL functions, which select rows by bare id and never compare `festival_id` to the caller's festival parameter:
  - `admin_upsert_schedule_entry` — `0004_content_rls_and_functions.sql:413`
  - `admin_upsert_notice` — `0004_content_rls_and_functions.sql:476`
  - `admin_upsert_event` — `0011_security_lockdown.sql:175`
  - `admin_upsert_sponsor` — `0016_sponsors.sql:91`

**Description:** Permission codes are checked globally, not per-festival. Any active staff assignment — even for an unrelated festival — satisfies `has_permission()` for the currently selected festival. Combined with the bare-id upsert functions above, an admin of fest A can create/update/delete content owned by fest B by supplying fest B's row id.

**Exploit scenario:** Low-trust volunteer given `content.notice.write` for a minor event switches their active festival context and edits/publishes notices, schedule entries, events, or sponsors belonging to the main festival.

**Fix:** Add `and sa.festival_id = <current festival>` to `has_permission()` (or resolve assignments per-festival), and add `and v_existing.festival_id = p_festival_id` guards inside each `admin_upsert_*` function before UPDATE.

---

### V-02 🔴 `/api/admin/overview` dumps cross-festival participant PII to any `admin.access` holder

> **Status: FIXED (2026-08-24, uncommitted)** — every query is now scoped with
> `.eq("festival_id", ctx.festivalId)` (`orders`, `delegate_passes`, `notices`,
> `events`), and festival metadata is read from the DB instead of the hardcoded
> `tarang-2027` slug/dates.

**Categories:** IDOR · Information Disclosure · Broken Access Control

**Location:** `src/app/api/admin/overview/route.ts:12-62`

**Description:** The only gate on this route is `guardAdminRead(req, "admin.access")`. Every query then runs on the **service-role** client with **zero** `.eq("festival_id", …)` filters:

| Lines | Data exposed |
|---|---|
| 17–24 | Last 100 orders across **all festivals** |
| 28–31 | Purchaser profiles: `phone_e164`, `college_name`, display name |
| 34–42 | Auth email addresses via `auth.admin.getUserById()` (up to 50 users) |
| 45–62 | All delegate passes incl. `public_pass_code`, holder profiles fetched again |

This deviates from the festival-scoped pattern used by every other admin route (`events`, `notices`, `sponsors`, `exports` lists all pass `ctx.festivalId` into their queries).

**Exploit scenario:** Any staff member whose role includes the generic `admin.access` code (e.g., a content editor) calls `GET /api/admin/overview` and receives names, phone numbers, colleges, and emails of every purchaser across every festival. This is the single largest PII exposure surface in the app.

**Fix:** Add `.eq("festival_id", ctx.festivalId)` to the orders and passes queries; derive profiles only from the scoped result set; consider requiring a dedicated `finance.read` / `admin.overview` permission instead of the broad `admin.access`.

---

### V-03 🔴 Order-cancel TOCTOU: a paid, FULFILLED order can be flipped to CANCELLED after capture

> **Status: FIXED (2026-08-24, uncommitted)** — the cancel route now calls a new
> `cancel_order(uuid, uuid)` SQL function (`supabase/migrations/0020_atomic_order_cancel.sql`),
> which locks the order, rejects `FULFILLED`/`PAYMENT_REVIEW`, and transitions
> atomically. Idempotent for already `CANCELLED`/`EXPIRED`. The route no longer
> read-modify-writes in JS.

**Categories:** Race Condition (TOCTOU) · Business Logic Flaw · Payment Manipulation

**Location:** `src/app/api/checkout/orders/[orderId]/cancel/route.ts:36-47`

**Description:** The FULFILLED check is a plain read (line 36) with no row lock; the subsequent UPDATE (lines 41–47) has **no state precondition** (`WHERE checkout_state IN (...)`) and no optimistic-version bump.

**Exploit scenario:** User completes payment; the Razorpay webhook and browser verify run `apply_captured_payment` (which locks the order row and fulfills). Concurrently the user hammers Cancel (double-click or scripted). Cancel passes its read-check pre-capture, its UPDATE blocks on the row lock, then commits after fulfillment — flipping a paid, fulfilled order to CANCELLED. Consequences: charge taken + pass issued + order reads cancelled; the freed "one open base-pass order" slot also allows a second paid order whose fulfillment later lands in the refund path.

**Fix:** Make the transition conditional and atomic:
```sql
update orders set checkout_state='CANCELLED'
where id=$1 and purchaser_user_id=$2
  and checkout_state in ('PROVISIONING','AWAITING_PAYMENT');
```
Treat `updated rows = 0` as CONFLICT (re-read state and respond accordingly).

---

### V-04 🔴 Order-cancel hold release is non-atomic and releases CONSUMED holds → phantom capacity / oversell

> **Status: FIXED (2026-08-24, uncommitted)** — hold release, inventory return,
> claims and team-draft rollback all happen inside the same `cancel_order`
> transaction (migration 0020) with state-guarded updates (`state='ACTIVE'` only)
> and `greatest(0, held_units - units)` decrements mirroring the reaper.

**Categories:** Race Condition · Payment Manipulation · Business Logic Flaw

**Location:** `src/app/api/checkout/orders/[orderId]/cancel/route.ts:49-82`

**Description:** Three defects in the release block:
1. Line 57–63: hold UPDATE filters only on `order_id` — **no `.eq("state","ACTIVE")`** despite the SELECT above filtering `ACTIVE`. A CONSUMED hold (already consumed by fulfillment) gets flipped to RELEASED, which corrupts `apply_captured_payment`'s hold-state branching (`0017:505/551`).
2. Lines 65–81: inventory return is read-modify-write (`held_units = Math.max(0, held - units)`), not atomic — no `FOR UPDATE`, no version increment, no conditional decrement.
3. Concurrent execution with `expire_holds_batch` (which decrements atomically, `0005:622-627`) double-releases the same units.

**Exploit scenario:** Two parallel cancels (or cancel racing the reaper) release the same capacity units twice. `event_inventory.held_units` undercounts real holds → the guarded reservation check (`capacity_units - held_units - confirmed_units >= units`, `0005:505-511`) admits more participants than capacity allows → oversold event.

**Fix:** Replace the whole block with a single SQL function that (a) updates only `state='ACTIVE'` holds with a state-guarded conditional update returning released rows, then (b) decrements `held_units` once atomically (`set held_units = held_units - u.units where ... and held_units >= u.units`). Mirror the reaper's locking semantics so both paths use identical ordering.

---

### V-05 🔴 Live `create_event_checkout` references nonexistent tables/columns and wrong enum literals

> **Status: FIXED (2026-08-24, uncommitted)** — `supabase/migrations/0021_fix_event_checkout.sql`
> replaces the broken 0017 function: `team_draft_members` (accepted) instead of
> `team_members`, `'PARTICIPANT'`/`'REGISTRATION'` enum literals, and no
> nonexistent `capacity_holds.order_id` / `event_participant_claims.festival_id`
> references. Real-DB E2E requirement now satisfied: event checkout scenarios
> run in `supabase/smoke/01-smoke-checkout-and-scan.sql`, enforced on every
> push by the `db-smoke` CI gate (`.github/workflows/ci.yml`).

**Categories:** DoS (fail-closed checkout) · Payment Manipulation (systematic undercharge if DB drifted) · Logic Flaw

**Locations:** `supabase/migrations/0017_production_hardening.sql`
- :213-216 — queries table **`team_members`** with column `joined_at`; only `team_draft_members` exists (`0005:24-32`). Team checkouts throw `relation does not exist`.
- :314/:320 — compares `capacity_basis = 'PER_PERSON'` / `price_basis = 'PER_PERSON'`; actual enum values are `'TEAM'/'PARTICIPANT'` and `'REGISTRATION'/'PARTICIPANT'` (`0001:19-20`). The branch never matches.
- :362-364 — inserts column `order_id` into `capacity_holds`; column doesn't exist (`0005:150-160`), added by no later migration.
- :377 — inserts `festival_id` into `event_participant_claims`; doesn't exist (`0005:166-175`).

**Impact:**
- As written against the canonical schema, **every** `/api/checkout/events/[eventId]` call fails at runtime — event sales are dead (fail-closed DoS).
- If a deployed database was hand-drifted to make 0017 runnable, the never-matching `'PER_PERSON'` comparisons mean a PARTICIPANT-priced team event reserves **1 capacity unit and charges 1× price for N members** — systematic undercharge plus capacity bypass.

**Fix:** Rewrite the function body against the real schema/enums in a **new** migration (never edit applied migrations), then exercise team-event and solo-event checkouts end-to-end against staging before any deploy. Add a CI check that greps migrations for identifiers not present in earlier ones (cheap drift tripwire).

---

### V-13 🔴 Admissions/history silently dead in `record_scan`; every event checkout raises an enum-cast error

> **Status: FIXED (2026-08-24, uncommitted)** — migrations
> `0023_fix_record_scan_composite_null_checks.sql` and
> `0024_fix_event_checkout_enum_cast.sql`. Verified end-to-end on a fresh
> local Postgres by `supabase/smoke/01-smoke-checkout-and-scan.sql` (TEST2
> scan/admission/history + replay; TEST4 event reserve/release).

**Categories:** Missing Audit Trail (admissions never written) · Logic Flaw · DoS (event checkout)

**Part A — composite `IS NULL` on rows with nullable fields (`record_scan`).**

**Locations:** `supabase/migrations/0008_qr_scanning.sql`, `0018_reentry_scanning_and_history.sql:41,62,73`, `0019_unified_pass_scan_history.sql:35,53,59`, `0022_fix_record_scan_uuid_and_replay.sql:57,141,155,169`.

`v_credential` is `qr_credentials%ROWTYPE`, and `qr_credentials.revoked_at`
is nullable. PostgreSQL only evaluates `row IS NULL` as true when every field
is NULL and `row IS NOT NULL` when every field is non-NULL; a resolved row
with any NULL field makes **both comparisons false** (verified live). Inside
`record_scan` that means:

- `if v_outcome in ('accepted','manual_override') and v_credential is not null` never fires → **no `admissions` rows are ever written**; re-entry semantics and the `admissions_one_per_scope` unique index are dead, and the audit trail loses first-entry facts (gate + time + who).
- Both scan-history branches are skipped → `recentScans` is always `[]`; the "unified scan history" feature (commit `4fd81c8`) silently returns nothing.

**Impact:** All valid scans still "work" from the scanner UI's perspective
(attempt is recorded), so operators see no error — silent functionality +
audit loss. Tampered tokens were still audited (that branch doesn't depend on
the composite check), which is why the existing smoke test only caught the
missing admission row.

**Fix (done):** field-based checks — `v_gate.id is null`,
`v_credential.id is null / is not null`, `v_admission.id is not null`
(`id` is the PK, so it is NULL iff no row was found). A sweep of all installed
plpgsql functions found no other bare `is (not) null` checks on row-typed
variables.

**Part B — untyped text → `participant_role` enum in `create_event_checkout`.**

**Location:** `0021_fix_event_checkout.sql` step 12.

The `order_participants.role` insert uses `case … then 'CAPTAIN' else 'MEMBER'
end` — text literals with no cast. plpgsql does not implicitly coerce text to
an enum target, so the insert raises `column "role" is of type
participant_role but expression is of type text` on **every** event checkout,
after the order/line/hold/inventory writes already happened (partial order +
held capacity left behind on the error path). Same bug class as V-05/G1:
typed-expression/column mismatch that mocks never catch.

**Fix (done):** explicit casts `'CAPTAIN'::participant_role` /
`'MEMBER'::participant_role`.

---

## 2. Medium findings

### V-06 🟡 Sponsor logo upload: SVG accepted, client-controlled MIME trusted, storage path broken in production

> **Status: MOSTLY FIXED (2026-08-24, uncommitted)** — allowlist dropped SVG,
> magic bytes (PNG/JPEG/WebP/GIF) are sniffed server-side and cross-checked
> against the client MIME. A new `uploads-data` Docker volume mounts
> `public/uploads` so writes survive the read-only rootfs. **Still open:** files
> remain under the web root (`/uploads/*`) served by nginx. This is now much
> less risky: SVG is rejected, all four image types are magic-byte sniffed, and
> nginx applies `nosniff`/CSP/X-Frame-Options to `/uploads/*` via
> `security-headers.conf` (V-07). Residual: move to Supabase Storage (or a
> controller) so uploads live outside the served web root entirely.

**Categories:** File Upload Bypass · SVG XSS / Stored XSS · MIME-Type Bypass · Double Extension Bypass (n/a but related surface)

**Locations:** `src/app/api/admin/sponsors/upload/route.ts`
- :15 — `image/svg+xml` in allowlist. SVG is an active-content format (`<script>`, `onload=` handlers); served same-origin from `/uploads/sponsors/*.svg`, opening the URL directly executes script in your origin (session-bearing).
- :36 — `const mimeType = file.type || "image/png"` trusts the **client-declared** Content-Type of the blob. No magic-byte sniffing, so an HTML/script payload rides in declared as `image/png`.
- :53-58 — writes to `process.cwd()/public/uploads/sponsors` at runtime.

**Deployment conflict (functional):** production containers run `read_only: true` (`docker-compose.yml:29,74`) with volumes only for `exports-data` and `next-cache` — the write fails outright, so sponsor uploads are broken in prod regardless of security posture.

**Mitigating factor:** route requires `content.sponsor.write` (admin mutation guard), so it's staff-only — but staff roles are delegable and V-01 shows permission scoping is unreliable.

**Fix (all four):**
1. Drop SVG from the allowlist (or serve uploads with `Content-Disposition: attachment` + `Content-Security-Policy: sandbox` and never inline-render SVG).
2. Validate magic bytes server-side (png/jpeg/webp signatures) instead of trusting `file.type`.
3. Move storage to a mounted volume (or Supabase Storage) outside the web root, served through a controller that sets safe headers.
4. Keep the generated random filename (good — no extension control by uploader).

---

### V-07 🟡 Zero security response headers anywhere — clickjacking on admin/scanner, no CSP baseline

> **Status: FIXED (2026-08-24, uncommitted)** — `infra/nginx/conf.d/security-headers.conf`
> adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
> `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
> (`camera=(self)` — the scanner PWA calls `getUserMedia`), and CSP
> `frame-ancestors 'none'`; included in every server block of both
> `tarang.conf` (5 blocks) and `tarang-single-domain.conf`. HSTS still depends on
> the Cloudflare zone (no in-repo TLS config).

**Categories:** Clickjacking · Misconfigured Headers · CSP Bypass (by absence)

**Locations:**
- `infra/nginx/conf.d/tarang.conf:44-193` — five server blocks, **zero** `add_header` directives.
- `infra/nginx/conf.d/tarang-single-domain.conf:76-133` — same.
- `next.config.ts` — only `poweredByHeader: false`; comment claims nginx/Cloudflare own transport security, but no config in-repo delivers it.

**Missing:** `Content-Security-Policy`, `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

**Impact:** Admin panel and scanner PWA are framable → UI-redress clickjacking against staff actions. No CSP means any future injection sink has nothing behind it. `nosniff` absent matters doubly given the upload MIME issues in V-06.

**Fix:** One shared block in both nginx variants:
```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; ..." always;
```
CSP needs iteration against Next's inline/bootstrap scripts (`'unsafe-inline'` for styles is typical; script hashes/nonce preferred). Verify HSTS is enabled at the Cloudflare zone since neither layer in-repo sets it.

---

### V-08 🟡 Auth flows have no application-layer throttling; Turnstile silently disabled in production when key unset

> **Status: FIXED (2026-08-24, uncommitted)** — every browser→Supabase auth
> mutation now calls `POST /api/auth/guard` first
> (`src/lib/auth-guard-client.ts`; wired into the login and admin-login forms
> for password sign-in/sign-up, magic link, password reset, confirmation
> resend, and Google OAuth start):
> - The route runs `validateMutationRequest` (CSRF origin check), parses the
>   body through the strict `authGuardSchema` (`src/lib/validation/schemas.ts`),
>   then enforces the `login` bucket (20 req / 15 min, `src/lib/redis/rate-limits.ts:31`)
>   keyed on hashed IP **and** hashed email (fails open when Redis is
>   unavailable so a Redis blip never locks out sign-ins).
> - Turnstile verification runs only when a form supplies a widget token
>   (forms don't ship the widget yet); and `verifyTurnstile` now fails closed
>   in production — a missing `TURNSTILE_SECRET_KEY` rejects, it no longer
>   silently returns `true` (`src/lib/turnstile.ts:19`).
>
> Validated by `tests/e2e/auth-guard.e2e.test.ts` (5 scenarios) and the full
> vitest suite.

**Categories:** Brute Force Vulnerability · Missing Rate Limits · Rate Limit Bypass · Account Takeover (enabler)

**Locations:**
- `src/app/login/page.tsx:67` (signInWithPassword), `:101` (signUp), `:136` (OTP request), `:158` (password reset) — browser→Supabase direct calls; no app-layer rate limit, no Turnstile token attached.
- `src/app/admin/login/AdminLoginForm.tsx:49,72` — staff/admin credential-stuffing surface, same gap.
- `src/lib/turnstile.ts:15` — `if (!secret) return true;` — bot protection silently off when `TURNSTILE_SECRET_KEY` unset, **including production**; the prod fail-fast list (`src/lib/env.ts:148-160`) does not require it.

**Impact:** Credential stuffing / OTP-harassment / signup-spam throughput is bounded only by Supabase's built-in defaults. An unset Turnstile secret in the prod env ships silently with public forms unprotected (ask/verify degrade from gated to open).

**Fix:**
1. Require `TURNSTILE_SECRET_KEY` (+ site keys) in the production fail-fast list, or log a loud boot warning and flip `verifyTurnstile` to fail-closed when `APP_ENV=production`.
2. Wrap all four auth submissions with the existing Upstash limiter (new bucket, e.g. 5/min/IP+email-hash) via a tiny server route, or at minimum add Turnstile to the auth forms like ask/verify already do.

---

### V-09 🟡 Captured payments ignore CANCELLED/EXPIRED orders; overpayments sit silently UNAPPLIED; auto-cancel kills live payment sessions

> **Status: FIXED (2026-08-24, uncommitted)** — additive migration
> `supabase/migrations/0026_captured_payment_terminal_states_and_provider_cancel.sql`:
> `apply_captured_payment` now treats CANCELLED / EXPIRED / PAYMENT_REVIEW as
> terminal — a late capture returns `REFUND_REQUIRED` with reason
> `order_cancelled` / `order_expired` / `order_payment_review` instead of
> force-fulfilling — and a captured payment that cannot bind to an order
> (ALREADY_APPLIED / FULFILLED duplicate) is flagged `REFUND_REQUIRED` instead
> of sitting silently `UNAPPLIED`. Fix item 3: new trigger
> `trg_orders_provider_cancel` emits `CANCEL_RAZORPAY_ORDER` outbox jobs on
> every UPDATE transition out of the live states (user cancel 0020,
> base-pass auto-cancel + event stale-order cleanup 0017, hold-reaper EXPIRED
> 0005 — all plain `UPDATE`s on orders), and `outbox-dispatcher.ts` claims and
> executes them via `cancelRazorpayOrder()` in
> `src/lib/razorpay/client.ts` (best-effort; 400 = already terminal = success).
> Fix item 4 was already delivered by migration 0018 (`COLD_STATES =
> [CANCELLED, EXPIRED]` with bounded `reconcile_attempts` and the
> `last_reconciled_at` fairness cursor). Validated against real PostgreSQL 15
> (reset + smoke + six targeted V-09 scenarios) and the full vitest suite.

**Categories:** Payment Manipulation · Business Logic Flaw · Logic Flaw

**Locations:** `supabase/migrations/0017_production_hardening.sql`
- :494-496 — `apply_captured_payment` short-circuits only on `checkout_state = 'FULFILLED'`. A payment captured against a user-CANCELLED or reaper-EXPIRED order proceeds to full fulfillment (BASE_PASS branch :610-641 has no terminal-state guard).
- :489-492 — second captured payment on one order returns `ALREADY_APPLIED` without setting `disposition = 'REFUND_REQUIRED'/'REVIEW'` → money sits in `UNAPPLIED` with no automated obligation; reconciler never revisits FULFILLED orders (`src/workers/payment-reconciler.ts:33-38` scans only PROVISIONING/AWAITING states).
- :104-115 (base-pass auto-cancel) & :240-271 (event stale-order cleanup) — starting a NEW checkout cancels ANY open AWAITING_PAYMENT order, including one whose Razorpay checkout modal is still open and gets completed seconds later. Nothing ever calls provider-side cancel (`src/lib/razorpay/client.ts` creates orders, never cancels).

**Exploit scenario:** Open checkout A, abandon it, start checkout B (auto-cancels A), pay A anyway from the stale tab → capture arrives on a CANCELLED order → force-fulfilled, or double-charged with the second amount parked UNAPPLIED until a human notices. Support/refund mess around launch weekend.

**Fix:**
1. In `apply_captured_payment`, treat CANCELLED/EXPIRED as `REFUND_REQUIRED` (or explicit policy constant) instead of fulfilling.
2. Set a refund disposition whenever a captured payment cannot bind to an order (covers ALREADY_APPLIED).
3. On app-side cancel, call Razorpay's order-cancel API best-effort so late authorizations fail provider-side.
4. Extend reconciler to sweep CANCELLED/EXPIRED orders that gained payments after cancellation.

---

### V-10 🟡 CSV formula injection in exported rosters

> **Status: FIXED (2026-08-24, uncommitted)** — `export-worker.ts` passes a
> string-only `cast` to `stringify` that prefixes `'` on cells beginning with
> `= + - @` (incl. fullwidth variants), tab or CR. Numeric columns (e.g.
> `amount_paise`) are unaffected.

**Categories:** CSV/Formula Injection · Improper Output Encoding

**Location:** `src/workers/export-worker.ts:57` — `stringify(rows, { header: true })` with no cell sanitization.

**Description:** Cell values come straight from user-controlled profile fields (display name, college name, etc.). Values beginning with `=`, `+`, `-`, `@` execute as formulas when staff open rosters in Excel/Sheets (`=HYPERLINK("https://evil","Click")`, `=WEBSERVICE(...)` exfil attempts).

**Fix:** Escape leading `[=+-@\t\r]` cells with a prefix (`'`) or space in the worker before stringify — standard OWASP CSV-injection defense; ~5 lines.

---

### V-11 🟡 Resend webhook: Svix signature verified but replay window unbounded

> **Status: FIXED (2026-08-24, uncommitted)** — the route now enforces a
> Svix-style replay window: `MAX_AGE_SECONDS = 5 * 60`
> (`src/app/api/webhooks/resend/route.ts:11`), and any delivery whose
> `svix-timestamp` is non-numeric or outside `now ± 300s` is rejected with
> **401 before signature verification** (`src/app/api/webhooks/resend/route.ts:78-84`).

**Categories:** Token Replay · Webhook Spoofing (partial)

**Location:** `src/app/api/webhooks/resend/route.ts:68-84` — `svix-timestamp` participates in the HMAC but its **age is never checked**.

**Exploit scenario:** Anyone who once captures a signed delivery (proxy log, leaked staging hook URL, support paste) can replay it indefinitely; it keeps verifying. Impact bounded today because `record_email_event` dedupes on `(resend_event_id, event_type)` (`0007:99-122`), but bounce/complaint suppression entries can be re-driven forever.

**Fix:** Reject deliveries older than ~5 minutes (`Math.abs(now - ts) > 300` → 400) before verification, per Svix guidance.

---

## 3. Hardening / low severity

### V-12 🟢 Assorted hardening items

| # | Location | Issue | Fix |
|---|---|---|---|
| a | `api/webhooks/razorpay/route.ts:59-61` | Dedupe key `x-razorpay-event-id` sits outside the body HMAC — replaying a captured (body, signature) pair with a fresh event-id creates new inbox rows. Processing stays idempotent, so impact is log/inbox pollution. | ✅ FIXED 2026-08-24: the dedupe key is now derived from the HMAC-covered body (`parsed.event_id`, falling back to `bodyHash(rawBody)`), so a replayed pair with a spoofed header cannot mint new inbox rows; the untrusted `x-razorpay-event-id` header is recorded only for forensics. |
| b | `scanner/scan/route.ts:45` vs `verify-card/route.ts:42` | Rate limit runs **after** device-credential validation — failed credential guesses are unthrottled (attacker first needs a `scanner.use` session, so low risk). | ✅ FIXED 2026-08-24: `checkRateLimit` now runs before the device lookup (keyed on the credential hash) in both routes. |
| c | `0013_independent_entities_and_verification.sql:397-453` + `scanner/verify-card/route.ts:44-72` | Post-C1-fix residual: `verify_gate_pass_lookup` matches `email ilike v_query` **unanchored**, letting any `scanner.use` holder harvest users by substring at the gate endpoint. Rate-limited per device only. | ✅ FIXED 2026-08-24 (migration 0025): `verify_gate_pass_lookup` is anchored — email matches by exact equality, pass-code lookup by prefix, and LIKE wildcards in the query are escaped. |
| d | `admin/exports/[id]/download/route.ts:40` | `readFile(job.storage_object_path)` reads whatever path the DB row contains with no allowlist. Worker-written today, but one bad insert away from arbitrary read within container FS. | ✅ FIXED 2026-08-24: the download route resolves `storage_object_path` against `path.resolve` and rejects unless it resolves inside `EXPORT_DIR` **and** the basename matches `^[0-9a-f-]{36}\.csv$`. |
| e | `services/team-service.ts:40-63,147-155` | `assertEventTeamMode` doesn't verify `event.festival_id === festivalId`; `joinTeamByCode` skips festival checks — drafts/teams can reference another festival's events (integrity, not exposure). | ✅ FIXED 2026-08-24: `team-service.ts` threads `festival_id` through assert/join lookups and asserts equality. |
| f | `auth/callback/route.ts:64,72` | Supabase-supplied `error_description` echoed into the login redirect URL — provider-controlled text reflected back (encoded, React-escaped; cosmetic phishing vector at most). | ✅ FIXED 2026-08-24: raw `error`/`error_description` are logged server-side; the login redirect carries fixed copy only (`access_denied` gets "Sign-in was cancelled…"). |
| g | `checkout/orders/[orderId]/route.ts` (GET poll), `cancel`, `api/me/*` (5 routes), `scanner/session` | Authenticated-but-unlimited endpoints; poll/cancel are state-touching. Cheap wins for abuse ceilings. | ✅ FIXED 2026-08-24: order poll `checkRateLimit("poll", user)` (60/min), cancel `enforceRateLimit("order", cancel:user, failClosed)` (5/min), all five `me/*` routes `checkRateLimit("me", user)` (120/min), `scanner/session` `checkRateLimit("scanner", session-hash:…)`. |

---

## 4. Verified-clean coverage map

Audited and found sound at HEAD (one-line evidence each):

| Area (checklist terms) | Evidence |
|---|---|
| SQL Injection (union/blind/time/error/stored) | All data access via PostgREST parameter binding; raw SQL confined to SECURITY DEFINER fns with fixed statements + pinned `search_path` |
| XSS (reflected/stored/DOM/blind/self/HTML inj.) | Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` across `src/` (grepped); React escaping everywhere |
| Open Redirect / Unvalidated Redirect | `safeNext()` prefix allowlist blocks `//`, `\`, `\n` — `src/app/auth/callback/route.ts:11-29` |
| SSRF / LFI / RFI / RCE / Command Injection / SSTI / XXE / XSLT | No user-controlled fetch targets, no shell exec, no template engines, no XML parsers, no dynamic file inclusion |
| Prototype Pollution / Insecure Deserialization | Zod `.strict()` schemas on every mutating body (`route-utils.readJsonBody` + per-route schemas) |
| JWT Misconfiguration / Forgery | Session JWTs validated server-side via `supabase.auth.getUser()`; pass credentials are Ed25519 JWS, kid-pinned, nbf/exp (`src/lib/qr/credential.ts`) |
| Session Hijacking / Fixation / Expiration | Supabase SSR cookie rotation + refresh-token rotation; httpOnly Secure cookies |
| CORS Misconfiguration | No permissive `Access-Control-*` anywhere; same-origin default |
| CSRF (mutations) | Origin allowlist + JSON content-type + size caps on admin/checkout mutations (`src/lib/csrf.ts`); SameSite=Lax cookies |
| Secrets / Hardcoded Credentials / API Key Leakage / Backup Exposure | `.env*` never committed (git history checked); `.dockerignore` excludes `.env*`; service-role key imported only behind `server-only`; pino redaction list (`logger.ts:44-61`) |
| Info Disclosure / Debug Mode / Directory Listing / Source Disclosure | Generic 500 shape (`lib/api.ts:86-91`); health routes minimal + permission-gated (`dependencies` requires `admin.access`); `poweredByHeader:false` |
| Payment Signature / Amount Tampering / Replay (Razorpay core) | Raw-body HMAC w/ current+previous secrets; browser callback HMAC `order|payment` constant-time; amounts snapshotted server-side; exact-amount/currency enforced in `apply_captured_payment`; `payment_applications` unique(order_id)+unique(payment_id) = at-most-once fulfillment |
| Webhook Spoofing (Razorpay) | Verified before durable insert; non-2xx on storage failure so retries aren't lost |
| Cron/Job Endpoint Abuse | All `/api/jobs/*` verify QStash signatures, fail closed without keys (`lib/route-utils.ts:63-85`) |
| Scanner Gate Bypass | Dual auth (operator permission + SHA-256-hashed device credential shown once); override re-checks `scanner.supervise`; DB state re-checked per scan; unique scan indexes prevent double-admission |
| Mass Assignment | Explicit column maps / strict Zod everywhere |
| Docker / Server Misconfig | Non-root uid 1001, read-only rootfs, tmpfs /tmp, ports bound to 127.0.0.1, secrets runtime-only, Trivy in CI |
| Insufficient Logging | Append-only `scan_attempts`, `webhook_events` inbox, structured pino with redaction |
| Hold Reservation Race (reserve path) | Single conditional UPDATE guarded by CHECK constraint (`0005:505-511`) |

**Not applicable to this stack** (no such surfaces exist): GraphQL/LDAP/NoSQL injection, XXE, SAML/OAuth misconfig (no third-party OAuth flows — Supabase password/OTP only), WebSocket/QUIC abuse, HTTP smuggling (nginx TLS-AOP ingress, no hop-by-hop forwarding), cache poisoning (no user-input-keyed caching), K8s/Lambda/ECS/IAM/S3/cloud categories, subdomain takeover (no dangling DNS managed here), JSONP, RFD, padding oracle, timing attack (constant-time compares used on all secret comparisons), dependency confusion (pnpm-lock pinned, private registry n/a).

---

## 5. Recommended fix order

Implemented (uncommitted, 2026-08-24): **V-01 through V-13 are closed**, with
two residuals and one env-ops item that are not code:

- **V-06 residual (only security finding still open):** uploads still live
  under the served web root (`/uploads/*`). SVG is rejected, all four allowed
  image types are magic-byte sniffed, and nginx now applies
  `nosniff`/CSP/frame headers to the path — but the durable fix is moving
  sponsor logos to Supabase Storage (or another controller-served location
  outside the web root).
- **V-07 residual:** HSTS is configured at the Cloudflare zone (no TLS edge in
  repo). Verify `Strict-Transport-Security` is live on both hostnames before
  go-live.
- **Deploy-side follow-ups (not vulnerabilities):** the remaining launch
  blockers live in `deploy_gaps.md` — install/verify the systemd units and
  CIDR timer on the VPS (D4/D7 — unit files themselves are fixed), Supabase
  compute sizing + 3k re-test (§4), export volume handling across origins
  (D9), and a staging checkout/auth HTTP smoke (D11 — the SQL layer is now
  covered by the `db-smoke` CI job). Migration files `0020`–`0030` must ship
  with the next deploy.
