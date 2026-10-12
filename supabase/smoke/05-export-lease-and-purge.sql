-- 05-export-lease-and-purge.sql
-- export job lease: atomic claim, SKIP LOCKED, crash recovery, backoff, purge, privileges.
-- Source: validated locally against PostgreSQL 15; run by CI in .github/workflows/ci.yml
-- after `supabase/smoke/bootstrap.sql` + migrations 0001-0030 + `supabase/seed.sql`.
-- Requires: superuser (for `set role authenticated` tests) and fresh DB state.

\set ON_ERROR_STOP on
\pset pager off

create or replace function assert_true(p_cond boolean, p_msg text) returns boolean
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERT FAIL: %', p_msg;
  end if;
  return true;
end $$;

select id as fest_id from festivals where slug='pulse-2026' \gset
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111','export-owner@example.com')
on conflict (id) do nothing;
insert into profiles (user_id, display_name, public_member_code, status)
values ('11111111-1111-4111-8111-111111111111','Export Owner','MEM-EXPO','ACTIVE')
on conflict (user_id) do nothing;

-- Case 1: atomic claim of a REQUESTED job (lease + attempts).
insert into export_jobs (festival_id, requested_by, export_type, filter_snapshot)
values (:'fest_id'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'ROSTER', '{}'::jsonb)
returning id as j1 \gset
select count(*)::int as c1 from claim_export_jobs('worker-a', 5, 300) \gset
select assert_true( :'c1' = '1', 'M6.1 claim did not return the REQUESTED job' );
select state as st1, lease_owner as lo1, attempts as att1
from export_jobs where id = :'j1'::uuid \gset
select assert_true( :'st1' = 'RUNNING', 'M6.1 state not RUNNING after claim' );
select assert_true( :'lo1' = 'worker-a', 'M6.1 lease_owner not set' );
select assert_true( :'att1'::int = 1, 'M6.1 attempts not bumped to 1' );

-- Case 2: a second worker cannot claim a job that is RUNNING (SKIP LOCKED).
select count(*)::int as c2 from claim_export_jobs('worker-b', 5, 300) \gset
select assert_true( :'c2' = '0', 'M6.2 concurrent worker stole a RUNNING job' );

-- Case 3: expired lease is reclaimed (crash recovery).
update export_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
where id = :'j1'::uuid;
select count(*)::int as c3 from claim_export_jobs('worker-b', 5, 300) \gset
select assert_true( :'c3' = '1', 'M6.3 expired-lease job not reclaimed' );
select lease_owner as lo2, attempts as att2 from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'lo2' = 'worker-b', 'M6.3 reclaimer owner not recorded' );
select assert_true( :'att2'::int = 2, 'M6.3 attempts not bumped on recovery' );

-- Case 4: fail_export_job parks in RETRY_WAIT with backoff; early claim is empty.
select fail_export_job(:'j1'::uuid, 'transient boom');
select state as st4 from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'st4' = 'RETRY_WAIT', 'M6.4 transient failure not parked in RETRY_WAIT' );
select (run_at > clock_timestamp()) as backoff_ok, error as err4
from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'backoff_ok' = 't', 'M6.4 backoff run_at not in the future' );
select assert_true( :'err4' = 'transient boom', 'M6.4 error text not stored' );
select count(*)::int as c4 from claim_export_jobs('worker-a', 5, 300) \gset
select assert_true( :'c4' = '0', 'M6.4 job claimed before its run_at (backoff ignored)' );

-- Case 5: after run_at passes, the job is claimable again (attempts grows).
update export_jobs set run_at = clock_timestamp() - interval '1 second'
where id=:'j1'::uuid;
select count(*)::int as c5 from claim_export_jobs('worker-a', 5, 300) \gset
select assert_true( :'c5' = '1', 'M6.5 retry_wait job not claimed after run_at' );
select attempts as att5 from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'att5'::int = 3, 'M6.5 attempts not bumped on retry claim' );

-- Case 6: max attempts lands the job in FAILED.
update export_jobs set attempts = 8 where id=:'j1'::uuid;
select fail_export_job(:'j1'::uuid, 'permanent boom');
select state as st6 from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'st6' = 'FAILED', 'M6.6 max-attempt job not FAILED' );
select assert_true( lease_owner is null and lease_expires_at is null,
  'M6.6 FAILED job still holds a lease' ) from export_jobs where id=:'j1'::uuid;

-- Case 7: purge_expired_exports expires old COMPLETED rows only, and the
-- service-role grant is present.
update export_jobs set state='COMPLETED', completed_at = now() - interval '8 days',
  as_of = now() - interval '8 days', storage_object_path = '/tmp/old.csv', error = null
where id=:'j1'::uuid;
insert into export_jobs (festival_id, requested_by, export_type, filter_snapshot)
values (:'fest_id'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'ROSTER', '{}'::jsonb)
returning id as j2 \gset
update export_jobs set state='COMPLETED', completed_at = now() where id=:'j2'::uuid;
select purge_expired_exports(7) as purged \gset
select assert_true( :'purged'::int = 1, 'M6.7 purge count not exactly 1' );
select state as st7a from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'st7a' = 'EXPIRED', 'M6.7 old COMPLETED row not EXPIRED' );
select storage_object_path is null as path_cleared from export_jobs where id=:'j1'::uuid \gset
select assert_true( :'path_cleared' = 't', 'M6.7 expired row kept its storage path' );
select state as st7b from export_jobs where id=:'j2'::uuid \gset
select assert_true( :'st7b' = 'COMPLETED', 'M6.7 fresh COMPLETED row purged' );

-- Case 8: worker plumbing is not reachable from browser sessions, but the
-- service-role worker (and postgres) can call it.
select has_function_privilege('authenticated', 'public.claim_export_jobs(text, integer, integer)', 'execute') as auth_can_claim \gset
select assert_true( :'auth_can_claim' = 'f', 'M6.8 authenticated can call claim_export_jobs' );
select has_function_privilege('anon', 'public.fail_export_job(uuid,text,integer,integer)', 'execute') as anon_can_fail \gset
select assert_true( :'anon_can_fail' = 'f', 'M6.8 anon can call fail_export_job' );
select has_function_privilege('service_role', 'public.claim_export_jobs(text, integer, integer)', 'execute') as sr_can_claim \gset
select assert_true( :'sr_can_claim' = 't', 'M6.8 service_role cannot call claim_export_jobs' );
select has_function_privilege('service_role', 'public.purge_expired_exports(integer)', 'execute') as sr_can_purge \gset
select assert_true( :'sr_can_purge' = 't', 'M6.8 service_role cannot call purge_expired_exports' );

select 'M6-EXPORT: ALL PASS' as result;
