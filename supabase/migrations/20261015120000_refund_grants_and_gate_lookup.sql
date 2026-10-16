-- 20261015120000_refund_grants_and_gate_lookup.sql
--
-- 1. refund_order (0039) failed on every call: it set payments.updated_at,
--    a column payments never had. The admin route then fell back to raw,
--    unlocked, unaudited writes that "refunded" orders in any state. This
--    rewrite:
--      * only refunds orders that actually took money (FULFILLED,
--        PAYMENT_REVIEW, or any order with a captured payment row);
--      * releases what the order holds or consumed — active holds, event
--        claims and confirmed event capacity — so the seat goes back on sale
--        and the participant can register again;
--      * audits the acting admin (auth.uid() is null under the service role).
--    Merchandise stock is deliberately not returned: the item may already
--    have been handed over, so restocking stays a manual decision.
--
-- 2. Client-role EXECUTE lockdown. refund_order and record_scan never had
--    their default PUBLIC grant revoked, so anon could call them through
--    /rest/v1/rpc. cancel_order and create_merchandise_checkout trust a
--    caller-supplied p_user_id, so an authenticated user could act for
--    someone else. The app calls all four with the service role only.
--
-- 3. write_audit is callable by authenticated users (admin routes record
--    audits with the caller's own JWT); limit it to active staff so ordinary
--    users cannot write into the audit trail.
--
-- 4. Profiles are written only by the service role (/api/me/profile), which
--    validates input. Drop direct client writes, which let a user set
--    profile_completed_at or public_member_code on their own row.

create or replace function refund_order(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text default 'Manual refund processed by organizers'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_hold capacity_holds;
  v_now timestamptz := clock_timestamp();
  v_passes_count integer := 0;
  v_registrations_count integer := 0;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_order.checkout_state = 'REFUNDED' then
    return jsonb_build_object(
      'refunded', true,
      'orderId', v_order.id,
      'publicOrderCode', v_order.public_order_code,
      'alreadyRefunded', true
    );
  end if;

  -- Only an order that took money can be refunded; an unpaid one is cancelled.
  if v_order.checkout_state not in ('FULFILLED', 'PAYMENT_REVIEW')
     and not exists (
       select 1 from payments
       where local_order_id = p_order_id
         and disposition in ('APPLIED', 'REFUND_REQUIRED', 'REVIEW')
     ) then
    raise exception 'NOT_REFUNDABLE' using errcode = '55000',
      detail = format('order is %s with no captured payment', v_order.checkout_state);
  end if;

  update orders
  set checkout_state = 'REFUNDED',
      version = version + 1,
      updated_at = v_now
  where id = p_order_id;

  -- Holds still active (e.g. a PAYMENT_REVIEW order) go back to inventory.
  for v_hold in
    select ch.*
    from capacity_holds ch
    join order_lines ol on ol.id = ch.order_line_id
    where ol.order_id = p_order_id
      and ch.state = 'ACTIVE'
    for update of ch
  loop
    update capacity_holds
    set state = 'RELEASED', released_at = v_now
    where id = v_hold.id;

    if v_hold.event_id is not null then
      update event_inventory
      set held_units = greatest(0, held_units - v_hold.units),
          version = version + 1,
          updated_at = v_now
      where event_id = v_hold.event_id;
    else
      update merchandise_products
      set held_units = greatest(0, held_units - v_hold.units),
          version = version + 1,
          updated_at = v_now
      where id = (select merchandise_product_id from order_lines where id = v_hold.order_line_id);
    end if;
  end loop;

  with updated_passes as (
    update delegate_passes
    set state = 'REFUNDED',
        revoked_at = v_now,
        version = version + 1,
        updated_at = v_now
    where source_order_line_id in (select id from order_lines where order_id = p_order_id)
      and state <> 'REFUNDED'
    returning id
  )
  select count(*) into v_passes_count from updated_passes;

  update qr_credentials
  set state = 'REVOKED',
      revoked_at = v_now
  where state = 'ACTIVE'
    and delegate_pass_id in (
      select dp.id from delegate_passes dp
      join order_lines ol on ol.id = dp.source_order_line_id
      where ol.order_id = p_order_id
    );

  -- Confirmed registrations give their capacity back.
  with updated_regs as (
    update registrations
    set state = 'REFUNDED',
        cancelled_at = v_now,
        version = version + 1,
        updated_at = v_now
    where order_line_id in (select id from order_lines where order_id = p_order_id)
      and state = 'CONFIRMED'
    returning event_id, capacity_units
  ), released as (
    update event_inventory ei
    set confirmed_units = greatest(0, ei.confirmed_units - r.units),
        version = ei.version + 1,
        updated_at = v_now
    from (
      select event_id, sum(capacity_units)::integer as units
      from updated_regs group by event_id
    ) r
    where ei.event_id = r.event_id
    returning 1
  )
  select (select count(*) from updated_regs) into v_registrations_count;

  -- Free the one-live-claim-per-participant slot so they can register again.
  update event_participant_claims
  set state = 'RELEASED'
  where order_line_id in (select id from order_lines where order_id = p_order_id)
    and state in ('HELD', 'CONFIRMED');

  update merchandise_orders
  set state = 'REFUNDED',
      updated_at = v_now
  where order_id = p_order_id;

  update payments
  set disposition = 'REFUNDED',
      refunded_paise = amount_paise,
      last_observed_at = v_now
  where local_order_id = p_order_id
    and disposition <> 'REFUNDED';

  insert into audit_logs (
    actor_user_id, actor_type, action, target_type, target_id, result, reason, metadata
  ) values (
    p_actor_user_id,
    case when p_actor_user_id is null then 'SERVICE'::audit_actor_type else 'USER'::audit_actor_type end,
    'order.refund', 'orders', p_order_id::text, 'SUCCESS',
    coalesce(p_reason, 'Manual refund processed by organizers'),
    jsonb_build_object(
      'previousState', v_order.checkout_state,
      'passesRefunded', v_passes_count,
      'registrationsRefunded', v_registrations_count
    )
  );

  return jsonb_build_object(
    'refunded', true,
    'orderId', p_order_id,
    'publicOrderCode', v_order.public_order_code,
    'previousState', v_order.checkout_state,
    'passesRefunded', v_passes_count,
    'registrationsRefunded', v_registrations_count
  );
end;
$$;

create or replace function write_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_result audit_result default 'SUCCESS',
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_logs (
    actor_user_id, actor_type, action, target_type, target_id,
    result, reason, before_json, after_json, metadata
  )
  select
    auth.uid(),
    case when auth.uid() is null then 'SERVICE'::audit_actor_type else 'USER'::audit_actor_type end,
    p_action, p_target_type, p_target_id, p_result, p_reason, p_before, p_after, p_metadata
  where auth.uid() is null
     or exists (
       select 1 from staff_assignments sa
       where sa.user_id = auth.uid() and sa.status = 'ACTIVE'
     );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'refund_order(uuid, uuid, text)',
    'record_scan(uuid, uuid, uuid, uuid, uuid, timestamptz, boolean, text, text, text, text, boolean, text)',
    'cancel_order(uuid, uuid)',
    'create_merchandise_checkout(uuid, uuid, uuid, text, integer, text, text, text, text, jsonb, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Guarded by has_permission(), but there is no reason for anon to reach it.
  execute 'revoke all on function admin_upsert_sponsor(uuid, uuid, text, text, text, text, text, text, integer, boolean, boolean, integer) from public, anon';
  execute 'grant execute on function admin_upsert_sponsor(uuid, uuid, text, text, text, text, text, text, integer, boolean, boolean, integer) to authenticated, service_role';
end
$$;

revoke insert, update, delete on table profiles from anon, authenticated;

-- 5. verify_gate_pass_lookup matched a case-insensitive *prefix* of the pass
--    code and returned the first hit. The scanner records an admission for
--    whatever comes back, so a partial code ("PP-4F") admitted an arbitrary
--    attendee — who was then refused as a duplicate at one-entry gates — and
--    let an operator walk the code space for names/emails. Codes now match
--    exactly (the PP- prefix may be omitted); emails still match in full.
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
  v_query text := upper(regexp_replace(coalesce(p_query, ''), '\s+', '', 'g'));
begin
  if length(v_query) < 3 then
    return jsonb_build_object('found', false);
  end if;

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
      upper(dp.public_pass_code) in (v_query, 'PP-' || v_query)
      or (
        v_query like '%@%'
        and lower(u.email) = lower(v_query)
      )
    )
  order by
    (case when dp.state = 'ACTIVE' then 1 when dp.state = 'REFUNDED' then 2 else 3 end),
    dp.created_at desc
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

revoke all on function verify_gate_pass_lookup(text) from public, anon, authenticated;
grant execute on function verify_gate_pass_lookup(text) to service_role;
