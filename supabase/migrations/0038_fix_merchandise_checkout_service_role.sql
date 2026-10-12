-- 0038_fix_merchandise_checkout_service_role.sql
--
-- Fix: Remove the blocking auth.uid() check in create_merchandise_checkout.
-- When the Next.js API layer invokes the RPC using createServiceRoleClient(),
-- auth.uid() is NULL in Postgres, causing (auth.uid() is distinct from p_user_id)
-- to evaluate to TRUE and throw FORBIDDEN (error 42501).
--
-- Authorization is strictly enforced in /api/checkout/merchandise via requireUser()
-- before calling this RPC with the service_role client.
--

create or replace function create_merchandise_checkout(
  p_user_id uuid,
  p_festival_id uuid,
  p_product_id uuid,
  p_selected_size text,
  p_quantity integer,
  p_recipient_name text,
  p_recipient_phone text,
  p_recipient_email text,
  p_delivery_mode text,
  p_shipping_address jsonb,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_idemp api_idempotency;
  v_existing_order orders;
  v_product merchandise_products;
  v_order orders;
  v_line order_lines;
  v_hold capacity_holds;
  v_total_paise bigint;
  v_hold_expires timestamptz;
  v_settle_deadline timestamptz;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id and not has_permission('admin.access') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_quantity <= 0 or p_quantity > 10 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  -- 1. Idempotency replay check
  select * into v_existing_idemp from api_idempotency
  where scope = 'checkout:merchandise' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_idemp.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '42P22';
    end if;
    if v_existing_idemp.resource_id is not null then
      select * into v_existing_order from orders where id = v_existing_idemp.resource_id;
      if found then
        return jsonb_build_object(
          'orderId', v_existing_order.id,
          'replayed', true,
          'amountPaise', v_existing_order.amount_paise
        );
      end if;
    end if;
  end if;

  -- 2. Lock product and verify status & available stock
  select * into v_product from merchandise_products
  where id = p_product_id and festival_id = p_festival_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_product.status <> 'PUBLISHED' or v_product.sales_state <> 'OPEN' then
    raise exception 'SALES_CLOSED' using errcode = '55000';
  end if;

  -- The selected size must be one this product actually offers.
  if p_selected_size is null or not (p_selected_size = any(v_product.sizes)) then
    raise exception 'INVALID_SIZE' using errcode = '22023';
  end if;

  if (v_product.stock_units - v_product.held_units - v_product.confirmed_units) < p_quantity then
    raise exception 'SOLD_OUT' using errcode = '55000';
  end if;

  v_total_paise := v_product.price_paise * p_quantity;
  v_hold_expires := clock_timestamp() + interval '15 minutes';
  v_settle_deadline := clock_timestamp() + interval '20 minutes';

  -- 3. Insert order
  insert into orders (
    festival_id, purchaser_user_id, kind, idempotency_key, request_hash,
    checkout_state, amount_paise, currency, hold_expires_at, settlement_deadline_at
  ) values (
    p_festival_id, p_user_id, 'MERCHANDISE', p_idempotency_key, p_request_hash,
    'PROVISIONING_PROVIDER', v_total_paise, v_product.currency, v_hold_expires, v_settle_deadline
  )
  returning * into v_order;

  -- 4. Insert order line
  insert into order_lines (
    order_id, line_kind, merchandise_product_id, unit_amount_paise,
    charge_quantity, capacity_units, line_amount_paise, description_snapshot
  ) values (
    v_order.id, 'MERCHANDISE', v_product.id, v_product.price_paise,
    p_quantity, p_quantity, v_total_paise, v_product.name || ' (' || p_selected_size || ')'
  )
  returning * into v_line;

  -- 5. Reserve hold on merchandise stock
  update merchandise_products
  set held_units = held_units + p_quantity,
      updated_at = clock_timestamp()
  where id = v_product.id;

  insert into capacity_holds (
    order_line_id, units, state, expires_at
  ) values (
    v_line.id, p_quantity, 'ACTIVE', v_hold_expires
  )
  returning * into v_hold;

  -- 6. Insert pending merchandise order metadata
  insert into merchandise_orders (
    festival_id, order_id, product_id, user_id, public_order_code,
    item_name, selected_size, quantity, unit_price_paise, total_amount_paise,
    recipient_name, recipient_email, recipient_phone, delivery_mode, shipping_address,
    state
  ) values (
    p_festival_id, v_order.id, v_product.id, p_user_id, v_order.public_order_code,
    v_product.name, p_selected_size, p_quantity, v_product.price_paise, v_total_paise,
    p_recipient_name, p_recipient_email, p_recipient_phone, coalesce(p_delivery_mode, 'PICKUP'),
    p_shipping_address, 'PENDING_PAYMENT'
  );

  -- 7. Record idempotency
  insert into api_idempotency (
    scope, idempotency_key, request_hash, resource_type, resource_id, state
  ) values (
    'checkout:merchandise', p_idempotency_key, p_request_hash, 'order', v_order.id, 'IN_PROGRESS'
  )
  on conflict (scope, idempotency_key) do update set
    resource_id = v_order.id,
    state = 'IN_PROGRESS';

  return jsonb_build_object(
    'orderId', v_order.id,
    'replayed', false,
    'amountPaise', v_total_paise
  );
end;
$$;

revoke all on function create_merchandise_checkout from public, anon;
grant execute on function create_merchandise_checkout to authenticated, service_role;
