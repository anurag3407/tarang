-- 0027_festival_scoped_rbac.sql
--
-- V-01 (Festival-blind RBAC): permission checks were global — any ACTIVE
-- staff assignment satisfied has_permission() regardless of which festival
-- the request targeted, and the bare-id admin mutation functions never
-- compared the target row's festival against the caller's festival context.
--
-- Fix (additive; never edits applied migrations):
--   1. has_permission() gains an optional p_festival_id parameter. When
--      provided, only ACTIVE assignments in that festival qualify
--      (superadmin bypass included — a superadmin must hold an ACTIVE
--      assignment in the festival).
--   2. admin_upsert_event / admin_publish_event / admin_set_event_capacity /
--      admin_upsert_schedule_entry / admin_upsert_notice / admin_upsert_sponsor
--      re-check the permission scoped to the target row's festival and reject
--      updates whose row belongs to a different festival than p_festival_id.
--   3. Read policies on festival-bearing tables pass the row's festival into
--      has_permission() so staff reads stay inside the assignment's festival.

-- ---------------------------------------------------------------------
-- 1. Festival-aware has_permission
-- ---------------------------------------------------------------------
-- Drop the pre-0027 two-argument variant (text, uuid) so calls relying on
-- defaults (1-arg) resolve unambiguously to the new signature. CASCADE also
-- drops policies that referenced the old signature; every one of them is
-- recreated below in section 3 (audit_logs_read, scanner_devices_manage,
-- which have no festival column, keep their previous global semantics).
drop function if exists has_permission(text, uuid) cascade;
create or replace function has_permission(
  p_permission text,
  p_event_id uuid default null,
  p_festival_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from staff_assignments sa
    join roles r on r.id = sa.role_id
    where sa.user_id = auth.uid()
      and sa.status = 'ACTIVE'
      and (p_festival_id is null or sa.festival_id = p_festival_id)
      and (
        r.is_superadmin
        or (
          exists (
            select 1
            from role_permissions rp
            join permissions p on p.id = rp.permission_id
            where rp.role_id = r.id
              and p.code = p_permission
          )
          and (
            p_event_id is null
            or exists (
              select 1 from staff_event_scopes ses
              where ses.staff_assignment_id = sa.id and ses.event_id = p_event_id
            )
            or not exists (
              select 1 from staff_event_scopes ses2
              where ses2.staff_assignment_id = sa.id
            )
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 2. Bare-id admin mutation functions: festival-scoped permission checks
--    and same-festival guards on updates.
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
  if not has_permission('content.event.write', null, p_festival_id) then
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
  if v_event.festival_id is distinct from p_festival_id then
    perform write_audit('event.update', 'event', p_event_id::text, 'DENIED', 'cross_festival');
    raise exception 'FORBIDDEN' using errcode = '42501';
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
    -- PRICE GUARD (0011): changing the amount requires the dedicated price
    -- permission even when the call comes straight through PostgREST.
    if not has_permission('content.event.price.write', null, p_festival_id) then
      perform write_audit('event.price_change', 'event', p_event_id::text, 'DENIED',
        'missing content.event.price.write');
      raise exception 'FORBIDDEN price change requires content.event.price.write'
        using errcode = '42501';
    end if;

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

create or replace function admin_publish_event(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not has_permission('content.event.publish', null, v_event.festival_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_event.current_price_version_id is null then
    raise exception 'PUBLISH_INVALID missing price version' using errcode = '23502';
  end if;
  if not exists (select 1 from event_inventory where event_id = p_event_id) then
    raise exception 'PUBLISH_INVALID missing inventory' using errcode = '23502';
  end if;

  update events
  set status = 'PUBLISHED',
      sales_state = case
        when registration_opens_at is not null and registration_opens_at > clock_timestamp() then 'SCHEDULED'::sales_state
        else 'OPEN'::sales_state
      end,
      published_at = coalesce(published_at, clock_timestamp()),
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_event_id
  returning * into v_event;

  perform write_audit('event.publish', 'event', p_event_id::text);
  return v_event;
end;
$$;

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
  select * into v_event from events where id = p_event_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not has_permission('content.event.capacity.write', null, v_event.festival_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
  if not has_permission('content.schedule.write', null, p_festival_id) then
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
    if v_entry.festival_id is distinct from p_festival_id then
      raise exception 'FORBIDDEN' using errcode = '42501';
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
  if not has_permission('content.notice.write', null, p_festival_id) then
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
    if v_notice.festival_id is distinct from p_festival_id then
      raise exception 'FORBIDDEN' using errcode = '42501';
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

create or replace function admin_upsert_sponsor(
  p_sponsor_id uuid,
  p_festival_id uuid,
  p_name text,
  p_category text,
  p_tagline text,
  p_logo_url text,
  p_website_url text,
  p_color_key text,
  p_sort_order integer,
  p_is_title boolean,
  p_is_active boolean,
  p_expected_version integer
)
returns sponsors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor sponsors;
begin
  -- 0027: both branches cover in-festival superadmins (role grants all codes),
  -- so the previous global is_superadmin() bypass is no longer needed.
  if not (has_permission('content.sponsor.write', null, p_festival_id)
       or has_permission('content.event.write', null, p_festival_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_sponsor_id is null then
    insert into sponsors (
      festival_id, name, category, tagline, logo_url, website_url,
      color_key, sort_order, is_title, is_active
    ) values (
      p_festival_id, p_name, p_category, coalesce(p_tagline, ''), p_logo_url, p_website_url,
      coalesce(p_color_key, 'secondary'), coalesce(p_sort_order, 0), coalesce(p_is_title, false), coalesce(p_is_active, true)
    )
    returning * into v_sponsor;
    perform write_audit('sponsor.create', 'sponsor', v_sponsor.id::text);
  else
    select * into v_sponsor from sponsors where id = p_sponsor_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sponsor.festival_id is distinct from p_festival_id then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if v_sponsor.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    update sponsors set
      name = p_name, category = p_category, tagline = coalesce(p_tagline, ''),
      logo_url = p_logo_url, website_url = p_website_url,
      color_key = coalesce(p_color_key, 'secondary'), sort_order = coalesce(p_sort_order, 0),
      is_title = coalesce(p_is_title, false), is_active = coalesce(p_is_active, true),
      version = version + 1, updated_at = clock_timestamp()
    where id = p_sponsor_id
    returning * into v_sponsor;
    perform write_audit('sponsor.update', 'sponsor', p_sponsor_id::text);
  end if;
  return v_sponsor;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. RLS read policies: scope staff reads to the row's festival.
-- ---------------------------------------------------------------------

drop policy if exists festivals_public_read on festivals;
create policy festivals_public_read on festivals
  for select using (status = 'PUBLISHED' or has_permission('admin.access'));

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories
  for select using (is_active or has_permission('content.event.read', null, festival_id));

drop policy if exists venues_public_read on venues;
create policy venues_public_read on venues
  for select using (is_active or has_permission('content.event.read', null, festival_id));

drop policy if exists events_public_read on events;
create policy events_public_read on events
  for select using (
    status = 'PUBLISHED'
    or has_permission('content.event.read', null, festival_id)
  );

drop policy if exists event_inventory_staff_read on event_inventory;
create policy event_inventory_staff_read on event_inventory
  for select using (
    exists (
      select 1 from events e
      where e.id = event_inventory.event_id
        and has_permission('content.event.read', null, e.festival_id)
    )
  );

drop policy if exists schedule_public_read on schedule_entries;
create policy schedule_public_read on schedule_entries
  for select using (status = 'PUBLISHED' or has_permission('content.event.read', null, festival_id));

drop policy if exists notices_public_read on notices;
create policy notices_public_read on notices
  for select using (
    (status = 'PUBLISHED'
      and publish_at <= now()
      and (expires_at is null or expires_at > now()))
    or has_permission('content.notice.write', null, festival_id)
  );

drop policy if exists pass_products_public_read on pass_products;
create policy pass_products_public_read on pass_products
  for select using (status = 'PUBLISHED' or has_permission('admin.access', null, festival_id));

drop policy if exists event_price_versions_public_read on event_price_versions;
create policy event_price_versions_public_read on event_price_versions
  for select using (
    exists (
      select 1 from events e
      where e.id = event_price_versions.event_id
        and (e.status = 'PUBLISHED' or has_permission('content.event.read', null, e.festival_id))
    )
  );

drop policy if exists pass_price_versions_public_read on pass_price_versions;
create policy pass_price_versions_public_read on pass_price_versions
  for select using (
    exists (
      select 1 from pass_products pp
      where pp.id = pass_price_versions.pass_product_id
        and (pp.status = 'PUBLISHED' or has_permission('admin.access', null, pp.festival_id))
    )
  );

drop policy if exists delegate_passes_own_read on delegate_passes;
create policy delegate_passes_own_read on delegate_passes
  for select using (user_id = auth.uid() or has_permission('registration.read', null, festival_id));

drop policy if exists registrations_own_read on registrations;
create policy registrations_own_read on registrations
  for select using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from events e
      where e.id = registrations.event_id
        and has_permission('registration.read', null, e.festival_id)
    )
    or exists (
      select 1 from registration_members rm
      where rm.registration_id = registrations.id and rm.user_id = auth.uid()
    )
  );

drop policy if exists registration_members_own_read on registration_members;
create policy registration_members_own_read on registration_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from registrations rg
      join events e on e.id = rg.event_id
      where rg.id = registration_members.registration_id
        and has_permission('registration.read', null, e.festival_id)
    )
  );

drop policy if exists orders_own_read on orders;
create policy orders_own_read on orders
  for select using (purchaser_user_id = auth.uid() or has_permission('finance.read', null, festival_id));

drop policy if exists order_lines_own_read on order_lines;
create policy order_lines_own_read on order_lines
  for select using (
    exists (select 1 from orders o where o.id = order_lines.order_id and o.purchaser_user_id = auth.uid())
    or exists (
      select 1 from orders o
      where o.id = order_lines.order_id
        and (has_permission('finance.read', null, o.festival_id) or has_permission('registration.read', null, o.festival_id))
    )
  );

drop policy if exists razorpay_orders_finance_read on razorpay_orders;
create policy razorpay_orders_finance_read on razorpay_orders
  for select using (
    exists (
      select 1 from orders o
      where o.id = razorpay_orders.local_order_id
        and has_permission('finance.read', null, o.festival_id)
    )
  );

drop policy if exists payments_finance_read on payments;
create policy payments_finance_read on payments
  for select using (
    exists (
      select 1 from orders o
      where o.id = payments.local_order_id
        and has_permission('finance.read', null, o.festival_id)
    )
  );

drop policy if exists refunds_finance_read on refunds;
create policy refunds_finance_read on refunds
  for select using (
    exists (
      select 1 from payments p
      join orders o on o.id = p.local_order_id
      where p.id = refunds.payment_id
        and has_permission('finance.read', null, o.festival_id)
    )
  );

drop policy if exists export_jobs_staff_read on export_jobs;
create policy export_jobs_staff_read on export_jobs
  for select using (
    has_permission('registration.export', null, festival_id)
    or has_permission('finance.read', null, festival_id)
  );

drop policy if exists audit_logs_read on audit_logs;
create policy audit_logs_read on audit_logs
  for select using (has_permission('audit.read'));

drop policy if exists qr_credentials_own_read on qr_credentials;
create policy qr_credentials_own_read on qr_credentials
  for select using (
    exists (select 1 from delegate_passes dp where dp.id = qr_credentials.delegate_pass_id and dp.user_id = auth.uid())
    or has_permission('pass.reissue', null, qr_credentials.festival_id)
  );

drop policy if exists gates_scanner_read on gates;
create policy gates_scanner_read on gates
  for select using (
    has_permission('scanner.use', null, festival_id)
    or has_permission('scanner.supervise', null, festival_id)
  );

drop policy if exists scanner_devices_manage on scanner_devices;
create policy scanner_devices_manage on scanner_devices
  for select using (has_permission('scanner.device.manage') or has_permission('scanner.use'));

drop policy if exists scan_attempts_scanner_read on scan_attempts;
create policy scan_attempts_scanner_read on scan_attempts
  for select using (
    exists (
      select 1 from gates g
      where g.id = scan_attempts.gate_id
        and has_permission('scanner.use', null, g.festival_id)
    )
    or has_permission('audit.read')
  );

drop policy if exists sponsors_public_read on sponsors;
create policy sponsors_public_read on sponsors
  for select using (is_active or has_permission('admin.access', null, festival_id));
