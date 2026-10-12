-- 0004: content RLS, admin mutation functions, RBAC seeds (plan §8, §11.5)

-- ---------------------------------------------------------------------
-- Enable RLS everywhere (plan §7.1.4). Server-only tables get no client
-- policy; service-role access bypasses RLS by design.
-- ---------------------------------------------------------------------
alter table festivals enable row level security;
alter table profiles enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table staff_assignments enable row level security;
alter table staff_event_scopes enable row level security;
alter table audit_logs enable row level security;
alter table categories enable row level security;
alter table venues enable row level security;
alter table events enable row level security;
alter table event_price_versions enable row level security;
alter table event_inventory enable row level security;
alter table schedule_entries enable row level security;
alter table notices enable row level security;
alter table feature_flags enable row level security;
alter table support_questions enable row level security;
alter table pass_products enable row level security;
alter table pass_price_versions enable row level security;

-- ---------------------------------------------------------------------
-- Public read policies: published fields only
-- ---------------------------------------------------------------------
create policy festivals_public_read on festivals
  for select using (status = 'PUBLISHED' or has_permission('admin.access'));

create policy categories_public_read on categories
  for select using (is_active or has_permission('content.event.read'));

create policy venues_public_read on venues
  for select using (is_active or has_permission('content.event.read'));

create policy events_public_read on events
  for select using (
    status = 'PUBLISHED'
    or has_permission('content.event.read')
  );

create policy event_price_versions_public_read on event_price_versions
  for select using (true);

-- Inventory: public aggregate view only (no direct table read for clients).
create policy event_inventory_staff_read on event_inventory
  for select using (has_permission('content.event.read'));

create policy schedule_public_read on schedule_entries
  for select using (status = 'PUBLISHED' or has_permission('content.event.read'));

create policy notices_public_read on notices
  for select using (
    (status = 'PUBLISHED'
      and publish_at <= now()
      and (expires_at is null or expires_at > now()))
    or has_permission('content.notice.write')
  );

create policy pass_products_public_read on pass_products
  for select using (status = 'PUBLISHED' or has_permission('admin.access'));

create policy pass_price_versions_public_read on pass_price_versions
  for select using (true);

-- Profiles: own limited read.
create policy profiles_own_read on profiles
  for select using (user_id = auth.uid() or has_permission('admin.access'));

create policy profiles_own_update on profiles
  for update using (user_id = auth.uid() and status = 'ACTIVE');

-- Support questions: insert through API (RLS insert for authenticated or
-- anonymous is intentionally absent; the Route Handler uses service role).
create policy support_staff_read on support_questions
  for select using (has_permission('support.read'));

create policy support_staff_update on support_questions
  for update using (has_permission('support.resolve'));

-- RBAC tables: superadmin read; mutations go through functions.
create policy roles_read on roles
  for select using (has_permission('admin.access'));

create policy permissions_read on permissions
  for select using (has_permission('admin.access'));

create policy role_permissions_read on role_permissions
  for select using (has_permission('admin.access'));

create policy staff_assignments_read on staff_assignments
  for select using (has_permission('staff.manage') or user_id = auth.uid());

create policy staff_event_scopes_read on staff_event_scopes
  for select using (has_permission('staff.manage'));

-- Audit logs: audit.read only.
create policy audit_logs_read on audit_logs
  for select using (has_permission('audit.read'));

-- Feature flags: readable by any authenticated participant (sale switches
-- are public state); writes only through admin functions.
create policy feature_flags_read on feature_flags
  for select using (true);

-- ---------------------------------------------------------------------
-- Audit helper (service-role and definer functions use this)
-- ---------------------------------------------------------------------
create or replace function write_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_result audit_result default 'SUCCESS',
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_logs (
    actor_user_id, actor_type, action, target_type, target_id,
    result, reason, before_json, after_json, metadata
  ) values (
    auth.uid(),
    case when auth.uid() is null then 'SERVICE'::audit_actor_type else 'USER'::audit_actor_type end,
    p_action, p_target_type, p_target_id, p_result, p_reason, p_before, p_after, p_metadata
  );
$$;

-- ---------------------------------------------------------------------
-- Admin content mutation functions (plan §11.6–§11.8)
-- All require permission + write audit + optimistic version check.
-- ---------------------------------------------------------------------

create or replace function admin_upsert_event(
  p_event_id uuid,
  p_festival_id uuid,
  p_slug text,
  p_name text,
  p_short_description text,
  p_description text,
  p_rules_markdown text,
  p_category_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_include_in_schedule boolean,
  p_is_night_event boolean,
  p_registration_mode registration_mode,
  p_capacity_basis capacity_basis,
  p_price_basis price_basis,
  p_min_team_size integer,
  p_max_team_size integer,
  p_capacity_units integer,
  p_price_paise bigint,
  p_prize_pool_text text,
  p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz,
  p_featured boolean,
  p_expected_version integer,
  p_change_reason text default null
)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
  v_has_holds boolean;
  v_price_version_id uuid;
  v_new_version integer;
begin
  if not has_permission('content.event.write') then
    perform write_audit('event.upsert', 'event', p_event_id::text, 'DENIED', 'missing content.event.write');
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_event_id is null then
    -- Create: event + inventory + initial immutable price version atomically.
    insert into events (
      festival_id, slug, name, short_description, description, rules_markdown,
      category_id, venue_id, starts_at, ends_at, include_in_schedule, is_night_event,
      registration_mode, capacity_basis, price_basis, min_team_size, max_team_size,
      prize_pool_text, registration_opens_at, registration_closes_at, featured
    ) values (
      p_festival_id, p_slug, p_name, p_short_description, p_description, p_rules_markdown,
      p_category_id, p_venue_id, p_starts_at, p_ends_at, p_include_in_schedule, p_is_night_event,
      p_registration_mode, p_capacity_basis, p_price_basis, p_min_team_size, p_max_team_size,
      p_prize_pool_text, p_registration_opens_at, p_registration_closes_at, p_featured
    )
    returning * into v_event;

    insert into event_price_versions (event_id, version, unit_amount_paise, created_by, change_reason)
    values (v_event.id, 1, p_price_paise, auth.uid(), coalesce(p_change_reason, 'initial price'))
    returning id into v_price_version_id;

    update events set current_price_version_id = v_price_version_id where id = v_event.id;
    insert into event_inventory (event_id, capacity_units) values (v_event.id, p_capacity_units);

    perform write_audit('event.create', 'event', v_event.id::text, 'SUCCESS', null, null,
      jsonb_build_object('name', p_name, 'pricePaise', p_price_paise, 'capacity', p_capacity_units));
    return v_event;
  end if;

  -- Update with optimistic concurrency.
  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.version <> p_expected_version then
    perform write_audit('event.update', 'event', p_event_id::text, 'FAILED', 'VERSION_CONFLICT');
    raise exception 'VERSION_CONFLICT expected=% actual=%', p_expected_version, v_event.version
      using errcode = '40001';
  end if;

  -- Structural fields immutable after first hold (plan §2.3.7).
  select exists(select 1 from capacity_holds ch where ch.event_id = p_event_id)
    into v_has_holds;
  if v_has_holds and (
    v_event.registration_mode <> p_registration_mode
    or v_event.capacity_basis <> p_capacity_basis
    or v_event.price_basis <> p_price_basis
    or v_event.min_team_size <> p_min_team_size
    or v_event.max_team_size <> p_max_team_size
  ) then
    raise exception 'STRUCTURE_LOCKED' using errcode = '55000';
  end if;

  v_new_version := v_event.version + 1;

  -- Price change creates a new immutable version, never an update.
  if exists (
    select 1 from event_price_versions epv
    where epv.id = v_event.current_price_version_id
      and epv.unit_amount_paise <> p_price_paise
  ) or v_event.current_price_version_id is null then
    insert into event_price_versions (event_id, version, unit_amount_paise, created_by, change_reason)
    values (p_event_id, coalesce((select max(version) from event_price_versions where event_id = p_event_id), 0) + 1,
            p_price_paise, auth.uid(), coalesce(p_change_reason, 'price update'))
    returning id into v_price_version_id;
  else
    v_price_version_id := v_event.current_price_version_id;
  end if;

  update events set
    slug = p_slug, name = p_name,
    short_description = p_short_description, description = p_description,
    rules_markdown = p_rules_markdown, category_id = p_category_id, venue_id = p_venue_id,
    starts_at = p_starts_at, ends_at = p_ends_at,
    include_in_schedule = p_include_in_schedule, is_night_event = p_is_night_event,
    registration_mode = p_registration_mode, capacity_basis = p_capacity_basis,
    price_basis = p_price_basis, min_team_size = p_min_team_size, max_team_size = p_max_team_size,
    current_price_version_id = v_price_version_id,
    prize_pool_text = p_prize_pool_text,
    registration_opens_at = p_registration_opens_at,
    registration_closes_at = p_registration_closes_at,
    featured = p_featured,
    version = v_new_version,
    updated_at = clock_timestamp()
  where id = p_event_id
  returning * into v_event;

  perform write_audit('event.update', 'event', p_event_id::text, 'SUCCESS', null, null,
    jsonb_build_object('version', v_new_version, 'pricePaise', p_price_paise));
  return v_event;
end;
$$;

-- Safe capacity change (plan §9.8): never below held + confirmed.
create or replace function admin_set_event_capacity(
  p_event_id uuid,
  p_new_capacity integer,
  p_expected_version integer
)
returns event_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv event_inventory;
  v_event events;
begin
  if not has_permission('content.event.capacity.write') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  update event_inventory
  set capacity_units = p_new_capacity,
      version = version + 1,
      updated_at = clock_timestamp()
  where event_id = p_event_id
    and p_new_capacity >= held_units + confirmed_units
  returning * into v_inv;

  if not found then
    select * into v_inv from event_inventory where event_id = p_event_id;
    perform write_audit('event.capacity', 'event', p_event_id::text, 'DENIED', 'CAPACITY_BELOW_COMMITTED',
      null, null, jsonb_build_object('requested', p_new_capacity,
        'held', v_inv.held_units, 'confirmed', v_inv.confirmed_units));
    raise exception 'CAPACITY_BELOW_COMMITTED held=% confirmed=% capacity=%',
      v_inv.held_units, v_inv.confirmed_units, v_inv.capacity_units
      using errcode = '23514';
  end if;

  update events set version = version + 1, updated_at = clock_timestamp() where id = p_event_id;
  perform write_audit('event.capacity', 'event', p_event_id::text, 'SUCCESS', null, null,
    jsonb_build_object('capacity', p_new_capacity));
  return v_inv;
end;
$$;

-- Publish with required-field validation (plan §11.6).
create or replace function admin_publish_event(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
begin
  if not has_permission('content.event.publish') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event.current_price_version_id is null then
    raise exception 'PUBLISH_INVALID missing price version' using errcode = '23502';
  end if;
  if not exists (select 1 from event_inventory where event_id = p_event_id) then
    raise exception 'PUBLISH_INVALID missing inventory' using errcode = '23502';
  end if;

  update events
  set status = 'PUBLISHED', published_at = coalesce(published_at, clock_timestamp()),
      version = version + 1, updated_at = clock_timestamp()
  where id = p_event_id
  returning * into v_event;

  perform write_audit('event.publish', 'event', p_event_id::text);
  return v_event;
end;
$$;

-- Schedule entry upsert with conflict detection (plan §11.7).
create or replace function admin_upsert_schedule_entry(
  p_entry_id uuid,
  p_festival_id uuid,
  p_linked_event_id uuid,
  p_title text,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_category_key text,
  p_is_night boolean,
  p_day_theme text,
  p_expected_version integer
)
returns schedule_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry schedule_entries;
  v_conflict_count integer;
begin
  if not has_permission('content.schedule.write') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Venue/time overlap warning (returned via exception only when same venue).
  select count(*) into v_conflict_count
  from schedule_entries se
  where se.festival_id = p_festival_id
    and se.status <> 'CANCELLED'
    and se.id is distinct from p_entry_id
    and se.venue_id is not null
    and se.venue_id = p_venue_id
    and tstzrange(se.starts_at, se.ends_at) && tstzrange(p_starts_at, p_ends_at);

  if p_entry_id is null then
    insert into schedule_entries (
      festival_id, linked_event_id, title, venue_id, starts_at, ends_at,
      category_key, is_night, day_theme, status
    ) values (
      p_festival_id, p_linked_event_id, p_title, p_venue_id, p_starts_at, p_ends_at,
      p_category_key, p_is_night, p_day_theme, 'DRAFT'
    )
    returning * into v_entry;
    perform write_audit('schedule.create', 'schedule_entry', v_entry.id::text);
  else
    select * into v_entry from schedule_entries where id = p_entry_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_entry.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    update schedule_entries set
      linked_event_id = p_linked_event_id, title = p_title, venue_id = p_venue_id,
      starts_at = p_starts_at, ends_at = p_ends_at, category_key = p_category_key,
      is_night = p_is_night, day_theme = p_day_theme,
      version = version + 1, updated_at = clock_timestamp()
    where id = p_entry_id
    returning * into v_entry;
    perform write_audit('schedule.update', 'schedule_entry', p_entry_id::text);
  end if;

  if v_conflict_count > 0 then
    -- Non-fatal marker in metadata; API surfaces a warning.
    perform write_audit('schedule.conflict_warning', 'schedule_entry', v_entry.id::text, 'SUCCESS',
      format('%s overlapping entries at same venue', v_conflict_count));
  end if;
  return v_entry;
end;
$$;

-- Notice upsert (plan §11.8).
create or replace function admin_upsert_notice(
  p_notice_id uuid,
  p_festival_id uuid,
  p_slug text,
  p_tag notice_tag,
  p_title text,
  p_body_markdown text,
  p_publish_at timestamptz,
  p_expires_at timestamptz,
  p_pinned boolean,
  p_expected_version integer
)
returns notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice notices;
begin
  if not has_permission('content.notice.write') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_notice_id is null then
    insert into notices (
      festival_id, slug, tag, title, body_markdown, publish_at, expires_at, pinned,
      status, created_by
    ) values (
      p_festival_id, p_slug, p_tag, p_title, p_body_markdown, p_publish_at, p_expires_at, p_pinned,
      case when p_publish_at <= now() then 'PUBLISHED'::notice_status else 'SCHEDULED'::notice_status end,
      auth.uid()
    )
    returning * into v_notice;
    perform write_audit('notice.create', 'notice', v_notice.id::text);
  else
    select * into v_notice from notices where id = p_notice_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_notice.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    update notices set
      slug = p_slug, tag = p_tag, title = p_title, body_markdown = p_body_markdown,
      publish_at = p_publish_at, expires_at = p_expires_at, pinned = p_pinned,
      status = case
        when v_notice.status = 'ARCHIVED' then 'ARCHIVED'::notice_status
        when p_publish_at <= now() then 'PUBLISHED'::notice_status
        else 'SCHEDULED'::notice_status
      end,
      updated_by = auth.uid(),
      version = version + 1,
      updated_at = clock_timestamp()
    where id = p_notice_id
    returning * into v_notice;
    perform write_audit('notice.update', 'notice', p_notice_id::text);
  end if;
  return v_notice;
end;
$$;

-- ---------------------------------------------------------------------
-- Seed: permission catalog + default roles (plan §11.5)
-- ---------------------------------------------------------------------
insert into permissions (code) values
  ('admin.access'), ('staff.manage'), ('role.manage'),
  ('content.event.read'), ('content.event.write'), ('content.event.publish'),
  ('content.event.price.write'), ('content.event.capacity.write'),
  ('content.schedule.write'), ('content.notice.write'),
  ('support.read'), ('support.resolve'),
  ('registration.read'), ('registration.export'),
  ('finance.read'), ('refund.create'), ('refund.approve'), ('payment.reconcile'),
  ('scanner.use'), ('scanner.supervise'), ('scanner.device.manage'),
  ('pass.revoke'), ('pass.reissue'),
  ('audit.read'), ('feature_flag.write')
on conflict (code) do nothing;

-- System roles (festival_id null = system-wide).
insert into roles (name, description, is_system, is_superadmin) values
  ('Superadmin', 'Full control including staff and role management', true, true),
  ('Content Admin', 'Manages events, schedule and notices', true, false),
  ('Event Manager', 'Manages assigned events only', true, false),
  ('Query Resolver', 'Support desk', true, false),
  ('Finance Viewer', 'Read-only finance and reconciliation views', true, false),
  ('Gate Scanner', 'Gate scanning only', true, false),
  ('Gate Supervisor', 'Scanner supervision and overrides', true, false),
  ('Auditor', 'Read-only audit logs', true, false)
on conflict do nothing;

-- Grant permission sets to system roles.
with role_perms(role_name, codes) as (
  values
    ('Content Admin', array['admin.access','content.event.read','content.event.write','content.event.publish','content.event.price.write','content.event.capacity.write','content.schedule.write','content.notice.write','registration.read']),
    ('Event Manager', array['admin.access','content.event.read','content.event.write','registration.read']),
    ('Query Resolver', array['admin.access','support.read','support.resolve']),
    ('Finance Viewer', array['admin.access','finance.read','registration.read','audit.read']),
    ('Gate Scanner', array['scanner.use']),
    ('Gate Supervisor', array['scanner.use','scanner.supervise','scanner.device.manage']),
    ('Auditor', array['admin.access','audit.read'])
)
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from role_perms rp
join roles r on r.name = rp.role_name and r.is_system
join permissions p on p.code = any(rp.codes)
on conflict do nothing;

-- Grant all permissions to Superadmin
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.name = 'Superadmin' and r.is_system
on conflict do nothing;

-- P0 feature flags (plan §7.5). Festival rows are seeded in seed.sql;
-- flags are inserted per-festival there.
