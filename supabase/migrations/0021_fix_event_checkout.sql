-- 0021_fix_event_checkout.sql
-- create_event_checkout (0017) referenced schema that does not exist:
--   - `team_members` / `joined_at`            -> team_draft_members (status = 'ACCEPTED')
--   - `capacity_basis = 'PER_PERSON'`         -> enum is TEAM | PARTICIPANT
--   - `price_basis = 'PER_PERSON'`            -> enum is REGISTRATION | PARTICIPANT
--   - `capacity_holds.order_id`               -> capacity_holds has order_line_id only
--     (the stale-order cleanup also set a nonexistent `updated_at`)
--   - `event_participant_claims.festival_id`  -> column does not exist
--
-- Event checkouts therefore failed (or undercharged) whenever this function
-- ran. Re-create with the same behavior but references matching the schema.

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
    if found and v_existing.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED') then
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
      case when v_member = p_user_id and v_mode = 'TEAM' then 'CAPTAIN' else 'MEMBER' end
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
    'IN_PROGRESS'
  );

  return jsonb_build_object('orderId', v_order.id, 'holdId', v_hold.id, 'replayed', false);
end;
$$;
