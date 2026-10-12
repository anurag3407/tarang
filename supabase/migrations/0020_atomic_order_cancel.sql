-- 0020_atomic_order_cancel.sql
-- Close the order-cancel TOCTOU: the user-facing cancel route previously
-- read checkout_state, then updated without a state precondition (a
-- FULFILLED order could be flipped after capture), and released capacity
-- holds via a non-atomic read-modify-write (double-release races).
--
-- cancel_order() performs the state check, the state transition, hold
-- release, claim release, inventory decrement, and team-draft unlock in one
-- transaction under the order row lock. Retrying a cancelled/expired order
-- is idempotent.

create or replace function cancel_order(
  p_order_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_hold capacity_holds;
  v_released integer := 0;
begin
  -- 1. Lock the order; serializes against capture/hold-reaper/applications.
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_order.purchaser_user_id <> p_user_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. State precondition.
  if v_order.checkout_state = 'FULFILLED' then
    raise exception 'CANNOT_CANCEL_FULFILLED' using errcode = '55000';
  end if;
  if v_order.checkout_state = 'PAYMENT_REVIEW' then
    raise exception 'CANNOT_CANCEL_PAYMENT_REVIEW' using errcode = '55000';
  end if;
  if v_order.checkout_state not in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT') then
    -- Already CANCELLED/EXPIRED: idempotent success, nothing to release.
    return jsonb_build_object(
      'cancelled', false, 'orderId', v_order.id, 'state', v_order.checkout_state
    );
  end if;

  -- 3. Transition the order.
  update orders
  set checkout_state = 'CANCELLED',
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_order_id and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

  -- 4. Release active capacity holds and restore inventory, atomically.
  for v_hold in
    select ch.*
    from capacity_holds ch
    join order_lines ol on ol.id = ch.order_line_id
    where ol.order_id = p_order_id
      and ch.state = 'ACTIVE'
    for update
  loop
    update capacity_holds
    set state = 'RELEASED',
        released_at = clock_timestamp()
    where id = v_hold.id;

    update event_inventory
    set held_units = greatest(0, held_units - v_hold.units),
        version = version + 1,
        updated_at = clock_timestamp()
    where event_id = v_hold.event_id;

    update event_participant_claims
    set state = 'RELEASED'
    where order_line_id = v_hold.order_line_id and state = 'HELD';

    -- Unlock/cancel team draft locked for this checkout.
    update team_drafts td
    set status = 'DRAFT', version = version + 1, updated_at = clock_timestamp()
    where td.status = 'LOCKED_FOR_CHECKOUT'
      and td.event_id = v_hold.event_id
      and td.captain_user_id = v_order.purchaser_user_id;

    v_released := v_released + 1;
  end loop;

  return jsonb_build_object(
    'cancelled', true,
    'orderId', p_order_id,
    'state', 'CANCELLED',
    'releasedHolds', v_released
  );
end;
$$;

revoke all on function cancel_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function cancel_order(uuid, uuid) to service_role;
