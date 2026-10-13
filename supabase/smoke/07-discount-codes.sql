-- 07-discount-codes.sql
-- Pass discount codes (20261013130000): the discount is computed server-side,
-- the order total carries it while the line keeps the full price, redemption
-- caps hold under live orders and free up on cancel, invalid codes never
-- create an order, and the codes table is unreachable from client roles.
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

-- Expect fn to raise an error containing p_expected.
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

select id as fest_id from festivals where slug='pulse-2026' \gset
select id as pronite_id from pass_products where slug='vip-delegate-pass' \gset
select id as basic_id from pass_products where slug='base-delegate-pass' \gset

-- Pronite Pass on sale at a known price for this suite.
update pass_products set status = 'PUBLISHED', sales_state = 'OPEN' where id = :'pronite_id'::uuid;
insert into pass_price_versions (pass_product_id, version, unit_amount_paise, currency, change_reason)
values (:'pronite_id'::uuid,
        (select coalesce(max(version), 0) + 1 from pass_price_versions where pass_product_id = :'pronite_id'::uuid),
        50000, 'INR', 'smoke 07')
returning id as price_id \gset
update pass_products set current_price_version_id = :'price_id'::uuid where id = :'pronite_id'::uuid;

insert into auth.users (id, email) values
  ('77777777-7777-4777-8777-777777777701','disc-a@example.com'),
  ('77777777-7777-4777-8777-777777777702','disc-b@example.com'),
  ('77777777-7777-4777-8777-777777777703','disc-c@example.com'),
  ('77777777-7777-4777-8777-777777777704','disc-d@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, college_name, profile_completed_at) values
  ('77777777-7777-4777-8777-777777777701','Disc A','MEM-D701','ACTIVE','+919800007701','NIT',now()),
  ('77777777-7777-4777-8777-777777777702','Disc B','MEM-D702','ACTIVE','+919800007702','NIT',now()),
  ('77777777-7777-4777-8777-777777777703','Disc C','MEM-D703','ACTIVE','+919800007703','NIT',now()),
  ('77777777-7777-4777-8777-777777777704','Disc D','MEM-D704','ACTIVE','+919800007704','NIT',now());

insert into discount_codes (festival_id, code, discount_type, amount_off_paise, percent_off, pass_product_id, max_redemptions, is_active, valid_from, valid_until) values
  (:'fest_id'::uuid, 'FLAT100',   'FLAT',    10000, null, null,               null, true,  null, null),
  (:'fest_id'::uuid, 'ONESHOT',   'PERCENT', null,  20,   :'pronite_id'::uuid, 1,    true,  null, null),
  (:'fest_id'::uuid, 'FREEPASS',  'PERCENT', null,  100,  null,               null, true,  null, null),
  (:'fest_id'::uuid, 'ALMOST',    'FLAT',    49950, null, null,               null, true,  null, null),
  (:'fest_id'::uuid, 'DISABLED',  'FLAT',    100,   null, null,               null, false, null, null),
  (:'fest_id'::uuid, 'EXPIRED1',  'FLAT',    100,   null, null,               null, true,  now() - interval '2 days', now() - interval '1 day'),
  (:'fest_id'::uuid, 'FUTURE1',   'FLAT',    100,   null, null,               null, true,  now() + interval '1 day', null),
  (:'fest_id'::uuid, 'BASICONLY', 'FLAT',    100,   null, :'basic_id'::uuid,  null, true,  null, null);

\echo '=== D1: flat code -> discounted order total, full-price line, fulfills at discounted amount ==='
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777701'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000a1'::uuid, 'd1', ' flat100 ') as checkout \gset
select (:'checkout'::jsonb->>'orderId')::uuid as d1_order \gset
select assert_true( (select amount_paise from orders where id = :'d1_order'::uuid) = 40000, 'D1 order amount not 40000' );
select assert_true( (select discount_paise from orders where id = :'d1_order'::uuid) = 10000, 'D1 discount not 10000' );
select assert_true( (select discount_code_snapshot from orders where id = :'d1_order'::uuid) = 'FLAT100', 'D1 snapshot not normalized' );
select assert_true( (select line_amount_paise from order_lines where order_id = :'d1_order'::uuid) = 50000, 'D1 line not full price' );
select attach_razorpay_order(:'d1_order'::uuid,'rzp_order_d1',40000,'INR','receipt-d1','created','{}'::jsonb) into temp d1_attach;
select apply_captured_payment('pay_d1','rzp_order_d1',40000,'INR','captured',now()) as applied \gset
select assert_true( (:'applied'::jsonb->>'result') = 'FULFILLED', 'D1 not FULFILLED: ' || :'applied' );
\echo 'D1 PASS'

\echo '=== D2: idempotency key reused with a different code -> IDEMPOTENCY_MISMATCH ==='
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777702'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000b2'::uuid, 'd2-hash-a', null) into temp d2_first;
select assert_raises(
  $q$select create_base_pass_checkout('77777777-7777-4777-8777-777777777702'::uuid,
     (select id from festivals where slug='pulse-2026'), (select id from pass_products where slug='vip-delegate-pass'),
     '77777777-7777-4777-8777-0000000000b2'::uuid, 'd2-hash-b', 'FLAT100')$q$,
  'IDEMPOTENCY_MISMATCH', 'D2 mismatch not raised');
\echo 'D2 PASS'

\echo '=== D3: max_redemptions=1 holds under a live order and frees on cancel ==='
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777702'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000b3'::uuid, 'd3-b', 'ONESHOT') as checkout \gset
select (:'checkout'::jsonb->>'orderId')::uuid as d3_order \gset
select assert_true( (select amount_paise from orders where id = :'d3_order'::uuid) = 40000, 'D3 20% off not 40000' );
select assert_raises(
  $q$select create_base_pass_checkout('77777777-7777-4777-8777-777777777703'::uuid,
     (select id from festivals where slug='pulse-2026'), (select id from pass_products where slug='vip-delegate-pass'),
     '77777777-7777-4777-8777-0000000000c1'::uuid, 'd3-c', 'ONESHOT')$q$,
  'DISCOUNT_EXHAUSTED', 'D3 cap not enforced');
select assert_true( (select count(*) from orders where purchaser_user_id = '77777777-7777-4777-8777-777777777703') = 0,
  'D3 rejected checkout left an order behind' );
-- Same user retrying with a fresh key: the abandoned order is cancelled first,
-- so their own live order does not block them.
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777702'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000b4'::uuid, 'd3-b-retry', 'ONESHOT') as checkout \gset
select (:'checkout'::jsonb->>'orderId')::uuid as d3_retry \gset
select assert_true( (select checkout_state from orders where id = :'d3_order'::uuid) = 'CANCELLED', 'D3 prior order not cancelled' );
update orders set checkout_state = 'CANCELLED' where id = :'d3_retry'::uuid;
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777703'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000c2'::uuid, 'd3-c2', 'ONESHOT') into temp d3_c_ok;
\echo 'D3 PASS'

\echo '=== D4: per-user limit -> preview reports DISCOUNT_ALREADY_USED ==='
select assert_raises(
  $q$select preview_pass_discount('77777777-7777-4777-8777-777777777703'::uuid,
     (select id from festivals where slug='pulse-2026'), (select id from pass_products where slug='vip-delegate-pass'), 'ONESHOT')$q$,
  'DISCOUNT_ALREADY_USED', 'D4 limit not enforced in preview');
select preview_pass_discount('77777777-7777-4777-8777-777777777704'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid, 'flat100') as pv \gset
select assert_true( (:'pv'::jsonb->>'finalAmountPaise')::bigint = 40000
  and (:'pv'::jsonb->>'originalAmountPaise')::bigint = 50000, 'D4 preview quote wrong: ' || :'pv' );
\echo 'D4 PASS'

\echo '=== D5: invalid codes rejected, no order created ==='
select assert_raises(format($q$select create_base_pass_checkout('77777777-7777-4777-8777-777777777704'::uuid,
     (select id from festivals where slug='pulse-2026'), (select id from pass_products where slug='vip-delegate-pass'),
     gen_random_uuid(), 'd5', %L)$q$, c), 'DISCOUNT_INVALID', 'D5 code accepted: ' || c)
from unnest(array['NOPE1234', 'DISABLED', 'EXPIRED1', 'FUTURE1', 'BASICONLY', 'x', 'BAD CODE!']) c;
select assert_true( (select count(*) from orders where purchaser_user_id = '77777777-7777-4777-8777-777777777704') = 0,
  'D5 invalid code left an order behind' );
\echo 'D5 PASS'

\echo '=== D6: partial discount never below Rs 1; full discount -> free ==='
select preview_pass_discount('77777777-7777-4777-8777-777777777704'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid, 'ALMOST') as pv \gset
select assert_true( (:'pv'::jsonb->>'finalAmountPaise')::bigint = 100
  and (:'pv'::jsonb->>'discountPaise')::bigint = 49900, 'D6 min-amount clamp wrong: ' || :'pv' );
select create_base_pass_checkout(
  '77777777-7777-4777-8777-777777777704'::uuid, :'fest_id'::uuid, :'pronite_id'::uuid,
  '77777777-7777-4777-8777-0000000000d1'::uuid, 'd6', 'FREEPASS') as checkout \gset
select assert_true( (select amount_paise = 0 and discount_paise = 50000 from orders
  where id = (:'checkout'::jsonb->>'orderId')::uuid), 'D6 free order wrong' );
\echo 'D6 PASS'

\echo '=== D7: order total invariant still enforced ==='
do $$
declare v_order uuid;
begin
  insert into orders (festival_id, purchaser_user_id, kind, idempotency_key, request_hash, amount_paise,
                      discount_code_id, discount_paise, discount_code_snapshot)
  values ((select id from festivals where slug='pulse-2026'), '77777777-7777-4777-8777-777777777701', 'BASE_PASS',
          gen_random_uuid(), 'd7', 45000,
          (select id from discount_codes where code = 'FLAT100'), 10000, 'FLAT100')
  returning id into v_order;
  insert into order_lines (order_id, line_kind, pass_product_id, unit_amount_paise, line_amount_paise)
  values (v_order, 'PASS', (select id from pass_products where slug='vip-delegate-pass'), 50000, 50000);
  set constraints all immediate;
  raise exception 'ASSERT FAIL: D7 mismatched total accepted';
exception when others then
  if SQLERRM not like '%ORDER_TOTAL_MISMATCH%' then raise; end if;
end $$;
\echo 'D7 PASS'

\echo '=== D8: client roles cannot read codes or call discount functions ==='
set role authenticated;
select assert_raises($q$select count(*) from discount_codes$q$, 'permission denied', 'D8 authenticated read codes');
select assert_raises(format($q$select preview_pass_discount(%L::uuid, %L::uuid, %L::uuid, 'FLAT100')$q$,
  '77777777-7777-4777-8777-777777777704', :'fest_id', :'pronite_id'), 'permission denied', 'D8 authenticated preview');
reset role;
set role anon;
select assert_raises($q$select count(*) from discount_codes$q$, 'permission denied', 'D8 anon read codes');
reset role;
\echo 'D8 PASS'

\echo '===== 07 DISCOUNT CODES: ALL PASS ====='
