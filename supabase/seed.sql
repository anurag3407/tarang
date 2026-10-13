-- seed.sql — local development seed (plan §11.10).
-- Idempotent: safe to re-run via `supabase db reset`.

-- Festival
insert into festivals (slug, name, year, starts_at, ends_at, status)
values ('tarang-2026', 'TARANG', 2026, '2026-09-17 00:00:00+00', '2026-09-22 00:00:00+00', 'PUBLISHED')
on conflict (slug) do update set status = 'PUBLISHED', starts_at = '2026-09-17 00:00:00+00', ends_at = '2026-09-22 00:00:00+00';

-- P0 feature flags (plan §7.5)
insert into feature_flags (festival_id, key, enabled)
select f.id, flag.key, flag.enabled
from festivals f
cross join (values
  ('public_site_enabled', true),
  ('auth_enabled', true),
  ('base_pass_sales_enabled', true),
  ('event_sales_enabled', true),
  ('scanner_enabled', false),
  ('sheets_mirror_enabled', false),
  ('maintenance_mode', false)
) as flag(key, enabled)
where f.slug = 'tarang-2026'
on conflict (festival_id, key) do nothing;

-- Retired Basic Card (₹200 = 20000 paise). Kept for historical orders only:
-- the Pronite Pass below is the sole pass on sale, so this stays ARCHIVED.
insert into pass_products (
  festival_id, slug, name, description, is_base_pass, requires_base_pass,
  sales_state, valid_from, valid_until, status
)
select f.id, 'base-delegate-pass', 'Basic Card',
       'Standard 5-day festival entry card. Required before registering for events.',
       true, false, 'CLOSED',
       '2026-09-01 00:00:00+00', '2026-09-22 00:00:00+00', 'ARCHIVED'
from festivals f
where f.slug = 'tarang-2026'
on conflict (festival_id, slug) do nothing;

-- insert into pass_price_versions
insert into pass_price_versions (pass_product_id, version, unit_amount_paise, change_reason)
select pp.id, 1, 20000, 'initial price ₹200'
from pass_products pp
join festivals f on f.id = pp.festival_id
where f.slug = 'tarang-2026' and pp.slug = 'base-delegate-pass'
  and not exists (
    select 1 from pass_price_versions ppv where ppv.pass_product_id = pp.id
  );

update pass_products pp
set current_price_version_id = (
  select ppv.id from pass_price_versions ppv
  where ppv.pass_product_id = pp.id order by ppv.version desc limit 1
)
from festivals f
where f.id = pp.festival_id and f.slug = 'tarang-2026'
  and pp.slug = 'base-delegate-pass'
  and pp.current_price_version_id is null;

-- VIP All-Access Delegate Pass product at ₹2000 = 200000 paise.
insert into pass_products (
  festival_id, slug, name, description, is_base_pass, requires_base_pass,
  sales_state, valid_from, valid_until, status
)
select f.id, 'vip-delegate-pass', 'All-Access Delegate Card',
       'All-access 5-day card with entry to all pro-show concerts, VIP front-row seating, fast-track entry, and artist lounge access.',
       false, true, 'OPEN',
       '2026-09-01 00:00:00+00', '2026-09-22 00:00:00+00', 'PUBLISHED'
from festivals f
where f.slug = 'tarang-2026'
on conflict (festival_id, slug) do update set requires_base_pass = true;

insert into pass_price_versions (pass_product_id, version, unit_amount_paise, change_reason)
select pp.id, 1, 200000, 'initial price ₹2000'
from pass_products pp
join festivals f on f.id = pp.festival_id
where f.slug = 'tarang-2026' and pp.slug = 'vip-delegate-pass'
  and not exists (
    select 1 from pass_price_versions ppv where ppv.pass_product_id = pp.id
  );

update pass_products pp
set current_price_version_id = (
  select ppv.id from pass_price_versions ppv
  where ppv.pass_product_id = pp.id order by ppv.version desc limit 1
)
from festivals f
where f.id = pp.festival_id and f.slug = 'tarang-2026'
  and pp.slug = 'vip-delegate-pass'
  and pp.current_price_version_id is null;

-- Default gates for scanning (Phase 4).
insert into gates (festival_id, name, gate_type, admission_policy, offline_policy)
select f.id, g.name, g.gate_type, g.admission_policy, g.offline_policy
from festivals f
cross join (values
  ('Main Gate', 'GENERAL'::gate_type, 'REENTRY_ALLOWED'::admission_policy, 'PROVISIONAL_GENERAL'::offline_policy),
  ('Convention Centre', 'PRO_SHOW'::gate_type, 'REENTRY_ALLOWED'::admission_policy, 'FAIL_CLOSED'::offline_policy),
  ('Amphitheatre', 'EVENT'::gate_type, 'REENTRY_ALLOWED'::admission_policy, 'FAIL_CLOSED'::offline_policy)
) as g(name, gate_type, admission_policy, offline_policy)
where f.slug = 'tarang-2026'
on conflict (festival_id, name) do update set admission_policy = 'REENTRY_ALLOWED';

-- Bootstrap note (plan §11.5): the first superadmin is granted through a
-- one-time script, not a public endpoint. Replace the email below and run
-- manually against the target project:
--
--   insert into staff_assignments (festival_id, user_id, role_id, status, activated_at)
--   select f.id, u.id, r.id, 'ACTIVE', now()
--   from festivals f, auth.users u, roles r
--   where f.slug = 'tarang-2026'
--     and u.email = 'you@example.com'
--     and r.name = 'Superadmin' and r.is_system;

