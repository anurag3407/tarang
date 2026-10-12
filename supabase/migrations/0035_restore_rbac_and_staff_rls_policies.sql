-- 0035_restore_rbac_and_staff_rls_policies.sql
--
-- Restores RLS policies dropped when has_permission was dropped with CASCADE in 0027.
--

-- 1. RBAC tables
drop policy if exists roles_read on roles;
create policy roles_read on roles
  for select using (has_permission('admin.access'));

drop policy if exists permissions_read on permissions;
create policy permissions_read on permissions
  for select using (has_permission('admin.access'));

drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions
  for select using (has_permission('admin.access'));

-- 2. Staff assignments & scopes
drop policy if exists staff_assignments_read on staff_assignments;
create policy staff_assignments_read on staff_assignments
  for select using (has_permission('staff.manage') or user_id = auth.uid());

drop policy if exists staff_event_scopes_read on staff_event_scopes;
create policy staff_event_scopes_read on staff_event_scopes
  for select using (has_permission('staff.manage'));

-- 3. Profiles read
drop policy if exists profiles_own_read on profiles;
create policy profiles_own_read on profiles
  for select using (user_id = auth.uid() or has_permission('admin.access'));

-- 4. Support questions
drop policy if exists support_staff_read on support_questions;
create policy support_staff_read on support_questions
  for select using (has_permission('support.read'));

drop policy if exists support_staff_update on support_questions;
create policy support_staff_update on support_questions
  for update using (has_permission('support.resolve'));
