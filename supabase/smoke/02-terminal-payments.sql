-- 02-terminal-payments.sql
-- terminal-state payment policy: late captures, refund dispositions, provider-cancel outbox.
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
-- These suites exercise the two-tier (Basic -> VIP) RPC paths. The Basic Card
-- is retired (archived by 20261013120000), so re-open it in this throwaway DB.
update pass_products set status = 'PUBLISHED', sales_state = 'OPEN' where slug = 'base-delegate-pass';
select id as base_pass_id from pass_products where slug='base-delegate-pass' \gset

\echo '=== V09A: late capture on user-cancelled order -> REFUND_REQUIRED + provider-cancel job ==='
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a','v09a@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('a0000000-0000-4000-8000-00000000000a','V09 A','MEM-009A','ACTIVE','+919800000091',now());
select create_base_pass_checkout(
  'a0000000-0000-4000-8000-00000000000a'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0a'::uuid, 'req-hash-v09a') as v09a_checkout \gset
select (:'v09a_checkout'::jsonb->>'orderId')::uuid as v09a_order \gset
select attach_razorpay_order(:'v09a_order'::uuid,'rzp_order_v09a',20000,'INR','receipt-v09a','created','{}'::jsonb) into temp at_v09a;
select (select count(*) from outbox_jobs
  where job_type='CANCEL_RAZORPAY_ORDER' and payload->>'razorpayOrderId'='rzp_order_v09a') = 0 as v09a_job0 \gset
select assert_true( :'v09a_job0' = 't', 'V09A premature cancel job' );
select cancel_order(:'v09a_order'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid) as v09a_cancel \gset
select (select checkout_state from orders where id=:'v09a_order') = 'CANCELLED' as v09a_cancelled \gset
select assert_true( :'v09a_cancelled' = 't', 'V09A order not CANCELLED' );
select (select count(*) from outbox_jobs
  where job_type='CANCEL_RAZORPAY_ORDER' and logical_key='rzp-cancel:rzp_order_v09a') = 1 as v09a_job \gset
select assert_true( :'v09a_job' = 't', 'V09A CANCEL_RAZORPAY_ORDER job missing' );
select apply_captured_payment('pay_v09a','rzp_order_v09a',20000,'INR','captured',now()) as v09a_apply \gset
select assert_true( (:'v09a_apply'::jsonb->>'result') = 'REFUND_REQUIRED', 'V09A not REFUND_REQUIRED' );
select assert_true( (:'v09a_apply'::jsonb->>'reason') = 'order_cancelled', 'V09A wrong reason' );
select (select disposition from payments where razorpay_payment_id='pay_v09a') = 'REFUND_REQUIRED' as v09a_disp \gset
select assert_true( :'v09a_disp' = 't', 'V09A payment not flagged REFUND_REQUIRED' );
select (select checkout_state from orders where id=:'v09a_order') = 'CANCELLED' as v09a_still \gset
select assert_true( :'v09a_still' = 't', 'V09A order state changed by late capture' );
select (select count(*) from delegate_passes where user_id='a0000000-0000-4000-8000-00000000000a') = 0 as v09a_nopass \gset
select assert_true( :'v09a_nopass' = 't', 'V09A pass issued on cancelled order' );

\echo '=== V09B: second capture on fulfilled order -> ALREADY_APPLIED + REFUND_REQUIRED ==='
insert into auth.users (id, email) values ('b0000000-0000-4000-8000-00000000000b','v09b@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('b0000000-0000-4000-8000-00000000000b','V09 B','MEM-009B','ACTIVE','+919800000092',now());
select create_base_pass_checkout(
  'b0000000-0000-4000-8000-00000000000b'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0b'::uuid, 'req-hash-v09b') as v09b_checkout \gset
select (:'v09b_checkout'::jsonb->>'orderId')::uuid as v09b_order \gset
select attach_razorpay_order(:'v09b_order'::uuid,'rzp_order_v09b',20000,'INR','receipt-v09b','created','{}'::jsonb) into temp at_v09b;
select apply_captured_payment('pay_v09b1','rzp_order_v09b',20000,'INR','captured',now()) as v09b_apply1 \gset
select assert_true( (:'v09b_apply1'::jsonb->>'result') = 'FULFILLED', 'V09B first capture not FULFILLED' );
select apply_captured_payment('pay_v09b2','rzp_order_v09b',20000,'INR','captured',now()) as v09b_apply2 \gset
select assert_true( (:'v09b_apply2'::jsonb->>'result') = 'ALREADY_APPLIED', 'V09B second capture not ALREADY_APPLIED' );
select (select disposition from payments where razorpay_payment_id='pay_v09b2') = 'REFUND_REQUIRED' as v09b_disp \gset
select assert_true( :'v09b_disp' = 't', 'V09B second payment not flagged REFUND_REQUIRED' );
select (select count(*) from outbox_jobs
  where payload->>'razorpayOrderId'='rzp_order_v09b') = 0 as v09b_nojob \gset
select assert_true( :'v09b_nojob' = 't', 'V09B FULFILLED order emitted cancel job' );

\echo '=== V09C: late capture on reaper-EXPIRED order -> REFUND_REQUIRED + job ==='
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-00000000000c','v09c@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('c0000000-0000-4000-8000-00000000000c','V09 C','MEM-009C','ACTIVE','+919800000093',now());
select create_base_pass_checkout(
  'c0000000-0000-4000-8000-00000000000c'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0c'::uuid, 'req-hash-v09c') as v09c_checkout \gset
select (:'v09c_checkout'::jsonb->>'orderId')::uuid as v09c_order \gset
select attach_razorpay_order(:'v09c_order'::uuid,'rzp_order_v09c',20000,'INR','receipt-v09c','created','{}'::jsonb) into temp at_v09c;
update orders set checkout_state='EXPIRED' where id=:'v09c_order';
select (select count(*) from outbox_jobs
  where logical_key='rzp-cancel:rzp_order_v09c') = 1 as v09c_job \gset
select assert_true( :'v09c_job' = 't', 'V09C EXPIRED order missed cancel job' );
select apply_captured_payment('pay_v09c','rzp_order_v09c',20000,'INR','captured',now()) as v09c_apply \gset
select assert_true( (:'v09c_apply'::jsonb->>'result') = 'REFUND_REQUIRED', 'V09C not REFUND_REQUIRED' );
select assert_true( (:'v09c_apply'::jsonb->>'reason') = 'order_expired', 'V09C wrong reason' );

\echo '=== V09D: capture stacking on PAYMENT_REVIEW order is refused ==='
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000d','v09d@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('d0000000-0000-4000-8000-00000000000d','V09 D','MEM-009D','ACTIVE','+919800000094',now());
select id as vip_pass_product_id from pass_products where slug='vip-delegate-pass' \gset
select create_base_pass_checkout(
  'd0000000-0000-4000-8000-00000000000d'::uuid, :'fest_id'::uuid, :'vip_pass_product_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0d'::uuid, 'req-hash-v09d-1') as v09d_c1 \gset
select (:'v09d_c1'::jsonb->>'orderId')::uuid as v09d_o1 \gset
select attach_razorpay_order(:'v09d_o1'::uuid,'rzp_order_v09d1',200000,'INR','receipt-v09d1','created','{}'::jsonb) into temp at_v09d1;
select apply_captured_payment('pay_v09d1','rzp_order_v09d1',200000,'INR','captured',now()) as v09d_a1 \gset
select assert_true( (:'v09d_a1'::jsonb->>'result') = 'FULFILLED', 'V09D seed VIP not FULFILLED' );
select create_base_pass_checkout(
  'd0000000-0000-4000-8000-00000000000d'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0e'::uuid, 'req-hash-v09d-2') as v09d_c2 \gset
select (:'v09d_c2'::jsonb->>'orderId')::uuid as v09d_o2 \gset
select attach_razorpay_order(:'v09d_o2'::uuid,'rzp_order_v09d2',20000,'INR','receipt-v09d2','created','{}'::jsonb) into temp at_v09d2;
select apply_captured_payment('pay_v09d2','rzp_order_v09d2',20000,'INR','captured',now()) as v09d_a2 \gset
select assert_true( (:'v09d_a2'::jsonb->>'result') = 'REFUND_REQUIRED', 'V09D first capture not REFUND_REQUIRED' );
select assert_true( (:'v09d_a2'::jsonb->>'reason') = 'base_pass_already_active', 'V09D unexpected first reason' );
select (select checkout_state from orders where id=:'v09d_o2') = 'PAYMENT_REVIEW' as v09d_pr \gset
select assert_true( :'v09d_pr' = 't', 'V09D order not PAYMENT_REVIEW' );
select apply_captured_payment('pay_v09d3','rzp_order_v09d2',20000,'INR','captured',now()) as v09d_a3 \gset
select assert_true( (:'v09d_a3'::jsonb->>'result') = 'REFUND_REQUIRED', 'V09D stack capture not refused' );
select assert_true( (:'v09d_a3'::jsonb->>'reason') = 'order_payment_review', 'V09D stack reason wrong' );
select (select disposition from payments where razorpay_payment_id='pay_v09d3') = 'REFUND_REQUIRED' as v09d_disp \gset
select assert_true( :'v09d_disp' = 't', 'V09D stack payment not flagged' );
select (select checkout_state from orders where id=:'v09d_o2') = 'PAYMENT_REVIEW' as v09d_still \gset
select assert_true( :'v09d_still' = 't', 'V09D stack capture changed order state' );

\echo '=== V09E: cancel of order without provider mapping emits no job ==='
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-00000000000e','v09e@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('e0000000-0000-4000-8000-00000000000e','V09 E','MEM-009E','ACTIVE','+919800000095',now());
select create_base_pass_checkout(
  'e0000000-0000-4000-8000-00000000000e'::uuid, :'fest_id'::uuid, :'base_pass_id'::uuid,
  '00000000-0000-4000-8000-00000000aa0f'::uuid, 'req-hash-v09e') as v09e_checkout \gset
select (:'v09e_checkout'::jsonb->>'orderId')::uuid as v09e_order \gset
select cancel_order(:'v09e_order'::uuid, 'e0000000-0000-4000-8000-00000000000e'::uuid) as v09e_cancel \gset
select (select count(*) from outbox_jobs
  where job_type='CANCEL_RAZORPAY_ORDER' and aggregate_id=:'v09e_order'::text) = 0 as v09e_nojob \gset
select assert_true( :'v09e_nojob' = 't', 'V09E cancel without mapping emitted job' );

\echo '=== V09F: dispatcher claims CANCEL_RAZORPAY_ORDER jobs ==='
select count(*) as v09f_claimed from claim_outbox_jobs(
  array['CANCEL_RAZORPAY_ORDER']::text[], 'v09test', 10) \gset
select assert_true( :'v09f_claimed'::int >= 2, 'V09F dispatcher claim failed' );
select (select count(*) from outbox_jobs
  where job_type='CANCEL_RAZORPAY_ORDER' and state='PROCESSING') >= 2 as v09f_state \gset
select assert_true( :'v09f_state' = 't', 'V09F jobs not PROCESSING after claim' );

\echo 'ALL V09 TESTS PASSED'
