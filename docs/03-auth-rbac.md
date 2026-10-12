# 03 — Users, Login & Permissions

## Who can use the system

| Actor | What they can do | Where |
|-------|-----------------|-------|
| Anonymous visitor | Browse public pages, verify passes | `/`, `/events`, `/schedule`, `/verify` |
| Delegate (user) | Complete profile, buy pass, register for events, view QR | `/dashboard`, `/checkout` |
| Staff member | Manage content, support, exports (role-dependent) | `/admin/*` |
| Scanner operator | Scan QR at gates | `/scanner` |
| Superadmin | Manage staff + roles + everything | `/admin/staff`, `/admin/roles` (API) |

## How login works

Authentication is **Supabase Auth** (email magic links / password). Session token lives in
cookies and is refreshed on every request by `src/proxy.ts` (see [02](./02-architecture.md)).

### Signup → profile

1. User signs up. A trigger (`handle_new_user` in SQL migration 0002) auto-creates a
   `profiles` row. **Never block signup if this fails** — the trigger swallows errors.
2. User must verify email before any checkout (`requireUser()` in `src/services/authz.ts:24`).
3. `/complete-profile` collects `display_name`, `college_name`, `phone_e164` and consent.
   Sets `profile_completed_at` — many flows require a completed profile.

### Protected pages

`src/proxy.ts` redirects unauthenticated users to login for:

| Path prefix | Redirect target |
|------|----------------|
| `/dashboard` | `/login` |
| `/admin` | `/admin/login` |
| `/scanner` | `/login` |

**Important:** proxy.ts only checks "is there a session?" — it CANNOT check roles or permissions
(it runs on edge, no DB). Fine-grained checks happen later, server-side. If you see a logged-in
admin blocked, it's the layout or API route, not proxy.ts.

## Staff, roles, permissions (RBAC)

The tables:

```
roles            – named bundles of permissions (e.g. "Content Lead", "Finance")
permissions      – atomic capability codes (fixed catalog)
role_permissions – many-to-many bridge
staff_assignments– user ↔ role, per festival, with status
staff_event_scopes– optional per-event scoping (staff limited to certain events)
```

### The 25 permission codes

Found in `src/domain/auth.ts:43` (`PERMISSION_CODES`). Groups:

| Group | Examples |
|-------|----------|
| admin/staff | `admin.access`, `staff.manage`, `role.manage` |
| content | `content.event.write`, `content.schedule.write`, `content.notice.write` |
| support | `support.read`, `support.resolve` |
| registration | `registration.read`, `registration.export` |
| finance | `finance.read`, `refund.create`, `refund.approve`, `payment.reconcile` |
| scanner | `scanner.use`, `scanner.supervise`, `scanner.device.manage` |
| pass | `pass.revoke`, `pass.reissue` |
| misc | `audit.read`, `feature_flag.write` |

### How permission is checked

```
API route
  └─ requirePermission("content.event.write")          src/services/authz.ts:48
       └─ sb.rpc("has_permission", {permission, event_id})
            └─ SQL resolves auth.uid() in current DB state (NOT JWT claims)
```

**Why "current DB state" matters:** JWT tokens can outlive role changes (e.g. a user is
revoked but token lasts 5 min more). The SQL check hits `staff_assignments` every time, so
revocations take effect **immediately**. Never replace `has_permission` with JWT claims.

### Admin access flow

1. Superadmin invites staff via `/admin/staff` (calls `/api/admin/staff/invitations`).
2. Invitee gets `staff_assignments` row with status `INVITED`.
3. On login with an active invite, status flips to `ACTIVE` in the DB.
4. `src/app/admin/layout.tsx:34` checks for an ACTIVE assignment and shows
   "Access denied" if missing.
5. Each API handler re-checks the specific permission needed for that mutation.

## Two ways "403" happens

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` (401) | No session. "Please log in." |
| `FORBIDDEN` (403) | Logged in, but not allowed. |
| `FEATURE_DISABLED` (403) | Feature flag turned off for this festival. |

When debugging admin bugs:
1. Is the user logged in? (401)
2. Is `staff_assignments.status` = `ACTIVE`?
3. Does their role → role_permissions contain the code? (`SELECT * FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.id = '<role_id>';`)
4. Is the assignment event-scoped to a different event? (`staff_event_scopes` table)

## The `is_superadmin` special case

In SQL: `has_permission()` and `is_superadmin()` automatically grant active superadmins all permission codes across the system (basic to advanced: event creation/editing/publishing/pricing, gate scanning & device management, staff & role management, finance, refunds, support resolution, exports, etc.) and bypass any event scoping. `active_superadmin_count()` guards against accidentally revoking the last active superadmin.

## What can go wrong?

| Symptom | Cause |
|---------|-------|
| Logged-in user can't checkout | Email not verified → `UNAUTHORIZED`; profile not completed |
| Staff sees "Access denied" page | `staff_assignments.status` not `ACTIVE` (invitation not accepted, or revoked) |
| "Missing permission" after role edit | `role_permissions` row missing — check join table, not just `roles` |
| Revoked staff still has access | Permission cached somewhere — `authz.ts` uses **current** state, but check if you're on old code path |
| Can't login with Supabase env not set | proxy.ts silently skips auth (line 32) — check `NEXT_PUBLIC_SUPABASE_URL` exists |
| Admin API returns 403 despite working UI | Permission check differs per route (write vs publish vs price.write vs capacity.write). Compare the permission required in the route handler. |
