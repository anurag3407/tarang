-- 04-gate-assignment-offline.sql
-- gate assignment enforcement + offline FAIL_CLOSED cooldown + override audit.
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
select id as gate_id from gates where name='Main Gate' \gset
select id as cc_gate_id from gates where name='Convention Centre' \gset
select id as ev_id from events order by starts_at limit 1 \gset
insert into gates (festival_id, name, gate_type, admission_policy, offline_policy, is_active, linked_event_id)
values (:'fest_id'::uuid, 'Test Provisional General', 'GENERAL', 'ONE_PER_EVENT', 'PROVISIONAL_GENERAL', true, :'ev_id'::uuid)
returning id as prov_gate_id \gset
select id as vip_pass_product_id from pass_products where slug='vip-delegate-pass' \gset
select jti as cred_jti from qr_credentials limit 1 \gset

-- Fresh buyer + VIP pass + credential used by the FAIL_CLOSED / provisional tests,
-- so no prior admission exists for that credential.
insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333','buyer2@example.com');
insert into profiles (user_id, display_name, public_member_code, status, phone_e164, profile_completed_at) values
  ('33333333-3333-4333-8333-333333333333','Buyer Two','MEM-0002','ACTIVE','+919800000002',now());
select create_base_pass_checkout(
  '33333333-3333-4333-8333-333333333333'::uuid, :'fest_id'::uuid, :'vip_pass_product_id'::uuid,
  '00000000-0000-4000-8000-00000000cc01'::uuid, 'g4-req-cc01') as g4_checkout \gset
select (:'g4_checkout'::jsonb->>'orderId')::uuid as g4_order_id \gset
select attach_razorpay_order(:'g4_order_id'::uuid,'rzp_g4_2',200000,'INR','receipt-g4','created','{}'::jsonb) into temp g4_att;
select apply_captured_payment('pay_g4_2','rzp_g4_2',200000,'INR','captured',now()) as g4_pay \gset
select (select checkout_state from orders where id=:'g4_order_id') = 'FULFILLED' as g4_ok \gset
select assert_true( :'g4_ok' = 't', 'G4 setup checkout not FULFILLED' );
select id as g4_pass_id from delegate_passes
where user_id='33333333-3333-4333-8333-333333333333' and pass_product_id=:'vip_pass_product_id'::uuid
order by created_at desc limit 1 \gset
insert into qr_credentials (festival_id, delegate_pass_id, key_id, entitlement_version, state, not_before, expires_at, token_digest)
values (:'fest_id'::uuid, :'g4_pass_id'::uuid, 'g4-key-cc', 1, 'ACTIVE', clock_timestamp(),
  (select valid_until from pass_products where id=:'vip_pass_product_id'::uuid), 'pending')
returning jti as g4_cred_jti \gset

-- Fresh gates + device for G4 assertions (state may follow smoke5).
insert into gates (festival_id, name, gate_type, admission_policy, offline_policy, is_active)
values (:'fest_id'::uuid, 'Test One-Per-Day', 'GENERAL', 'ONE_PER_DAY', 'FAIL_CLOSED', true)
returning id as opd_gate_id \gset
insert into gates (festival_id, name, gate_type, admission_policy, offline_policy, is_active)
values (:'fest_id'::uuid, 'Test Inactive Gate', 'GENERAL', 'ONE_PER_DAY', 'FAIL_CLOSED', false)
returning id as inactive_gate_id \gset
insert into scanner_devices (id, public_device_id, name, credential_hash, state)
values ('88888888-8888-4888-8888-888888888888','dev-g4-unassigned','G4 Unassigned','hash-g4u','ACTIVE');

-- Assignment for the OPD gate (device 9999 + operator 2222), and one for CC gate
-- used by the offline FAIL_CLOSED tests.
insert into gate_assignments (device_id, gate_id, operator_user_id, valid_from, valid_until)
values ('99999999-9999-4999-8999-999999999999'::uuid, :'opd_gate_id'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, now(), now() + interval '1 day');
insert into gate_assignments (device_id, gate_id, operator_user_id, valid_from, valid_until)
values ('99999999-9999-4999-8999-999999999999'::uuid, :'prov_gate_id'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, now(), now() + interval '1 day');
insert into gate_assignments (device_id, gate_id, operator_user_id, valid_from, valid_until)
values ('99999999-9999-4999-8999-999999999999'::uuid, :'cc_gate_id'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, now(), now() + interval '1 day');

\echo '=== G4 TEST 1: no assignment -> wrong_gate/no_active_assignment, nothing recorded ==='
select record_scan('40000000-0000-4000-8000-000000000001'::uuid, :'cred_jti'::uuid, :'cc_gate_id'::uuid,
  '88888888-8888-4888-8888-888888888888'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-1', 'DELEGATE', 'Buyer One') as g4_1 \gset
select (:'g4_1'::jsonb->>'outcome') = 'wrong_gate' and (:'g4_1'::jsonb->>'reason') = 'no_active_assignment' as ok1 \gset
select assert_true( :'ok1' = 't', 'G4T1 wrong_gate/no_active_assignment' );
select (select count(*) from scan_attempts where scan_id='40000000-0000-4000-8000-000000000001') = 0 as ok1b \gset
select assert_true( :'ok1b' = 't', 'G4T1 rejected scan was recorded' );
\echo 'G4 TEST1 PASS'

\echo '=== G4 TEST 2: unknown gate -> wrong_gate/unknown_gate ==='
select record_scan('40000000-0000-4000-8000-000000000002'::uuid, :'cred_jti'::uuid, '00000000-0000-0000-0000-00000000dead',
  '88888888-8888-4888-8888-888888888888'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-2', 'DELEGATE', 'Buyer One') as g4_2 \gset
select (:'g4_2'::jsonb->>'outcome') = 'wrong_gate' and (:'g4_2'::jsonb->>'reason') = 'unknown_gate' as ok2 \gset
select assert_true( :'ok2' = 't', 'G4T2 wrong_gate/unknown_gate' );
\echo 'G4 TEST2 PASS'

\echo '=== G4 TEST 3: inactive gate -> wrong_gate/gate_inactive ==='
select record_scan('40000000-0000-4000-8000-000000000003'::uuid, :'cred_jti'::uuid, :'inactive_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-3', 'DELEGATE', 'Buyer One') as g4_3 \gset
select (:'g4_3'::jsonb->>'outcome') = 'wrong_gate' and (:'g4_3'::jsonb->>'reason') = 'gate_inactive' as ok3 \gset
select assert_true( :'ok3' = 't', 'G4T3 wrong_gate/gate_inactive' );
\echo 'G4 TEST3 PASS'

\echo '=== G4 TEST 4: assigned gate -> accepted_reentry + replay ==='
select record_scan('40000000-0000-4000-8000-000000000004'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-4', 'DELEGATE', 'Buyer One') as g4_4 \gset
select (:'g4_4'::jsonb->>'outcome') = 'accepted_reentry' as ok4 \gset
select assert_true( :'ok4' = 't', 'G4T4 assigned scan not accepted_reentry' );
select record_scan('40000000-0000-4000-8000-000000000004'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-4', 'DELEGATE', 'Buyer One') as g4_4r \gset
select (:'g4_4r'::jsonb->>'replayed') = 'true' and (:'g4_4r'::jsonb->>'outcome') = 'accepted_reentry' as ok4b \gset
select assert_true( :'ok4b' = 't', 'G4T4 replay not idempotent' );
select (select count(*) from scan_attempts where scan_id='40000000-0000-4000-8000-000000000004') = 1 as ok4c \gset
select assert_true( :'ok4c' = 't', 'G4T4 replay duplicated the scan' );
\echo 'G4 TEST4 PASS'

\echo '=== G4 TEST 5: ONE_PER_DAY second scan -> duplicate/already_admitted ==='
select record_scan('40000000-0000-4000-8000-000000000005'::uuid, :'cred_jti'::uuid, :'opd_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-5', 'DELEGATE', 'Buyer One') as g4_5a \gset
select (:'g4_5a'::jsonb->>'outcome') = 'accepted' as ok5 \gset
select assert_true( :'ok5' = 't', 'G4T5 OPD first scan not accepted' );
select record_scan('40000000-0000-4000-8000-000000000006'::uuid, :'cred_jti'::uuid, :'opd_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-6', 'DELEGATE', 'Buyer One') as g4_5b \gset
select (:'g4_5b'::jsonb->>'outcome') = 'duplicate' and (:'g4_5b'::jsonb->>'reason') = 'already_admitted' as ok5b \gset
select assert_true( :'ok5b' = 't', 'G4T5 OPD duplicate not detected' );
select (select count(*) from admissions where credential_id=(select id from qr_credentials where jti=:'cred_jti'::uuid)
        and scope_key = to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD')) = 1 as ok5c \gset
select assert_true( :'ok5c' = 't', 'G4T5 OPD admission count' );
\echo 'G4 TEST5 PASS'

\echo '=== G4 TEST 6: offline FAIL_CLOSED -> cooldown; override -> manual_override + audit ==='
select record_scan('40000000-0000-4000-8000-000000000007'::uuid, :'g4_cred_jti'::uuid, :'cc_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), true, 'ACTIVE', 'g4-7', 'DELEGATE', 'Buyer Two') as g4_6a \gset
select (:'g4_6a'::jsonb->>'outcome') = 'cooldown' and (:'g4_6a'::jsonb->>'reason') = 'offline_fail_closed' as ok6 \gset
select assert_true( :'ok6' = 't', 'G4T6 offline FAIL_CLOSED not enforced' );
select record_scan('40000000-0000-4000-8000-000000000008'::uuid, :'g4_cred_jti'::uuid, :'cc_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), true, 'ACTIVE', 'g4-8', 'DELEGATE', 'Buyer Two', true, 'field-trip') as g4_6b \gset
select (:'g4_6b'::jsonb->>'outcome') = 'accepted' as ok6b \gset
select assert_true( :'ok6b' = 't', 'G4T6 override did not bypass FAIL_CLOSED' );
-- After a manual override the credential is admitted; a later FAIL_CLOSED offline
-- scan must now be treated as re-entry (still REENTRY_ALLOWED policy).
select record_scan('40000000-0000-4000-8000-00000000000b'::uuid, :'g4_cred_jti'::uuid, :'cc_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), true, 'ACTIVE', 'g4-b', 'DELEGATE', 'Buyer Two') as g4_6c \gset
select (:'g4_6c'::jsonb->>'outcome') = 'accepted_reentry' as ok6d \gset
select assert_true( :'ok6d' = 't', 'G4T6 admitted FAIL_CLOSED offline scan not reentry' );
-- Supervisor override of a REVOKED credential -> manual_override + audit row.
update qr_credentials set state='REVOKED' where id=(select id from qr_credentials where jti=:'g4_cred_jti'::uuid);
select record_scan('40000000-0000-4000-8000-00000000000c'::uuid, :'g4_cred_jti'::uuid, :'opd_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'ACTIVE', 'g4-c', 'DELEGATE', 'Buyer Two', true, 'gate-entry') as g4_6d \gset
select (:'g4_6d'::jsonb->>'outcome') = 'manual_override' as ok6e \gset
select assert_true( :'ok6e' = 't', 'G4T6 revoked override not manual_override' );
select (select count(*) from audit_logs where action='scan.override') = 1 as ok6f \gset
select assert_true( :'ok6f' = 't', 'G4T6 scan.override audit missing' );
update qr_credentials set state='ACTIVE' where id=(select id from qr_credentials where jti=:'g4_cred_jti'::uuid);
\echo 'G4 TEST6 PASS'

\echo '=== G4 TEST 7: offline PROVISIONAL_GENERAL -> accepted offline ==='
select record_scan('40000000-0000-4000-8000-000000000009'::uuid, :'g4_cred_jti'::uuid, :'prov_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), true, 'ACTIVE', 'g4-9', 'DELEGATE', 'Buyer Two') as g4_7 \gset
select (:'g4_7'::jsonb->>'outcome') = 'accepted' as ok7 \gset
select assert_true( :'ok7' = 't', 'G4T7 provisional-general offline scan rejected' );
select record_scan('40000000-0000-4000-8000-00000000000d'::uuid, :'g4_cred_jti'::uuid, :'prov_gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), true, 'ACTIVE', 'g4-d', 'DELEGATE', 'Buyer Two') as g4_7b \gset
select (:'g4_7b'::jsonb->>'outcome') = 'duplicate' as ok7b \gset
select assert_true( :'ok7b' = 't', 'G4T7 provisional gate duplicate not detected' );
\echo 'G4 TEST7 PASS'

\echo '=== G4 TEST 8: invalid signature still audited (assigned gate) ==='
select record_scan('40000000-0000-4000-8000-00000000000a'::uuid, :'cred_jti'::uuid, :'gate_id'::uuid,
  '99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid,
  now(), false, 'invalid_signature', 'g4-a', 'DELEGATE', 'Buyer One') as g4_8 \gset
select (:'g4_8'::jsonb->>'outcome') = 'invalid_signature' as ok8 \gset
select assert_true( :'ok8' = 't', 'G4T8 invalid signature not audited' );
\echo 'G4 TEST8 PASS'

\echo 'ALL G4 TESTS PASS'
