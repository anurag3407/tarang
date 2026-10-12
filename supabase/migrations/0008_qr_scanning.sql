-- 0008: QR credentials and gate scanning (plan §7.15, §9.10)

-- ---------------------------------------------------------------------
-- qr_credentials
-- ---------------------------------------------------------------------
create table qr_credentials (
  id uuid primary key default gen_random_uuid(),
  jti uuid not null unique default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  delegate_pass_id uuid not null unique references delegate_passes (id) on delete cascade,
  key_id text not null,
  entitlement_version integer not null default 1,
  state qr_credential_state not null default 'ACTIVE',
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  token_digest text not null,
  created_at timestamptz not null default now()
);

create index qr_credentials_jti_idx on qr_credentials (jti);

-- ---------------------------------------------------------------------
-- gates / scanner_devices / gate_assignments
-- ---------------------------------------------------------------------
create table gates (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references festivals (id) on delete cascade,
  name text not null,
  gate_type gate_type not null default 'GENERAL',
  linked_event_id uuid references events (id) on delete set null,
  admission_policy admission_policy not null default 'ONE_PER_DAY',
  cooldown_seconds integer not null default 30,
  offline_policy offline_policy not null default 'FAIL_CLOSED',
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (festival_id, name)
);

create table scanner_devices (
  id uuid primary key default gen_random_uuid(),
  public_device_id text not null unique default 'SD-' || upper(encode(gen_random_bytes(5), 'hex')),
  name text not null,
  credential_hash text not null,
  state scanner_device_state not null default 'PENDING',
  last_seen_at timestamptz,
  app_version text,
  created_by uuid references auth.users (id),
  revoked_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table gate_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references scanner_devices (id) on delete cascade,
  gate_id uuid not null references gates (id) on delete cascade,
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint gate_assignments_window_valid check (valid_from < valid_until)
);

create index gate_assignments_active_idx
  on gate_assignments (device_id, gate_id, valid_until);

-- ---------------------------------------------------------------------
-- scan_attempts (append-only) / admissions
-- ---------------------------------------------------------------------
create table scan_attempts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique,
  credential_id uuid references qr_credentials (id) on delete set null,
  device_id uuid references scanner_devices (id) on delete set null,
  operator_user_id uuid references auth.users (id) on delete set null,
  gate_id uuid not null references gates (id) on delete restrict,
  captured_at_device timestamptz,
  received_at_server timestamptz not null default clock_timestamp(),
  offline_provisional boolean not null default false,
  outcome text not null,
  reason_code text,
  credential_digest text,
  metadata jsonb not null default '{}'::jsonb
);

create index scan_attempts_credential_idx on scan_attempts (credential_id, received_at_server desc);
create index scan_attempts_gate_idx on scan_attempts (gate_id, received_at_server desc);

create table admissions (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references qr_credentials (id) on delete restrict,
  gate_id uuid not null references gates (id) on delete restrict,
  scope_key text not null,
  first_scan_attempt_id uuid not null references scan_attempts (id) on delete restrict,
  admitted_at timestamptz not null default clock_timestamp(),
  state text not null default 'ACTIVE',
  constraint admissions_state_valid check (state in ('ACTIVE', 'REVOKED'))
);

-- One admission per credential per scope (when policy is one-entry).
create unique index admissions_one_per_scope
  on admissions (credential_id, scope_key)
  where state = 'ACTIVE';

alter table qr_credentials enable row level security;
alter table gates enable row level security;
alter table scanner_devices enable row level security;
alter table gate_assignments enable row level security;
alter table scan_attempts enable row level security;
alter table admissions enable row level security;

create policy qr_credentials_own_read on qr_credentials
  for select using (
    exists (select 1 from delegate_passes dp where dp.id = qr_credentials.delegate_pass_id and dp.user_id = auth.uid())
    or has_permission('pass.reissue')
  );

create policy gates_scanner_read on gates
  for select using (has_permission('scanner.use') or has_permission('scanner.supervise'));

create policy scanner_devices_manage on scanner_devices
  for select using (has_permission('scanner.device.manage') or has_permission('scanner.use'));

create policy scan_attempts_scanner_read on scan_attempts
  for select using (has_permission('scanner.use') or has_permission('audit.read'));

-- ---------------------------------------------------------------------
-- record_scan (plan §9.10) — one atomic transaction per scan.
-- ---------------------------------------------------------------------
create or replace function record_scan(
  p_scan_id uuid,
  p_credential_jti uuid,
  p_gate_id uuid,
  p_device_id uuid,
  p_operator_user_id uuid,
  p_captured_at_device timestamptz,
  p_offline_provisional boolean,
  p_credential_state text,
  p_credential_digest text,
  p_pass_class text,
  p_masked_name text,
  p_override boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate gates;
  v_credential qr_credentials;
  v_existing scan_attempts;
  v_attempt scan_attempts;
  v_admission admissions;
  v_scope_key text;
  v_outcome text;
  v_reason text := null;
  v_recent jsonb;
begin
  -- 1. Gate + device + assignment validation.
  select * into v_gate from gates where id = p_gate_id and is_active;
  if not found then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'gate_inactive');
  end if;

  if not exists (
    select 1 from gate_assignments ga
    where ga.device_id = p_device_id
      and ga.gate_id = p_gate_id
      and ga.operator_user_id = p_operator_user_id
      and now() between ga.valid_from and ga.valid_until
  ) then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'no_active_assignment');
  end if;

  -- 4. Idempotent retry: same scan_id returns the prior result.
  select * into v_existing from scan_attempts where scan_id = p_scan_id;
  if found then
    return jsonb_build_object('outcome', v_existing.outcome, 'reason', v_existing.reason_code, 'replayed', true);
  end if;

  -- Resolve credential.
  select * into v_credential from qr_credentials where jti = p_credential_jti for update;

  if v_credential is null then
    v_outcome := 'unknown_credential';
  elsif p_credential_state = 'invalid_signature' then
    v_outcome := 'invalid_signature';
  elsif v_credential.state <> 'ACTIVE' then
    v_outcome := case v_credential.state
      when 'REVOKED' then 'revoked'
      when 'EXPIRED' then 'expired'
      else 'revoked'
    end;
  elsif now() < v_credential.not_before then
    v_outcome := 'not_yet_valid';
  elsif now() > v_credential.expires_at then
    v_outcome := 'expired';
  else
    -- Gate policy evaluation.
    v_scope_key := case v_gate.admission_policy
      when 'ONE_PER_DAY' then to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
      when 'ONE_PER_EVENT' then coalesce(v_gate.linked_event_id::text, 'event')
      else 'reentry'
    end;

    select * into v_admission
    from admissions
    where credential_id = v_credential.id and scope_key = v_scope_key and state = 'ACTIVE'
    for update;

    if v_admission is not null then
      if v_gate.admission_policy = 'REENTRY_ALLOWED' then
        v_outcome := 'accepted_reentry';
      else
        v_outcome := 'duplicate';
        v_reason := 'already_admitted';
      end if;
    else
      -- Event gates require a confirmed registration for the linked event.
      if v_gate.gate_type in ('EVENT', 'PRO_SHOW') and v_gate.linked_event_id is not null then
        if not exists (
          select 1
          from qr_credentials qc
          join delegate_passes dp on dp.id = qc.delegate_pass_id
          join registration_members rm on rm.user_id = dp.user_id
          where qc.id = v_credential.id
            and rm.event_id = v_gate.linked_event_id
            and exists (
              select 1 from registrations r
              where r.id = rm.registration_id and r.state = 'CONFIRMED'
            )
        ) then
          v_outcome := 'wrong_event';
          v_reason := 'no_confirmed_registration';
        end if;
      end if;

      if v_outcome is null then
        if p_offline_provisional and v_gate.offline_policy = 'FAIL_CLOSED' and not p_override then
          v_outcome := 'cooldown';
          v_reason := 'offline_fail_closed';
        else
          v_outcome := 'accepted';
        end if;
      end if;
    end if;
  end if;

  -- Supervisor override.
  if p_override and v_outcome not in ('accepted', 'accepted_reentry') then
    v_outcome := 'manual_override';
    v_reason := coalesce(p_override_reason, 'supervisor_override');
    perform write_audit('scan.override', 'gate', p_gate_id::text, 'SUCCESS', p_override_reason);
  end if;

  -- 5. Insert immutable scan attempt.
  insert into scan_attempts (
    scan_id, credential_id, device_id, operator_user_id, gate_id,
    captured_at_device, offline_provisional, outcome, reason_code, credential_digest,
    metadata
  ) values (
    p_scan_id, v_credential.id, p_device_id, p_operator_user_id, p_gate_id,
    p_captured_at_device, p_offline_provisional, v_outcome, v_reason, p_credential_digest,
    jsonb_build_object('passClass', p_pass_class)
  )
  returning * into v_attempt;

  -- 6. Insert admission under uniqueness constraint.
  if v_outcome in ('accepted', 'manual_override') and v_credential is not null then
    begin
      insert into admissions (credential_id, gate_id, scope_key, first_scan_attempt_id)
      values (v_credential.id, p_gate_id, v_scope_key, v_attempt.id);
    exception when unique_violation then
      v_outcome := 'duplicate';
      v_reason := 'race_duplicate';
      update scan_attempts set outcome = 'duplicate', reason_code = 'race_duplicate'
      where id = v_attempt.id;
    end;
  end if;

  update scanner_devices set last_seen_at = clock_timestamp() where id = p_device_id;

  -- 7. Limited recent history.
  select coalesce(jsonb_agg(jsonb_build_object(
    'gateName', g.name, 'at', sa.received_at_server, 'outcome', sa.outcome
  ) order by sa.received_at_server desc), '[]'::jsonb)
  into v_recent
  from (
    select * from scan_attempts sa2
    where sa2.credential_id = v_credential.id
    order by sa2.received_at_server desc limit 3
  ) sa
  join gates g on g.id = sa.gate_id;

  return jsonb_build_object(
    'outcome', v_outcome,
    'reason', v_reason,
    'display', jsonb_build_object('maskedName', p_masked_name, 'passClass', p_pass_class),
    'recentScans', v_recent
  );
end;
$$;
