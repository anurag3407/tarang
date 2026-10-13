-- 01-smoke-checkout-and-scan.sql
-- base-pass + VIP checkout, fulfillment, QR issuance, scan admission + replay + tamper audit.
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

select id as fest_id from festivals where slug='tarang-2026' \gset
-- These suites exercise the two-tier (Basic -> VIP) RPC paths. The Basic Card
-- is retired (archived by 20261013120000), so re-open it in this throwaway DB.
update pass_products set status = 'PUBLISHED', sales_state = 'OPEN' where slug = 'base-delegate-pass';
select id as base_pass_id from pass_products where slug='base-delegate-pass' \gset
select id as vip_pass_product_id from pass_products where slug='vip-delegate-pass' \gset
select id as gate_id from gates where name='Main Gate' \gset
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','buyer@example.com'),
  ('22222222-2222-4222-8222-222222222222','op@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, college_name, profile_completed_at) values
  ('11111111-1111-4111-8111-111111111111','Buyer One','MEM-0001','ACTIVE','+919800000001','AIIMS New Delhi',now());
insert into scanner_devices (id, public_device_id, name, credential_hash, state) values
  ('99999999-9999-4999-8999-999999999999','dev-1','Scanner 1','hash-1','ACTIVE');
insert into gate_assignments (device_id, gate_id, operator_user_id, valid_from, valid_until)
values ('99999999-9999-4999-8999-999999999999'::uuid, :'gate_id'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, now(), now() + interval '1 day');

-- Superadmin staff assignment for the operator user (mirrors seed bootstrap note).
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_id'::uuid, 'Audit Superadmin', false, true) returning id as role_id \gset
insert into staff_assignments (festival_id, user_id, role_id, status, activated_at)
values (:'fest_id'::uuid, '22222222-2222-4222-8222-222222222222', :'role_id'::uuid, 'ACTIVE', now());
-- Make auth.uid() read the JWT subject from the GUC (local bootstrap defines a
-- null stub) so has_permission / RLS see the acting operator.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

\echo '=== TEST 0: incomplete profile cannot purchase (PROFILE_INCOMPLETE gate, plan P0-2) ==='
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa','incomplete@example.com');
insert into profiles (user_id, display_name, public_member_code, status) values
  ('00000000-0000-4000-8000-0000000000aa','Incomplete User','MEM-0000','ACTIVE');
do $$
begin
  perform create_base_pass_checkout(
    '00000000-0000-4000-8000-0000000000aa'::uuid,
    (select id from festivals where slug='tarang-2026'),
    (select id from pass_products where slug='base-delegate-pass'),
    '00000000-0000-4000-8000-00000000aa00'::uuid, 'req-hash-0');
  raise exception 'ASSERT FAIL: TEST0 checkout succeeded despite incomplete profile';
exception when sqlstate '22023' then
  if SQLERRM not like '%PROFILE_INCOMPLETE%' then raise; end if;
end $$;
select (select count(*) from orders where purchaser_user_id='00000000-0000-4000-8000-0000000000aa') = 0 as no_order \gset
select assert_true( :'no_order' = 't', 'TEST0 order row leaked on blocked checkout' );
\echo 'TEST0 PASS'

\echo '=== TEST 1: base pass (Basic) checkout -> FULFILLED, no ISSUE_QR job ==='
select create_base_pass_checkout(
  '11111111-1111-4111-8111-111111111111'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa01'::uuid, 'req-hash-1') as base_checkout \gset
select (:'base_checkout'::jsonb->>'orderId')::uuid as bp_order_id \gset
select attach_razorpay_order(:'bp_order_id'::uuid,'rzp_order_1',20000,'INR','receipt-1','created','{}'::jsonb) into temp attach_result_base;
select apply_captured_payment('pay_1','rzp_order_1',20000,'INR','captured',now()) as apply_result \gset
select (select checkout_state from orders where id=:'bp_order_id') = 'FULFILLED' as order_state_ok \gset
select assert_true( :'order_state_ok' = 't', 'TEST1 order not FULFILLED' );
select (select count(*) from outbox_jobs where job_type='ISSUE_QR') = 0 as no_qr_job \gset
select assert_true( :'no_qr_job' = 't', 'TEST1 base pass unexpectedly queued ISSUE_QR' );
select (select count(*) from outbox_jobs where job_type='SEND_EMAIL' and aggregate_id=:'bp_order_id'::text) = 0 as no_email_job \gset
select assert_true( :'no_email_job' = 't', 'TEST1 base pass unexpectedly queued SEND_EMAIL (credit policy)' );
select (select count(*) from outbox_jobs where job_type='INVALIDATE_CACHE' and logical_key='cache:order:'||:'bp_order_id') = 1 as cache_job_ok \gset
select assert_true( :'cache_job_ok' = 't', 'TEST1 INVALIDATE_CACHE job missing' );
\echo 'TEST1 PASS'

\echo '=== TEST 1b: VIP pass checkout -> FULFILLED + ISSUE_QR job + credential via worker flow ==='
select create_base_pass_checkout(
  '11111111-1111-4111-8111-111111111111'::uuid, :'fest_id'::uuid, :'vip_pass_product_id'::uuid,
  '00000000-0000-4000-8000-00000000aa03'::uuid, 'req-hash-3') as vip_checkout \gset
select (:'vip_checkout'::jsonb->>'orderId')::uuid as vip_order_id \gset
select attach_razorpay_order(:'vip_order_id'::uuid,'rzp_order_2',200000,'INR','receipt-2','created','{}'::jsonb) into temp attach_result_vip;
select apply_captured_payment('pay_2','rzp_order_2',200000,'INR','captured',now()) as apply_result2 \gset
select (select checkout_state from orders where id=:'vip_order_id') = 'FULFILLED' as vip_order_ok \gset
select assert_true( :'vip_order_ok' = 't', 'TEST1b vip order not FULFILLED' );
select id as vip_pass from delegate_passes where user_id='11111111-1111-4111-8111-111111111111' and pass_product_id=:'vip_pass_product_id'::uuid \gset
select assert_true( :'vip_pass' <> '', 'TEST1b vip pass not issued' );
select (select count(*) from outbox_jobs where job_type='ISSUE_QR' and payload->>'delegatePassId' = :'vip_pass') = 1 as qr_job_ok \gset
select assert_true( :'qr_job_ok' = 't', 'TEST1b ISSUE_QR job missing' );
select (select count(*) from outbox_jobs where job_type='SEND_EMAIL' and aggregate_id=:'vip_order_id'::text) = 1 as email_job_ok \gset
select assert_true( :'email_job_ok' = 't', 'TEST1b SEND_EMAIL job missing for delegate pass' );
select id as issue_job_id from claim_outbox_jobs(array['ISSUE_QR']::text[], 'smoke', 10) limit 1 \gset
insert into qr_credentials (festival_id, delegate_pass_id, key_id, entitlement_version, state, not_before, expires_at, token_digest)
values (:'fest_id'::uuid, :'vip_pass'::uuid, 'smoke-key-1', 1, 'ACTIVE', clock_timestamp(),
        (select valid_until from pass_products where id=:'vip_pass_product_id'::uuid), 'pending')
returning jti as cred_jti \gset
select complete_outbox_job(:'issue_job_id'::uuid);
select assert_true( :'cred_jti' <> '', 'TEST1b qr credential not issued' );
select (select state from outbox_jobs where id=:'issue_job_id') = 'DONE' as job_done \gset
select assert_true( :'job_done' = 't', 'TEST1b ISSUE_QR job not DONE' );
\echo 'TEST1b PASS'

\echo '=== TEST 2: record_scan valid / replay / tamper ==='
select record_scan('10000000-0000-4000-8000-000000000001'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'digest-1', 'DELEGATE', 'Buyer One') as scan_ok \gset
select record_scan('10000000-0000-4000-8000-000000000001'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'digest-1', 'DELEGATE', 'Buyer One') as scan_replay \gset
select record_scan('10000000-0000-4000-8000-000000000002'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'invalid_signature', 'bad', 'DELEGATE', 'Buyer One') as scan_tamper \gset

select (:'scan_ok'::jsonb->>'outcome') = 'accepted' as ok1 \gset
select assert_true( :'ok1' = 't', 'TEST2 scan outcome' );
select (:'scan_replay'::jsonb->>'replayed') = 'true' as ok2 \gset
select assert_true( :'ok2' = 't', 'TEST2 replay flag' );
select (select count(*) from admissions where credential_id=(select id from qr_credentials where jti=:'cred_jti'::uuid)) = 1 as ok3 \gset
select assert_true( :'ok3' = 't', 'TEST2 admission missing' );
select (:'scan_tamper'::jsonb->>'outcome') = 'invalid_signature' as ok4 \gset
select assert_true( :'ok4' = 't', 'TEST2 tamper outcome' );
select (select count(*) from scan_attempts where outcome='invalid_signature') = 1 as ok5 \gset
select assert_true( :'ok5' = 't', 'TEST2 tamper not audited' );
select (select count(*) from admissions) = 1 as ok6 \gset
select assert_true( :'ok6' = 't', 'TEST2 tamper created an admission' );
\echo 'TEST2 PASS'

\echo '=== TEST 3: cancel FULFILLED refused; EXPIRED cancel idempotent ==='
create temp table smoke_oid (id uuid);
insert into smoke_oid values (:'vip_order_id'::uuid);
do $$
declare r jsonb; v_oid uuid;
begin
  select id into v_oid from smoke_oid limit 1;
  begin
    r := cancel_order('00000000-0000-0000-0000-000000000000'::uuid, '11111111-1111-4111-8111-111111111111'::uuid);
    raise exception 'expected exception, got %', r;
  exception when others then
    if sqlstate = 'P0002' then
      -- wrong id; re-run with the real (fulfilled) order
      null;
    else
      raise;
    end if;
  end;
end $$;
do $$
declare r jsonb; v_oid uuid;
begin
  select id into v_oid from smoke_oid limit 1;
  begin
    r := cancel_order(v_oid, '11111111-1111-4111-8111-111111111111'::uuid);
    raise exception 'expected CANNOT_CANCEL_FULFILLED, got %', r;
  exception when others then
    if sqlstate <> '55000' then
      raise;
    end if;
  end;
end $$;
select (select checkout_state from orders where id=:'vip_order_id') = 'FULFILLED' as cf2 \gset
select assert_true( :'cf2' = 't', 'TEST3 FULFILLED order mutated' );
update orders set checkout_state='EXPIRED' where id=:'bp_order_id';
select cancel_order(:'bp_order_id'::uuid,'11111111-1111-4111-8111-111111111111') as cancel_x1 \gset
select cancel_order(:'bp_order_id'::uuid,'11111111-1111-4111-8111-111111111111') as cancel_x2 \gset
select (:'cancel_x1'::jsonb->>'cancelled') = 'false' and (:'cancel_x1'::jsonb->>'state') = 'EXPIRED' as x1 \gset
select assert_true( :'x1' = 't', 'TEST3 EXPIRED first cancel not idempotent' );
select (:'cancel_x2'::jsonb->>'cancelled') = 'false' and (:'cancel_x2'::jsonb->>'state') = 'EXPIRED' as x2 \gset
select assert_true( :'x2' = 't', 'TEST3 EXPIRED second cancel not idempotent' );
\echo 'TEST3 PASS'

\echo '=== TEST 4: event solo checkout reserve + cancel release exactly once, idempotent ==='
insert into categories (id, festival_id, name, slug) values
  ('aaaa1111-0000-4000-8000-000000000001', :'fest_id'::uuid, 'Music','music');
insert into venues (id, festival_id, name, short_name) values
  ('aaaa2222-0000-4000-8000-000000000002', :'fest_id'::uuid, 'Main Stage','Main Stage');
select ev.id as ev_event_id, ev.version as ev_version
from admin_upsert_event(
  null, :'fest_id'::uuid, 'solo-crescendo','Solo Crescendo',
  'desc','desc','rules','aaaa1111-0000-4000-8000-000000000001'::uuid,'aaaa2222-0000-4000-8000-000000000002'::uuid,
  '2026-09-18 10:00+05:30','2026-09-18 12:00+05:30',true,false,'INDIVIDUAL','PARTICIPANT','PARTICIPANT',
  1,1,50,50000,'Prize','2026-08-01 00:00+05:30','2026-12-31 00:00+05:30',true,1,'setup') ev \gset

select admin_publish_event(:'ev_event_id'::uuid) as published_ev \gset

select create_event_checkout(
  '11111111-1111-4111-8111-111111111111'::uuid, :'fest_id'::uuid,
  :'ev_event_id'::uuid, null,
  '00000000-0000-4000-8000-00000000aa02'::uuid, 'req-hash-2') as event_checkout \gset
select (:'event_checkout'::jsonb->>'orderId')::uuid as ev_order_id \gset

select (select held_units from event_inventory where event_id=:'ev_event_id'::uuid) = 1 as ev1 \gset
select assert_true( :'ev1' = 't', 'TEST4 reserve not 1 unit' );

select cancel_order(:'ev_order_id'::uuid,'11111111-1111-4111-8111-111111111111') as cancel_ev1 \gset
select cancel_order(:'ev_order_id'::uuid,'11111111-1111-4111-8111-111111111111') as cancel_ev2 \gset
select (:'cancel_ev1'::jsonb->>'cancelled') = 'true' as ev2 \gset
select assert_true( :'ev2' = 't', 'TEST4 first cancel failed' );
select (:'cancel_ev1'::jsonb->>'releasedHolds')::int >= 1 as ev2b \gset
select assert_true( :'ev2b' = 't', 'TEST4 first cancel released no holds' );
select (:'cancel_ev2'::jsonb->>'cancelled') = 'false' and (:'cancel_ev2'::jsonb->>'state') = 'CANCELLED' as ev3 \gset
select assert_true( :'ev3' = 't', 'TEST4 second cancel not idempotent' );
select (select held_units from event_inventory where event_id=:'ev_event_id'::uuid) = 0 as ev4 \gset
select assert_true( :'ev4' = 't', 'TEST4 capacity not returned to 0' );
select (select count(*) from capacity_holds ch join order_lines ol on ol.id = ch.order_line_id
        where ol.order_id = :'ev_order_id'::uuid and ch.state <> 'RELEASED') = 0 as ev5 \gset
select assert_true( :'ev5' = 't', 'TEST4 non-released hold remains' );
\echo 'TEST4 PASS'

\echo '===== ALL SMOKE TESTS PASSED ====='
