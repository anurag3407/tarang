-- 0037_allow_fee_surcharge_in_payment_apply.sql
--
-- Fixes AMOUNT_MISMATCH when payment amount is >= order amount due to Razorpay
-- customer fee passing / surcharge / convenience fee (e.g. ₹1.00 order with ₹0.03 fee = ₹1.03),
-- and guards held_units against negative values using greatest(0, held_units - v_hold.units).
--

create or replace function apply_captured_payment(
  p_razorpay_payment_id text,
  p_razorpay_order_id text,
  p_amount_paise bigint,
  p_currency char(3),
  p_provider_status text,
  p_provider_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_mapping razorpay_orders;
  v_order orders;
  v_line order_lines;
  v_hold capacity_holds;
  v_app payment_applications;
  v_inv event_inventory;
  v_reg registrations;
  v_pass delegate_passes;
  v_merch_prod merchandise_products;
  v_participant record;
  v_timely boolean;
  v_product pass_products;
  v_is_delegate boolean;
begin
  -- 1. Upsert provider payment without downgrading captured state.
  insert into payments (
    razorpay_payment_id, razorpay_order_id, amount_paise, currency,
    provider_status, provider_created_at, last_observed_at
  ) values (
    p_razorpay_payment_id, p_razorpay_order_id, p_amount_paise, p_currency,
    p_provider_status, p_provider_created_at, clock_timestamp()
  )
  on conflict (razorpay_payment_id) do update set
    provider_status = case
      when payments.provider_status in ('captured', 'paid') then payments.provider_status
      else excluded.provider_status
    end,
    local_order_id = coalesce(payments.local_order_id,
      (select local_order_id from razorpay_orders where razorpay_order_id = p_razorpay_order_id)),
    last_observed_at = clock_timestamp()
  returning * into v_payment;

  -- Never fulfill on a non-captured state.
  if v_payment.provider_status not in ('captured', 'paid') then
    return jsonb_build_object('result', 'NOT_CAPTURED', 'paymentId', v_payment.id);
  end if;

  select * into v_mapping from razorpay_orders
  where razorpay_order_id = p_razorpay_order_id;
  if not found then
    return jsonb_build_object('result', 'ORPHAN', 'paymentId', v_payment.id);
  end if;

  select * into v_order from orders where id = v_mapping.local_order_id for update;
  if not found then
    return jsonb_build_object('result', 'ORDER_NOT_FOUND');
  end if;

  if v_order.checkout_state in ('CANCELLED', 'EXPIRED', 'PAYMENT_REVIEW') then
    update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
    return jsonb_build_object('result', 'REFUND_REQUIRED', 'paymentId', v_payment.id,
      'orderId', v_order.id, 'reason',
      case v_order.checkout_state
        when 'CANCELLED' then 'order_cancelled'
        when 'EXPIRED' then 'order_expired'
        else 'order_payment_review'
      end);
  end if;

  -- Allow payment if amount >= order amount (covers customer convenience fee / surcharge)
  if p_amount_paise < v_order.amount_paise or v_order.currency <> p_currency then
    update payments set disposition = 'REVIEW' where id = v_payment.id;
    return jsonb_build_object('result', 'AMOUNT_MISMATCH', 'paymentId', v_payment.id);
  end if;

  update payments set local_order_id = v_order.id where id = v_payment.id;

  select * into v_app from payment_applications where order_id = v_order.id;
  if found then
    update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id,
      'paymentId', v_payment.id);
  end if;

  if v_order.checkout_state = 'FULFILLED' then
    update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id,
      'paymentId', v_payment.id);
  end if;

  select * into v_line from order_lines where order_id = v_order.id for update;

  -- -------------------------------------------------------------------
  -- BRANCH 1: MERCHANDISE
  -- -------------------------------------------------------------------
  if v_line.line_kind = 'MERCHANDISE' then
    select * into v_hold from capacity_holds
    where order_line_id = v_line.id for update;

    if v_hold.id is not null and v_hold.state = 'ACTIVE' then
      update merchandise_products
      set held_units = greatest(0, held_units - v_hold.units),
          confirmed_units = confirmed_units + v_hold.units,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = v_line.merchandise_product_id;

      update capacity_holds set state = 'CONSUMED' where id = v_hold.id;

      update merchandise_orders
      set state = 'CONFIRMED',
          updated_at = clock_timestamp()
      where order_id = v_order.id;
    else
      -- No active hold or expired
      update merchandise_products
      set confirmed_units = confirmed_units + v_line.charge_quantity,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = v_line.merchandise_product_id;

      update merchandise_orders
      set state = 'CONFIRMED',
          updated_at = clock_timestamp()
      where order_id = v_order.id;
    end if;

  -- -------------------------------------------------------------------
  -- BRANCH 2: EVENT
  -- -------------------------------------------------------------------
  elsif v_line.line_kind = 'EVENT' then
    select * into v_hold from capacity_holds
    where order_line_id = v_line.id for update;

    if v_hold.id is not null and v_hold.state = 'ACTIVE' and v_hold.expires_at > clock_timestamp() then
      update event_inventory
      set held_units = greatest(0, held_units - v_hold.units),
          confirmed_units = confirmed_units + v_hold.units,
          version = version + 1,
          updated_at = clock_timestamp()
      where event_id = v_hold.event_id
      returning * into v_inv;

      update capacity_holds set state = 'CONSUMED' where id = v_hold.id;
      update event_participant_claims
      set state = 'CONFIRMED', expires_at = null
      where order_line_id = v_line.id and state = 'HELD';

      insert into registrations (
        order_line_id, event_id, owner_user_id, team_name, registration_mode,
        capacity_units, state, confirmed_at
      ) values (
        v_line.id, v_line.event_id, v_order.purchaser_user_id,
        (select team_name from team_drafts td
          where td.event_id = v_line.event_id
            and td.captain_user_id = v_order.purchaser_user_id
            and td.status = 'LOCKED_FOR_CHECKOUT'
          limit 1),
        coalesce(v_line.registration_mode_snapshot, 'INDIVIDUAL'),
        v_line.capacity_units, 'CONFIRMED', clock_timestamp()
      )
      returning * into v_reg;

      for v_participant in
        select op.user_id, op.delegate_pass_id, op.role
        from order_participants op where op.order_line_id = v_line.id
      loop
        insert into registration_members (registration_id, event_id, user_id, delegate_pass_id, role)
        values (v_reg.id, v_line.event_id, v_participant.user_id, v_participant.delegate_pass_id, v_participant.role);
        update event_participant_claims
        set registration_id = v_reg.id
        where order_line_id = v_line.id and user_id = v_participant.user_id;
      end loop;

      update team_drafts
      set status = 'CONFIRMED', version = version + 1, updated_at = clock_timestamp()
      where event_id = v_line.event_id
        and captain_user_id = v_order.purchaser_user_id
        and status = 'LOCKED_FOR_CHECKOUT';

    elsif v_hold.id is not null and (v_hold.state in ('EXPIRED', 'RELEASED')
        or v_hold.expires_at <= clock_timestamp()) then
      v_timely := p_provider_created_at is not null
        and v_hold.expires_at is not null
        and p_provider_created_at <= v_hold.expires_at;

      if v_timely and clock_timestamp() <= v_order.settlement_deadline_at then
        update event_inventory
        set confirmed_units = confirmed_units + v_hold.units,
            version = version + 1,
            updated_at = clock_timestamp()
        where event_id = v_hold.event_id
          and capacity_units - held_units - confirmed_units >= v_hold.units;
        if found then
          update capacity_holds set state = 'CONSUMED' where id = v_hold.id;
          update event_participant_claims
          set state = 'CONFIRMED', expires_at = null
          where order_line_id = v_line.id and state in ('HELD', 'RELEASED');

          insert into registrations (
            order_line_id, event_id, owner_user_id, registration_mode,
            capacity_units, state, confirmed_at
          ) values (
            v_line.id, v_line.event_id, v_order.purchaser_user_id,
            coalesce(v_line.registration_mode_snapshot, 'INDIVIDUAL'),
            v_line.capacity_units, 'CONFIRMED', clock_timestamp()
          )
          returning * into v_reg;

          for v_participant in
            select op.user_id, op.delegate_pass_id, op.role
            from order_participants op where op.order_line_id = v_line.id
          loop
            insert into registration_members (registration_id, event_id, user_id, delegate_pass_id, role)
            values (v_reg.id, v_line.event_id, v_participant.user_id, v_participant.delegate_pass_id, v_participant.role);
          end loop;
        else
          update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
          update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
          where id = v_order.id;
          return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
            'reason', 'late_payment_no_capacity');
        end if;
      else
        update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
        update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
        where id = v_order.id;
        return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
          'reason', 'late_payment');
      end if;
    else
      return jsonb_build_object('result', 'NO_HOLD', 'orderId', v_order.id);
    end if;

  -- -------------------------------------------------------------------
  -- BRANCH 3: BASE_PASS
  -- -------------------------------------------------------------------
  else
    select * into v_product from pass_products where id = v_line.pass_product_id;
    v_is_delegate := (v_product.slug = 'vip-delegate-pass' or not v_product.is_base_pass or v_product.name ilike '%delegate%');

    if exists (
      select 1 from delegate_passes dp
      where dp.user_id = v_order.purchaser_user_id
        and dp.festival_id = v_order.festival_id
        and dp.state = 'ACTIVE'
        and dp.pass_product_id = v_line.pass_product_id
    ) then
      update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
      update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
      where id = v_order.id;
      return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
        'reason', 'duplicate_pass_purchase');
    end if;

    if v_product.requires_base_pass or v_product.slug = 'vip-delegate-pass' then
      update delegate_passes
      set state = 'EXPIRED'
      where user_id = v_order.purchaser_user_id
        and festival_id = v_order.festival_id
        and state = 'ACTIVE';

      insert into delegate_passes (
        festival_id, user_id, pass_product_id, source_order_line_id,
        state, activated_at, expires_at
      ) values (
        v_order.festival_id, v_order.purchaser_user_id, v_line.pass_product_id, v_line.id,
        'ACTIVE', clock_timestamp(),
        v_product.valid_until
      )
      returning * into v_pass;
    else
      if exists (
        select 1 from delegate_passes dp
        where dp.user_id = v_order.purchaser_user_id
          and dp.festival_id = v_order.festival_id
          and dp.state = 'ACTIVE'
      ) then
        update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
        update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
        where id = v_order.id;
        return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
          'reason', 'base_pass_already_active');
      end if;

      insert into delegate_passes (
        festival_id, user_id, pass_product_id, source_order_line_id,
        state, activated_at, expires_at
      ) values (
        v_order.festival_id, v_order.purchaser_user_id, v_line.pass_product_id, v_line.id,
        'ACTIVE', clock_timestamp(),
        v_product.valid_until
      )
      returning * into v_pass;
    end if;
  end if;

  -- Common: payment application + order fulfillment.
  insert into payment_applications (order_id, payment_id, amount_paise)
  values (v_order.id, v_payment.id, p_amount_paise);

  update payments set disposition = 'APPLIED' where id = v_payment.id;

  update orders
  set checkout_state = 'FULFILLED',
      fulfilled_at = clock_timestamp(),
      version = version + 1,
      updated_at = clock_timestamp()
  where id = v_order.id;

  return jsonb_build_object(
    'result', 'FULFILLED',
    'orderId', v_order.id,
    'paymentId', v_payment.id
  );
end;
$$;

revoke all on function apply_captured_payment from public, anon, authenticated;
grant execute on function apply_captured_payment to service_role;
