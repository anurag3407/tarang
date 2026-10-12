-- 0033_merchandise_catalog_and_orders.sql
-- Merchandise catalog, inventory, atomic checkout, and Google Sheets sync support

-- ---------------------------------------------------------------------
-- Enums extension
-- ---------------------------------------------------------------------
alter type order_kind add value if not exists 'MERCHANDISE';
alter type order_line_kind add value if not exists 'MERCHANDISE';

-- ---------------------------------------------------------------------
-- merchandise_products table
-- ---------------------------------------------------------------------
create table if not exists merchandise_products (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  slug text not null,
  name text not null,
  tagline text not null default '',
  description text not null,
  details_markdown text,
  category text not null default 'Apparel',
  price_paise bigint not null,
  currency char(3) not null default 'INR',
  images text[] not null default '{}',
  sizes text[] not null default '{"S", "M", "L", "XL", "XXL"}',
  stock_units integer not null default 100,
  held_units integer not null default 0,
  confirmed_units integer not null default 0,
  sales_state sales_state not null default 'OPEN',
  status content_status not null default 'PUBLISHED',
  featured boolean not null default false,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchandise_products_price_non_negative check (price_paise >= 0),
  constraint merchandise_products_stock_non_negative check (stock_units >= 0),
  constraint merchandise_products_held_non_negative check (held_units >= 0),
  constraint merchandise_products_confirmed_non_negative check (confirmed_units >= 0),
  constraint merchandise_products_slug_unique unique (festival_id, slug)
);

create index if not exists merchandise_products_published_idx
  on merchandise_products (festival_id, status, sales_state, sort_order);

-- ---------------------------------------------------------------------
-- merchandise_orders table
-- ---------------------------------------------------------------------
create table if not exists merchandise_orders (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete restrict,
  order_id uuid not null references orders (id) on delete restrict,
  product_id uuid not null references merchandise_products (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  public_order_code text not null,
  item_name text not null,
  selected_size text not null default 'Standard',
  quantity integer not null default 1,
  unit_price_paise bigint not null,
  total_amount_paise bigint not null,
  recipient_name text not null,
  recipient_email text not null,
  recipient_phone text not null,
  delivery_mode text not null default 'PICKUP',
  shipping_address jsonb,
  state text not null default 'CONFIRMED',
  synced_to_sheets boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchandise_orders_user_idx
  on merchandise_orders (user_id, created_at desc);

create index if not exists merchandise_orders_order_idx
  on merchandise_orders (order_id);

-- Alter order_lines to support merchandise product link
alter table order_lines
  add column if not exists merchandise_product_id uuid references merchandise_products (id) on delete restrict;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into permissions (code, description) values
  ('content.merchandise.read', 'View all merchandise products and inventory'),
  ('content.merchandise.write', 'Create, update, and manage merchandise products')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.name in ('Superadmin', 'Content Admin') and r.is_system
  and p.code in ('content.merchandise.read', 'content.merchandise.write')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS Policies
-- ---------------------------------------------------------------------
alter table merchandise_products enable row level security;
alter table merchandise_orders enable row level security;

drop policy if exists merchandise_products_public_read on merchandise_products;
create policy merchandise_products_public_read on merchandise_products
  for select using (
    (status = 'PUBLISHED')
    or has_permission('content.merchandise.read')
    or has_permission('admin.access')
  );

drop policy if exists merchandise_orders_user_read on merchandise_orders;
create policy merchandise_orders_user_read on merchandise_orders
  for select using (
    user_id = auth.uid()
    or has_permission('orders.read')
    or has_permission('admin.access')
  );

-- ---------------------------------------------------------------------
-- Admin Upsert Merchandise Function
-- ---------------------------------------------------------------------
create or replace function admin_upsert_merchandise(
  p_merchandise_id uuid,
  p_festival_id uuid,
  p_slug text,
  p_name text,
  p_tagline text,
  p_description text,
  p_details_markdown text,
  p_category text,
  p_price_paise bigint,
  p_images text[],
  p_sizes text[],
  p_stock_units integer,
  p_sales_state sales_state,
  p_status content_status,
  p_featured boolean,
  p_sort_order integer,
  p_expected_version integer
)
returns merchandise_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item merchandise_products;
  v_new_version integer;
begin
  if not has_permission('content.merchandise.write', null, p_festival_id) then
    perform write_audit('merchandise.upsert', 'merchandise', p_merchandise_id::text, 'DENIED', 'missing content.merchandise.write');
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_merchandise_id is null then
    insert into merchandise_products (
      festival_id, slug, name, tagline, description, details_markdown,
      category, price_paise, images, sizes, stock_units, sales_state,
      status, featured, sort_order, version
    ) values (
      p_festival_id, p_slug, p_name, coalesce(p_tagline, ''), p_description, p_details_markdown,
      coalesce(p_category, 'Apparel'), p_price_paise, coalesce(p_images, '{}'), coalesce(p_sizes, '{"S","M","L","XL","XXL"}'),
      p_stock_units, coalesce(p_sales_state, 'OPEN'), coalesce(p_status, 'PUBLISHED'),
      coalesce(p_featured, false), coalesce(p_sort_order, 0), 1
    )
    returning * into v_item;

    perform write_audit('merchandise.create', 'merchandise', v_item.id::text, 'SUCCESS', null, null,
      jsonb_build_object('name', p_name, 'pricePaise', p_price_paise, 'stock', p_stock_units));
    return v_item;
  end if;

  select * into v_item from merchandise_products where id = p_merchandise_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_item.festival_id is distinct from p_festival_id then
    perform write_audit('merchandise.update', 'merchandise', p_merchandise_id::text, 'DENIED', 'cross_festival');
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_item.version <> p_expected_version then
    perform write_audit('merchandise.update', 'merchandise', p_merchandise_id::text, 'FAILED', 'VERSION_CONFLICT');
    raise exception 'VERSION_CONFLICT expected=% actual=%', p_expected_version, v_item.version
      using errcode = '40001';
  end if;

  v_new_version := v_item.version + 1;

  update merchandise_products set
    slug = p_slug,
    name = p_name,
    tagline = coalesce(p_tagline, ''),
    description = p_description,
    details_markdown = p_details_markdown,
    category = coalesce(p_category, 'Apparel'),
    price_paise = p_price_paise,
    images = coalesce(p_images, '{}'),
    sizes = coalesce(p_sizes, '{"S","M","L","XL","XXL"}'),
    stock_units = p_stock_units,
    sales_state = coalesce(p_sales_state, 'OPEN'),
    status = coalesce(p_status, 'PUBLISHED'),
    featured = coalesce(p_featured, false),
    sort_order = coalesce(p_sort_order, 0),
    version = v_new_version,
    updated_at = clock_timestamp()
  where id = p_merchandise_id
  returning * into v_item;

  perform write_audit('merchandise.update', 'merchandise', p_merchandise_id::text, 'SUCCESS', null, null,
    jsonb_build_object('version', v_new_version, 'pricePaise', p_price_paise, 'stock', p_stock_units));
  return v_item;
end;
$$;

revoke all on function admin_upsert_merchandise from public, anon;
grant execute on function admin_upsert_merchandise to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Create Merchandise Checkout Function
-- ---------------------------------------------------------------------
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
  if auth.uid() is distinct from p_user_id and not has_permission('admin.access') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_quantity <= 0 or p_quantity > 20 then
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

-- ---------------------------------------------------------------------
-- Update apply_captured_payment to fulfill MERCHANDISE lines
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

  if v_order.amount_paise <> p_amount_paise or v_order.currency <> p_currency then
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
      set held_units = held_units - v_hold.units,
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

-- ---------------------------------------------------------------------
-- Update cancel_order to release MERCHANDISE holds and mark orders CANCELLED
-- ---------------------------------------------------------------------
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
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_order.purchaser_user_id <> p_user_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_order.checkout_state = 'FULFILLED' then
    raise exception 'CANNOT_CANCEL_FULFILLED' using errcode = '55000';
  end if;
  if v_order.checkout_state = 'PAYMENT_REVIEW' then
    raise exception 'CANNOT_CANCEL_PAYMENT_REVIEW' using errcode = '55000';
  end if;
  if v_order.checkout_state not in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT') then
    return jsonb_build_object(
      'cancelled', false, 'orderId', v_order.id, 'state', v_order.checkout_state
    );
  end if;

  update orders
  set checkout_state = 'CANCELLED',
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_order_id and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

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

    if v_hold.event_id is not null then
      update event_inventory
      set held_units = greatest(0, held_units - v_hold.units),
          version = version + 1,
          updated_at = clock_timestamp()
      where event_id = v_hold.event_id;

      update event_participant_claims
      set state = 'RELEASED'
      where order_line_id = v_hold.order_line_id and state = 'HELD';

      update team_drafts td
      set status = 'DRAFT', version = version + 1, updated_at = clock_timestamp()
      where td.status = 'LOCKED_FOR_CHECKOUT'
        and td.event_id = v_hold.event_id
        and td.captain_user_id = v_order.purchaser_user_id;
    else
      -- Release merchandise held stock
      update merchandise_products
      set held_units = greatest(0, held_units - v_hold.units),
          version = version + 1,
          updated_at = clock_timestamp()
      where id = (select merchandise_product_id from order_lines where id = v_hold.order_line_id);

      update merchandise_orders
      set state = 'CANCELLED',
          updated_at = clock_timestamp()
      where order_id = p_order_id;
    end if;

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

revoke all on function cancel_order from public, anon;
grant execute on function cancel_order to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Update expire_holds_batch to handle MERCHANDISE expiration
-- ---------------------------------------------------------------------
create or replace function expire_holds_batch(p_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold capacity_holds;
  v_order orders;
  v_expired integer := 0;
  v_inventory jsonb := '[]'::jsonb;
  v_inv event_inventory;
  v_holds cursor for
    select * from capacity_holds
    where state = 'ACTIVE' and expires_at <= clock_timestamp()
    order by expires_at, id
    limit p_batch_size
    for update skip locked;
begin
  for v_hold in v_holds loop
    select * into v_order from orders where id = (
      select order_id from order_lines where id = v_hold.order_line_id
    ) for update;

    if v_order.checkout_state in ('FULFILLED', 'CANCELLED') then
      continue;
    end if;

    update capacity_holds
    set state = 'EXPIRED', released_at = clock_timestamp()
    where id = v_hold.id;

    if v_hold.event_id is not null then
      update event_inventory
      set held_units = held_units - v_hold.units,
          version = version + 1,
          updated_at = clock_timestamp()
      where event_id = v_hold.event_id
      returning * into v_inv;

      update event_participant_claims
      set state = 'RELEASED'
      where order_line_id = v_hold.order_line_id and state = 'HELD';

      update team_drafts td
      set status = 'DRAFT', version = version + 1, updated_at = clock_timestamp()
      where td.status = 'LOCKED_FOR_CHECKOUT'
        and exists (select 1 from order_lines ol where ol.order_id = v_order.id)
        and td.event_id = v_hold.event_id
        and td.captain_user_id = v_order.purchaser_user_id;

      v_inventory := v_inventory || jsonb_build_array(jsonb_build_object(
        'eventId', v_hold.event_id,
        'capacityUnits', v_inv.capacity_units,
        'heldUnits', v_inv.held_units,
        'confirmedUnits', v_inv.confirmed_units,
        'inventoryVersion', v_inv.version
      ));
    else
      -- Expire merchandise hold
      update merchandise_products
      set held_units = greatest(0, held_units - v_hold.units),
          version = version + 1,
          updated_at = clock_timestamp()
      where id = (select merchandise_product_id from order_lines where id = v_hold.order_line_id);

      update merchandise_orders
      set state = 'EXPIRED',
          updated_at = clock_timestamp()
      where order_id = v_order.id;
    end if;

    update orders
    set checkout_state = 'EXPIRED', version = version + 1, updated_at = clock_timestamp()
    where id = v_order.id and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'inventory', v_inventory);
end;
$$;

revoke all on function expire_holds_batch from public, anon;
grant execute on function expire_holds_batch to service_role;
