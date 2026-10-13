-- 20261013120000_pronite_launch_fixes.sql
--
-- Launch fixes for the single-pass (Pronite Pass) setup:
--
--   1. Retire the Basic Card product in the database, not just the UI. It was
--      still PUBLISHED + OPEN, so /api/checkout/base-pass would take payment
--      for it and issue a pass with no gate QR and no confirmation email.
--   2. One ACTIVE QR credential per pass, instead of one credential per pass
--      ever. The old unique(delegate_pass_id) made reissue impossible (the
--      REPLACED row still blocked the new one). Concurrent issuers still
--      collide on the partial index and reuse the winner's credential.
--   3. Enqueue a SHEETS_SYNC outbox job for every fulfilled order. The Google
--      Sheets mirror used to be fire-and-forget; a failed append was never
--      retried. As an outbox job it retries with backoff like email does.

-- ---------------------------------------------------------------------
-- 1. Retire the Basic Card
-- ---------------------------------------------------------------------
update pass_products
set sales_state = 'CLOSED',
    status = 'ARCHIVED',
    version = version + 1,
    updated_at = now()
where is_base_pass = true
  and slug <> 'vip-delegate-pass'
  and (sales_state <> 'CLOSED' or status <> 'ARCHIVED');

-- ---------------------------------------------------------------------
-- 2. One ACTIVE QR credential per pass
-- ---------------------------------------------------------------------
alter table qr_credentials
  drop constraint if exists qr_credentials_delegate_pass_id_key;

create unique index if not exists qr_credentials_one_active_per_pass
  on qr_credentials (delegate_pass_id)
  where state = 'ACTIVE';

create index if not exists qr_credentials_delegate_pass_idx
  on qr_credentials (delegate_pass_id);

-- ---------------------------------------------------------------------
-- 3. Fulfillment outbox trigger: 0034 policy + SHEETS_SYNC
-- ---------------------------------------------------------------------
create or replace function enqueue_fulfillment_outbox_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line order_lines;
  v_product pass_products;
  v_is_delegate boolean := false;
  v_pass delegate_passes;
begin
  -- Only on a transition into FULFILLED.
  if new.checkout_state is distinct from 'FULFILLED' then
    return new;
  end if;
  if old.checkout_state is not distinct from 'FULFILLED' then
    return new;
  end if;

  -- Cache invalidation always.
  insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
  values
    ('INVALIDATE_CACHE', 'order', new.id::text,
     'cache:order:' || new.id::text,
     jsonb_build_object('orderId', new.id))
  on conflict (logical_key) do nothing;

  -- Google Sheets mirror always (the worker no-ops when Sheets is disabled).
  insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
  values
    ('SHEETS_SYNC', 'order', new.id::text,
     'sheets:order:' || new.id::text,
     jsonb_build_object('orderId', new.id))
  on conflict (logical_key) do nothing;

  -- EMAIL POLICY: event orders get a registration confirmation; pass orders
  -- only for the Pronite Pass (the former delegate product, with gate QR).
  if new.kind = 'EVENT' then
    insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
    values
      ('SEND_EMAIL', 'order', new.id::text,
       'email:order-confirmation:' || new.id::text,
       jsonb_build_object('orderId', new.id, 'kind', new.kind))
    on conflict (logical_key) do nothing;
  elsif new.kind = 'BASE_PASS' then
    select * into v_line from order_lines where order_id = new.id limit 1;
    if found and v_line.pass_product_id is not null then
      select * into v_product from pass_products where id = v_line.pass_product_id;
      if found then
        v_is_delegate := (v_product.slug = 'vip-delegate-pass'
                          or not v_product.is_base_pass
                          or v_product.name ilike '%delegate%');
      end if;
    end if;

    if v_is_delegate then
      insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
      values
        ('SEND_EMAIL', 'order', new.id::text,
         'email:order-confirmation:' || new.id::text,
         jsonb_build_object('orderId', new.id, 'kind', new.kind))
      on conflict (logical_key) do nothing;

      select * into v_pass
      from delegate_passes
      where source_order_line_id = v_line.id and state = 'ACTIVE'
      order by created_at desc
      limit 1;
      if found then
        insert into outbox_jobs (job_type, aggregate_type, aggregate_id, logical_key, payload)
        values ('ISSUE_QR', 'delegate_pass', v_pass.id::text,
                'qr:issue:' || v_pass.id::text,
                jsonb_build_object('delegatePassId', v_pass.id))
        on conflict (logical_key) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function enqueue_fulfillment_outbox_jobs() from public, anon;
