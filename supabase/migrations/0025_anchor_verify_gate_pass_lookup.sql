-- 0025_anchor_verify_gate_pass_lookup.sql
-- Additive fix for V-12c: `verify_gate_pass_lookup` matched `email ilike
-- v_query` unanchored, so any operator with `scanner.use` could harvest
-- registered emails by iterating substrings (rate limit is per device only).
-- New semantics:
--   * email queries (contain '@'') must match the full address exactly;
--   * pass-code queries match a case-insensitive prefix of the code;
--   * LIKE wildcards in user input are escaped, so a crafted `%`/`_` query
--     can never turn into a capture pattern.

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
  v_query text := trim(p_query);
  v_like text;
begin
  v_like := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

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
  where dp.state = 'ACTIVE'
    and (
      dp.public_pass_code ilike v_like || '%' escape '\'
      or (
        v_query like '%@%'
        and lower(u.email) = lower(v_query)
      )
    )
  order by dp.created_at desc
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
