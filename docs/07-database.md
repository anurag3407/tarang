# 07 — Database

Postgres, hosted on Supabase. Schema defined by numbered SQL migrations in
`supabase/migrations/`. **Migrations are the source of truth** — run in order, never edit
an applied migration, add a new one instead.

## Migration map

| File | What it creates |
|------|-----------------|
| `0001_extensions_and_enums.sql` | pgcrypto/citext extensions + ALL enum types |
| `0002_profiles_and_rbac.sql` | festivals, profiles, roles, permissions, staff, audit + triggers |
| `0003_content_catalog.sql` | categories, venues, events, prices, inventory, schedule, notices, flags, pass products, teams |
| `0004_content_rls_and_functions.sql` | RLS on everything + admin mutation SQL functions + RBAC seed |
| `0005_checkout_and_inventory.sql` | orders, order_lines, capacity_holds, claims, delegate_passes, registrations + `create_*_checkout`, `expire_holds_batch` |
| `0006_payments_refunds_webhooks.sql` | outbox_jobs, razorpay_orders, payments, refunds, webhook_events + `apply_captured_payment`, outbox claim functions |
| `0007_outbox_email_exports.sql` | email_jobs, email_events, suppressions, export_jobs, sheets sync + claim functions |
| `0008_qr_scanning.sql` | qr_credentials, gates, devices, assignments, scan_attempts, admissions + `record_scan` |
| `0009_indexes_and_retention.sql` | Performance indexes + retention cleanup functions |
| `0010_admin_helpers.sql` | `resolve_user_id_by_email` (service_role-only lookup) |

`supabase/seed.sql` — local dev seed (festival, feature flags, sample data).

## Tables grouped by domain

### Core
| Table | Purpose | Key facts |
|-------|---------|-----------|
| `festivals` | One row per fest edition | `status` PUBLISHED = active; `version` for optimistic locking |
| `profiles` | Delegate info, 1:1 with `auth.users` | `public_member_code` is the public ID; `ANONYMIZED` = GDPR state |
| `feature_flags` | Per-festival on/off switches | `key` like `maintenance_mode`; read with 5s Redis cache |
| `audit_logs` | Who did what (append-only) | Written by SQL functions for sensitive mutations |

### RBAC (see doc 03)
`roles`, `permissions`, `role_permissions`, `staff_assignments`, `staff_event_scopes`

### Content catalog
| Table | Purpose | Key facts |
|-------|---------|-----------|
| `categories` | Event categories (music, dance...) | `is_active`, `sort_order` |
| `venues` | Physical locations | `name`, `short_name` |
| `events` | The events themselves | `status` DRAFT→PUBLISHED→ARCHIVED; `sales_state`; capacity/price via **versioned** tables |
| `event_price_versions` | Price history per event | Never update a price — insert new version, bump `events.current_price_version_id` |
| `event_inventory` | Capacity counters | `capacity_units`, `held_units`, `confirmed_units`. **Holds modify this atomically.** |
| `pass_products` / `pass_price_versions` | Base pass + its price history | Same versioning pattern as events |
| `schedule_entries` | Day-wise schedule | Can link to an event (`linked_event_id`) or be standalone |
| `notices` | Notice board | `pinned`, `publish_at`, `expires_at` |
| `support_questions` | User questions from /ask | Status for support dashboard |

**Why price versions?** Money must be auditable. You never change a price; you create a new
version. Old orders reference the version they paid. Same for pass prices.

### Checkout & orders (see doc 04)
| Table | Purpose |
|-------|---------|
| `orders` | Purchase attempts + state machine |
| `order_lines` | Items in an order, price snapshot |
| `order_participants` | People covered by an order line |
| `capacity_holds` | Temporary seat reservations (`expires_at`) |
| `event_participant_claims` | Prevents double-registration per user per event |
| `team_drafts` / `team_draft_members` | Team formation before checkout |
| `api_idempotency` | Request dedup, expires 24h |
| `delegate_passes` | The base pass, once fulfilled |
| `registrations` / `registration_members` | Event signups (solo or team) |

### Payments (see doc 04)
| Table | Purpose |
|-------|---------|
| `razorpay_orders` | Local↔provider order ID mapping |
| `payments` | Payment records; `disposition` (APPLIED, REFUNDED...); `refunded_paise` |
| `payment_applications` | Which payment applied to which order (audit) |
| `refunds` / `refund_allocations` | Refund lifecycle + which payments they draw from |
| `webhook_events` | Durable inbox for Razorpay/Resend webhooks; dedup by `provider_event_id` |
| `outbox_jobs` | Durable background-job queue (see doc 05) |

### Email
| Table | Purpose |
|-------|---------|
| `email_jobs` | Queue of emails to send (`logical_key` dedup) |
| `email_events` | Delivery/bounce notifications from Resend webhooks |
| `email_suppressions` | Banned recipients (bounced/complained — don't email again) |

### QR & scanning (see doc 06)
`qr_credentials`, `gates`, `scanner_devices`, `gate_assignments`, `scan_attempts` (append-only), `admissions`

### Exports & sync
| Table | Purpose |
|-------|---------|
| `export_jobs` | Requested CSV exports (`state` REQUESTED→RUNNING→COMPLETED) |
| `sheets_sync_state` / `sheets_sync_items` | Optional Google Sheets mirror |

## The important SQL functions

These contain business rules. When behavior is wrong, read these.

| Function | Migration | What it does |
|----------|-----------|--------------|
| `handle_new_user` | 0002 | Trigger: creates profile on signup (never blocks signup) |
| `has_permission(code, event_id)` | 0002 | RBAC check against **current** DB state |
| `current_staff_assignment` | 0002 | Resolves user's active staff row |
| `is_superadmin` / `active_superadmin_count` | 0002 | Superadmin checks |
| `admin_upsert_event` / `admin_publish_event` / `admin_set_event_capacity` | 0004 | Atomic admin content mutations (validate + audit) |
| `admin_upsert_notice` / `admin_upsert_schedule_entry` | 0004 | Same for notices/schedule |
| `write_audit` | 0004 | Append audit_logs row (called by the above) |
| `create_base_pass_checkout` | 0005 | Atomic: order + lines + hold + idempotency |
| `create_event_checkout` | 0005 | Same for events (+ team handling) |
| `check_order_total` | 0005 | Trigger: order total = sum of lines |
| `expire_holds_batch` | 0005 | Reaper: frees expired holds atomically |
| `attach_razorpay_order` | 0006 | Maps provider order to local order |
| `apply_captured_payment` | 0006 | The money function: captured payment → order FULFILLED, idempotent |
| `cancel_registration_with_refund` | 0006 | Admin cancellation flow |
| `claim_outbox_jobs` / `complete_outbox_job` / `fail_outbox_job` | 0006 | Job queue primitives (lease-based) |
| `claim_email_jobs` / `record_email_event` | 0007 | Email queue primitives |
| `record_scan` | 0008 | One atomic transaction per gate scan (see doc 06) |
| `purge_expired_exports` / `purge_old_webhook_bodies` / `anonymize_old_scan_attempts` | 0009 | Retention/housekeeping |
| `resolve_user_id_by_email` | 0010 | Service-role-only user lookup |

## Row Level Security (RLS)

- RLS is **on for every table** (migration 0004).
- Participant browsers use the **anon/authorized** Supabase key — they only see rows their
  policies allow (own profile, own orders, published content).
- Server code uses the **service role** key (`src/lib/supabase/service-role.ts`) which
  **bypasses RLS**. That file imports `server-only` so it can never leak to the browser.
- Some tables are server-only: no client policy at all, only service role reaches them.

**Rule of thumb:** UI reads go through RLS (safe by default); server logic uses service role
(and must therefore do its own permission checks via `requirePermission`).

## Key enums (types)

From migration 0001: `festival_status`, `profile_status`, `staff_assignment_status`,
`content_status`, `checkout_state`, `order_kind`, `payment_disposition`, `refund_state`,
`outbox_job_state`, `email_job_state`, `qr_credential_state`, `gate_type`, `admission_policy`,
and more. When a value "disappears" or behaves oddly, check the enum allows it.

## What can go wrong?

| Symptom | Cause | Fix |
|---------|-------|-----|
| "relation does not exist" | Migration not applied | `supabase db reset` locally; apply migrations in Supabase dashboard |
| RLS denies a legit read | Missing policy / wrong `auth.uid()` context | Check the table's policies; remember `has_permission` needs the **user's session client**, not service role |
| Service role suddenly forbidden | `SUPABASE_SERVICE_ROLE_KEY` wrong/rotated | Rotate env var; never commit it |
| Duplicate key on `api_idempotency` | Idempotency collision — expected behavior | Same key+payload = replay (OK); same key+different payload = `IDEMPOTENCY_MISMATCH` (client bug) |
| Event shows wrong price | `current_price_version_id` points to wrong version | Join `events` → `event_price_versions` |
| `held_units` never decreases | Hold reaper not running | See doc 05/10 |

### Debugging tips

- Supabase dashboard → Table Editor to browse rows; SQL Editor for queries.
- Local dev: `pnpm supabase:reset` (rebuilds DB from migrations + seed).
- Lint SQL: `pnpm supabase:lint`. Test: `pnpm supabase:test`.
