-- 0016: sponsors catalog & management

-- ---------------------------------------------------------------------
-- sponsors table
-- ---------------------------------------------------------------------
create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  name text not null,
  category text not null,
  tagline text not null default '',
  logo_url text not null,
  website_url text,
  color_key text not null default 'secondary',
  sort_order integer not null default 0,
  is_title boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsors_name_len check (char_length(name) between 1 and 160)
);

create index if not exists sponsors_festival_order_idx
  on sponsors (festival_id, is_title desc, sort_order asc, created_at asc);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table sponsors enable row level security;

drop policy if exists sponsors_public_read on sponsors;
create policy sponsors_public_read on sponsors
  for select using (is_active or has_permission('admin.access'));

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into permissions (code, description) values
  ('content.sponsor.write', 'Create, update, and delete festival sponsors')
on conflict (code) do nothing;

-- Grant to Superadmin and Content Admin
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.name in ('Superadmin', 'Content Admin') and r.is_system
  and p.code = 'content.sponsor.write'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Admin mutation function
-- ---------------------------------------------------------------------
create or replace function admin_upsert_sponsor(
  p_sponsor_id uuid,
  p_festival_id uuid,
  p_name text,
  p_category text,
  p_tagline text,
  p_logo_url text,
  p_website_url text,
  p_color_key text,
  p_sort_order integer,
  p_is_title boolean,
  p_is_active boolean,
  p_expected_version integer
)
returns sponsors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor sponsors;
begin
  if not (has_permission('content.sponsor.write') or has_permission('content.event.write') or is_superadmin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_sponsor_id is null then
    insert into sponsors (
      festival_id, name, category, tagline, logo_url, website_url,
      color_key, sort_order, is_title, is_active
    ) values (
      p_festival_id, p_name, p_category, coalesce(p_tagline, ''), p_logo_url, p_website_url,
      coalesce(p_color_key, 'secondary'), coalesce(p_sort_order, 0), coalesce(p_is_title, false), coalesce(p_is_active, true)
    )
    returning * into v_sponsor;
    perform write_audit('sponsor.create', 'sponsor', v_sponsor.id::text);
  else
    select * into v_sponsor from sponsors where id = p_sponsor_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sponsor.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    update sponsors set
      name = p_name, category = p_category, tagline = coalesce(p_tagline, ''),
      logo_url = p_logo_url, website_url = p_website_url,
      color_key = coalesce(p_color_key, 'secondary'), sort_order = coalesce(p_sort_order, 0),
      is_title = coalesce(p_is_title, false), is_active = coalesce(p_is_active, true),
      version = version + 1, updated_at = clock_timestamp()
    where id = p_sponsor_id
    returning * into v_sponsor;
    perform write_audit('sponsor.update', 'sponsor', p_sponsor_id::text);
  end if;
  return v_sponsor;
end;
$$;
