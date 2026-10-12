-- 0035_group_entries.sql
-- Adds the public group-entry form table (custom group registration).
--
-- A visitor (no login required) fills the /group-entry form with a lead
-- name, contact details, college, and group size. Each submission is
-- stored here, surfaced on the admin mission-control dashboard, emailed
-- to the organizers, and mirrored to a Google Sheet by the API route.
--
-- Modeled on support_questions: public anonymous submissions are written
-- only through the Route Handler using the service role, so RLS is
-- enabled with NO insert policy; reads require the support.read
-- permission (reused rather than introducing a new permission code).

create table group_entries (
  id uuid primary key default gen_random_uuid(),
  public_entry_code text not null unique default 'GE-' || upper(encode(gen_random_bytes(5), 'hex')),
  lead_name text not null,
  email citext not null,
  phone text not null,
  college text,
  group_size integer not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint group_entry_name_len check (char_length(lead_name) between 1 and 120),
  constraint group_entry_phone_len check (char_length(phone) between 1 and 20),
  constraint group_entry_college_len check (college is null or char_length(college) between 1 and 160),
  constraint group_entry_size_range check (group_size between 1 and 500),
  constraint group_entry_notes_len check (notes is null or char_length(notes) <= 4000)
);

create index group_entries_created_idx on group_entries (created_at desc);

-- RLS: enabled, no insert policy (service role writes via the API),
-- read limited to staff with support.read (mirrors support_questions).
alter table group_entries enable row level security;

create policy group_entries_staff_read on group_entries
  for select using (has_permission('support.read'));
