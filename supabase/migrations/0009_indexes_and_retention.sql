-- 0009: indexes and retention helpers (plan §7.17, §15.12)

-- Published event list by festival/category/sort.
create index if not exists events_published_list_idx
  on events (festival_id, category_id, sort_order)
  where status = 'PUBLISHED';

create index if not exists events_featured_idx
  on events (festival_id, sort_order)
  where status = 'PUBLISHED' and featured;

-- Current notices by publish/expiry/pinned.
create index if not exists notices_published_idx
  on notices (festival_id, pinned desc, publish_at desc)
  where status = 'PUBLISHED';

-- User active base pass.
create index if not exists delegate_passes_user_active_idx
  on delegate_passes (user_id, festival_id)
  where state = 'ACTIVE';

-- User registrations/dashboard.
create index if not exists registrations_owner_idx
  on registrations (owner_user_id, created_at desc);

-- Pending order/payment reconciliation.
create index if not exists razorpay_orders_status_idx
  on razorpay_orders (provider_status)
  where provider_status is distinct from 'paid';

-- RBAC permission lookup.
create index if not exists staff_assignments_user_idx
  on staff_assignments (user_id, status);

create index if not exists role_permissions_role_idx on role_permissions (role_id);

-- QR lookup by digest.
create index if not exists qr_credentials_digest_idx
  on qr_credentials (token_digest);

-- Outbox claim by job type.
create index if not exists outbox_jobs_type_idx
  on outbox_jobs (job_type, run_at)
  where state in ('PENDING', 'RETRY_WAIT');

-- Orders by purchaser for dashboard.
create index if not exists orders_purchaser_idx
  on orders (purchaser_user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Retention/anonymization helpers (plan §15.12). These are invoked by
-- scheduled jobs after the fest, never during the event window.
-- ---------------------------------------------------------------------
create or replace function anonymize_old_scan_attempts(p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from scan_attempts
    where received_at_server < clock_timestamp() - make_interval(days => p_older_than_days)
    returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

create or replace function purge_expired_exports(p_older_than_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update export_jobs
  set state = 'EXPIRED', storage_object_path = null
  where state = 'COMPLETED'
    and completed_at < clock_timestamp() - make_interval(days => p_older_than_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function purge_old_webhook_bodies(p_older_than_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update webhook_events
  set raw_body = null
  where processing_state in ('PROCESSED', 'DEAD')
    and received_at < clock_timestamp() - make_interval(days => p_older_than_days)
    and raw_body is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
