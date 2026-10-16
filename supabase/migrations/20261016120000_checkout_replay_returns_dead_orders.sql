-- 20261016120000_checkout_replay_returns_dead_orders.sql
--
-- Retrying a checkout with the same Idempotency-Key after its order had
-- expired or been cancelled (buyer closes Razorpay, the hold lapses, buyer
-- taps Buy again) fell through the replay check and inserted a second order
-- with the same key -> unique violation -> HTTP 409 "already registered".
-- Replays now return the original order in any state; the browser renews its
-- key when that order is dead. Bodies are otherwise unchanged from the
-- current definitions (20261013130000 / 0024).

CREATE OR REPLACE FUNCTION public.create_base_pass_checkout(p_user_id uuid, p_festival_id uuid, p_pass_product_id uuid, p_idempotency_key uuid, p_request_hash text, p_discount_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_product pass_products;
  v_price pass_price_versions;
  v_order orders;
  v_line order_lines;
  v_existing orders;
  v_existing_key api_idempotency;
  v_discount jsonb;
  v_discount_code_id uuid;
  v_discount_paise bigint := 0;
  v_discount_snapshot text;
begin
  -- 1. Lock participant guard row (also serializes per-user discount limits).
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
    -- Same key, same request: always the same order, whatever its state.
    -- Falling through for an EXPIRED/CANCELLED order re-inserted this key
    -- and failed on the unique constraint (surfaced as a 409); the client
    -- sees the dead state and starts over with a fresh key.
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

  -- 4. Auto-cancel prior abandoned order for THIS pass product. Runs before
  --    the discount check so an abandoned attempt does not use up the
  --    user's own redemption.
  update orders
  set checkout_state = 'CANCELLED',
      updated_at = clock_timestamp()
  where purchaser_user_id = p_user_id
    and festival_id = p_festival_id
    and kind = 'BASE_PASS'
    and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
    and id in (
      select ol.order_id from order_lines ol
      where ol.pass_product_id = p_pass_product_id
    );

  -- 5. Snapshot current dynamic price version.
  select * into v_price from pass_price_versions
  where id = v_product.current_price_version_id;
  if not found then
    raise exception 'NOT_FOUND missing price version' using errcode = 'P0002';
  end if;

  -- 6. Discount: computed server-side, code row locked against concurrent
  --    redemptions (lock order: profile -> pass product -> discount code).
  if p_discount_code is not null and btrim(p_discount_code) <> '' then
    v_discount := evaluate_pass_discount(
      p_user_id, p_festival_id, p_pass_product_id, p_discount_code,
      v_price.unit_amount_paise, true
    );
    v_discount_code_id := (v_discount ->> 'codeId')::uuid;
    v_discount_paise := (v_discount ->> 'discountPaise')::bigint;
    v_discount_snapshot := v_discount ->> 'code';
  end if;

  -- 7. Insert order + line. The line keeps the full price; the order total
  --    carries the discount.
  insert into orders (
    festival_id, purchaser_user_id, kind, idempotency_key, request_hash,
    checkout_state, amount_paise, currency,
    discount_code_id, discount_paise, discount_code_snapshot
  ) values (
    p_festival_id, p_user_id, 'BASE_PASS', p_idempotency_key, p_request_hash,
    'PROVISIONING_PROVIDER', v_price.unit_amount_paise - v_discount_paise, v_price.currency,
    v_discount_code_id, v_discount_paise, v_discount_snapshot
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
  );

  return jsonb_build_object('orderId', v_order.id, 'replayed', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_checkout(p_user_id uuid, p_festival_id uuid, p_event_id uuid, p_team_draft_id uuid, p_idempotency_key uuid, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event events;
  v_inv event_inventory;
  v_price event_price_versions;
  v_order orders;
  v_line order_lines;
  v_hold capacity_holds;
  v_existing orders;
  v_existing_key api_idempotency;
  v_stale_order record;
  v_participants uuid[];
  v_mode registration_mode;
  v_team_size integer;
  v_req_units integer;
  v_total_amount bigint;
  v_member uuid;
  v_pass_id uuid;
begin
  -- 1. Lock purchaser profile row.
  perform 1 from profiles where user_id = p_user_id for update;

  -- 2. Idempotent replay check.
  select * into v_existing_key
  from api_idempotency
  where scope = p_user_id::text || ':event:' || p_event_id::text
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_key.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '40001';
    end if;
    select * into v_existing from orders where id = v_existing_key.resource_id;
    -- Same key, same request: always the same order, whatever its state.
    -- Falling through for an EXPIRED/CANCELLED order re-inserted this key
    -- and failed on the unique constraint (surfaced as a 409); the client
    -- sees the dead state and starts over with a fresh key.
    if found then
      return jsonb_build_object('orderId', v_existing.id, 'replayed', true);
    end if;
  end if;

  -- 3. Resolve participant list & validate registration mode.
  if p_team_draft_id is not null then
    v_mode := 'TEAM';
    select array_agg(tdm.user_id order by tdm.user_id) into v_participants
    from team_draft_members tdm
    where tdm.team_draft_id = p_team_draft_id and tdm.status = 'ACCEPTED';

    if v_participants is null or array_length(v_participants, 1) is null then
      raise exception 'TEAM_NOT_READY no accepted members' using errcode = '55000';
    end if;

    if not (p_user_id = any(v_participants)) then
      raise exception 'FORBIDDEN captain must be in team' using errcode = '42501';
    end if;
  else
    v_mode := 'INDIVIDUAL';
    v_participants := array[p_user_id];
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
    select o.id, ol.id as line_id, ol.capacity_units from orders o
    join order_lines ol on ol.order_id = o.id
    where o.purchaser_user_id = p_user_id
      and o.festival_id = p_festival_id
      and o.kind = 'EVENT'
      and ol.event_id = p_event_id
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
  loop
    update capacity_holds
    set state = 'RELEASED',
        released_at = clock_timestamp()
    where order_line_id = v_stale_order.line_id and state = 'ACTIVE';

    update event_participant_claims
    set state = 'RELEASED',
        expires_at = clock_timestamp()
    where order_line_id = v_stale_order.line_id and state = 'HELD';

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

  -- 8. Compute capacity units and total price.
  if v_event.capacity_basis = 'PARTICIPANT' then
    v_req_units := v_team_size;
  else
    v_req_units := 1;
  end if;

  if v_event.price_basis = 'PARTICIPANT' then
    v_total_amount := v_price.unit_amount_paise * v_team_size;
  else
    v_total_amount := v_price.unit_amount_paise;
  end if;

  -- 9. Check and decrement available inventory.
  if (v_inv.capacity_units - v_inv.held_units - v_inv.confirmed_units) < v_req_units then
    raise exception 'SOLD_OUT' using errcode = '55000';
  end if;

  update event_inventory
  set held_units = held_units + v_req_units,
      version = version + 1,
      updated_at = clock_timestamp()
  where event_id = p_event_id;

  -- 10. Insert order + order line.
  insert into orders (
    festival_id, purchaser_user_id, kind, idempotency_key, request_hash,
    checkout_state, amount_paise, currency
  ) values (
    p_festival_id, p_user_id, 'EVENT', p_idempotency_key, p_request_hash,
    'PROVISIONING_PROVIDER', v_total_amount, v_price.currency
  )
  returning * into v_order;

  insert into order_lines (
    order_id, line_kind, event_id, event_price_version_id,
    unit_amount_paise, charge_quantity, capacity_units, team_size,
    line_amount_paise, description_snapshot, registration_mode_snapshot
  ) values (
    v_order.id, 'EVENT', p_event_id, v_price.id,
    v_price.unit_amount_paise,
    case when v_event.price_basis = 'PARTICIPANT' then v_team_size else 1 end,
    v_req_units, v_team_size, v_total_amount, v_event.name, v_mode
  )
  returning * into v_line;

  -- 11. Insert capacity hold (15 min window).
  insert into capacity_holds (
    order_line_id, event_id, units, state,
    expires_at
  ) values (
    v_line.id, p_event_id, v_req_units, 'ACTIVE',
    clock_timestamp() + interval '15 minutes'
  )
  returning * into v_hold;

  -- 12. Lock participant claims and attach participant records.
  foreach v_member in array v_participants loop
    select id into v_pass_id from delegate_passes
    where user_id = v_member and festival_id = p_festival_id and state = 'ACTIVE'
    order by created_at desc limit 1;

    insert into event_participant_claims (
      event_id, user_id, order_line_id, state, expires_at
    ) values (
      p_event_id, v_member, v_line.id, 'HELD',
      clock_timestamp() + interval '15 minutes'
    );

    insert into order_participants (
      order_line_id, user_id, delegate_pass_id, role
    ) values (
      v_line.id, v_member, v_pass_id,
      case when v_member = p_user_id and v_mode = 'TEAM' then 'CAPTAIN'::participant_role else 'MEMBER'::participant_role end
    );
  end loop;

  -- 13. Lock team draft state during checkout.
  if p_team_draft_id is not null then
    update team_drafts
    set status = 'LOCKED_FOR_CHECKOUT',
        version = version + 1,
        updated_at = clock_timestamp()
    where id = p_team_draft_id;
  end if;

  -- 14. Record idempotency entry.
  insert into api_idempotency (
    scope, idempotency_key, request_hash, resource_type, resource_id,
    response_status, response_body, state
  ) values (
    p_user_id::text || ':event:' || p_event_id::text, p_idempotency_key, p_request_hash,
    'order', v_order.id, 201, jsonb_build_object('orderId', v_order.id),
    'COMPLETED'
  );

  -- 15. Count unique participants (returns units reserved) and return.
  return jsonb_build_object(
    'orderId', v_order.id,
    'kind', 'EVENT',
    'checkoutState', v_order.checkout_state,
    'amountPaise', v_total_amount,
    'currency', v_price.currency,
    'participantCount', array_length(v_participants, 1)
  );
end;
$function$;
