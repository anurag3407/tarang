import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin layout (plan §11.3, §11.5).
 *
 * Checks for an ACTIVE staff assignment on every render — a revoked staff
 * member with a still-valid browser token gets no admin access. Fine-grained
 * permissions are enforced per-route in the API handlers.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  // Active staff assignment check against current DB state (never stale JWT
  // claims). RLS on staff_assignments allows reading one's own rows.
  const { data: anyAssignment } = await supabase
    .from("staff_assignments")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  const hasStaff = Boolean(anyAssignment);

  if (!hasStaff) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="border-8 border-black bg-neo-accent p-8 shadow-neo-lg">
          <h1 className="text-2xl font-black uppercase tracking-tighter">
            Access denied
          </h1>
          <p className="mt-2 font-bold">
            Your account does not have an active staff assignment. Contact a
            superadmin if you believe this is a mistake.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/dashboard"
              className="border-4 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm hover:bg-neo-secondary"
            >
              My Dashboard
            </Link>
            <Link
              href="/"
              className="border-4 border-black bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm hover:bg-white"
            >
              Fest Home
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neo-cream text-black">
      <header className="border-b-4 border-black bg-black px-4 py-3 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="font-mono text-lg font-black uppercase tracking-tighter text-neo-secondary hover:text-white transition-colors"
            >
              ⚡ TARANG ADMIN
            </Link>
            <span className="hidden sm:inline-block font-mono text-[10px] uppercase tracking-wider text-white/50 border-l border-white/20 pl-3">
              NIT Patna 2026
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-1.5 text-xs font-black uppercase" aria-label="Admin">
            <AdminLink href="/admin">Mission Control</AdminLink>
            <AdminLink href="/admin/events">Events</AdminLink>
            <AdminLink href="/admin/merchandise">Merchandise</AdminLink>
            <AdminLink href="/admin/discounts">Discounts</AdminLink>
            <AdminLink href="/admin/schedule">Schedule</AdminLink>
            <AdminLink href="/admin/notices">Notices</AdminLink>
            <AdminLink href="/admin/sponsors">Sponsors</AdminLink>
            <AdminLink href="/admin/support">Support</AdminLink>
            <AdminLink href="/admin/staff">Staff</AdminLink>
            <AdminLink href="/admin/exports">Exports</AdminLink>
            <AdminLink href="/admin/import">Bulk Import</AdminLink>
            <Link
              href="/scanner"
              className="border-2 border-neo-accent bg-neo-accent px-2.5 py-1 text-black font-black uppercase transition-colors hover:bg-white"
            >
              📱 Scanner
            </Link>
          </nav>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="hidden md:inline-block text-white/60 text-[11px]">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="border-2 border-white/30 px-2.5 py-1 text-white/90 font-mono transition-colors hover:border-neo-secondary hover:bg-zinc-900 hover:text-neo-secondary"
    >
      {children}
    </Link>
  );
}
