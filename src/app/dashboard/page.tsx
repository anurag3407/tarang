import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, Music, Star, ShieldCheck, Ticket } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST } from "@/lib/dates";
import { getCurrentFestivalId, getPublishedPassProducts } from "@/repositories/public-content";
import { ButtonLink } from "@/components/ui/Button";
import { SignOutButton } from "@/components/auth/SignOutButton";
import ConcertPassCard from "@/components/cards/ConcertPassCard";
import BasicCardView from "@/components/cards/BasicCardView";

export const metadata: Metadata = {
  title: "My Dashboard — PULSE 2026",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Participant dashboard (plan §12.1, §14.4).
 *
 * Shows profile state, active passes (Basic Card and/or VIP Delegate Pass), orders, and event registrations.
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

  // Find dynamic pass products
  const basicProduct =
    products.find(
      (p) =>
        p.slug === "base-delegate-pass" ||
        p.isBasePass ||
        p.name.toLowerCase().includes("basic")
    ) ?? products[0];

  const delegateProduct =
    products.find(
      (p) =>
        p.slug === "vip-delegate-pass" ||
        !p.isBasePass ||
        p.name.toLowerCase().includes("delegate") ||
        p.name.toLowerCase().includes("all-access")
    ) ?? products[1];

  const basicPriceFormatted = basicProduct ? formatPaise(basicProduct.amountPaise) : "₹200";
  const delegatePriceFormatted = delegateProduct ? formatPaise(delegateProduct.amountPaise) : "₹2,000";

  // Identify active passes
  const activePasses = (passesRes.data ?? []).filter((p) => p.state === "ACTIVE");

  const activeDelegatePass = activePasses.find((p) => {
    const prod = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
    return (
      prod?.slug === "vip-delegate-pass" ||
      prod?.is_base_pass === false ||
      prod?.name?.toLowerCase().includes("delegate") ||
      prod?.name?.toLowerCase().includes("all-access") ||
      prod?.name?.toLowerCase().includes("vip")
    );
  });

  const activeBasicPass = activePasses.find((p) => {
    const prod = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
    return (
      prod?.slug === "base-delegate-pass" ||
      prod?.is_base_pass === true ||
      prod?.name?.toLowerCase().includes("basic")
    );
  });

  const hasAnyPass = Boolean(activeDelegatePass || activeBasicPass);

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

      {/* Festival Cards Section */}
      <section className="mt-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-black uppercase tracking-tight">
            Festival Cards
          </h2>
          <div className="flex gap-4 text-xs font-black uppercase">
            {!activeDelegatePass && !activeBasicPass && (
              <Link
                href="/basic-card"
                className="text-black hover:text-neo-accent underline"
              >
                Basic Card ({basicPriceFormatted})
              </Link>
            )}
            {!activeDelegatePass && (
              <Link
                href="/delegate-card"
                className="text-black hover:text-neo-accent underline"
              >
                VIP Delegate Card ({delegatePriceFormatted})
              </Link>
            )}
          </div>
        </div>

        {/* 1. Delegate Card (Concert Card Style with Gate QR) */}
        {activeDelegatePass && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-black/70">
                ⭐ All-Access VIP Concert Card
              </span>
              <span className="text-xs font-mono font-bold text-black/50">
                Gate QR Issued
              </span>
            </div>
            <ConcertPassCard
              passId={activeDelegatePass.id}
              passCode={activeDelegatePass.public_pass_code}
              state={activeDelegatePass.state}
              productName={getProductName(activeDelegatePass.pass_products) || "VIP All-Access Delegate Card"}
              priceLabel={delegatePriceFormatted}
              userName={profile?.display_name}
              collegeName={profile?.college_name}
              expiresAt={activeDelegatePass.expires_at}
            />
          </div>
        )}

        {/* 2. Basic Card (Simple ID Card Style with Unique String) */}
        {activeBasicPass && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-black/70">
                🪪 Basic Festival Participant Card
              </span>
              <span className="text-xs font-mono font-bold text-black/50">
                Gate String Code
              </span>
            </div>
            <BasicCardView
              passId={activeBasicPass.id}
              passCode={activeBasicPass.public_pass_code}
              state={activeBasicPass.state}
              productName={getProductName(activeBasicPass.pass_products) || "Basic Festival Card"}
              userName={profile?.display_name}
              collegeName={profile?.college_name}
              email={user.email}
              expiresAt={activeBasicPass.expires_at}
            />
          </div>
        )}

        {/* 3. If User Has No Passes At All, Show Both Available Options */}
        {!hasAnyPass && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Basic Card Option */}
            <div className="flex flex-col justify-between border-4 border-black bg-white p-6 shadow-neo">
              <div>
                <span className="inline-block border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">
                  Standard Entity
                </span>
                <h3 className="mt-2 text-2xl font-black uppercase">Basic Card</h3>
                <p className="text-2xl font-black mt-1">{basicPriceFormatted}</p>
                <p className="mt-2 text-xs font-bold text-black/70">
                  5-day general campus entry card. Required for participating in competitions.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs font-bold text-black/80">
                  <li className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-black" /> 5-Day General Campus Access
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-black" /> Competitions Participation
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-black font-black">#</span> Unique String Gate Verification
                  </li>
                </ul>
              </div>
              <ButtonLink href="/basic-card" variant="outline" className="mt-6 w-full text-center">
                Get Basic Card — {basicPriceFormatted}
              </ButtonLink>
            </div>

            {/* VIP Delegate Card Option */}
            <div className="relative flex flex-col justify-between overflow-hidden border-4 border-black bg-black p-6 text-white shadow-neo">
              <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-neo-secondary/20 blur-xl" />
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 border-2 border-black bg-neo-secondary px-2 py-0.5 text-xs font-black uppercase text-black">
                    <Star className="h-3 w-3 fill-black" /> VIP Concert Card
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider text-neo-secondary">
                    All-Access
                  </span>
                </div>
                <h3 className="mt-2 text-2xl font-black uppercase text-white">
                  VIP Delegate Card
                </h3>
                <p className="text-2xl font-black mt-1 text-neo-secondary">{delegatePriceFormatted}</p>
                <p className="mt-2 text-xs font-bold text-white/80">
                  Full 5-day festival card including all 5 pro-shows, star concerts &amp; VIP perks.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs font-bold text-white/90">
                  <li className="flex items-center gap-2">
                    <Music className="h-4 w-4 text-neo-secondary" /> All 5 Star Night Pro-Shows Included
                  </li>
                  <li className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-neo-secondary" /> VIP Front-Row Stage Zone &amp; Fast-Track
                  </li>
                  <li className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-neo-secondary" /> Dynamic QR Gate Entry &amp; Email Card
                  </li>
                </ul>
              </div>
              <ButtonLink href="/delegate-card" variant="secondary" className="mt-6 w-full text-center">
                Get VIP Delegate Card — {delegatePriceFormatted}
              </ButtonLink>
            </div>
          </div>
        )}

        {/* 4. If User Has Basic Card but Not Delegate Pass, Offer Delegate Card Option Cleanly */}
        {activeBasicPass && !activeDelegatePass && (
          <div className="border-4 border-black bg-black p-5 text-white shadow-neo flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-neo-secondary fill-neo-secondary" />
                <span className="text-xs font-black uppercase tracking-widest text-neo-secondary">
                  VIP Pro-Show Concerts
                </span>
              </div>
              <h3 className="text-lg font-black uppercase text-white">
                Interested in the All-Access Delegate Card?
              </h3>
              <p className="text-xs font-bold text-white/70">
                Includes all 5 Star Night Concerts, VIP Front-Row Arena, Backstage Lounge &amp; Official Gate QR Card.
              </p>
            </div>
            <ButtonLink href="/delegate-card" variant="secondary">
              Get VIP Delegate Card ({delegatePriceFormatted}) →
            </ButtonLink>
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

function getProductName(products: unknown): string {
  const p = Array.isArray(products) ? products[0] : products;
  return (p as { name?: string } | null)?.name ?? "";
}
