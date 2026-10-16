-- 08-refund-order.sql
-- Admin refunds + gate lookup (20261015120000): refund_order succeeds on a real database,
-- refunds only orders that took money, revokes passes + QR, gives event
-- capacity and the participant claim back, marks the payment, audits the
-- acting admin, is idempotent, and is unreachable from client roles.
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

create or replace function assert_raises(p_sql text, p_expected text, p_msg text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ASSERT FAIL: % (no error raised)', p_msg;
exception when others then
  if SQLERRM like 'ASSERT FAIL%' then raise; end if;
  if SQLERRM not like '%' || p_expected || '%' then
    raise exception 'ASSERT FAIL: % (got: %)', p_msg, SQLERRM;
  end if;
  return true;
end $$;

-- auth.uid() reads the JWT subject, as in suites 01/03.
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
select coalesce((select unit_amount_paise from pass_price_versions
  where id = (select current_price_version_id from pass_products where id = :'pronite_id'::uuid)), 0) as pass_price \gset

insert into auth.users (id, email) values
  ('88888888-8888-4888-8888-888888888801','refund-a@example.com'),
  ('88888888-8888-4888-8888-888888888802','refund-b@example.com'),
  ('88888888-8888-4888-8888-888888888809','refund-admin@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, college_name, profile_completed_at) values
  ('88888888-8888-4888-8888-888888888801','Refund A','MEM-R801','ACTIVE','+919800008801','NIT',now()),
  ('88888888-8888-4888-8888-888888888802','Refund B','MEM-R802','ACTIVE','+919800008802','NIT',now());
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_id'::uuid, 'Refund Superadmin', false, true) returning id as role_id \gset
insert into staff_assignments (festival_id, user_id, role_id, status, activated_at)
values (:'fest_id'::uuid, '88888888-8888-4888-8888-888888888809', :'role_id'::uuid, 'ACTIVE', now());

-- A: paid Pronite Pass + QR credential.
select create_base_pass_checkout(
  '88888888-8888-4888-8888-888888888801'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '88888888-0000-4000-8000-0000000000a1'::uuid, 'r-a') as co \gset
select (:'co'::jsonb->>'orderId')::uuid as pass_order \gset
select amount_paise as pass_amount from orders where id = :'pass_order'::uuid \gset
select attach_razorpay_order(:'pass_order'::uuid,'rzp_r_a',:'pass_amount'::bigint,'INR','rcpt-r-a','created','{}'::jsonb) into temp r_a;
select apply_captured_payment('pay_r_a','rzp_r_a',:'pass_amount'::bigint,'INR','captured',now()) as applied \gset
select assert_true( (:'applied'::jsonb->>'result') = 'FULFILLED', 'setup: pass order not FULFILLED: ' || :'applied' );
select id as pass_id from delegate_passes
where user_id = '88888888-8888-4888-8888-888888888801' and pass_product_id = :'pronite_id'::uuid \gset
insert into qr_credentials (festival_id, delegate_pass_id, key_id, entitlement_version, state, not_before, expires_at, token_digest)
values (:'fest_id'::uuid, :'pass_id'::uuid, 'r-key', 1, 'ACTIVE', clock_timestamp(), now() + interval '30 days', 'd')
returning jti as cred_jti \gset

-- Paid solo event registration for the same user.
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888809', false);
insert into categories (id, festival_id, name, slug) values
  ('88880000-0000-4000-8000-0000000000c1', :'fest_id'::uuid, 'Refund Cat','refund-cat');
insert into venues (id, festival_id, name, short_name) values
  ('88880000-0000-4000-8000-0000000000c2', :'fest_id'::uuid, 'Refund Hall','Refund Hall');
select ev.id as ev_id
from admin_upsert_event(
  null, :'fest_id'::uuid, 'refund-solo','Refund Solo',
  'desc','desc','rules','88880000-0000-4000-8000-0000000000c1'::uuid,'88880000-0000-4000-8000-0000000000c2'::uuid,
  now() + interval '2 days', now() + interval '2 days 2 hours', true, false, 'INDIVIDUAL','PARTICIPANT','PARTICIPANT',
  1, 1, 10, 20000, 'Prize', now() - interval '1 day', now() + interval '10 days', true, 1, 'setup') ev \gset
select admin_publish_event(:'ev_id'::uuid) as published \gset
select set_config('request.jwt.claim.sub', '', false);

select create_event_checkout(
  '88888888-8888-4888-8888-888888888801'::uuid, :'fest_id'::uuid, :'ev_id'::uuid, null,
  '88888888-0000-4000-8000-0000000000e1'::uuid, 'r-ev') as evco \gset
select (:'evco'::jsonb->>'orderId')::uuid as ev_order \gset
select attach_razorpay_order(:'ev_order'::uuid,'rzp_r_ev',20000,'INR','rcpt-r-ev','created','{}'::jsonb) into temp r_ev;
select apply_captured_payment('pay_r_ev','rzp_r_ev',20000,'INR','captured',now()) as ev_applied \gset
select assert_true( (:'ev_applied'::jsonb->>'result') = 'FULFILLED', 'setup: event order not FULFILLED: ' || :'ev_applied' );
select assert_true( (select confirmed_units from event_inventory where event_id = :'ev_id'::uuid) = 1, 'setup: confirmed_units not 1' );

\echo '=== R1: unpaid order is not refundable, unknown order is NOT_FOUND ==='
select create_base_pass_checkout(
  '88888888-8888-4888-8888-888888888802'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '88888888-0000-4000-8000-0000000000b1'::uuid, 'r-b') as co_b \gset
select assert_raises(
  format('select refund_order(%L::uuid, %L::uuid)', :'co_b'::jsonb->>'orderId', '88888888-8888-4888-8888-888888888809'),
  'NOT_REFUNDABLE', 'R1 unpaid order refunded');
select assert_true(
  (select checkout_state::text from orders where id = (:'co_b'::jsonb->>'orderId')::uuid) <> 'REFUNDED',
  'R1 unpaid order state changed');
select assert_raises(
  'select refund_order(''00000000-0000-4000-8000-0000000000ff''::uuid, null)', 'NOT_FOUND', 'R1 missing order');
\echo 'R1 PASS'

\echo '=== R2: event refund releases capacity and the participant claim ==='
select refund_order(:'ev_order'::uuid, '88888888-8888-4888-8888-888888888809'::uuid, 'smoke') as ev_refund \gset
select assert_true( (:'ev_refund'::jsonb->>'refunded') = 'true', 'R2 not refunded: ' || :'ev_refund' );
select assert_true( (:'ev_refund'::jsonb->>'registrationsRefunded')::int = 1, 'R2 registration count' );
select assert_true( (select checkout_state::text from orders where id = :'ev_order'::uuid) = 'REFUNDED', 'R2 order state' );
select assert_true(
  (select state::text from registrations r join order_lines ol on ol.id = r.order_line_id where ol.order_id = :'ev_order'::uuid) = 'REFUNDED',
  'R2 registration state');
select assert_true( (select confirmed_units from event_inventory where event_id = :'ev_id'::uuid) = 0, 'R2 confirmed_units not released' );
select assert_true(
  (select count(*) from event_participant_claims where event_id = :'ev_id'::uuid and state in ('HELD','CONFIRMED')) = 0,
  'R2 claim still live');
select assert_true(
  (select disposition::text from payments where razorpay_payment_id = 'pay_r_ev') = 'REFUNDED'
  and (select refunded_paise from payments where razorpay_payment_id = 'pay_r_ev') = 20000,
  'R2 payment not marked refunded');
select assert_true(
  (select actor_user_id from audit_logs where action = 'order.refund' and target_id = :'ev_order') = '88888888-8888-4888-8888-888888888809'::uuid,
  'R2 audit actor missing');
-- The freed claim lets the participant register again.
select create_event_checkout(
  '88888888-8888-4888-8888-888888888801'::uuid, :'fest_id'::uuid, :'ev_id'::uuid, null,
  '88888888-0000-4000-8000-0000000000e2'::uuid, 'r-ev-2') as evco2 \gset
select assert_true( (:'evco2'::jsonb->>'orderId') is not null, 'R2 re-registration blocked' );
\echo 'R2 PASS'

\echo '=== R3: pass refund revokes the pass and its QR; refund is idempotent ==='
select refund_order(:'pass_order'::uuid, '88888888-8888-4888-8888-888888888809'::uuid) as pass_refund \gset
select assert_true( (:'pass_refund'::jsonb->>'passesRefunded')::int = 1, 'R3 pass count' );
select assert_true( (select state::text from delegate_passes where id = :'pass_id'::uuid) = 'REFUNDED', 'R3 pass state' );
select assert_true( (select state::text from qr_credentials where jti = :'cred_jti'::uuid) = 'REVOKED', 'R3 QR not revoked' );
select refund_order(:'pass_order'::uuid, '88888888-8888-4888-8888-888888888809'::uuid) as again \gset
select assert_true( (:'again'::jsonb->>'alreadyRefunded') = 'true', 'R3 second refund not idempotent' );
select assert_true(
  (select count(*) from audit_logs where action = 'order.refund' and target_id = :'pass_order') = 1,
  'R3 idempotent refund wrote a second audit row');
\echo 'R3 PASS'

\echo '=== R4: client roles cannot call money/scan RPCs; non-staff cannot write audits ==='
select assert_true( not has_function_privilege('anon', 'refund_order(uuid, uuid, text)', 'execute'), 'R4 anon refund_order' );
select assert_true( not has_function_privilege('authenticated', 'refund_order(uuid, uuid, text)', 'execute'), 'R4 authd refund_order' );
select assert_true( not has_function_privilege('authenticated', 'cancel_order(uuid, uuid)', 'execute'), 'R4 authd cancel_order' );
select assert_true(
  not has_function_privilege('anon', 'record_scan(uuid, uuid, uuid, uuid, uuid, timestamptz, boolean, text, text, text, text, boolean, text)', 'execute'),
  'R4 anon record_scan');
select assert_true(
  not has_function_privilege('authenticated', 'create_merchandise_checkout(uuid, uuid, uuid, text, integer, text, text, text, text, jsonb, uuid, text)', 'execute'),
  'R4 authd create_merchandise_checkout');
select assert_true( not has_table_privilege('authenticated', 'profiles', 'update'), 'R4 authd can update profiles' );
select count(*) as audits_before from audit_logs \gset
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888802', false);
select write_audit('forged.action', 'orders', 'x');
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888809', false);
select write_audit('staff.action', 'orders', 'y');
select set_config('request.jwt.claim.sub', '', false);
select assert_true( (select count(*) from audit_logs where action = 'forged.action') = 0, 'R4 non-staff audit written' );
select assert_true( (select count(*) from audit_logs where action = 'staff.action') = 1, 'R4 staff audit not written' );
\echo 'R4 PASS'

\echo '=== R5: gate lookup matches whole codes only ==='
select public_pass_code as code_b from delegate_passes dp
join pass_products pp on pp.id = dp.pass_product_id
where dp.state = 'ACTIVE' limit 1 \gset
select assert_true( (verify_gate_pass_lookup(:'code_b')->>'found') = 'true', 'R5 exact code not found' );
select assert_true( (verify_gate_pass_lookup(lower(:'code_b'))->>'found') = 'true', 'R5 lowercase code not found' );
select assert_true( (verify_gate_pass_lookup(substr(:'code_b', 4))->>'found') = 'true', 'R5 code without PP- not found' );
select assert_true( (verify_gate_pass_lookup(left(:'code_b', 6))->>'found') = 'false', 'R5 prefix matched a pass' );
select assert_true( (verify_gate_pass_lookup('PP-')->>'found') = 'false', 'R5 bare prefix matched a pass' );
select assert_true( (verify_gate_pass_lookup('%')->>'found') = 'false', 'R5 wildcard matched a pass' );
select assert_true( (verify_gate_pass_lookup('refund-a@example.com')->>'found') = 'true', 'R5 exact email not found' );
select assert_true( (verify_gate_pass_lookup('refund-a@example')->>'found') = 'false', 'R5 partial email matched' );
select assert_true( not has_function_privilege('authenticated', 'verify_gate_pass_lookup(text)', 'execute'), 'R5 authd lookup' );
\echo 'R5 PASS'

\echo '===== 08 REFUND ORDER: ALL PASS ====='
