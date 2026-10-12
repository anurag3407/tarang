-- 0028_record_scan_gate_assignment_and_offline_policy.sql
-- G4: restore gate-assignment enforcement and offline FAIL_CLOSED semantics
-- in `record_scan`.
--
-- 0018/0019/0022/0023 rewrote `record_scan` and dropped two checks from the
-- original 0008 implementation:
--   * REQUIRED: the device/operator must hold an ACTIVE `gate_assignments`
--     row for the requested gate (0008 block). 0022/0023 instead silently
--     fell back to the first active gate of any kind, which both broke
--     operator scoping and could record scans against the wrong gate.
--   * REQUIRED: an offline/provisional scan on a FAIL_CLOSED gate must be
--     rejected unless a supervisor overrides (0008 block). 0022/0023 never
--     evaluated `offline_policy` at all.
-- 0023 also collapsed every existing-admission outcome to `accepted_reentry`
-- (it used to be `duplicate`/`already_admitted` for one-entry gates).
--
-- This migration restores all three while keeping:
--   * the 0022 `p_credential_jti uuid` signature (drop the broken text
--     overload first),
--   * the 0023 field-based null checks (`v_credential.id is null`), which
--     fixed row-type `is null` evaluation,
--   * the 0023 unified scan history across all credentials of a pass,
--   * replay-first idempotency: a retried `scan_id` returns the prior
--     result before any new gate/credential evaluation, so a successful
--     first attempt can never be turned into a failure (or vice versa) by a
--     retry, and the unique(scan_id) constraint can never be hit.

drop function if exists record_scan(
  uuid, text, uuid, uuid, uuid, timestamptz, boolean, text, text, text, text, boolean, text
);

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
  -- 0. Idempotent retry: same scan_id returns the prior recorded result.
  --    Runs first so a retry can never be re-evaluated against a changed
  --    gate/assignment state (and can never violate unique(scan_id)).
  select * into v_existing from scan_attempts where scan_id = p_scan_id;
  if found then
    return jsonb_build_object('outcome', v_existing.outcome, 'reason', v_existing.reason_code, 'replayed', true);
  end if;

  -- 1. Gate must exist and be active for the requested p_gate_id. No
  --    fallback to "first active gate": silently scanning another gate
  --    corrupts admission scope and audit.
  select * into v_gate from gates where id = p_gate_id;
  if not found then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'unknown_gate');
  end if;

  if not v_gate.is_active then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'gate_inactive');
  end if;

  -- 2. Device/operator must hold an active assignment to this gate.
  if not exists (
    select 1 from gate_assignments ga
    where ga.device_id = p_device_id
      and ga.gate_id = p_gate_id
      and ga.operator_user_id = p_operator_user_id
      and now() between ga.valid_from and ga.valid_until
  ) then
    return jsonb_build_object('outcome', 'wrong_gate', 'reason', 'no_active_assignment');
  end if;

  -- 3. Resolve credential (field-based null checks; see 0023).
  select * into v_credential from qr_credentials where jti = p_credential_jti for update;

  -- Admission scope key depends only on the gate policy. Computed before the
  -- credential-state branch so a supervisor override of a revoked/expired
  -- credential still records an admission with a meaningful scope (0008/0023
  -- left v_scope_key null and hit the admissions.scope_key NOT NULL check).
  v_scope_key := case v_gate.admission_policy
    when 'ONE_PER_DAY' then to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
    when 'ONE_PER_EVENT' then coalesce(v_gate.linked_event_id::text, 'event')
    else 'reentry'
  end;

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
    -- 4. Gate policy evaluation (existing admission for this scope).
    select * into v_admission
    from admissions
    where credential_id = v_credential.id and scope_key = v_scope_key and state = 'ACTIVE'
    for update;

    if v_admission.id is not null then
      -- 5. Existing check-in: re-entry only where the gate allows it.
      if v_gate.admission_policy = 'REENTRY_ALLOWED' then
        v_outcome := 'accepted_reentry';
      else
        v_outcome := 'duplicate';
        v_reason := 'already_admitted';
      end if;
    else
      -- 6. Event gates require a confirmed registration for the linked event.
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
        -- 7. Offline/provisional scans fail closed on FAIL_CLOSED gates
        --    unless a supervisor explicitly overrides.
        if p_offline_provisional and v_gate.offline_policy = 'FAIL_CLOSED' and not p_override then
          v_outcome := 'cooldown';
          v_reason := 'offline_fail_closed';
        else
          v_outcome := 'accepted';
        end if;
      end if;
    end if;
  end if;

  -- 8. Supervisor override.
  if p_override and v_outcome not in ('accepted', 'accepted_reentry') then
    v_outcome := 'manual_override';
    v_reason := coalesce(p_override_reason, 'supervisor_override');
    perform write_audit('scan.override', 'gate', p_gate_id::text, 'SUCCESS', p_override_reason);
  end if;

  -- 9. Insert immutable scan attempt.
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

  -- 10. Insert admission record on first entry. A concurrent insert wins
  --     race yields the policy-appropriate outcome instead of a 500.
  if v_outcome in ('accepted', 'manual_override') and v_credential.id is not null then
    begin
      insert into admissions (credential_id, gate_id, scope_key, first_scan_attempt_id)
      values (v_credential.id, v_gate.id, v_scope_key, v_attempt.id);
    exception when unique_violation then
      if v_gate.admission_policy = 'REENTRY_ALLOWED' then
        v_outcome := 'accepted_reentry';
        v_reason := 'race_reentry';
      else
        v_outcome := 'duplicate';
        v_reason := 'race_duplicate';
      end if;
      update scan_attempts set outcome = v_outcome, reason_code = v_reason
      where id = v_attempt.id;
    end;
  end if;

  update scanner_devices set last_seen_at = clock_timestamp() where id = p_device_id;

  -- 11. Full unified scan history across all credentials for this pass (up to 25 past entries).
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
