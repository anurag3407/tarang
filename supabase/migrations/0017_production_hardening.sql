-- 0017_production_hardening.sql
-- Production readiness fixes:
--   1. C1: Lock down verify_gate_pass_lookup from public/anon/authenticated to service_role.
--   2. C2: Fix captured EVENT payment with missing hold -> REFUND_REQUIRED / PAYMENT_REVIEW.
--   3. C7: Guard against duplicate active pass in apply_captured_payment -> REFUND_REQUIRED / PAYMENT_REVIEW.
--   4. R16: Release event_participant_claims in create_event_checkout stale-order cleanup.
--   5. R15: Scope create_base_pass_checkout auto-cancellation to matching pass product.
--   6. R17: Restrict public price versions read to PUBLISHED items.
--   7. R1: Restrict profiles_own_update with check to prevent self-unban.

-- ---------------------------------------------------------------------
-- 1. Restrict RLS policies
-- ---------------------------------------------------------------------
drop policy if exists event_price_versions_public_read on event_price_versions;
create policy event_price_versions_public_read on event_price_versions
  for select using (
    exists (
      select 1 from events e
      where e.id = event_price_versions.event_id
        and (e.status = 'PUBLISHED' or has_permission('content.event.read'))
    )
  );

drop policy if exists pass_price_versions_public_read on pass_price_versions;
create policy pass_price_versions_public_read on pass_price_versions
  for select using (
    exists (
      select 1 from pass_products pp
      where pp.id = pass_price_versions.pass_product_id
        and (pp.status = 'PUBLISHED' or has_permission('admin.access'))
    )
  );

drop policy if exists profiles_own_update on profiles;
create policy profiles_own_update on profiles
  for update using (user_id = auth.uid() and status = 'ACTIVE')
  with check (user_id = auth.uid() and status = 'ACTIVE');

-- ---------------------------------------------------------------------
-- 2. create_base_pass_checkout (Scoped auto-cancellation by product)
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

  -- 4. Auto-cancel prior abandoned order for THIS pass product
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
  );

  return jsonb_build_object('orderId', v_order.id, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. create_event_checkout (Release participant claims on stale order cleanup)
-- ---------------------------------------------------------------------
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
    select array_agg(user_id order by joined_at) into v_participants
    from team_members
    where team_draft_id = p_team_draft_id;

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
        released_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where order_id = v_stale_order.id and state = 'ACTIVE';

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
  if v_event.capacity_basis = 'PER_PERSON' then
    v_req_units := v_team_size;
  else
    v_req_units := 1;
  end if;

  if v_event.price_basis = 'PER_PERSON' then
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
    case when v_event.price_basis = 'PER_PERSON' then v_team_size else 1 end,
    v_req_units, v_team_size, v_total_amount, v_event.name, v_mode
  )
  returning * into v_line;

  -- 11. Insert capacity hold (15 min window).
  insert into capacity_holds (
    order_id, order_line_id, event_id, units, state,
    expires_at
  ) values (
    v_order.id, v_line.id, p_event_id, v_req_units, 'ACTIVE',
    clock_timestamp() + interval '15 minutes'
  )
  returning * into v_hold;

  -- 12. Lock participant claims and attach participant records.
  foreach v_member in array v_participants loop
    select id into v_pass_id from delegate_passes
    where user_id = v_member and festival_id = p_festival_id and state = 'ACTIVE'
    order by created_at desc limit 1;

    insert into event_participant_claims (
      festival_id, event_id, user_id, order_line_id, state, expires_at
    ) values (
      p_festival_id, p_event_id, v_member, v_line.id, 'HELD',
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

-- ---------------------------------------------------------------------
-- 4. apply_captured_payment (Fix NO_HOLD and duplicate pass edge cases)
-- ---------------------------------------------------------------------
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

  -- Resolve local order mapping.
  select * into v_mapping from razorpay_orders
  where razorpay_order_id = p_razorpay_order_id;
  if not found then
    return jsonb_build_object('result', 'ORPHAN', 'paymentId', v_payment.id);
  end if;

  -- 2. Lock order (global lock order), then line/hold.
  select * into v_order from orders where id = v_mapping.local_order_id for update;
  if not found then
    return jsonb_build_object('result', 'ORDER_NOT_FOUND');
  end if;

  -- 3. Verify exact amount and currency.
  if v_order.amount_paise <> p_amount_paise or v_order.currency <> p_currency then
    update payments set disposition = 'REVIEW' where id = v_payment.id;
    return jsonb_build_object('result', 'AMOUNT_MISMATCH', 'paymentId', v_payment.id);
  end if;

  update payments set local_order_id = v_order.id where id = v_payment.id;

  -- 4. At-most-once: return existing fulfillment result.
  select * into v_app from payment_applications where order_id = v_order.id;
  if found then
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id);
  end if;

  if v_order.checkout_state = 'FULFILLED' then
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id);
  end if;

  select * into v_line from order_lines where order_id = v_order.id for update;

  -- 5. Active hold path for EVENT.
  if v_line.line_kind = 'EVENT' then
    select * into v_hold from capacity_holds
    where order_line_id = v_line.id for update;

    if v_hold.id is not null and v_hold.state = 'ACTIVE' and v_hold.expires_at > clock_timestamp() then
      update event_inventory
      set held_units = held_units - v_hold.units,
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
      -- No recoverable hold row: route to manual refund obligation
      update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
      update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
      where id = v_order.id;
      return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
        'reason', 'no_hold_found');
    end if;

  else
    -- BASE_PASS fulfillment.
    select * into v_product from pass_products where id = v_line.pass_product_id;

    -- Guard against duplicate active pass for this product
    if exists (
      select 1 from delegate_passes dp
      where dp.user_id = v_order.purchaser_user_id
        and dp.festival_id = v_order.festival_id
        and dp.pass_product_id = v_line.pass_product_id
        and dp.state = 'ACTIVE'
    ) then
      update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
      update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
      where id = v_order.id;
      return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
        'reason', 'pass_already_active');
    end if;

    v_is_delegate := (v_product.slug = 'vip-delegate-pass' or not v_product.is_base_pass or v_product.name ilike '%delegate%');

    -- Insert active pass record for this product tier
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

  -- Common: payment application + order fulfillment.
  insert into payment_applications (order_id, payment_id, amount_paise)
  values (v_order.id, v_payment.id, p_amount_paise);

  update payments set disposition = 'APPLIED' where id = v_payment.id;

  update orders
  set checkout_state = 'FULFILLED', fulfilled_at = clock_timestamp(),
      version = version + 1, updated_at = clock_timestamp()
  where id = v_order.id;

  update api_idempotency
  set state = 'COMPLETED', response_status = 200
  where resource_id = v_order.id;

  -- Cache invalidation outbox job
  insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
  values
    ('INVALIDATE_CACHE', 'order', v_order.id::text,
     'cache:order:' || v_order.id::text,
     jsonb_build_object('orderId', v_order.id))
  on conflict (logical_key) do nothing;

  -- EMAIL POLICY:
  -- Events get registration confirmation email.
  -- Passes: ONLY Delegate Pass gets confirmation email. Basic Card DOES NOT get an email.
  if v_order.kind = 'EVENT' or (v_order.kind = 'BASE_PASS' and v_is_delegate) then
    insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
    values
      ('SEND_EMAIL', 'order', v_order.id::text,
       'email:order-confirmation:' || v_order.id::text,
       jsonb_build_object('orderId', v_order.id, 'kind', v_order.kind))
    on conflict (logical_key) do nothing;
  end if;

  -- QR POLICY:
  -- Only Delegate Pass gets QR credential issuance. Basic Card DOES NOT get QR.
  if v_order.kind = 'BASE_PASS' and v_is_delegate then
    insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
    values ('ISSUE_QR', 'delegate_pass', v_pass.id::text,
            'qr:issue:' || v_pass.id::text,
            jsonb_build_object('delegatePassId', v_pass.id))
    on conflict (logical_key) do nothing;
  end if;

  return jsonb_build_object('result', 'FULFILLED', 'orderId', v_order.id,
    'kind', v_order.kind);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Privileges Lockdown (C1 fix + payment functions)
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
        'verify_gate_pass_lookup',
        'apply_captured_payment',
        'create_base_pass_checkout',
        'create_event_checkout'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
