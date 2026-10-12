-- 0023_fix_record_scan_composite_null_checks.sql
-- Additive fix: `record_scan` (0022 and earlier) tested row-type variables
-- with composite `is null` / `is not null`. For a composite value, PostgreSQL
-- only treats `row is null` as true when *every* field is null and `row is
-- not null` when *every* field is not null. `qr_credentials.revoked_at` is
-- nullable, so after the credential SELECT resolves a row both checks are
-- FALSE for every real credential. Consequences (verified on live DB):
--   * Step 5 admission INSERT guard (`v_credential is not null`) never fires
--     -> admissions are never recorded; first-entry semantics dead.
--   * Step 6 scan history guard never fires -> clients always receive an
--     empty `recentScans` array.
-- Replace all row-type null checks with field-based checks (`v_*.id` is
-- never null on a resolved row because `id` is the primary key, and stays
-- null when no row was found).

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
  -- 1. Gate validation (with fallback if needed).
  select * into v_gate from gates where id = p_gate_id and is_active;
  if not found then
    select * into v_gate from gates where is_active order by name asc limit 1;
  end if;

  if v_gate.id is null then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'no_active_gates');
  end if;

  -- 2. Idempotent retry: same scan_id returns the prior result.
  select * into v_existing from scan_attempts where scan_id = p_scan_id;
  if found then
    return jsonb_build_object('outcome', v_existing.outcome, 'reason', v_existing.reason_code, 'replayed', true);
  end if;

  -- 3. Resolve credential.
  select * into v_credential from qr_credentials where jti = p_credential_jti for update;

  if v_credential.id is null then
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
      when 'ONE_PER_EVENT' then coalesce(v_gate.linked_event_id::text, 'event')
      else 'reentry'
    end;

    select * into v_admission
    from admissions
    where credential_id = v_credential.id and scope_key = v_scope_key and state = 'ACTIVE'
    for update;

    if v_admission.id is not null then
      -- Existing check-in: Permit re-entry
      v_outcome := 'accepted_reentry';
    else
      -- Event gates require confirmed registration.
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
        v_outcome := 'accepted';
      end if;
    end if;
  end if;

  -- Supervisor override.
  if p_override and v_outcome not in ('accepted', 'accepted_reentry') then
    v_outcome := 'manual_override';
    v_reason := coalesce(p_override_reason, 'supervisor_override');
  end if;

  -- 4. Insert immutable scan attempt.
  insert into scan_attempts (
    scan_id, credential_id, device_id, operator_user_id, gate_id,
    captured_at_device, offline_provisional, outcome, reason_code, credential_digest,
    metadata
  ) values (
    p_scan_id, coalesce(v_credential.id, '00000000-0000-0000-0000-000000000000'::uuid),
    p_device_id, p_operator_user_id, v_gate.id,
    p_captured_at_device, p_offline_provisional, v_outcome, v_reason, p_credential_digest,
    jsonb_build_object('passClass', p_pass_class)
  )
  returning * into v_attempt;

  -- 5. Insert admission record on first entry.
  if v_outcome in ('accepted', 'manual_override') and v_credential.id is not null then
    begin
      insert into admissions (credential_id, gate_id, scope_key, first_scan_attempt_id)
      values (v_credential.id, v_gate.id, v_scope_key, v_attempt.id);
    exception when unique_violation then
      v_outcome := 'accepted_reentry';
      update scan_attempts set outcome = 'accepted_reentry'
      where id = v_attempt.id;
    end;
  end if;

  update scanner_devices set last_seen_at = clock_timestamp() where id = p_device_id;

  -- 6. Full unified scan history across all credentials for this pass (up to 25 past entries).
  if v_credential.id is not null and v_credential.delegate_pass_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'gateName', coalesce(g.name, 'Main Gate'), 'at', sa.captured_at_device, 'outcome', sa.outcome
    ) order by sa.captured_at_device desc), '[]'::jsonb)
    into v_recent
    from (
      select sa2.* from scan_attempts sa2
      where sa2.credential_id in (
        select qc2.id from qr_credentials qc2
        where qc2.delegate_pass_id = v_credential.delegate_pass_id
      )
      order by sa2.captured_at_device desc limit 25
    ) sa
    left join gates g on g.id = sa.gate_id;
  elsif v_credential.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'gateName', coalesce(g.name, 'Main Gate'), 'at', sa.captured_at_device, 'outcome', sa.outcome
    ) order by sa.captured_at_device desc), '[]'::jsonb)
    into v_recent
    from (
      select * from scan_attempts sa2
      where sa2.credential_id = v_credential.id
      order by sa2.captured_at_device desc limit 25
    ) sa
    left join gates g on g.id = sa.gate_id;
  else
    v_recent := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'reason', v_reason,
    'display', jsonb_build_object('maskedName', p_masked_name, 'passClass', p_pass_class),
    'recentScans', v_recent
  );
end;
$$;
