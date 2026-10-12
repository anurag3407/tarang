import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";

export const metadata: Metadata = {
  title: "Gate Scanner",
  robots: { index: false, follow: false },
  viewport: { width: "device-width", initialScale: 1, maximumScale: 1 },
};

export const dynamic = "force-dynamic";

/**
 * Scanner layout (plan §14.5). Requires scanner.use; the device credential
 * is entered on the scanner page itself (stored only on the device).
 */
export default async function ScannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scanner");

  const { data: perm } = await supabase.rpc("has_permission", {
    p_permission: "scanner.use",
    p_event_id: null,
  });
  if (!perm) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="border-8 border-black bg-neo-accent p-8 shadow-neo-lg text-black">
          <h1 className="text-2xl font-black uppercase tracking-tighter">
            No scanner access
          </h1>
          <p className="mt-2 font-bold">
            Your account does not have the gate scanner permission.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="border-4 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm hover:bg-neo-secondary"
            >
              Fest Home
            </Link>
            <Link
              href="/dashboard"
              className="border-4 border-black bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm hover:bg-white"
            >
              My Dashboard
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b-4 border-neo-secondary px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black uppercase tracking-tighter text-neo-secondary">
              TARANG Gate Scanner
            </span>
            <Link
              href="/admin"
              className="border-2 border-white/40 px-2 py-0.5 text-xs font-black uppercase text-white/80 transition-colors hover:border-neo-secondary hover:text-neo-secondary"
            >
              Admin
            </Link>
            <Link
              href="/"
              className="border-2 border-white/40 px-2 py-0.5 text-xs font-black uppercase text-white/80 transition-colors hover:border-neo-secondary hover:text-neo-secondary"
            >
              Site
            </Link>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
