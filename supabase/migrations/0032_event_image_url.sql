-- 0032_event_image_url.sql
-- Add image_url to events for poster / Instagram ratio card display

alter table events
  add column if not exists image_url text;

-- Drop old function signature to prevent overload ambiguity
drop function if exists admin_upsert_event(
  uuid, uuid, text, text, text, text, text, uuid, uuid,
  timestamptz, timestamptz, boolean, boolean, registration_mode,
  capacity_basis, price_basis, integer, integer, integer, bigint,
  text, timestamptz, timestamptz, boolean, integer, text
);

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
  p_change_reason text default null,
  p_image_url text default null
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
      prize_pool_text, registration_opens_at, registration_closes_at, featured,
      image_url
    ) values (
      p_festival_id, p_slug, p_name, p_short_description, p_description, p_rules_markdown,
      p_category_id, p_venue_id, p_starts_at, p_ends_at, p_include_in_schedule, p_is_night_event,
      p_registration_mode, p_capacity_basis, p_price_basis, p_min_team_size, p_max_team_size,
      p_prize_pool_text, p_registration_opens_at, p_registration_closes_at, p_featured,
      p_image_url
    )
    returning * into v_event;

    insert into event_price_versions (event_id, version, unit_amount_paise, created_by, change_reason)
    values (v_event.id, 1, p_price_paise, auth.uid(), coalesce(p_change_reason, 'initial price'))
    returning id into v_price_version_id;

    update events set current_price_version_id = v_price_version_id where id = v_event.id;
    insert into event_inventory (event_id, capacity_units) values (v_event.id, p_capacity_units);

    perform write_audit('event.create', 'event', v_event.id::text, 'SUCCESS', null, null,
      jsonb_build_object('name', p_name, 'pricePaise', p_price_paise, 'capacity', p_capacity_units, 'imageUrl', p_image_url));
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
    image_url = p_image_url,
    version = v_new_version,
    updated_at = clock_timestamp()
  where id = p_event_id
  returning * into v_event;

  perform write_audit('event.update', 'event', p_event_id::text, 'SUCCESS', null, null,
    jsonb_build_object('version', v_new_version, 'pricePaise', p_price_paise, 'imageUrl', p_image_url));
  return v_event;
end;
$$;

revoke all on function admin_upsert_event from public, anon;
grant execute on function admin_upsert_event to authenticated, service_role;
