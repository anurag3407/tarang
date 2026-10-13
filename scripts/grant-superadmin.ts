/**
 * Grant the first superadmin (plan §11.5).
 *
 * Superadmin access is deliberately not grantable through any HTTP endpoint —
 * it is a one-time out-of-band operation. This script is the supported way to
 * do it, replacing the commented-out SQL note at the end of supabase/seed.sql.
 *
 * Usage:
 *   pnpm grant:superadmin you@college.edu
 *   pnpm grant:superadmin you@college.edu --role "Content Admin"
 *   pnpm grant:superadmin --list
 *
 * If no auth user exists for the email yet, the script creates one with a
 * confirmed address (no password — the app signs in via magic link / Google),
 * so you can bootstrap admin access before anyone has logged in.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FEST_SLUG = process.env.FEST_SLUG ?? "tarang-2026";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** Print who currently holds staff access, then exit. */
async function listStaff(): Promise<void> {
  const { data, error } = await sb
    .from("staff_assignments")
    .select("status, activated_at, invited_email, roles(name, is_superadmin)")
    .order("created_at");
  if (error) fail(error.message);
  if (!data || data.length === 0) {
    console.log("No staff assignments exist yet.");
    console.log("Bootstrap one with: pnpm grant:superadmin <your-email>");
    return;
  }
  console.log(`\n${data.length} staff assignment(s):\n`);
  for (const row of data as unknown as {
    status: string;
    activated_at: string | null;
    invited_email: string | null;
    roles: { name: string; is_superadmin: boolean } | null;
  }[]) {
    const star = row.roles?.is_superadmin ? " ★" : "";
    console.log(
      `  ${row.status.padEnd(8)} ${(row.roles?.name ?? "?").padEnd(16)}${star}  ${row.invited_email ?? "(no email recorded)"}`
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--list")) {
    await listStaff();
    return;
  }

  const email = argv.find((a) => !a.startsWith("--"))?.toLowerCase();
  if (!email || !email.includes("@")) {
    fail(
      "Usage: pnpm grant:superadmin <email> [--role \"Role Name\"]\n" +
        "       pnpm grant:superadmin --list"
    );
  }

  const roleFlagIndex = argv.indexOf("--role");
  const roleName = roleFlagIndex >= 0 ? argv[roleFlagIndex + 1] : undefined;

  // --- Festival ---
  const { data: festival, error: festErr } = await sb
    .from("festivals")
    .select("id, name, year")
    .eq("slug", FEST_SLUG)
    .maybeSingle();
  if (festErr) fail(`festival lookup: ${festErr.message}`);
  if (!festival) fail(`No festival with slug "${FEST_SLUG}". Run supabase/seed.sql.`);

  // --- Role ---
  const roleQuery = sb.from("roles").select("id, name, is_superadmin");
  const { data: role, error: roleErr } = roleName
    ? await roleQuery.eq("name", roleName).maybeSingle()
    : await roleQuery.eq("is_superadmin", true).maybeSingle();
  if (roleErr) fail(`role lookup: ${roleErr.message}`);
  if (!role) {
    fail(
      roleName
        ? `No role named "${roleName}".`
        : "No role with is_superadmin = true. Run supabase/seed.sql."
    );
  }

  // --- Auth user (create if absent so admin access can be bootstrapped) ---
  let userId: string | undefined;
  const { data: resolved, error: resolveErr } = await sb.rpc(
    "resolve_user_id_by_email",
    { p_email: email }
  );
  if (resolveErr) fail(`resolve_user_id_by_email: ${resolveErr.message}`);
  userId = (resolved as string | null) ?? undefined;

  if (userId) {
    console.log(`✓ Found existing auth user for ${email}`);
  } else {
    console.log(`· No auth user for ${email} yet — creating one…`);
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      fail(`could not create auth user: ${createErr?.message ?? "unknown error"}`);
    }
    userId = created.user.id;
    console.log(`✓ Created auth user ${userId}`);
    console.log(
      "  (no password set — sign in with the email magic link or Google)"
    );
  }

  // --- Assignment: reactivate an existing row rather than duplicating it ---
  const { data: existing, error: existErr } = await sb
    .from("staff_assignments")
    .select("id, status")
    .eq("festival_id", festival.id)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .maybeSingle();
  if (existErr) fail(`assignment lookup: ${existErr.message}`);

  if (existing && existing.status === "ACTIVE") {
    console.log(`\n✓ ${email} is already an ACTIVE "${role.name}". Nothing to do.`);
  } else if (existing) {
    const { error } = await sb
      .from("staff_assignments")
      .update({
        status: "ACTIVE",
        activated_at: new Date().toISOString(),
        revoked_at: null,
        invited_email: email,
      })
      .eq("id", existing.id);
    if (error) fail(`activation failed: ${error.message}`);
    console.log(`\n✓ Reactivated ${email} as "${role.name}" (was ${existing.status})`);
  } else {
    const { error } = await sb.from("staff_assignments").insert({
      festival_id: festival.id,
      user_id: userId,
      role_id: role.id,
      status: "ACTIVE",
      activated_at: new Date().toISOString(),
      invited_email: email,
    });
    if (error) fail(`insert failed: ${error.message}`);
    console.log(
      `\n✓ Granted ${email} the "${role.name}" role for ${festival.name} ${festival.year}`
    );
  }

  if (role.is_superadmin) {
    console.log("  ★ superadmin — bypasses per-permission checks");
  }
  console.log("\nNext: sign in at /admin/login with this email.");
}

void main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
