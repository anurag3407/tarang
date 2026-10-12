import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import BasicCardClient from "./BasicCardClient";

export const metadata: Metadata = {
  title: "TARANG BR Card — AIIMS New Delhi",
  description:
    "Official mandatory 5-day participant BR Card for TARANG 2026 at AIIMS New Delhi. Campus entry, competition registrations, and unlocked informal events.",
};

export const dynamic = "force-dynamic";

export default async function BasicCardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let userProfile: { displayName?: string | null; collegeName?: string | null } | null = null;
  let activePass: {
    id: string;
    publicPassCode: string;
    state: string;
    productName: string;
    isBasePass: boolean;
    expiresAt: string | null;
  } | null = null;

  if (user) {
    const sb = createServiceRoleClient();
    const [profileRes, passesRes] = await Promise.all([
      sb
        .from("profiles")
        .select("display_name, college_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      sb
        .from("delegate_passes")
        .select("id, public_pass_code, state, expires_at, pass_products ( name, slug, is_base_pass )")
        .eq("user_id", user.id)
        .eq("state", "ACTIVE")
        .order("created_at", { ascending: false }),
    ]);

    userProfile = profileRes.data
      ? {
          displayName: profileRes.data.display_name,
          collegeName: profileRes.data.college_name,
        }
      : null;

    const delegatePass = (passesRes.data ?? []).find((p) => {
      const product = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
      return (
        product?.slug === "vip-delegate-pass" ||
        product?.is_base_pass === false ||
        product?.name?.toLowerCase().includes("delegate") ||
        product?.name?.toLowerCase().includes("vip")
      );
    });

    const basicPass = (passesRes.data ?? []).find((p) => {
      const product = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
      return product?.is_base_pass || product?.slug === "base-delegate-pass" || product?.name?.toLowerCase().includes("basic") || product?.name?.toLowerCase().includes("br");
    });

    if (basicPass) {
      const product = Array.isArray(basicPass.pass_products) ? basicPass.pass_products[0] : basicPass.pass_products;
      const prodName = product?.name ?? "TARANG BR Card";

      activePass = {
        id: basicPass.id,
        publicPassCode: basicPass.public_pass_code,
        state: basicPass.state,
        productName: prodName,
        isBasePass: true,
        expiresAt: basicPass.expires_at,
      };
    }

    return (
      <BasicCardClient
        isLoggedIn={Boolean(user)}
        userProfile={userProfile}
        initialActivePass={activePass}
        hasDelegatePass={Boolean(delegatePass)}
        delegatePassCode={delegatePass?.public_pass_code ?? null}
      />
    );
  }

  return (
    <BasicCardClient
      isLoggedIn={Boolean(user)}
      userProfile={userProfile}
      initialActivePass={activePass}
      hasDelegatePass={false}
      delegatePassCode={null}
    />
  );
}
