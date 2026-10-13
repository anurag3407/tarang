-- 06-pronite-launch.sql
-- Single-pass launch (20261013120000): the retired Basic Card cannot be sold,
-- a Pronite Pass purchase enqueues email + QR + Sheets jobs, and a pass can
-- hold at most one ACTIVE QR credential while still allowing reissue.
-- Requires: bootstrap + all migrations + seed.sql. Self-contained: runs after
-- suites 01-05 (it re-closes the Basic Card they re-open) or on a fresh DB.

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
select id as basic_id from pass_products where slug='base-delegate-pass' \gset
select id as pronite_id from pass_products where slug='vip-delegate-pass' \gset
select id as gate_id from gates where name='Main Gate' \gset

-- State the launch migration establishes (suites 01/02 re-open the Basic Card).
update pass_products set status = 'ARCHIVED', sales_state = 'CLOSED' where slug = 'base-delegate-pass';
-- Keep the pass valid relative to now, so this suite does not date-expire.
update festivals set starts_at = now() - interval '1 day', ends_at = now() + interval '30 days'
where slug = 'pulse-2026';
update pass_products set valid_from = now() - interval '30 days', valid_until = now() + interval '30 days'
where slug = 'vip-delegate-pass';

insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-666666666601','pronite-buyer@example.com'),
  ('66666666-6666-4666-8666-666666666602','pronite-op@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, college_name, profile_completed_at) values
  ('66666666-6666-4666-8666-666666666601','Pronite Buyer','MEM-P601','ACTIVE','+919800006601','NIT',now());
insert into scanner_devices (id, public_device_id, name, credential_hash, state) values
  ('66666666-6666-4666-8666-6666666666d1','dev-p6','Scanner P6','hash-p6','ACTIVE');
insert into gate_assignments (device_id, gate_id, operator_user_id, valid_from, valid_until)
values ('66666666-6666-4666-8666-6666666666d1'::uuid, :'gate_id'::uuid,
        '66666666-6666-4666-8666-666666666602'::uuid, now(), now() + interval '1 day');

\echo '=== P1: retired Basic Card cannot be purchased ==='
do $$
begin
  perform create_base_pass_checkout(
    '66666666-6666-4666-8666-666666666601'::uuid,
    (select id from festivals where slug='pulse-2026'),
    (select id from pass_products where slug='base-delegate-pass'),
    '66666666-6666-4666-8666-0000000000b1'::uuid, 'p6-basic');
  raise exception 'ASSERT FAIL: P1 retired Basic Card checkout succeeded';
exception when others then
  if SQLERRM not like '%SALES_CLOSED%' then raise; end if;
end $$;
\echo 'P1 PASS'

\echo '=== P2: Pronite Pass purchase -> FULFILLED + SEND_EMAIL + ISSUE_QR + SHEETS_SYNC ==='
select create_base_pass_checkout(
  '66666666-6666-4666-8666-666666666601'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '66666666-6666-4666-8666-0000000000b2'::uuid, 'p6-pronite') as checkout \gset
select (:'checkout'::jsonb->>'orderId')::uuid as order_id \gset
select amount_paise as amount from orders where id = :'order_id' \gset
select attach_razorpay_order(:'order_id'::uuid,'rzp_order_p6',:'amount'::bigint,'INR','receipt-p6','created','{}'::jsonb) into temp p6_attach;
select apply_captured_payment('pay_p6','rzp_order_p6',:'amount'::bigint,'INR','captured',now()) as applied \gset
select assert_true( (:'applied'::jsonb->>'result') = 'FULFILLED', 'P2 order not FULFILLED' );

select id as pass_id from delegate_passes where source_order_line_id =
  (select id from order_lines where order_id = :'order_id') \gset
select assert_true( (select count(*) from outbox_jobs where job_type='SEND_EMAIL' and aggregate_id=:'order_id'::text) = 1,
  'P2 SEND_EMAIL job missing' );
select assert_true( (select count(*) from outbox_jobs where job_type='ISSUE_QR' and aggregate_id=:'pass_id'::text) = 1,
  'P2 ISSUE_QR job missing' );
select assert_true( (select count(*) from outbox_jobs where job_type='SHEETS_SYNC' and logical_key='sheets:order:'||:'order_id') = 1,
  'P2 SHEETS_SYNC job missing' );
select assert_true( (select count(*) from outbox_jobs where job_type='INVALIDATE_CACHE' and logical_key='cache:order:'||:'order_id') = 1,
  'P2 INVALIDATE_CACHE job missing' );
\echo 'P2 PASS'

\echo '=== P3: one ACTIVE credential per pass; reissue allowed ==='
insert into qr_credentials (festival_id, delegate_pass_id, key_id, state, expires_at, token_digest)
values (:'fest_id'::uuid, :'pass_id'::uuid, 'k1', 'ACTIVE', now() + interval '30 days', 'pending')
returning jti as jti1 \gset
do $$
begin
  insert into qr_credentials (festival_id, delegate_pass_id, key_id, state, expires_at, token_digest)
  select festival_id, delegate_pass_id, 'k1', 'ACTIVE', now() + interval '30 days', 'pending'
  from qr_credentials where state = 'ACTIVE'
    and delegate_pass_id = (select dp.id from delegate_passes dp
                            join order_lines ol on ol.id = dp.source_order_line_id
                            join razorpay_orders ro on ro.local_order_id = ol.order_id
                            where ro.razorpay_order_id = 'rzp_order_p6');
  raise exception 'ASSERT FAIL: P3 second ACTIVE credential accepted';
exception when unique_violation then
  null;
end $$;
-- Reissue: retire the old credential, then a new ACTIVE one is allowed.
update qr_credentials set state = 'REPLACED', revoked_at = now() where jti = :'jti1'::uuid;
insert into qr_credentials (festival_id, delegate_pass_id, key_id, entitlement_version, state, expires_at, token_digest)
values (:'fest_id'::uuid, :'pass_id'::uuid, 'k1', 2, 'ACTIVE', now() + interval '30 days', 'pending')
returning jti as jti2 \gset
select assert_true( (select count(*) from qr_credentials where delegate_pass_id = :'pass_id'::uuid) = 2,
  'P3 reissue did not keep both credential rows' );
\echo 'P3 PASS'

\echo '=== P4: reissued credential admits at the gate; replaced one does not ==='
select record_scan('66666666-6666-4666-8666-0000000000c1'::uuid, :'jti2'::uuid, :'gate_id'::uuid,
  '66666666-6666-4666-8666-6666666666d1'::uuid, '66666666-6666-4666-8666-666666666602'::uuid,
  now(), false, 'valid', 'digest-p6', 'BASE', 'P******r') as scan_new \gset
select assert_true( (:'scan_new'::jsonb->>'outcome') = 'accepted', 'P4 reissued credential not accepted: ' || :'scan_new' );
select record_scan('66666666-6666-4666-8666-0000000000c2'::uuid, :'jti1'::uuid, :'gate_id'::uuid,
  '66666666-6666-4666-8666-6666666666d1'::uuid, '66666666-6666-4666-8666-666666666602'::uuid,
  now(), false, 'valid', 'digest-p6-old', 'BASE', 'P******r') as scan_old \gset
select assert_true( (:'scan_old'::jsonb->>'outcome') <> 'accepted', 'P4 replaced credential still admitted' );
\echo 'P4 PASS'

\echo '===== 06 PRONITE LAUNCH: ALL PASS ====='
