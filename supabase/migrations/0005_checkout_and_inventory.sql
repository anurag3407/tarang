-- 0005: checkout and inventory (plan §7.8–§7.9, §9.2–§9.3, §9.6)

-- ---------------------------------------------------------------------
-- team_drafts / team_draft_members
-- ---------------------------------------------------------------------
create table team_drafts (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  captain_user_id uuid not null references auth.users (id) on delete restrict,
  team_name text not null,
  join_code_hash text not null,
  status team_draft_status not null default 'DRAFT',
  expires_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_drafts_name_len check (char_length(team_name) between 3 and 60)
);

create index team_drafts_event_idx on team_drafts (event_id, status);
create index team_drafts_join_code_hash_idx on team_drafts (join_code_hash);

create table team_draft_members (
  team_draft_id uuid not null references team_drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role team_member_role not null default 'MEMBER',
  status team_member_status not null default 'INVITED',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (team_draft_id, user_id)
);

-- ---------------------------------------------------------------------
-- api_idempotency (plan §7.9)
-- ---------------------------------------------------------------------
create table api_idempotency (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  resource_type text,
  resource_id uuid,
  response_status integer,
  response_body jsonb,
  state idempotency_state not null default 'IN_PROGRESS',
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  unique (scope, idempotency_key)
);

-- ---------------------------------------------------------------------
-- orders / order_lines / order_participants
-- ---------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  public_order_code text not null unique default 'PO-' || upper(encode(gen_random_bytes(6), 'hex')),
  festival_id uuid not null references festivals (id) on delete restrict,
  purchaser_user_id uuid not null references auth.users (id) on delete restrict,
  kind order_kind not null,
  idempotency_key uuid not null,
  request_hash text not null,
  checkout_state checkout_state not null default 'PROVISIONING_PROVIDER',
  amount_paise bigint not null,
  currency char(3) not null default 'INR',
  hold_expires_at timestamptz,
  settlement_deadline_at timestamptz,
  fulfilled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchaser_user_id, idempotency_key),
  constraint orders_amount_non_negative check (amount_paise >= 0),
  constraint orders_currency check (currency = 'INR')
);

-- At most one open base-pass order per user/festival.
create unique index orders_one_open_base_pass
  on orders (festival_id, purchaser_user_id)
  where kind = 'BASE_PASS'
    and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

create index orders_pending_idx
  on orders (checkout_state, hold_expires_at)
  where checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete restrict,
  line_kind order_line_kind not null,
  pass_product_id uuid references pass_products (id) on delete restrict,
  event_id uuid references events (id) on delete restrict,
  pass_price_version_id uuid references pass_price_versions (id) on delete restrict,
  event_price_version_id uuid references event_price_versions (id) on delete restrict,
  unit_amount_paise bigint not null,
  charge_quantity integer not null default 1,
  capacity_units integer not null default 1,
  team_size integer not null default 1,
  registration_mode_snapshot registration_mode,
  capacity_basis_snapshot capacity_basis,
  price_basis_snapshot price_basis,
  line_amount_paise bigint not null,
  description_snapshot text not null default '',
  created_at timestamptz not null default now(),
  constraint order_lines_one_product check (
    (line_kind = 'PASS' and pass_product_id is not null and event_id is null)
    or (line_kind = 'EVENT' and event_id is not null and pass_product_id is null)
  ),
  constraint order_lines_amount_consistent check (
    line_amount_paise = unit_amount_paise * charge_quantity
  )
);

create unique index order_lines_one_event_per_order on order_lines (order_id, event_id)
  where event_id is not null;

-- Order total must equal sum of lines (deferred check via trigger).
create or replace function check_order_total()
returns trigger
language plpgsql
as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(line_amount_paise), 0) into v_sum
  from order_lines where order_id = coalesce(new.order_id, old.order_id);
  if (select amount_paise from orders where id = coalesce(new.order_id, old.order_id)) <> v_sum then
    raise exception 'ORDER_TOTAL_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger order_lines_total_check
  after insert or update or delete on order_lines
  deferrable initially deferred
  for each row execute function check_order_total();

create table order_participants (
  order_line_id uuid not null references order_lines (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  delegate_pass_id uuid,
  role participant_role not null default 'INDIVIDUAL',
  primary key (order_line_id, user_id)
);

-- ---------------------------------------------------------------------
-- capacity_holds / event_participant_claims
-- ---------------------------------------------------------------------
create table capacity_holds (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null unique references order_lines (id) on delete restrict,
  event_id uuid not null references events (id) on delete restrict,
  units integer not null,
  state hold_state not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  constraint capacity_holds_units_positive check (units > 0)
);

create index capacity_holds_active_expiry_idx
  on capacity_holds (expires_at, id)
  where state = 'ACTIVE';

create table event_participant_claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  order_line_id uuid not null references order_lines (id) on delete restrict,
  registration_id uuid,
  state claim_state not null default 'HELD',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live claim per participant per event (plan §7.9).
create unique index one_live_event_claim_per_participant
  on event_participant_claims (event_id, user_id)
  where state in ('HELD', 'CONFIRMED');

-- ---------------------------------------------------------------------
-- delegate_passes / registrations / registration_members (plan §7.11)
-- Defined here because checkout functions reference them.
-- ---------------------------------------------------------------------
create table delegate_passes (
  id uuid primary key default gen_random_uuid(),
  public_pass_code text not null unique default 'PP-' || upper(encode(gen_random_bytes(6), 'hex')),
  festival_id uuid not null references festivals (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  pass_product_id uuid not null references pass_products (id) on delete restrict,
  source_order_line_id uuid not null unique references order_lines (id) on delete restrict,
  state pass_state not null default 'ACTIVE',
  activated_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active base pass per user/festival.
create unique index delegate_passes_one_active_base
  on delegate_passes (festival_id, user_id)
  where state = 'ACTIVE';

create table registrations (
  id uuid primary key default gen_random_uuid(),
  public_registration_code text not null unique default 'PR-' || upper(encode(gen_random_bytes(6), 'hex')),
  order_line_id uuid not null unique references order_lines (id) on delete restrict,
  event_id uuid not null references events (id) on delete restrict,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  team_name text,
  registration_mode registration_mode not null,
  capacity_units integer not null default 1,
  state registration_state not null default 'CONFIRMED',
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table registration_members (
  registration_id uuid not null references registrations (id) on delete cascade,
  event_id uuid not null references events (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  delegate_pass_id uuid references delegate_passes (id) on delete restrict,
  role participant_role not null default 'MEMBER',
  primary key (registration_id, user_id)
);

create index registration_members_user_idx on registration_members (user_id);
create index registrations_event_idx on registrations (event_id, state);

alter table delegate_passes enable row level security;
alter table registrations enable row level security;
alter table registration_members enable row level security;

create policy delegate_passes_own_read on delegate_passes
  for select using (user_id = auth.uid() or has_permission('registration.read'));

create policy registrations_own_read on registrations
  for select using (
    owner_user_id = auth.uid()
    or has_permission('registration.read')
    or exists (
      select 1 from registration_members rm
      where rm.registration_id = registrations.id and rm.user_id = auth.uid()
    )
  );

create policy registration_members_own_read on registration_members
  for select using (user_id = auth.uid() or has_permission('registration.read'));

-- ---------------------------------------------------------------------
-- create_base_pass_checkout (plan §9.2)
-- No provider HTTP call inside this transaction.
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

  -- 3. Reject if an active base pass exists.
  if exists (
    select 1 from delegate_passes dp
    where dp.user_id = p_user_id and dp.festival_id = p_festival_id and dp.state = 'ACTIVE'
  ) then
    raise exception 'BASE_PASS_EXISTS' using errcode = '23505';
  end if;

  -- Reject if an open base-pass order already exists.
  if exists (
    select 1 from orders o
    where o.purchaser_user_id = p_user_id
      and o.festival_id = p_festival_id
      and o.kind = 'BASE_PASS'
      and o.checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT')
  ) then
    raise exception 'BASE_PASS_EXISTS' using errcode = '23505';
  end if;

  -- 5. Snapshot current price version.
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
    v_price.unit_amount_paise, 1, 0, 1,
    v_price.unit_amount_paise, v_product.name
  )
  returning * into v_line;

  -- 7. Idempotency resource mapping.
  insert into api_idempotency (scope, idempotency_key, request_hash, resource_type, resource_id, state)
  values (p_user_id::text || ':base-pass', p_idempotency_key, p_request_hash, 'order', v_order.id, 'IN_PROGRESS');

  return jsonb_build_object('orderId', v_order.id, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------
-- create_event_checkout (plan §9.3)
-- The browser never submits an amount.
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
    if found then
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

  -- 8. Calculate units and amount (plan §2.3.5–6).
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

  -- 10. No row => sold out.
  if not found then
    raise exception 'SOLD_OUT' using errcode = '55000';
  end if;

  -- 11. Insert order, line, participant snapshots, hold, claims.
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

  -- 13. Lock team draft for checkout.
  if p_team_draft_id is not null then
    update team_drafts
    set status = 'LOCKED_FOR_CHECKOUT', version = version + 1, updated_at = clock_timestamp()
    where id = p_team_draft_id;
  end if;

  insert into api_idempotency (scope, idempotency_key, request_hash, resource_type, resource_id, state)
  values (p_user_id::text || ':event-checkout', p_idempotency_key, p_request_hash, 'order', v_order.id, 'IN_PROGRESS');

  return jsonb_build_object(
    'orderId', v_order.id,
    'replayed', false,
    'amountPaise', v_amount,
    'capacityUnits', v_capacity_units,
    'teamSize', v_team_size,
    'holdExpiresAt', v_order.hold_expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------
-- expire_holds_batch (plan §9.6)
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
    -- Lock the order; if a captured payment is being applied the order lock
    -- serialization determines the winner (plan §9.6.4).
    select * into v_order from orders where id = (
      select order_id from order_lines where id = v_hold.order_line_id
    ) for update;

    if v_order.checkout_state in ('FULFILLED', 'CANCELLED') then
      continue;
    end if;

    update capacity_holds
    set state = 'EXPIRED', released_at = clock_timestamp()
    where id = v_hold.id;

    update event_inventory
    set held_units = held_units - v_hold.units,
        version = version + 1,
        updated_at = clock_timestamp()
    where event_id = v_hold.event_id
    returning * into v_inv;

    update event_participant_claims
    set state = 'RELEASED'
    where order_line_id = v_hold.order_line_id and state = 'HELD';

    -- Unlock/cancel team draft.
    update team_drafts td
    set status = 'DRAFT', version = version + 1, updated_at = clock_timestamp()
    where td.status = 'LOCKED_FOR_CHECKOUT'
      and exists (select 1 from order_lines ol where ol.order_id = v_order.id)
      and td.event_id = v_hold.event_id
      and td.captain_user_id = v_order.purchaser_user_id;

    update orders
    set checkout_state = 'EXPIRED', version = version + 1, updated_at = clock_timestamp()
    where id = v_order.id and checkout_state in ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT');

    v_expired := v_expired + 1;
    v_inventory := v_inventory || jsonb_build_array(jsonb_build_object(
      'eventId', v_hold.event_id,
      'capacityUnits', v_inv.capacity_units,
      'heldUnits', v_inv.held_units,
      'confirmedUnits', v_inv.confirmed_units,
      'inventoryVersion', v_inv.version
    ));
  end loop;

  return jsonb_build_object('expired', v_expired, 'inventory', v_inventory);
end;
$$;

-- RLS for checkout tables: participants read own orders; no browser DML.
alter table team_drafts enable row level security;
alter table team_draft_members enable row level security;
alter table api_idempotency enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table order_participants enable row level security;
alter table capacity_holds enable row level security;
alter table event_participant_claims enable row level security;

create policy team_drafts_own_read on team_drafts
  for select using (
    captain_user_id = auth.uid()
    or exists (select 1 from team_draft_members tdm where tdm.team_draft_id = team_drafts.id and tdm.user_id = auth.uid())
  );

create policy team_draft_members_own_read on team_draft_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from team_drafts td
      where td.id = team_draft_members.team_draft_id and td.captain_user_id = auth.uid()
    )
  );

create policy orders_own_read on orders
  for select using (purchaser_user_id = auth.uid() or has_permission('finance.read'));

create policy order_lines_own_read on order_lines
  for select using (
    exists (select 1 from orders o where o.id = order_lines.order_id and o.purchaser_user_id = auth.uid())
    or has_permission('finance.read')
    or has_permission('registration.read')
  );

create policy order_participants_own_read on order_participants
  for select using (user_id = auth.uid());
