-- 0011: security lockdown + payment-flow hardening.
--
-- Findings addressed:
--   1. CRITICAL — every SECURITY DEFINER function was executable by PUBLIC
--      (Postgres default). Any signed-in user (and even anonymous callers)
--      could call financial RPCs directly through PostgREST
--      (/rest/v1/rpc/...), bypassing the Next.js Route Handlers entirely:
--        - apply_captured_payment  -> fulfill any order WITHOUT paying
--        - attach_razorpay_order   -> wire any provider order to any local order
--        - create_event_checkout / create_base_pass_checkout -> grab inventory
--        - expire_holds_batch      -> release other users' holds
--        - record_scan             -> forge admissions
--        - claim_outbox_jobs / claim_email_jobs -> steal worker jobs
--      Only resolve_user_id_by_email (0010) had been locked down.
--   2. HIGH — admin_upsert_event enforced content.event.write but not
--      content.event.price.write, so a staff role with event-write (e.g.
--      Event Manager) could change prices by calling the RPC directly even
--      though the API route checks the price permission.
--   3. HIGH — an abandoned base-pass order (PROVISIONING_PROVIDER /
--      AWAITING_PAYMENT) blocked the user from retrying forever: base-pass
--      orders carry no capacity hold, so the hold reaper never expires them
--      and the one-open-base-pass check rejected every new attempt.
--
-- Refunds are intentionally NOT automated on this platform: payments that
-- cannot be fulfilled stay in REFUND_REQUIRED / PAYMENT_REVIEW as manual
-- obligations settled by the organizers. No refund submission path exists.

-- ---------------------------------------------------------------------
-- 1. Lock financial / checkout / worker / scanner functions to service_role.
--    The Next.js server calls all of these through the service-role client;
--    no browser session ever needs them.
-- ---------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'create_base_pass_checkout',
        'create_event_checkout',
        'expire_holds_batch',
        'attach_razorpay_order',
        'apply_captured_payment',
        'cancel_registration_with_refund',
        'claim_outbox_jobs',
        'complete_outbox_job',
        'fail_outbox_job',
        'claim_email_jobs',
        'record_email_event',
        'record_scan',
        'anonymize_old_scan_attempts',
        'purge_expired_exports',
        'purge_old_webhook_bodies'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- RBAC helpers callable by signed-in sessions (they only expose the caller's
-- own authorization state via auth.uid()). Anonymous callers get nothing.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'current_staff_assignment',
        'is_superadmin',
        'active_superadmin_count',
        'write_audit',
        'admin_upsert_event',
        'admin_set_event_capacity',
        'admin_publish_event',
        'admin_upsert_schedule_entry',
        'admin_upsert_notice'
      ])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- NOTE: has_permission keeps its default PUBLIC execute grant on purpose:
-- RLS policies evaluate it as the calling role (including anon for public
-- reads). It returns only a boolean about auth.uid() and leaks no rows.

-- ---------------------------------------------------------------------
-- 2. admin_upsert_event: require content.event.price.write for price changes.
--    Identical to the 0004 definition except for the marked price guard.
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
    -- PRICE GUARD (0011): changing the amount requires the dedicated price
    -- permission even when the call comes straight through PostgREST.
    if not has_permission('content.event.price.write') then
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

-- ---------------------------------------------------------------------
-- 3. create_base_pass_checkout: self-heal stale abandoned base-pass orders.
--    Identical to the 0005 definition except an open base-pass order older
--    than 20 minutes is cancelled in place (Razorpay orders expire after 15
--    minutes, so nothing payable is lost), and a still-open recent order
--    raises a distinct BASE_PASS_ORDER_OPEN error with a friendly message.
-- ---------------------------------------------------------------------
create or replace function create_base_pass_checkout(
  p_user_id uuid,
  p_festival_id uuid,
  p_pass_product_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product pass_products;
  v_price pass_price_versions;
  v_order orders;
  v_line order_lines;
  v_existing orders;
  v_existing_key api_idempotency;
begin
  -- 1. Lock participant guard row.
  perform 1 from profiles where user_id = p_user_id for update;

  -- Idempotent replay: same key + same hash returns the original order.
  select * into v_existing_key
  from api_idempotency
  where scope = p_user_id::text || ':base-pass'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_key.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '40001';
    end if;
    select * into v_existing from orders where id = v_existing_key.resource_id;
    if found then
      return jsonb_build_object('orderId', v_existing.id, 'replayed', true);
    end if;
  end if;

  -- 2. Verify product state/window.
  select * into v_product from pass_products
  where id = p_pass_product_id and festival_id = p_festival_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_product.sales_state not in ('OPEN', 'SCHEDULED') or v_product.status <> 'PUBLISHED' then
    raise exception 'SALES_CLOSED' using errcode = '55000';
  end if;

  -- 3. Reject if an active base pass exists.
  if exists (
    select 1 from delegate_passes dp
    where dp.user_id = p_user_id and dp.festival_id = p_festival_id and dp.state = 'ACTIVE'
  ) then
    raise exception 'BASE_PASS_EXISTS' using errcode = '23505';
  end if;

  -- (0011) Cancel stale abandoned base-pass orders so the user can retry.
  -- Base-pass orders hold no inventory, so the hold reaper never touches
  -- them; without this they would block checkout forever.
  update orders
  set checkout_state = 'CANCELLED', updated_at = clock_timestamp()
  where purchaser_user_id = p_user_id
    and festival_id = p_festival_id
    and kind = 'BASE_PASS'
    and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
    and created_at < clock_timestamp() - interval '20 minutes';

  -- Reject if a recent open base-pass order already exists.
  if exists (
    select 1 from orders o
    where o.purchaser_user_id = p_user_id
      and o.festival_id = p_festival_id
      and o.kind = 'BASE_PASS'
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
  ) then
    raise exception 'BASE_PASS_ORDER_OPEN' using errcode = '55000';
  end if;

  -- 5. Snapshot current price version.
  select * into v_price from pass_price_versions
  where id = v_product.current_price_version_id;
  if not found then
    raise exception 'NOT_FOUND missing price version' using errcode = 'P0002';
  end if;

  -- 6. Insert order + line.
  insert into orders (
    festival_id, purchaser_user_id, kind, idempotency_key, request_hash,
    checkout_state, amount_paise, currency
  ) values (
    p_festival_id, p_user_id, 'BASE_PASS', p_idempotency_key, p_request_hash,
    'PROVISIONING_PROVIDER', v_price.unit_amount_paise, v_price.currency
  )
  returning * into v_order;

  insert into order_lines (
    order_id, line_kind, pass_product_id, pass_price_version_id,
    unit_amount_paise, charge_quantity, capacity_units, team_size,
    line_amount_paise, description_snapshot
  ) values (
    v_order.id, 'PASS', v_product.id, v_price.id,
    v_price.unit_amount_paise, 1, 0, 1,
    v_price.unit_amount_paise, v_product.name
  )
  returning * into v_line;

  -- 7. Idempotency resource mapping.
  insert into api_idempotency (scope, idempotency_key, request_hash, resource_type, resource_id, state)
  values (p_user_id::text || ':base-pass', p_idempotency_key, p_request_hash, 'order', v_order.id, 'IN_PROGRESS');

  return jsonb_build_object('orderId', v_order.id, 'replayed', false);
end;
$$;

-- Re-assert the lockdown for the two functions recreated above.
-- (CREATE OR REPLACE preserves existing privileges, so this is a safety net
-- in case the functions were ever dropped/recreated with default grants.)
do $$
declare
  f regprocedure;
begin
  select p.oid::regprocedure into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_upsert_event'
  limit 1;
  if f is not null then
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end if;

  select p.oid::regprocedure into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_base_pass_checkout'
  limit 1;
  if f is not null then
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end if;
end;
$$;
