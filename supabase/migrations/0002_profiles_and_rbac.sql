-- 0002: festivals, profiles, RBAC, audit (plan §7.2–§7.4)

-- ---------------------------------------------------------------------
-- festivals
-- ---------------------------------------------------------------------
create table festivals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  year smallint not null,
  timezone text not null default 'Asia/Kolkata',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status festival_status not null default 'DRAFT',
  base_currency char(3) not null default 'INR',
  settings jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint festivals_dates_valid check (starts_at < ends_at),
  constraint festivals_name_year_unique unique (name, year)
);

-- ---------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text,
  college_name text,
  phone_e164 text,
  public_member_code text not null unique default encode(gen_random_bytes(9), 'base64'),
  profile_completed_at timestamptz,
  consent_version text,
  consented_at timestamptz,
  status profile_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 120),
  constraint profiles_college_len check (char_length(college_name) <= 160),
  constraint profiles_phone_len check (char_length(phone_e164) <= 20)
);

-- Failure-safe profile creation trigger (plan §7.2).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (user_id) do nothing;
  return new;
exception when others then
  -- Never block signup on a profile trigger failure.
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid references festivals (id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_superadmin boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (festival_id, name)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text
);

create table role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_id uuid not null references permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table staff_assignments (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references roles (id) on delete restrict,
  status staff_assignment_status not null default 'INVITED',
  invited_by uuid references auth.users (id),
  invited_email citext,
  activated_at timestamptz,
  revoked_at timestamptz,
  authz_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active assignment per user/role/festival.
create unique index staff_assignments_one_active
  on staff_assignments (festival_id, user_id, role_id)
  where status = 'ACTIVE';

create table staff_event_scopes (
  staff_assignment_id uuid not null references staff_assignments (id) on delete cascade,
  event_id uuid not null,
  primary key (staff_assignment_id, event_id)
);

-- ---------------------------------------------------------------------
-- audit_logs (append-only; no update/delete grants)
-- ---------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  festival_id uuid references festivals (id),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  actor_type audit_actor_type not null default 'USER',
  request_id text,
  ip_hash text,
  user_agent_summary text,
  action text not null,
  target_type text,
  target_id text,
  result audit_result not null default 'SUCCESS',
  reason text,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index audit_logs_action_idx on audit_logs (action, occurred_at desc);
create index audit_logs_target_idx on audit_logs (target_type, target_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- RBAC helper functions (security definer, stable within a statement)
-- ---------------------------------------------------------------------

-- Current active assignment row for the calling user in a festival.
create or replace function current_staff_assignment(p_festival_id uuid)
returns staff_assignments
language sql
stable
security definer
set search_path = public
as $$
  select sa.*
  from staff_assignments sa
  where sa.user_id = auth.uid()
    and sa.festival_id = p_festival_id
    and sa.status = 'ACTIVE'
  order by sa.created_at desc
  limit 1;
$$;

-- Does the calling user hold a permission code (optionally event-scoped)?
-- Superadmins bypass all permission code and event scope checks.
create or replace function has_permission(p_permission text, p_event_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from staff_assignments sa
    join roles r on r.id = sa.role_id
    where sa.user_id = auth.uid()
      and sa.status = 'ACTIVE'
      and (
        r.is_superadmin
        or (
          exists (
            select 1
            from role_permissions rp
            join permissions p on p.id = rp.permission_id
            where rp.role_id = r.id
              and p.code = p_permission
          )
          and (
            p_event_id is null
            or exists (
              select 1 from staff_event_scopes ses
              where ses.staff_assignment_id = sa.id and ses.event_id = p_event_id
            )
            or not exists (
              select 1 from staff_event_scopes ses2
              where ses2.staff_assignment_id = sa.id
            )
          )
        )
      )
  );
$$;

create or replace function is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from staff_assignments sa
    join roles r on r.id = sa.role_id
    where sa.user_id = auth.uid()
      and sa.status = 'ACTIVE'
      and r.is_superadmin
  );
$$;

-- Count of active superadmins (last-superadmin protection, plan §7.3).
create or replace function active_superadmin_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from staff_assignments sa
  join roles r on r.id = sa.role_id
  where sa.status = 'ACTIVE' and r.is_superadmin;
$$;
