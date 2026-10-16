-- 09-checkout-replay.sql
-- Idempotent replay of a dead order (20261016120000): retrying a checkout with
-- the same Idempotency-Key after its order expired or was cancelled returns
-- that same order (so the browser can start over with a fresh key) instead of
-- failing on the unique key with a 409. A fresh key then opens a new order.
-- Requires: bootstrap + all migrations + seed.sql. Self-contained.

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

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

select id as fest_id from festivals where slug='tarang-2026' \gset
select id as pronite_id from pass_products where slug='vip-delegate-pass' \gset
update festivals set starts_at = now() - interval '1 day', ends_at = now() + interval '30 days'
where id = :'fest_id'::uuid;
update pass_products set status = 'PUBLISHED', sales_state = 'OPEN',
  valid_from = now() - interval '30 days', valid_until = now() + interval '30 days'
where id = :'pronite_id'::uuid;

insert into auth.users (id, email) values
  ('90900000-0000-4000-8000-000000000001','replay-a@example.com'),
  ('90900000-0000-4000-8000-000000000009','replay-admin@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, college_name, profile_completed_at) values
  ('90900000-0000-4000-8000-000000000001','Replay A','MEM-9091','ACTIVE','+919800090901','NIT',now());
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_id'::uuid, 'Replay Superadmin', false, true) returning id as role_id \gset
insert into staff_assignments (festival_id, user_id, role_id, status, activated_at)
values (:'fest_id'::uuid, '90900000-0000-4000-8000-000000000009', :'role_id'::uuid, 'ACTIVE', now());

\echo '=== P1: pass checkout replayed after the hold expired ==='
select create_base_pass_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'pronite_id'::uuid,
  '90900000-0000-4000-8000-0000000000a1', 'h-pass') as first \gset
update orders set checkout_state = 'EXPIRED' where id = (:'first'::jsonb->>'orderId')::uuid;
select create_base_pass_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'pronite_id'::uuid,
  '90900000-0000-4000-8000-0000000000a1', 'h-pass') as replay \gset
select assert_true( (:'replay'::jsonb->>'replayed') = 'true', 'P1 replay not flagged: ' || :'replay' );
select assert_true( (:'replay'::jsonb->>'orderId') = (:'first'::jsonb->>'orderId'), 'P1 replay returned another order' );
select create_base_pass_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'pronite_id'::uuid,
  '90900000-0000-4000-8000-0000000000a2', 'h-pass') as fresh \gset
select assert_true( (:'fresh'::jsonb->>'replayed') = 'false'
  and (:'fresh'::jsonb->>'orderId') <> (:'first'::jsonb->>'orderId'), 'P1 fresh key did not open a new order' );
\echo 'P1 PASS'

\echo '=== P2: event checkout replayed after the order was cancelled ==='
select set_config('request.jwt.claim.sub', '90900000-0000-4000-8000-000000000009', false);
insert into categories (id, festival_id, name, slug) values
  ('90900000-0000-4000-8000-0000000000c1', :'fest_id'::uuid, 'Replay Cat','replay-cat');
insert into venues (id, festival_id, name, short_name) values
  ('90900000-0000-4000-8000-0000000000c2', :'fest_id'::uuid, 'Replay Hall','Replay Hall');
select ev.id as ev_id
from admin_upsert_event(
  null, :'fest_id'::uuid, 'replay-solo','Replay Solo',
  'desc','desc','rules','90900000-0000-4000-8000-0000000000c1'::uuid,'90900000-0000-4000-8000-0000000000c2'::uuid,
  now() + interval '2 days', now() + interval '2 days 2 hours', true, false, 'INDIVIDUAL','PARTICIPANT','PARTICIPANT',
  1, 1, 10, 20000, 'Prize', now() - interval '1 day', now() + interval '10 days', true, 1, 'setup') ev \gset
select admin_publish_event(:'ev_id'::uuid) as published \gset
select set_config('request.jwt.claim.sub', '', false);

select create_event_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'ev_id'::uuid, null,
  '90900000-0000-4000-8000-0000000000e1', 'h-ev') as ev_first \gset
select cancel_order((:'ev_first'::jsonb->>'orderId')::uuid, '90900000-0000-4000-8000-000000000001') as cancelled \gset
select create_event_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'ev_id'::uuid, null,
  '90900000-0000-4000-8000-0000000000e1', 'h-ev') as ev_replay \gset
select assert_true( (:'ev_replay'::jsonb->>'replayed') = 'true'
  and (:'ev_replay'::jsonb->>'orderId') = (:'ev_first'::jsonb->>'orderId'), 'P2 event replay: ' || :'ev_replay' );
select create_event_checkout('90900000-0000-4000-8000-000000000001', :'fest_id'::uuid, :'ev_id'::uuid, null,
  '90900000-0000-4000-8000-0000000000e2', 'h-ev') as ev_fresh \gset
-- A new event order carries no `replayed` flag; compare ids instead.
select assert_true( coalesce(:'ev_fresh'::jsonb->>'replayed', 'false') = 'false'
  and (:'ev_fresh'::jsonb->>'orderId') <> (:'ev_first'::jsonb->>'orderId'), 'P2 fresh key did not open a new event order' );
\echo 'P2 PASS'

\echo '===== 09 CHECKOUT REPLAY: ALL PASS ====='
