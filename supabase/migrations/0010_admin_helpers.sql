-- 0010: admin helpers.
--
-- auth-js 2.112 removed `getUserByEmail` from the admin API. Staff
-- invitations (plan §11.5) still need to resolve an invitee's existing
-- account by email, so expose a minimal security-definer lookup. It is
-- executable by service_role only — never by participant sessions.

create or replace function resolve_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function resolve_user_id_by_email(text) from public, anon, authenticated;
grant execute on function resolve_user_id_by_email(text) to service_role;
