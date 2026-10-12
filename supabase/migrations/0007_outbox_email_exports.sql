-- 0007: email jobs and delivery events (plan §7.14)

create table email_jobs (
  id uuid primary key default gen_random_uuid(),
  logical_key text not null unique,
  recipient_user_id uuid references auth.users (id) on delete set null,
  to_email_snapshot citext not null,
  template_name text not null,
  template_version integer not null default 1,
  render_data jsonb not null default '{}'::jsonb,
  state email_job_state not null default 'PENDING',
  resend_email_id text unique,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  submitted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_jobs_pending_idx
  on email_jobs (created_at)
  where state in ('PENDING', 'RETRY_WAIT');

create table email_events (
  id uuid primary key default gen_random_uuid(),
  email_job_id uuid references email_jobs (id) on delete cascade,
  resend_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  unique (resend_event_id, event_type)
);

create table email_suppressions (
  email citext primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table email_jobs enable row level security;
alter table email_events enable row level security;
alter table email_suppressions enable row level security;

-- Claim email jobs for the worker (same lease pattern as outbox).
create or replace function claim_email_jobs(
  p_owner text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns setof email_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from email_jobs
    where state in ('PENDING', 'RETRY_WAIT')
      and (lease_expires_at is null or lease_expires_at < clock_timestamp())
    order by created_at
    limit p_batch_size
    for update skip locked
  )
  update email_jobs ej
  set state = 'PROCESSING',
      lease_owner = p_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      updated_at = clock_timestamp()
  from claimed
  where ej.id = claimed.id
  returning ej.*;
end;
$$;

-- Monotonic delivery-state update from Resend webhooks (plan §13.5).
create or replace function record_email_event(
  p_resend_email_id text,
  p_resend_event_id text,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job email_jobs;
  v_new_state email_job_state;
begin
  select * into v_job from email_jobs where resend_email_id = p_resend_email_id for update;

  insert into email_events (email_job_id, resend_event_id, event_type, metadata)
  values (v_job.id, p_resend_event_id, p_event_type, p_metadata)
  on conflict (resend_event_id, event_type) do nothing;

  if not found and v_job.id is null then
    return;
  end if;

  v_new_state := case p_event_type
    when 'email.delivered' then 'DELIVERED'::email_job_state
    when 'email.bounced' then 'BOUNCED'::email_job_state
    when 'email.complained' then 'COMPLAINED'::email_job_state
    when 'email.delivery_delayed' then 'DELAYED'::email_job_state
    else null
  end;

  if v_new_state is not null and v_job.id is not null then
    -- Monotonic: never move a terminal state backwards.
    update email_jobs
    set state = v_new_state,
        delivered_at = case when v_new_state = 'DELIVERED' then clock_timestamp() else delivered_at end,
        updated_at = clock_timestamp()
    where id = v_job.id
      and state not in ('DELIVERED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'DEAD');

    if v_new_state in ('BOUNCED', 'COMPLAINED') then
      insert into email_suppressions (email, reason)
      values (v_job.to_email_snapshot, p_event_type)
      on conflict (email) do nothing;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- export_jobs / sheets sync (plan §7.16)
-- ---------------------------------------------------------------------
create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete restrict,
  export_type text not null,
  filter_snapshot jsonb not null default '{}'::jsonb,
  column_policy text not null default 'standard',
  state export_job_state not null default 'REQUESTED',
  storage_object_path text,
  checksum text,
  row_count integer,
  as_of timestamptz,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint export_jobs_type_valid check (
    export_type in ('EVENT_REGISTRATIONS', 'ROSTER', 'FINANCE_LEDGER', 'SCAN_HISTORY')
  )
);

alter table export_jobs enable row level security;

create policy export_jobs_staff_read on export_jobs
  for select using (has_permission('registration.export') or has_permission('finance.read'));

create table sheets_sync_state (
  festival_id uuid primary key references festivals (id) on delete cascade,
  master_spreadsheet_id text,
  folder_id text,
  last_outbox_cursor timestamptz,
  status text not null default 'IDLE',
  last_error text,
  updated_at timestamptz not null default now()
);

create table sheets_sync_items (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  entity_version integer not null default 1,
  sync_state text not null default 'PENDING',
  attempts integer not null default 0,
  provider_row_id text,
  updated_at timestamptz not null default now(),
  unique (festival_id, entity_type, entity_id, entity_version)
);

alter table sheets_sync_state enable row level security;
alter table sheets_sync_items enable row level security;
