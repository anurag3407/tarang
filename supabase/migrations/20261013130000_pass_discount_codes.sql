-- 20261013130000_pass_discount_codes.sql
--
-- Discount codes for pass purchases.
--
--   1. discount_codes: superadmin-issued codes (flat or percent off), optionally
--      scoped to one pass product, with a validity window, a global redemption
--      cap and a per-user cap. Service-role only — no anon/authenticated access,
--      so codes can never be listed from the browser.
--   2. orders gains discount_code_id / discount_paise / discount_code_snapshot.
--      Order lines keep the full catalog price; the order total is
--      sum(lines) - discount_paise, enforced by the deferred total check.
--   3. evaluate_pass_discount: the one place a discount amount is computed.
--      Redemptions are counted from live orders, so a cancelled or expired
--      order frees its slot without any extra bookkeeping. Called with
--      p_lock = true from checkout, it locks the code row so concurrent
--      checkouts cannot exceed max_redemptions.
--   4. preview_pass_discount: read-only quote for the checkout page.
--   5. create_base_pass_checkout gains p_discount_code (default null). The
--      browser never sends an amount; the discount is computed here, inside
--      the same transaction that snapshots the price.
--   6. discount_code_usage: per-code aggregates for the admin panel.
--
-- Additive: does not edit any applied migration.

-- ---------------------------------------------------------------------
-- 1. Permission (superadmin only; protected from custom roles in the API)
-- ---------------------------------------------------------------------
insert into permissions (code, description) values
  ('discount.manage', 'Create, edit and deactivate pass discount codes')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.name = 'Superadmin' and r.is_system
  and p.code = 'discount.manage'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. discount_codes
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discount_type') then
    create type discount_type as enum ('FLAT', 'PERCENT');
  end if;
end;
$$;

create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete restrict,
  code text not null,
  description text not null default '',
  discount_type discount_type not null,
  amount_off_paise bigint,
  percent_off integer,
  -- null = valid for any pass product of the festival
  pass_product_id uuid references pass_products (id) on delete restrict,
  -- null = unlimited
  max_redemptions integer,
  per_user_limit integer not null default 1,
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (festival_id, code),
  constraint discount_codes_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{3,31}$'),
  constraint discount_codes_value check (
    (discount_type = 'FLAT' and amount_off_paise > 0 and percent_off is null)
    or (discount_type = 'PERCENT' and percent_off between 1 and 100 and amount_off_paise is null)
  ),
  constraint discount_codes_max_redemptions check (max_redemptions is null or max_redemptions > 0),
  constraint discount_codes_per_user_limit check (per_user_limit between 1 and 100),
  constraint discount_codes_window check (
    valid_from is null or valid_until is null or valid_until > valid_from
  ),
  constraint discount_codes_description_len check (char_length(description) <= 300)
);

alter table discount_codes enable row level security;
-- No policies: only the service role (which bypasses RLS) can touch codes.
revoke all on table discount_codes from public, anon, authenticated;
grant all on table discount_codes to service_role;

-- ---------------------------------------------------------------------
-- 3. orders: discount snapshot
-- ---------------------------------------------------------------------
alter table orders
  add column if not exists discount_code_id uuid references discount_codes (id) on delete restrict,
  add column if not exists discount_paise bigint not null default 0,
  add column if not exists discount_code_snapshot text;

alter table orders drop constraint if exists orders_discount_consistent;
alter table orders add constraint orders_discount_consistent check (
  (discount_code_id is null and discount_paise = 0 and discount_code_snapshot is null)
  or (discount_code_id is not null and discount_paise > 0 and discount_code_snapshot is not null)
);

create index if not exists orders_discount_code_idx
  on orders (discount_code_id, checkout_state)
  where discount_code_id is not null;

-- Users can read their own orders; keep the discount columns readable with
-- the rest of the row (they reveal only the code the user typed).

-- Order total = sum(lines) - discount.
create or replace function check_order_total()
returns trigger
language plpgsql
as $$
declare
  v_sum bigint;
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  select coalesce(sum(line_amount_paise), 0) into v_sum
  from order_lines where order_id = v_order_id;
  if (select amount_paise + discount_paise from orders where id = v_order_id) <> v_sum then
    raise exception 'ORDER_TOTAL_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. evaluate_pass_discount
-- ---------------------------------------------------------------------
-- Raises DISCOUNT_INVALID (unknown / inactive / outside window / wrong pass /
-- no effect), DISCOUNT_EXHAUSTED or DISCOUNT_ALREADY_USED. Returns
-- {codeId, code, discountPaise, finalAmountPaise}.
create or replace function evaluate_pass_discount(
  p_user_id uuid,
  p_festival_id uuid,
  p_pass_product_id uuid,
  p_code text,
  p_base_amount_paise bigint,
  p_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code discount_codes;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_used bigint;
  v_discount bigint;
  v_final bigint;
begin
  if v_norm !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  if p_lock then
    select * into v_code from discount_codes
    where festival_id = p_festival_id and code = v_norm
    for update;
  else
    select * into v_code from discount_codes
    where festival_id = p_festival_id and code = v_norm;
  end if;

  if not found
     or not v_code.is_active
     or (v_code.valid_from is not null and clock_timestamp() < v_code.valid_from)
     or (v_code.valid_until is not null and clock_timestamp() >= v_code.valid_until)
     or (v_code.pass_product_id is not null and v_code.pass_product_id <> p_pass_product_id)
  then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  -- Live orders hold a redemption; CANCELLED / EXPIRED orders release it.
  select count(*) into v_used from orders o
  where o.discount_code_id = v_code.id
    and o.purchaser_user_id = p_user_id
    and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED', 'PAYMENT_REVIEW');
  if v_used >= v_code.per_user_limit then
    raise exception 'DISCOUNT_ALREADY_USED' using errcode = 'P0001';
  end if;

  if v_code.max_redemptions is not null then
    select count(*) into v_used from orders o
    where o.discount_code_id = v_code.id
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED', 'PAYMENT_REVIEW');
    if v_used >= v_code.max_redemptions then
      raise exception 'DISCOUNT_EXHAUSTED' using errcode = 'P0001';
    end if;
  end if;

  if v_code.discount_type = 'FLAT' then
    v_discount := least(v_code.amount_off_paise, p_base_amount_paise);
  else
    v_discount := (p_base_amount_paise * v_code.percent_off) / 100;
  end if;

  v_final := p_base_amount_paise - v_discount;
  -- Razorpay rejects orders under ₹1: a partial discount never leaves less
  -- than 100 paise. Only a full discount makes the pass free.
  if v_final > 0 and v_final < 100 then
    v_final := 100;
    v_discount := p_base_amount_paise - 100;
  end if;

  if v_discount <= 0 then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'codeId', v_code.id,
    'code', v_code.code,
    'discountPaise', v_discount,
    'finalAmountPaise', v_final
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5. preview_pass_discount (read-only quote)
-- ---------------------------------------------------------------------
create or replace function preview_pass_discount(
  p_user_id uuid,
  p_festival_id uuid,
  p_pass_product_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product pass_products;
  v_price pass_price_versions;
  v_result jsonb;
begin
  select * into v_product from pass_products
  where id = p_pass_product_id and festival_id = p_festival_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_product.sales_state not in ('OPEN', 'SCHEDULED') or v_product.status <> 'PUBLISHED' then
    raise exception 'SALES_CLOSED' using errcode = '55000';
  end if;

  select * into v_price from pass_price_versions
  where id = v_product.current_price_version_id;
  if not found then
    raise exception 'NOT_FOUND missing price version' using errcode = 'P0002';
  end if;

  v_result := evaluate_pass_discount(
    p_user_id, p_festival_id, p_pass_product_id, p_code, v_price.unit_amount_paise, false
  );
  return v_result || jsonb_build_object('originalAmountPaise', v_price.unit_amount_paise);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. create_base_pass_checkout (0017 + discount code)
-- ---------------------------------------------------------------------
-- Adding a parameter creates a new overload, so drop the 5-arg version first.
drop function if exists create_base_pass_checkout(uuid, uuid, uuid, uuid, text);

create or replace function create_base_pass_checkout(
  p_user_id uuid,
  p_festival_id uuid,
  p_pass_product_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_discount_code text default null
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
$$;

-- ---------------------------------------------------------------------
-- 7. discount_code_usage (admin aggregates)
-- ---------------------------------------------------------------------
create or replace function discount_code_usage(p_festival_id uuid)
returns table (
  discount_code_id uuid,
  fulfilled_count bigint,
  pending_count bigint,
  fulfilled_discount_paise bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.discount_code_id,
    count(*) filter (where o.checkout_state = 'FULFILLED'),
    count(*) filter (where o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW')),
    coalesce(sum(o.discount_paise) filter (where o.checkout_state = 'FULFILLED'), 0)::bigint
  from orders o
  where o.festival_id = p_festival_id
    and o.discount_code_id is not null
  group by o.discount_code_id;
$$;

-- ---------------------------------------------------------------------
-- 8. Privileges: service role only
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
        'evaluate_pass_discount',
        'preview_pass_discount',
        'create_base_pass_checkout',
        'discount_code_usage'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
