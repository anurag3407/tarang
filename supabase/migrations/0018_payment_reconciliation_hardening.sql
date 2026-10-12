-- 0013: payment_reconciliation_hardening
--
-- Five live-mode money-loss gaps, closed:
--
--  1. The reconciler only ever re-checked orders in PROVISIONING_PROVIDER /
--     AWAITING_PAYMENT. But the hold reaper moves event orders to EXPIRED
--     (0005) and the base-pass self-heal moves pass orders to CANCELLED
--     (0011). A capture that lands after that sweep — late UPI collect, or a
--     webhook lost through Razorpay's whole retry window — was never
--     discovered by anything. Money held, nothing issued, nothing flagged.
--     Fix: reconcile_attempts + last_reconciled_at let the reconciler keep
--     watching swept orders a bounded number of times.
--
--  2. That scan used a fixed LIMIT with no ORDER BY, so abandoned orders
--     could permanently occupy the window and starve a genuinely paid one.
--     Fix: last_reconciled_at is a fairness cursor (nulls first = never
--     checked goes first).
--
--  3. apply_captured_payment's VIP branch expired any ACTIVE pass and issued
--     a new one unconditionally. A user who paid for VIP twice (double-tap
--     producing two idempotency keys) got both payments marked APPLIED, the
--     first pass EXPIRED, the second ACTIVE — paid twice, one pass, and no
--     refund obligation recorded anywhere. The standard basic-pass branch had
--     this guard; the VIP branch did not.
--     Fix: a duplicate purchase of the SAME product is REFUND_REQUIRED. A
--     genuine Basic -> VIP upgrade (different product) still works.
--
--  4. A webhook row moved to PROCESSING and then died there — a deploy mid
--     handler, an OOM kill, a crashed web process — was never picked up again.
--     retryStuckWebhookEvents only ever looked at RECEIVED/RETRY, so nothing
--     in the system owned a PROCESSING row. Razorpay had already been given a
--     2xx, so it never redelivered either.
--     Fix: processing_started_at makes "stale" measurable, so the reconciler
--     can reclaim a row whose handler clearly died without stealing one that
--     a concurrent worker is legitimately still running.
--
--  5. Nothing recorded whether the workers were alive. The reconciler IS the
--     safety net for every lost-callback and lost-webhook case, so a worker
--     that silently stopped looks exactly like a quiet sales day.
--     Fix: worker_heartbeats, written every tick, success or failure.

-- ---------------------------------------------------------------------
-- 1. Reconciliation cursor on orders.
-- ---------------------------------------------------------------------
alter table orders
  add column if not exists reconcile_attempts int not null default 0,
  add column if not exists last_reconciled_at timestamptz;

comment on column orders.reconcile_attempts is
  'Provider checks spent on this order while in a swept state (EXPIRED/CANCELLED). Bounded so a dead order stops costing provider calls.';
comment on column orders.last_reconciled_at is
  'Fairness cursor for the payment reconciler. Nulls first = never checked.';

-- Supports both reconciler scans: filter on checkout_state, order by cursor.
create index if not exists orders_reconcile_scan_idx
  on orders (checkout_state, last_reconciled_at nulls first)
  where checkout_state in (
    'PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'EXPIRED', 'CANCELLED'
  );

-- ---------------------------------------------------------------------
-- 2. mark_order_reconciled — advance the cursor atomically.
--
-- The increment must happen server-side: a read-modify-write from the worker
-- would race a second worker (duplicate workers are explicitly supported).
-- p_spend_attempt is false when the provider never answered, so a provider
-- outage does not burn a cold order's attempt budget.
-- ---------------------------------------------------------------------
create or replace function mark_order_reconciled(
  p_order_id uuid,
  p_spend_attempt boolean default false
)
returns void
language sql
security definer
set search_path = public
as $$
  update orders
  set last_reconciled_at = clock_timestamp(),
      reconcile_attempts = reconcile_attempts
        + case when p_spend_attempt then 1 else 0 end
  where id = p_order_id;
$$;

revoke all on function mark_order_reconciled(uuid, boolean)
  from public, anon, authenticated;
grant execute on function mark_order_reconciled(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------
-- 3. apply_captured_payment — guard duplicate same-product pass purchases.
--
-- Identical to the 0012 definition except the VIP/upgrade branch now
-- distinguishes an upgrade from a double purchase before expiring anything.
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

  select * into v_mapping from razorpay_orders
  where razorpay_order_id = p_razorpay_order_id;
  if not found then
    return jsonb_build_object('result', 'ORPHAN', 'paymentId', v_payment.id);
  end if;

  select * into v_order from orders where id = v_mapping.local_order_id for update;
  if not found then
    return jsonb_build_object('result', 'ORDER_NOT_FOUND');
  end if;

  if v_order.amount_paise <> p_amount_paise or v_order.currency <> p_currency then
    update payments set disposition = 'REVIEW' where id = v_payment.id;
    return jsonb_build_object('result', 'AMOUNT_MISMATCH', 'paymentId', v_payment.id);
  end if;

  update payments set local_order_id = v_order.id where id = v_payment.id;

  select * into v_app from payment_applications where order_id = v_order.id;
  if found then
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id);
  end if;

  if v_order.checkout_state = 'FULFILLED' then
    return jsonb_build_object('result', 'ALREADY_APPLIED', 'orderId', v_order.id);
  end if;

  select * into v_line from order_lines where order_id = v_order.id for update;

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
      return jsonb_build_object('result', 'NO_HOLD', 'orderId', v_order.id);
    end if;

  else
    -- BASE_PASS fulfillment.
    select * into v_product from pass_products where id = v_line.pass_product_id;

    -- Tier check driving the email/QR policy below.
    v_is_delegate := (v_product.slug = 'vip-delegate-pass' or not v_product.is_base_pass or v_product.name ilike '%delegate%');

    -- (0013) Paying twice for the SAME pass product is a duplicate.
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

    -- Issue active pass for this pass product
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

revoke all on function apply_captured_payment(text, text, bigint, char, text, timestamptz)
  from public, anon, authenticated;
grant execute on function apply_captured_payment(text, text, bigint, char, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------
-- 4. payment_review_queue — the manual refund obligation, made visible.
--
-- Refunds are deliberately not automated, but nothing surfaced the resulting
-- obligations. Run this to work the queue:
--   select * from payment_review_queue;
--
-- security_invoker: the view runs with the caller's rights, not the owner's,
-- so it cannot become a privilege-escalation path if it is ever granted more
-- widely. Service role bypasses RLS anyway, so behaviour is unchanged.
-- ---------------------------------------------------------------------
create or replace view payment_review_queue
with (security_invoker = true) as
select
  o.id                       as order_id,
  o.public_order_code,
  o.checkout_state,
  o.kind,
  o.purchaser_user_id,
  o.created_at               as order_created_at,
  p.razorpay_payment_id,
  p.amount_paise,
  p.currency,
  p.provider_status,
  p.disposition,
  p.provider_created_at,
  p.last_observed_at
from payments p
join orders o on o.id = p.local_order_id
where p.disposition in ('REFUND_REQUIRED', 'REVIEW')
   or o.checkout_state = 'PAYMENT_REVIEW'
order by p.provider_created_at nulls last, p.last_observed_at desc;

revoke all on payment_review_queue from public, anon, authenticated;
grant select on payment_review_queue to service_role;

-- ---------------------------------------------------------------------
-- 5. webhook_events.processing_started_at — make a dead handler detectable.
--
-- processing_state alone cannot distinguish "a worker is running this right
-- now" from "the process that claimed this died three hours ago". Both read
-- PROCESSING. Timing the claim separates them: received_at is when Razorpay
-- delivered, which says nothing about when the current attempt began, and an
-- event can be re-claimed several times before it succeeds.
-- ---------------------------------------------------------------------
alter table webhook_events
  add column if not exists processing_started_at timestamptz;

comment on column webhook_events.processing_started_at is
  'When the current PROCESSING claim began. Age past a threshold = the handler died; safe to reclaim.';

-- Backfill: any row already sitting in PROCESSING was claimed by a handler
-- that is long gone. Dating it from received_at makes it immediately eligible
-- for reclaim, and means the reclaim scan never has to handle a null.
update webhook_events
set processing_started_at = received_at
where processing_state = 'PROCESSING'
  and processing_started_at is null;

-- The reclaim scan: state = PROCESSING ordered by claim age.
create index if not exists webhook_events_stuck_processing_idx
  on webhook_events (processing_started_at)
  where processing_state = 'PROCESSING';

-- ---------------------------------------------------------------------
-- 6. worker_heartbeats — prove the safety net is running.
--
-- The reconciler is what recovers a lost callback or a lost webhook. If it
-- stops, every symptom is an absence: no error, no alert, just orders that
-- quietly never resolve. A row per worker written on every tick turns that
-- into something monitorable.
--
-- consecutive_failures is the useful signal: last_error alone cannot tell a
-- single transient blip from a worker that has failed every tick for an hour.
-- ---------------------------------------------------------------------
create table if not exists worker_heartbeats (
  worker_name text primary key,
  last_started_at timestamptz not null default clock_timestamp(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  runs bigint not null default 0
);

alter table worker_heartbeats enable row level security;

comment on table worker_heartbeats is
  'One row per worker loop, written every tick. Absence of a recent last_success_at means the recovery path is not running.';

create or replace function record_worker_heartbeat(
  p_worker text,
  p_ok boolean,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into worker_heartbeats as wh (
    worker_name, last_started_at, last_success_at, last_error_at, last_error,
    consecutive_failures, runs
  ) values (
    p_worker,
    clock_timestamp(),
    case when p_ok then clock_timestamp() end,
    case when p_ok then null else clock_timestamp() end,
    case when p_ok then null else left(p_error, 2000) end,
    case when p_ok then 0 else 1 end,
    1
  )
  on conflict (worker_name) do update set
    last_started_at = clock_timestamp(),
    last_success_at = case when p_ok then clock_timestamp()
                           else wh.last_success_at end,
    last_error_at   = case when p_ok then wh.last_error_at
                           else clock_timestamp() end,
    last_error      = case when p_ok then null
                           else left(p_error, 2000) end,
    consecutive_failures = case when p_ok then 0
                                else wh.consecutive_failures + 1 end,
    runs = wh.runs + 1;
$$;

revoke all on function record_worker_heartbeat(text, boolean, text)
  from public, anon, authenticated;
grant execute on function record_worker_heartbeat(text, boolean, text) to service_role;
