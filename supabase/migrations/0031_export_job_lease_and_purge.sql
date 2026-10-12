-- 0031_export_job_lease_and_purge.sql
-- Export worker atomicity, lease recovery, and retry/backoff (M6/G-export).
--
-- Previously the worker claimed jobs with a plain SELECT then an optimistic
-- UPDATE: two overlapping worker instances (the scheduled loop and a QStash
-- wake) could claim the same job, a worker crash mid-build left the job
-- stuck in RUNNING forever, failures went straight to FAILED (no transient
-- retry), and purge_expired_exports was never invoked, so completed rows and
-- their on-disk files were never reclaimed.
--
-- Additive changes:
--   * export_jobs gains lease columns (lease_owner / lease_expires_at),
--     a retry counter (attempts) and a gate (run_at) for backoff.
--   * claim_export_jobs() claims REQUESTED / RETRY_WAIT jobs (and RUNNING
--     jobs whose lease expired) with FOR UPDATE SKIP LOCKED, so concurrent
--     workers can never double-process a job.
--   * fail_export_job() parks a failed job in RETRY_WAIT with exponential
--     backoff, or FAILED once max attempts are exhausted.
--   * purge_expired_exports() is granted to service_role and invoked by the
--     worker each tick; local .csv files are removed by the worker.

alter table export_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists run_at timestamptz not null default now();

create index if not exists export_jobs_claim_idx
  on export_jobs (state, run_at, created_at)
  where state in ('REQUESTED', 'RETRY_WAIT');

-- Legacy RUNNING rows from the pre-lease worker have no lease and would
-- otherwise be unreclaimable: re-queue them so a crashed pre-migration
-- worker's jobs still run.
update export_jobs
set state = 'REQUESTED',
    lease_owner = null,
    lease_expires_at = null,
    run_at = now()
where state = 'RUNNING' and lease_expires_at is null;

-- Atomic claim with lease (mirrors claim_outbox_jobs in 0006).
create or replace function claim_export_jobs(
  p_owner text,
  p_batch_size integer default 3,
  p_lease_seconds integer default 300
)
returns setof export_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from export_jobs
    where run_at <= clock_timestamp()
      and (
        state in ('REQUESTED', 'RETRY_WAIT')
        or (state = 'RUNNING' and lease_expires_at is not null and lease_expires_at < clock_timestamp())
      )
    order by created_at, id
    limit p_batch_size
    for update skip locked
  )
  update export_jobs ej
  set state = 'RUNNING',
      lease_owner = p_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      run_at = clock_timestamp()
  from claimed
  where ej.id = claimed.id
  returning ej.*;
end;
$$;

-- Park a failed job for retry with backoff, or mark FAILED at max attempts.
create or replace function fail_export_job(
  p_job_id uuid,
  p_error text,
  p_retry_delay_seconds integer default 60,
  p_max_attempts integer default 8
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update export_jobs
  set state = case when attempts >= p_max_attempts then 'FAILED'::export_job_state else 'RETRY_WAIT'::export_job_state end,
      run_at = clock_timestamp() + make_interval(secs => p_retry_delay_seconds * attempts),
      error = left(p_error, 2000),
      lease_owner = null,
      lease_expires_at = null
  where id = p_job_id;
end;
$$;

-- Claim/retry helpers are internal worker plumbing: not callable by browser
-- sessions (mirrors 0011 lockdown for outbox claims).
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array['claim_export_jobs', 'fail_export_job'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Worker purge (expire COMPLETED rows older than 7 days) must be callable by
-- the worker; 0011 already revoked it from public/anon/authenticated.
grant execute on function purge_expired_exports(integer) to service_role;
