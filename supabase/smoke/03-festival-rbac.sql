-- 03-festival-rbac.sql
-- festival-scoped RBAC: cross-festival denial, per-festival grants, scoped RLS.
-- Source: validated locally against PostgreSQL 15; run by CI in .github/workflows/ci.yml
-- after `supabase/smoke/bootstrap.sql` + migrations 0001-0030 + `supabase/seed.sql`.
-- Requires: superuser (for `set role authenticated` tests) and fresh DB state.

\set ON_ERROR_STOP off
\pset pager off

create or replace function assert_true(p_cond boolean, p_msg text) returns boolean
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERT FAIL: %', p_msg;
  end if;
  return true;
end $$;

select id as fest_a from festivals where slug='pulse-2026' \gset
insert into festivals (slug, name, year, starts_at, ends_at, status)
values ('pulse-2025-archive', 'PULSE Archive', 2025,
        now() - interval '12 months', now() - interval '11 months', 'ARCHIVED')
returning id as fest_b \gset
insert into categories (festival_id, slug, name)
values (:'fest_a'::uuid, 'cat-a', 'Category A') returning id as cat_a \gset
insert into categories (festival_id, slug, name)
values (:'fest_b'::uuid, 'cat-b', 'Category B') returning id as cat_b \gset

insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_a'::uuid, 'Content Admin A', false, false) returning id as role_ca_a \gset
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_b'::uuid, 'Content Admin B', false, false) returning id as role_ca_b \gset
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_a'::uuid, 'Superadmin A', false, true) returning id as role_sa_a \gset
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_b'::uuid, 'Superadmin B', false, true) returning id as role_sa_b \gset

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ca@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','subera@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','supersys@example.com');

insert into staff_assignments (festival_id, user_id, role_id, status, activated_at) values
  (:'fest_a'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', :'role_ca_a'::uuid, 'ACTIVE', now()),
  (:'fest_a'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', :'role_sa_a'::uuid, 'ACTIVE', now()),
  (:'fest_b'::uuid, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', :'role_sa_b'::uuid, 'ACTIVE', now());

insert into role_permissions (role_id, permission_id)
select :'role_ca_a'::uuid, p.id from permissions p
where p.code in ('content.event.write','content.event.publish','content.event.capacity.write',
                 'content.event.price.write','content.schedule.write','content.notice.write',
                 'content.sponsor.write','admin.access','registration.read','content.event.read');

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Stage festival ids for use inside plpgsql blocks.
select set_config('pulse.fest_a', :'fest_a', false);
select set_config('pulse.fest_b', :'fest_b', false);
select set_config('pulse.cat_a', :'cat_a', false);
select set_config('pulse.cat_b', :'cat_b', false);

\echo '=== TEST 1: has_permission scopes to festival ==='
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select has_permission('content.event.write', null, :'fest_a'::uuid) as in_a \gset
select assert_true( :'in_a' = 't', 'TEST1 CA should have write in A' );
select has_permission('content.event.write', null, :'fest_b'::uuid) as in_b \gset
select assert_true( :'in_b' = 'f', 'TEST1 CA must NOT have write in B' );
select has_permission('content.event.write') as legacy_global \gset
select assert_true( :'legacy_global' = 't', 'TEST1 two-arg form keeps legacy behavior' );
select has_permission('finance.read', null, :'fest_a'::uuid) as no_finance \gset
select assert_true( :'no_finance' = 'f', 'TEST1 CA lacks finance.read in A' );
\echo 'TEST1 PASS'

\echo '=== TEST 2: superadmin is festival-scoped ==='
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', false);
select has_permission('finance.read', null, :'fest_a'::uuid) as sa_a \gset
select assert_true( :'sa_a' = 't', 'TEST2 superadmin-A has code in A' );
select has_permission('finance.read', null, :'fest_b'::uuid) as sa_b \gset
select assert_true( :'sa_b' = 'f', 'TEST2 superadmin-A must NOT have access in B' );
\echo 'TEST2 PASS'

\echo '=== TEST 3: admin_upsert_event create denied in B for CA ==='
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
do $$
declare v_fest_b uuid := current_setting('pulse.fest_b')::uuid;
begin
  begin
    perform admin_upsert_event(null, v_fest_b, 'x', 'X', '', '', '', current_setting('pulse.cat_b')::uuid, null,
      now(), now() + interval '1 hour', false, false, 'INDIVIDUAL', 'PARTICIPANT'::capacity_basis,
      'PARTICIPANT'::price_basis, 1, 1, 10, 5000, '', now(), now() + interval '1 day', false, 0);
    raise exception 'TEST3 FAIL: create in B succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end; $$;
\echo 'TEST3 PASS'

\echo '=== TEST 4: create in A ok; cross-festival update denied ==='
do $$
declare v_fest_a uuid := current_setting('pulse.fest_a')::uuid;
declare v_fest_b uuid := current_setting('pulse.fest_b')::uuid;
declare v_ev events;
begin
  v_ev := admin_upsert_event(null, v_fest_a, 'a-slot', 'A Event', '', '', '', current_setting('pulse.cat_a')::uuid, null,
    now(), now() + interval '1 hour', false, false, 'INDIVIDUAL', 'PARTICIPANT'::capacity_basis,
    'PARTICIPANT'::price_basis, 1, 1, 10, 5000, '', now(), now() + interval '1 day', false, 0);
  begin
    perform admin_upsert_event(v_ev.id, v_fest_b, 'a-slot', 'A Event Hacked', '', '', '', current_setting('pulse.cat_a')::uuid, null,
      now(), now() + interval '1 hour', false, false, 'INDIVIDUAL', 'PARTICIPANT'::capacity_basis,
      'PARTICIPANT'::price_basis, 1, 1, 10, 5000, '', now(), now() + interval '1 day', false, v_ev.version);
    raise exception 'TEST4 FAIL: cross-festival update succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end; $$;
\echo 'TEST4 PASS'

\echo '=== TEST 5: publish / capacity / sponsor guards ==='
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', false);
do $$
declare v_fest_b uuid := current_setting('pulse.fest_b')::uuid;
declare v_ev events;
begin
  v_ev := admin_upsert_event(null, v_fest_b, 'b-slot', 'B Event', '', '', '', current_setting('pulse.cat_b')::uuid, null,
    now(), now() + interval '1 hour', false, false, 'INDIVIDUAL', 'PARTICIPANT'::capacity_basis,
    'PARTICIPANT'::price_basis, 1, 1, 10, 5000, '', now(), now() + interval '1 day', false, 0);
  perform admin_publish_event(v_ev.id);
  -- Second B event stays DRAFT so RLS scoping of unpublished rows is testable.
  perform admin_upsert_event(null, v_fest_b, 'b-draft-slot', 'B Draft Event', '', '', '', current_setting('pulse.cat_b')::uuid, null,
    now(), now() + interval '1 hour', false, false, 'INDIVIDUAL', 'PARTICIPANT'::capacity_basis,
    'PARTICIPANT'::price_basis, 1, 1, 10, 5000, '', now(), now() + interval '1 day', false, 0);
  -- Sponsor stays inactive (private) so CA cannot see it via RLS.
  perform admin_upsert_sponsor(null, v_fest_b, 'B Corp', 'Gold', '', '', '', '', 1, false, false, 0);
end; $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
do $$
declare v_fest_a uuid := current_setting('pulse.fest_a')::uuid;
declare v_ev events;
declare v_sp sponsors;
begin
  select * into v_ev from events where slug = 'b-slot';
  select * into v_sp from sponsors where name = 'B Corp';
  begin
    perform admin_publish_event(v_ev.id);
    raise exception 'TEST5 FAIL: publish of B event by A staff succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform admin_set_event_capacity(v_ev.id, 99, v_ev.version);
    raise exception 'TEST5 FAIL: capacity change of B event by A staff succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform admin_upsert_sponsor(v_sp.id, v_fest_a, 'B Corp hacked', 'Gold', '', '', '', '', 1, false, true, v_sp.version);
    raise exception 'TEST5 FAIL: cross-festival sponsor update succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end; $$;
\echo 'TEST5 PASS'

\echo '=== TEST 6: schedule + notice cross-festival update denied ==='
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', false);
insert into notices (festival_id, slug, tag, title, body_markdown, status)
values (:'fest_b'::uuid, 'b-notice', 'INFO', 'B Notice', 'body', 'PUBLISHED') returning id as b_notice \gset
select id as b_slot_id from events where slug='b-slot' \gset
insert into schedule_entries (festival_id, linked_event_id, title, starts_at, ends_at, category_key)
values (:'fest_b'::uuid, :'b_slot_id'::uuid, 'B Entry', now(), now() + interval '1 hour', 'workshop') returning id as b_entry \gset
select set_config('pulse.b_notice', :'b_notice', false);
select set_config('pulse.b_entry', :'b_entry', false);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
do $$
declare v_fest_a uuid := current_setting('pulse.fest_a')::uuid;
begin
  begin
    perform admin_upsert_notice(current_setting('pulse.b_notice')::uuid, v_fest_a, 'b-notice', 'INFO', 'B Notice Hacked', 'body',
      now(), null, false, 1);
    raise exception 'TEST6 FAIL: cross-festival notice update succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform admin_upsert_schedule_entry(current_setting('pulse.b_entry')::uuid, v_fest_a, null, 'B Entry Hacked', null,
      now(), now() + interval '1 hour', 'workshop', false, null, 1);
    raise exception 'TEST6 FAIL: cross-festival schedule update succeeded';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end; $$;
\echo 'TEST6 PASS'

\echo '=== TEST 7: RLS reads scoped to assignment festival ==='
grant select on events, notices, schedule_entries, sponsors to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select count(*) as a_drafts from events where status <> 'PUBLISHED' \gset
select assert_true( :'a_drafts' = '1', 'TEST7 CA sees only A drafts' );
select count(*) as a_b_drafts from events where festival_id = :'fest_b'::uuid and status <> 'PUBLISHED' \gset
select assert_true( :'a_b_drafts' = '0', 'TEST7 CA sees no B drafts' );
select count(*) as a_sponsors from sponsors \gset
select assert_true( :'a_sponsors' = '0', 'TEST7 CA sees no B private sponsors' );
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', false);
select count(*) as sa_drafts from events where status <> 'PUBLISHED' \gset
select assert_true( :'sa_drafts' = '1', 'TEST7 superadmin-A RLS sees only A drafts' );
reset role;
\echo 'TEST7 PASS'

\echo '=== TEST 8: event-scoped permission still works inside festival ==='
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
insert into roles (festival_id, name, is_system, is_superadmin)
values (:'fest_a'::uuid, 'Event Manager A', false, false) returning id as role_em_a \gset
insert into role_permissions (role_id, permission_id)
select :'role_em_a'::uuid, p.id from permissions p
where p.code in ('content.event.write','registration.read','admin.access');
insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4','em@example.com');
insert into staff_assignments (festival_id, user_id, role_id, status, activated_at)
values (:'fest_a'::uuid, 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', :'role_em_a'::uuid, 'ACTIVE', now());
select id as ev_a_id from events where slug='a-slot' \gset
insert into staff_event_scopes (staff_assignment_id, event_id)
select sa.id, :'ev_a_id'::uuid
from staff_assignments sa where sa.user_id='dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', false);
select has_permission('content.event.write', :'ev_a_id'::uuid, :'fest_a'::uuid) as em_scoped \gset
select assert_true( :'em_scoped' = 't', 'TEST8 Event Manager scope in A works' );
\echo 'TEST8 PASS'

\echo 'ALL V01 TESTS PASS'
