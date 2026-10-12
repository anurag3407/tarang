-- 0013: independent_entities_and_verification
-- Separates Basic Card and Delegate Pass into independent entities (no prerequisite or upgrade chain).
-- Ensures mail and QR codes are generated exclusively for Delegate Passes, not Basic Cards.
-- Provides gate lookup RPC for unique string verification with email and participant data.

-- 1. Ensure requires_base_pass is false for all pass products
update pass_products
set requires_base_pass = false;

-- 2. Allow holding both a Basic Card and a Delegate Pass independently
drop index if exists delegate_passes_one_active_base;

create unique index if not exists delegate_passes_one_active_per_product
  on delegate_passes (festival_id, user_id, pass_product_id)
  where state = 'ACTIVE';

-- ---------------------------------------------------------------------
-- create_base_pass_checkout (independent entities, no prerequisite)
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

  -- 4. Reject if an open base-pass order already exists for this user.
  if exists (
    select 1 from orders o
    where o.purchaser_user_id = p_user_id
      and o.festival_id = p_festival_id
      and o.kind = 'BASE_PASS'
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
  ) then
    raise exception 'BASE_PASS_EXISTS' using errcode = '23505';
  end if;

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
-- apply_captured_payment (email/QR only for Delegate Pass, not Basic)
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

    if v_hold is not null and v_hold.state = 'ACTIVE' and v_hold.expires_at > clock_timestamp() then
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

    elsif v_hold is not null and (v_hold.state in ('EXPIRED', 'RELEASED')
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

  else
    -- BASE_PASS fulfillment.
    select * into v_product from pass_products where id = v_line.pass_product_id;

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
-- verify_gate_pass_lookup (Gate lookup by unique string or email)
-- ---------------------------------------------------------------------
create or replace function verify_gate_pass_lookup(
  p_query text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass record;
  v_query text := trim(p_query);
begin
  select
    dp.id as pass_id,
    dp.public_pass_code,
    dp.state,
    dp.activated_at,
    dp.expires_at,
    pp.name as product_name,
    pp.slug as product_slug,
    pp.is_base_pass,
    p.display_name,
    p.college_name,
    u.email
  into v_pass
  from delegate_passes dp
  join pass_products pp on pp.id = dp.pass_product_id
  join auth.users u on u.id = dp.user_id
  left join profiles p on p.user_id = dp.user_id
  where (
    dp.public_pass_code ilike v_query
    or u.email ilike v_query
  )
  and dp.state = 'ACTIVE'
  order by dp.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'passId', v_pass.pass_id,
    'publicPassCode', v_pass.public_pass_code,
    'state', v_pass.state,
    'productName', v_pass.product_name,
    'productSlug', v_pass.product_slug,
    'isBasePass', v_pass.is_base_pass,
    'displayName', v_pass.display_name,
    'collegeName', v_pass.college_name,
    'email', v_pass.email,
    'activatedAt', v_pass.activated_at,
    'expiresAt', v_pass.expires_at
  );
end;
$$;
