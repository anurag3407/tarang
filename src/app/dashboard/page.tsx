import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QrCode } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { formatPaise } from "@/lib/money";
import { isPronitePassProduct } from "@/lib/pronite-pass";
import { formatDateTimeIST } from "@/lib/dates";
import { getCurrentFestivalId, getPublishedPassProducts } from "@/repositories/public-content";
import { ButtonLink } from "@/components/ui/Button";
import { SignOutButton } from "@/components/auth/SignOutButton";
import PassTicket from "@/components/tarang/PassTicket";

export const metadata: Metadata = {
  title: "My Dashboard — TARANG 2026",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Participant dashboard (plan §12.1, §14.4).
 *
 * Shows profile state, the Pronite Pass, orders, and event registrations.
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const festivalId = await getCurrentFestivalId();
  if (!festivalId) redirect("/");

  const sb = createServiceRoleClient();
  const [profileRes, passesRes, ordersRes, regsRes, products] = await Promise.all([
    sb
      .from("profiles")
      .select("display_name, college_name, profile_completed_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    sb
      .from("delegate_passes")
      .select("id, public_pass_code, state, expires_at, pass_products ( id, name, slug, is_base_pass )")
      .eq("user_id", user.id)
      .eq("festival_id", festivalId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("orders")
      .select("id, public_order_code, kind, checkout_state, amount_paise, created_at")
      .eq("purchaser_user_id", user.id)
      .eq("festival_id", festivalId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("registration_members")
      .select("registration_id")
      .eq("user_id", user.id)
      .limit(50),
    getPublishedPassProducts(festivalId).catch(() => []),
  ]);

  const profile = profileRes.data;
  const profileComplete = Boolean(profile?.profile_completed_at);

  const orderIds = (ordersRes.data ?? []).map((o) => o.id);
  const { data: userPayments } = orderIds.length > 0
    ? await sb
        .from("payments")
        .select("local_order_id, razorpay_payment_id")
        .in("local_order_id", orderIds)
    : { data: [] };
  const userPaymentMap = new Map((userPayments ?? []).map((p) => [p.local_order_id, p.razorpay_payment_id]));

  let registrations: {
    code: string;
    eventName: string;
    state: string;
    teamName: string | null;
  }[] = [];
  const regIds = (regsRes.data ?? []).map((m) => m.registration_id);
  if (regIds.length > 0) {
    const { data: regs } = await sb
      .from("registrations")
      .select("public_registration_code, state, team_name, events ( name )")
      .in("id", regIds)
      .order("created_at", { ascending: false });
    registrations = (regs ?? []).map((r) => {
      const event = Array.isArray(r.events) ? r.events[0] : r.events;
      return {
        code: r.public_registration_code,
        eventName: event?.name ?? "",
        state: r.state,
        teamName: r.team_name,
      };
    });
  }

  // One pass is on sale — the Pronite Pass (the former VIP Delegate product).
  const passProduct = products.find(isPronitePassProduct);
  const passPrice = passProduct ? formatPaise(passProduct.amountPaise) : null;
  const activePass = (passesRes.data ?? []).find(
    (p) =>
      p.state === "ACTIVE" &&
      isPronitePassProduct(Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products)
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">
            My Dashboard
          </h1>
          <p className="mt-1 text-sm font-bold text-black/70">
            {profile?.display_name ?? user.email}
            {profile?.college_name ? ` · ${profile.college_name}` : ""}
          </p>
        </div>
        <SignOutButton />
      </div>

      {!profileComplete && (
        <div className="mt-6 border-4 border-black bg-neo-secondary p-4 shadow-neo-sm">
          <p className="font-bold">
            Complete your profile before registering for events or getting cards.
          </p>
          <ButtonLink href="/complete-profile" variant="dark" className="mt-3">
            Complete profile
          </ButtonLink>
        </div>
      )}

      {/* Pronite Pass */}
      <section className="mt-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-black uppercase tracking-tight">Your Pronite Pass</h2>
          {activePass && (
            <span className="text-xs font-bold uppercase tracking-widest text-black/60">Gate QR issued</span>
          )}
        </div>

        {activePass ? (
          <div className="space-y-5">
            <PassTicket price="Valid" serial={activePass.public_pass_code} />
            <div className="flex flex-wrap items-center gap-4">
              <ButtonLink href={`/dashboard/pass/${activePass.id}`}>
                <QrCode className="h-4 w-4" /> Show gate QR
              </ButtonLink>
              <p className="text-sm font-bold text-black/60">
                Issued to {profile?.display_name ?? user.email}
                {profile?.college_name ? ` · ${profile.college_name}` : ""}
                {activePass.expires_at ? ` · valid through ${formatDateTimeIST(activePass.expires_at)}` : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-6 border-4 border-black bg-white p-6 shadow-neo">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-black/60">One pass · every night</p>
              <h3 className="mt-2 text-3xl font-black uppercase">Pronite Pass{passPrice ? ` — ${passPrice}` : ""}</h3>
              <p className="mt-2 max-w-lg text-sm font-bold text-black/70">
                Both pronites, campus access for the whole fest, and registration for every competition.
              </p>
            </div>
            <ButtonLink href="/pronite-pass">Get your pass</ButtonLink>
          </div>
        )}
      </section>

      {/* Registrations */}
      <section className="mt-10">
        <h2 className="text-2xl font-black uppercase tracking-tight">
          Event Registrations
        </h2>
        {registrations.length === 0 ? (
          <p className="mt-3 border-4 border-black bg-white p-4 font-bold text-black/60 shadow-neo-sm">
            No registrations yet. Browse the events and register.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {registrations.map((r) => (
              <div
                key={r.code}
                className="flex flex-wrap items-center justify-between gap-3 border-4 border-black bg-white p-4 shadow-neo-sm"
              >
                <div>
                  <p className="text-lg font-black uppercase">{r.eventName}</p>
                  <p className="text-sm font-bold text-black/60">
                    {r.code}
                    {r.teamName ? ` · Team ${r.teamName}` : ""}
                  </p>
                </div>
                <span
                  className={`border-2 border-black px-3 py-1 text-xs font-black uppercase ${
                    r.state === "CONFIRMED" ? "bg-neo-secondary" : "bg-neo-muted"
                  }`}
                >
                  {r.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Orders */}
      <section className="mt-10">
        <h2 className="text-2xl font-black uppercase tracking-tight">Orders</h2>
        {(() => {
          // Hide admin-issued tracking orders (bulk import creates ₹0 orders with PO-ADM- prefix)
          const visibleOrders = (ordersRes.data ?? []).filter(
            (o) => !o.public_order_code.startsWith("PO-ADM-")
          );
          if (visibleOrders.length === 0) {
            return (
              <p className="mt-3 border-4 border-black bg-white p-4 font-bold text-black/60 shadow-neo-sm">
                No orders yet.
              </p>
            );
          }
          return (
            <div className="mt-3 space-y-2">
              {visibleOrders.map((o) => {
                const paymentId = userPaymentMap.get(o.id);
                return (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-4 border-black bg-white px-4 py-3 shadow-neo-sm"
                  >
                    <div>
                      <p className="font-black">{o.public_order_code}</p>
                      <p className="text-xs font-bold uppercase text-black/60">
                        {o.kind} · {formatDateTimeIST(o.created_at)}
                      </p>
                      {paymentId && (
                        <p className="font-mono text-[10px] text-black/50 select-all" title="Payment Reference ID">
                          Ref: {paymentId}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-black">
                        {Number(o.amount_paise) === 0
                          ? "Complimentary"
                          : formatPaise(Number(o.amount_paise))}
                      </p>
                      <p className="text-xs font-bold uppercase text-black/60">
                        {o.checkout_state}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>
    </div>
  );
}
