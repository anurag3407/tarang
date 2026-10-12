-- 0003: content catalog, passes, support (plan §7.5–§7.7)

-- ---------------------------------------------------------------------
-- categories / venues
-- ---------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  slug text not null,
  name text not null,
  tagline text,
  icon_key text,
  color_key text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (festival_id, slug)
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  name text not null,
  short_name text,
  description text,
  map_url text,
  capacity_hint integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (festival_id, name)
);

-- ---------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------
create table events (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  slug text not null,
  name text not null,
  short_description text not null,
  description text not null,
  rules_markdown text,
  category_id uuid not null references categories (id) on delete restrict,
  venue_id uuid references venues (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  include_in_schedule boolean not null default true,
  is_night_event boolean not null default false,
  registration_mode registration_mode not null,
  capacity_basis capacity_basis not null,
  price_basis price_basis not null,
  min_team_size integer not null default 1,
  max_team_size integer not null default 1,
  current_price_version_id uuid,
  sales_state sales_state not null default 'DRAFT',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  prize_pool_text text not null default '',
  featured boolean not null default false,
  sort_order integer not null default 0,
  status content_status not null default 'DRAFT',
  published_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_dates_valid check (starts_at < ends_at),
  constraint events_individual_team_size check (
    registration_mode <> 'INDIVIDUAL' or (min_team_size = 1 and max_team_size = 1)
  ),
  constraint events_team_size_valid check (
    min_team_size >= 1 and min_team_size <= max_team_size
  ),
  constraint events_registration_window_valid check (
    registration_opens_at is null
    or registration_closes_at is null
    or registration_opens_at < registration_closes_at
  )
);

create unique index events_festival_slug_unique on events (festival_id, slug);

-- ---------------------------------------------------------------------
-- event_price_versions (immutable)
-- ---------------------------------------------------------------------
create table event_price_versions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete restrict,
  version integer not null,
  unit_amount_paise bigint not null,
  currency char(3) not null default 'INR',
  created_by uuid references auth.users (id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (event_id, version),
  constraint event_price_non_negative check (unit_amount_paise >= 0),
  constraint event_price_currency check (currency = 'INR')
);

alter table events
  add constraint events_price_version_fk
  foreign key (current_price_version_id)
  references event_price_versions (id) on delete restrict;

-- ---------------------------------------------------------------------
-- event_inventory — the authoritative counter (plan §7.5)
-- ---------------------------------------------------------------------
create table event_inventory (
  event_id uuid primary key references events (id) on delete cascade,
  capacity_units integer not null,
  held_units integer not null default 0,
  confirmed_units integer not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint event_inventory_invariant check (
    capacity_units >= 0
    and held_units >= 0
    and confirmed_units >= 0
    and held_units + confirmed_units <= capacity_units
  )
);

-- ---------------------------------------------------------------------
-- schedule_entries
-- ---------------------------------------------------------------------
create table schedule_entries (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  linked_event_id uuid references events (id) on delete set null,
  title text,
  venue_id uuid references venues (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  category_key text not null,
  is_night boolean not null default false,
  day_theme text,
  status schedule_status not null default 'DRAFT',
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_dates_valid check (starts_at < ends_at),
  constraint schedule_standalone_requires_title check (
    linked_event_id is not null or (title is not null and venue_id is not null)
  )
);

create index schedule_entries_festival_time_idx
  on schedule_entries (festival_id, starts_at);

-- ---------------------------------------------------------------------
-- notices
-- ---------------------------------------------------------------------
create table notices (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  slug text not null,
  tag notice_tag not null,
  title text not null,
  body_markdown text not null,
  status notice_status not null default 'DRAFT',
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  pinned boolean not null default false,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (festival_id, slug),
  constraint notices_expiry_valid check (expires_at is null or expires_at > publish_at)
);

-- ---------------------------------------------------------------------
-- feature_flags (plan §7.5)
-- ---------------------------------------------------------------------
create table feature_flags (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (festival_id, key)
);

-- ---------------------------------------------------------------------
-- support_questions (plan §7.6)
-- ---------------------------------------------------------------------
create table support_questions (
  id uuid primary key default gen_random_uuid(),
  public_ticket_code text not null unique default 'PQ-' || upper(encode(gen_random_bytes(5), 'hex')),
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email citext not null,
  college text,
  topic text not null,
  question text not null,
  status support_status not null default 'OPEN',
  assigned_to uuid references auth.users (id),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_name_len check (char_length(name) between 1 and 120),
  constraint support_question_len check (char_length(question) between 1 and 4000)
);

create index support_questions_status_idx on support_questions (status, created_at desc);

-- ---------------------------------------------------------------------
-- pass_products / pass_price_versions (plan §7.7)
-- ---------------------------------------------------------------------
create table pass_products (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  is_base_pass boolean not null default false,
  requires_base_pass boolean not null default false,
  current_price_version_id uuid,
  sales_state sales_state not null default 'DRAFT',
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status content_status not null default 'DRAFT',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (festival_id, slug),
  constraint pass_product_window_valid check (valid_from < valid_until)
);

-- Exactly one active base product per festival.
create unique index pass_products_one_base
  on pass_products (festival_id)
  where is_base_pass and status = 'PUBLISHED';

create table pass_price_versions (
  id uuid primary key default gen_random_uuid(),
  pass_product_id uuid not null references pass_products (id) on delete restrict,
  version integer not null,
  unit_amount_paise bigint not null,
  currency char(3) not null default 'INR',
  created_by uuid references auth.users (id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (pass_product_id, version),
  constraint pass_price_non_negative check (unit_amount_paise >= 0),
  constraint pass_price_currency check (currency = 'INR')
);

alter table pass_products
  add constraint pass_products_price_version_fk
  foreign key (current_price_version_id)
  references pass_price_versions (id) on delete restrict;
