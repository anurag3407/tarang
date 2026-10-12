-- Migration 0014: Auto-cancel abandoned orders on new checkout attempt & publish sales state fix

-- 1. admin_publish_event: automatically set sales_state to OPEN when publishing
create or replace function public.admin_publish_event(p_event_id uuid)
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

-- 2. create_base_pass_checkout: auto-cancel prior abandoned orders
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
    if found and v_existing.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED') then
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

  -- 3. Reject if user already has an active pass for THIS specific product tier
  if exists (
    select 1 from delegate_passes dp
    where dp.user_id = p_user_id
      and dp.festival_id = p_festival_id
      and dp.pass_product_id = p_pass_product_id
      and dp.state = 'ACTIVE'
  ) then
    raise exception 'BASE_PASS_EXISTS' using errcode = '23505';
  end if;

  -- 4. Auto-cancel any prior abandoned / unfulfilled base-pass order for this user
  update orders
  set checkout_state = 'CANCELLED',
      updated_at = clock_timestamp()
  where purchaser_user_id = p_user_id
    and festival_id = p_festival_id
    and kind = 'BASE_PASS'
    and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

  -- 5. Snapshot current dynamic price version.
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
    v_price.unit_amount_paise, 1, 1, 1,
    v_price.unit_amount_paise, v_product.name
  )
  returning * into v_line;

  insert into api_idempotency (
    scope, idempotency_key, request_hash, resource_type, resource_id,
    response_status, response_body, state
  ) values (
    p_user_id::text || ':base-pass', p_idempotency_key, p_request_hash,
    'order', v_order.id, 201, jsonb_build_object('orderId', v_order.id),
    'IN_PROGRESS'
  )
  on conflict (scope, idempotency_key) do update
  set request_hash = p_request_hash,
      resource_id = v_order.id,
      response_status = 201,
      response_body = jsonb_build_object('orderId', v_order.id),
      state = 'IN_PROGRESS';

  return jsonb_build_object('orderId', v_order.id, 'replayed', false);
end;
$$;

-- 3. create_event_checkout: auto-cancel prior abandoned orders and return holds
create or replace function create_event_checkout(
  p_user_id uuid,
  p_festival_id uuid,
  p_event_id uuid,
  p_team_draft_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
  v_price event_price_versions;
  v_inv event_inventory;
  v_order orders;
  v_line order_lines;
  v_existing_key api_idempotency;
  v_existing orders;
  v_participants uuid[];
  v_uid uuid;
  v_team_size integer;
  v_capacity_units integer;
  v_charge_quantity integer;
  v_amount bigint;
  v_mode registration_mode;
  v_stale_order record;
begin
  -- Idempotent replay.
  select * into v_existing_key
  from api_idempotency
  where scope = p_user_id::text || ':event-checkout'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_key.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '40001';
    end if;
    select * into v_existing from orders where id = v_existing_key.resource_id;
    if found and v_existing.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED') then
      return jsonb_build_object('orderId', v_existing.id, 'replayed', true);
    end if;
  end if;

  -- 1. Resolve participants.
  if p_team_draft_id is null then
    v_participants := array[p_user_id];
    v_mode := 'INDIVIDUAL';
  else
    select array_agg(tdm.user_id order by tdm.user_id) into v_participants
    from team_draft_members tdm
    where tdm.team_draft_id = p_team_draft_id and tdm.status = 'ACCEPTED';
    v_mode := 'TEAM';
    if v_participants is null or array_length(v_participants, 1) is null then
      raise exception 'TEAM_NOT_READY' using errcode = '55000';
    end if;
  end if;

  -- 2. Lock participant rows sorted by UUID.
  for v_uid in select unnest(v_participants) order by 1 loop
    perform 1 from profiles where user_id = v_uid for update;
  end loop;

  -- 3. Every participant must have an active base pass.
  if exists (
    select 1 from unnest(v_participants) as u(uid)
    where not exists (
      select 1 from delegate_passes dp
      where dp.user_id = u.uid and dp.festival_id = p_festival_id and dp.state = 'ACTIVE'
    )
  ) then
    raise exception 'BASE_PASS_REQUIRED' using errcode = '55000';
  end if;

  -- 4. Lock team draft and verify captain/ready/size.
  if p_team_draft_id is not null then
    perform 1 from team_drafts td
    where td.id = p_team_draft_id
      and td.event_id = p_event_id
      and td.captain_user_id = p_user_id
      and td.status in ('DRAFT', 'READY')
    for update;
    if not found then
      raise exception 'TEAM_LOCKED' using errcode = '55000';
    end if;
  end if;

  -- Auto-cancel any prior abandoned unfulfilled event order for this user & event
  for v_stale_order in
    select o.id, ol.capacity_units from orders o
    join order_lines ol on ol.order_id = o.id
    where o.purchaser_user_id = p_user_id
      and o.festival_id = p_festival_id
      and o.kind = 'EVENT'
      and ol.event_id = p_event_id
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
  loop
    update capacity_holds
    set state = 'RELEASED',
        released_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where order_id = v_stale_order.id and state = 'ACTIVE';

    update event_inventory
    set held_units = greatest(0, held_units - coalesce(v_stale_order.capacity_units, 0)),
        version = version + 1,
        updated_at = clock_timestamp()
    where event_id = p_event_id;

    update orders
    set checkout_state = 'CANCELLED',
        updated_at = clock_timestamp()
    where id = v_stale_order.id;
  end loop;

  -- 5. Lock event and inventory.
  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_inv from event_inventory where event_id = p_event_id for update;

  -- 6. Verify published, sales open, registration window.
  if v_event.status <> 'PUBLISHED' then
    raise exception 'SALES_CLOSED' using errcode = '55000';
  end if;
  if v_event.sales_state = 'PAUSED' then
    raise exception 'SALES_PAUSED' using errcode = '55000';
  end if;
  if v_event.sales_state not in ('OPEN', 'SCHEDULED') then
    raise exception 'SALES_CLOSED' using errcode = '55000';
  end if;
  if v_event.registration_mode <> v_mode then
    raise exception 'VALIDATION_FAILED registration mode mismatch' using errcode = '23514';
  end if;
  if v_event.registration_opens_at is not null and now() < v_event.registration_opens_at then
    raise exception 'REGISTRATION_WINDOW_CLOSED' using errcode = '55000';
  end if;
  if v_event.registration_closes_at is not null and now() > v_event.registration_closes_at then
    raise exception 'REGISTRATION_WINDOW_CLOSED' using errcode = '55000';
  end if;

  -- Team size validation.
  v_team_size := coalesce(array_length(v_participants, 1), 1);
  if v_mode = 'TEAM' and (v_team_size < v_event.min_team_size or v_team_size > v_event.max_team_size) then
    raise exception 'TEAM_NOT_READY invalid team size' using errcode = '55000';
  end if;

  -- 7. Snapshot immutable price version.
  select * into v_price from event_price_versions
  where id = v_event.current_price_version_id;
  if not found then
    raise exception 'NOT_FOUND missing price version' using errcode = 'P0002';
  end if;

  -- 8. Calculate units and amount.
  v_capacity_units := case when v_event.capacity_basis = 'PARTICIPANT' then v_team_size else 1 end;
  v_charge_quantity := case when v_event.price_basis = 'PARTICIPANT' then v_team_size else 1 end;
  v_amount := v_price.unit_amount_paise * v_charge_quantity;

  -- 9. Atomically reserve inventory.
  update event_inventory
  set held_units = held_units + v_capacity_units,
      version = version + 1,
      updated_at = clock_timestamp()
  where event_id = p_event_id
    and capacity_units - held_units - confirmed_units >= v_capacity_units
  returning * into v_inv;

  if not found then
    raise exception 'SOLD_OUT' using errcode = '55000';
  end if;

  -- 10. Insert order, line, participant snapshots, hold, claims.
  insert into orders (
    festival_id, purchaser_user_id, kind, idempotency_key, request_hash,
    checkout_state, amount_paise, currency,
    hold_expires_at, settlement_deadline_at
  ) values (
    p_festival_id, p_user_id, 'EVENT', p_idempotency_key, p_request_hash,
    'PROVISIONING_PROVIDER', v_amount, v_price.currency,
    clock_timestamp() + interval '10 minutes',
    clock_timestamp() + interval '40 minutes'
  )
  returning * into v_order;

  insert into order_lines (
    order_id, line_kind, event_id, event_price_version_id,
    unit_amount_paise, charge_quantity, capacity_units, team_size,
    registration_mode_snapshot, capacity_basis_snapshot, price_basis_snapshot,
    line_amount_paise, description_snapshot
  ) values (
    v_order.id, 'EVENT', v_event.id, v_price.id,
    v_price.unit_amount_paise, v_charge_quantity, v_capacity_units, v_team_size,
    v_event.registration_mode, v_event.capacity_basis, v_event.price_basis,
    v_amount, v_event.name
  )
  returning * into v_line;

  insert into order_participants (order_line_id, user_id, delegate_pass_id, role)
  select v_line.id, u.uid,
         (select dp.id from delegate_passes dp
           where dp.user_id = u.uid and dp.festival_id = p_festival_id and dp.state = 'ACTIVE'
           limit 1),
         case
           when v_mode = 'INDIVIDUAL' then 'INDIVIDUAL'::participant_role
           when u.uid = p_user_id then 'CAPTAIN'::participant_role
           else 'MEMBER'::participant_role
         end
  from unnest(v_participants) as u(uid);

  insert into capacity_holds (order_line_id, event_id, units, state, expires_at)
  values (v_line.id, p_event_id, v_capacity_units, 'ACTIVE',
          clock_timestamp() + interval '10 minutes');

  insert into event_participant_claims (event_id, user_id, order_line_id, state, expires_at)
  select p_event_id, u.uid, v_line.id, 'HELD', clock_timestamp() + interval '10 minutes'
  from unnest(v_participants) as u(uid);

  if p_team_draft_id is not null then
    update team_drafts
    set status = 'LOCKED_FOR_CHECKOUT',
        version = version + 1,
        updated_at = clock_timestamp()
    where id = p_team_draft_id;
  end if;

  insert into api_idempotency (
    scope, idempotency_key, request_hash, resource_type, resource_id,
    response_status, response_body, state
  ) values (
    p_user_id::text || ':event-checkout', p_idempotency_key, p_request_hash,
    'order', v_order.id, 201, jsonb_build_object('orderId', v_order.id),
    'IN_PROGRESS'
  )
  on conflict (scope, idempotency_key) do update
  set request_hash = p_request_hash,
      resource_id = v_order.id,
      response_status = 201,
      response_body = jsonb_build_object('orderId', v_order.id),
      state = 'IN_PROGRESS';

  return jsonb_build_object(
    'orderId', v_order.id,
    'replayed', false,
    'amountPaise', v_amount
  );
end;
$$;
