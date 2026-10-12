-- 0006: payments, refunds, webhooks (plan §7.10, §7.12, §7.13, §9.5)

-- ---------------------------------------------------------------------
-- outbox_jobs (plan §7.13) — defined here because payment functions insert
-- outbox rows in the same transaction.
-- ---------------------------------------------------------------------
create table outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  logical_key text not null unique,
  payload_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  state outbox_job_state not null default 'PENDING',
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  qstash_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbox_jobs_claim_idx
  on outbox_jobs (run_at, id)
  where state in ('PENDING', 'RETRY_WAIT');

alter table outbox_jobs enable row level security;

-- Claim jobs with FOR UPDATE SKIP LOCKED (plan §7.13).
create or replace function claim_outbox_jobs(
  p_job_types text[],
  p_owner text,
  p_batch_size integer default 20,
  p_lease_seconds integer default 120
)
returns setof outbox_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from outbox_jobs
    where state in ('PENDING', 'RETRY_WAIT')
      and run_at <= clock_timestamp()
      and job_type = any(p_job_types)
      and (lease_expires_at is null or lease_expires_at < clock_timestamp())
    order by run_at, id
    limit p_batch_size
    for update skip locked
  )
  update outbox_jobs oj
  set state = 'PROCESSING',
      lease_owner = p_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      updated_at = clock_timestamp()
  from claimed
  where oj.id = claimed.id
  returning oj.*;
end;
$$;

create or replace function complete_outbox_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update outbox_jobs
  set state = 'DONE', lease_owner = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_job_id;
$$;

create or replace function fail_outbox_job(
  p_job_id uuid,
  p_error text,
  p_retry_delay_seconds integer default 30,
  p_max_attempts integer default 8
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update outbox_jobs
  set state = case when attempts >= p_max_attempts then 'DEAD'::outbox_job_state else 'RETRY_WAIT'::outbox_job_state end,
      run_at = clock_timestamp() + make_interval(secs => p_retry_delay_seconds * attempts),
      lease_owner = null,
      lease_expires_at = null,
      last_error = left(p_error, 2000),
      updated_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

-- ---------------------------------------------------------------------
-- razorpay_orders / payments / payment_applications
-- ---------------------------------------------------------------------
create table razorpay_orders (
  id uuid primary key default gen_random_uuid(),
  local_order_id uuid not null unique references orders (id) on delete restrict,
  razorpay_order_id text unique,
  receipt text not null unique,
  expected_amount_paise bigint not null,
  currency char(3) not null default 'INR',
  provider_status text,
  raw_last_snapshot jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint razorpay_orders_receipt_len check (char_length(receipt) <= 40)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  razorpay_payment_id text not null unique,
  razorpay_order_id text,
  local_order_id uuid references orders (id) on delete restrict,
  amount_paise bigint not null,
  currency char(3) not null default 'INR',
  provider_status text not null,
  provider_created_at timestamptz,
  disposition payment_disposition not null default 'UNAPPLIED',
  refund_reserved_paise bigint not null default 0,
  refunded_paise bigint not null default 0,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index payments_local_order_idx on payments (local_order_id);
create index payments_disposition_idx on payments (disposition) where disposition in ('UNAPPLIED', 'REFUND_REQUIRED', 'REVIEW');

create table payment_applications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete restrict,
  payment_id uuid not null unique references payments (id) on delete restrict,
  amount_paise bigint not null,
  applied_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- refunds / refund_allocations
-- ---------------------------------------------------------------------
create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete restrict,
  idempotency_key text not null unique,
  amount_paise bigint not null,
  reason_code text not null,
  reason_text text,
  state refund_state not null default 'REQUESTED',
  razorpay_refund_id text unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  requested_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint refunds_amount_positive check (amount_paise > 0)
);

create table refund_allocations (
  refund_id uuid not null references refunds (id) on delete cascade,
  order_line_id uuid not null references order_lines (id) on delete restrict,
  amount_paise bigint not null,
  primary key (refund_id, order_line_id)
);

-- ---------------------------------------------------------------------
-- webhook_events
-- ---------------------------------------------------------------------
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider webhook_provider not null,
  provider_event_id text not null,
  event_type text not null,
  raw_body jsonb,
  body_hash text not null,
  headers_subset jsonb,
  signature_valid boolean not null default false,
  processing_state webhook_processing_state not null default 'RECEIVED',
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index webhook_events_unprocessed_idx
  on webhook_events (received_at)
  where processing_state in ('RECEIVED', 'RETRY');

-- ---------------------------------------------------------------------
-- attach_razorpay_order (plan §9.4): persist mapping with verification.
-- ---------------------------------------------------------------------
create or replace function attach_razorpay_order(
  p_local_order_id uuid,
  p_razorpay_order_id text,
  p_amount_paise bigint,
  p_currency char(3),
  p_receipt text,
  p_provider_status text,
  p_raw_snapshot jsonb default null
)
returns razorpay_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapping razorpay_orders;
  v_order orders;
begin
  select * into v_order from orders where id = p_local_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Exact amount/currency verification.
  if v_order.amount_paise <> p_amount_paise or v_order.currency <> p_currency then
    raise exception 'AMOUNT_MISMATCH' using errcode = '23514';
  end if;

  insert into razorpay_orders (
    local_order_id, razorpay_order_id, receipt, expected_amount_paise, currency,
    provider_status, raw_last_snapshot, last_checked_at
  ) values (
    p_local_order_id, p_razorpay_order_id, p_receipt, p_amount_paise, p_currency,
    p_provider_status, p_raw_snapshot, clock_timestamp()
  )
  on conflict (local_order_id) do update set
    razorpay_order_id = coalesce(razorpay_orders.razorpay_order_id, excluded.razorpay_order_id),
    provider_status = excluded.provider_status,
    raw_last_snapshot = excluded.raw_last_snapshot,
    last_checked_at = clock_timestamp()
  returning * into v_mapping;

  update orders
  set checkout_state = 'AWAITING_PAYMENT', updated_at = clock_timestamp()
  where id = p_local_order_id and checkout_state = 'PROVISIONING_PROVIDER';

  return v_mapping;
end;
$$;

-- ---------------------------------------------------------------------
-- apply_captured_payment (plan §9.5) — at-most-once fulfillment.
-- Used by webhook processor, verified browser callback, and reconciler.
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
    -- Orphan webhook: mapping not yet persisted. Reconciler will resolve.
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

  -- 5. Active hold path.
  if v_line.line_kind = 'EVENT' then
    select * into v_hold from capacity_holds
    where order_line_id = v_line.id for update;

    if v_hold is not null and v_hold.state = 'ACTIVE' and v_hold.expires_at > clock_timestamp() then
      -- Move inventory units from held to confirmed (sum unchanged).
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

      -- Insert registration + members.
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
      -- 6. Late-payment policy (plan §12.10).
      v_timely := p_provider_created_at is not null
        and v_hold.expires_at is not null
        and p_provider_created_at <= v_hold.expires_at;

      if v_timely and clock_timestamp() <= v_order.settlement_deadline_at then
        -- Attempt reacquisition at original snapshot.
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
          -- Reacquisition failed: refund obligation.
          update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
          update orders set checkout_state = 'PAYMENT_REVIEW', updated_at = clock_timestamp()
          where id = v_order.id;
          return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
            'reason', 'late_payment_no_capacity');
        end if;
      else
        -- Payment initiated after expiry or discovered too late: refund obligation.
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
    if exists (
      select 1 from delegate_passes dp
      where dp.user_id = v_order.purchaser_user_id
        and dp.festival_id = v_order.festival_id
        and dp.state = 'ACTIVE'
    ) then
      update payments set disposition = 'REFUND_REQUIRED' where id = v_payment.id;
      return jsonb_build_object('result', 'REFUND_REQUIRED', 'orderId', v_order.id,
        'reason', 'base_pass_already_active');
    end if;

    insert into delegate_passes (
      festival_id, user_id, pass_product_id, source_order_line_id,
      state, activated_at, expires_at
    ) values (
      v_order.festival_id, v_order.purchaser_user_id, v_line.pass_product_id, v_line.id,
      'ACTIVE', clock_timestamp(),
      (select valid_until from pass_products where id = v_line.pass_product_id)
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

  -- Outbox jobs for email / QR / cache invalidation (plan §9.5.5).
  insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
  values
    ('SEND_EMAIL', 'order', v_order.id::text,
     'email:order-confirmation:' || v_order.id::text,
     jsonb_build_object('orderId', v_order.id, 'kind', v_order.kind)),
    ('INVALIDATE_CACHE', 'order', v_order.id::text,
     'cache:order:' || v_order.id::text,
     jsonb_build_object('orderId', v_order.id))
  on conflict (logical_key) do nothing;

  if v_order.kind = 'BASE_PASS' then
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
-- cancel_registration_with_refund (plan §9.9)
-- ---------------------------------------------------------------------
create or replace function cancel_registration_with_refund(
  p_registration_id uuid,
  p_reason_code text,
  p_reason_text text default null,
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg registrations;
  v_line order_lines;
  v_order orders;
  v_payment payments;
  v_inv event_inventory;
  v_refund refunds;
begin
  select * into v_reg from registrations where id = p_registration_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_reg.state <> 'CONFIRMED' then
    raise exception 'ALREADY_CANCELLED' using errcode = '55000';
  end if;

  select * into v_line from order_lines where id = v_reg.order_line_id for update;
  select * into v_order from orders where id = v_line.order_id for update;

  -- Release confirmed claims and decrement confirmed units.
  update event_participant_claims
  set state = 'RELEASED'
  where order_line_id = v_line.id and state = 'CONFIRMED';

  update event_inventory
  set confirmed_units = confirmed_units - v_line.capacity_units,
      version = version + 1,
      updated_at = clock_timestamp()
  where event_id = v_reg.event_id
  returning * into v_inv;

  update registrations
  set state = 'CANCELLED', cancelled_at = clock_timestamp(),
      version = version + 1, updated_at = clock_timestamp()
  where id = p_registration_id;

  -- Reserve refundable amount and create refund obligation.
  select * into v_payment from payments
  where local_order_id = v_order.id and disposition = 'APPLIED'
  for update;

  if found then
    update payments
    set refund_reserved_paise = refund_reserved_paise + v_line.line_amount_paise
    where id = v_payment.id;

    insert into refunds (payment_id, idempotency_key, amount_paise, reason_code, reason_text, state, requested_by)
    values (v_payment.id, 'reg-cancel:' || p_registration_id::text,
            v_line.line_amount_paise, p_reason_code, p_reason_text,
            'REQUESTED', coalesce(p_requested_by, auth.uid()))
    returning * into v_refund;

    insert into refund_allocations (refund_id, order_line_id, amount_paise)
    values (v_refund.id, v_line.id, v_line.line_amount_paise);

    insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
    values ('SUBMIT_REFUND', 'refund', v_refund.id::text,
            'refund:submit:' || v_refund.id::text,
            jsonb_build_object('refundId', v_refund.id))
    on conflict (logical_key) do nothing;
  end if;

  perform write_audit('registration.cancel', 'registration', p_registration_id::text, 'SUCCESS',
    p_reason_code);

  return jsonb_build_object('registrationId', p_registration_id, 'refundCreated', v_refund.id is not null);
end;
$$;

-- RLS: financial tables have no browser DML policies (plan §8.4).
alter table razorpay_orders enable row level security;
alter table payments enable row level security;
alter table payment_applications enable row level security;
alter table refunds enable row level security;
alter table refund_allocations enable row level security;
alter table webhook_events enable row level security;

create policy razorpay_orders_finance_read on razorpay_orders
  for select using (has_permission('finance.read'));

create policy payments_finance_read on payments
  for select using (has_permission('finance.read'));

create policy refunds_finance_read on refunds
  for select using (has_permission('finance.read'));
