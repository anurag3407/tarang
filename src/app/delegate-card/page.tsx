import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import DelegatePassClient from "@/app/delegate-pass/DelegatePassClient";

export const metadata: Metadata = {
  title: "VIP All-Access Delegate Card — TARANG 2026",
  description:
    "Get full 5-day festival access, all star pro shows, front-row concert arena, and fast-track gate entry.",
};

export const dynamic = "force-dynamic";

export default async function DelegateCardPage() {
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
    isDelegatePass: boolean;
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

    const passes = passesRes.data ?? [];
    const vipPass = passes.find((p) => {
      const product = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
      const slug = product?.slug ?? "";
      const name = product?.name ?? "";
      return slug === "vip-delegate-pass" || !product?.is_base_pass || name.toLowerCase().includes("vip") || name.toLowerCase().includes("all-access") || name.toLowerCase().includes("delegate");
    });

    if (vipPass) {
      const product = Array.isArray(vipPass.pass_products) ? vipPass.pass_products[0] : vipPass.pass_products;
      const prodName = product?.name ?? "VIP All-Access Delegate Card";

      activePass = {
        id: vipPass.id,
        publicPassCode: vipPass.public_pass_code,
        state: vipPass.state,
        productName: prodName,
        isDelegatePass: true,
        expiresAt: vipPass.expires_at,
      };
    }

    return (
      <DelegatePassClient
        isLoggedIn={Boolean(user)}
        userProfile={userProfile}
        initialActivePass={activePass}
        hasDelegatePass={Boolean(vipPass)}
      />
    );
  }

  return (
    <DelegatePassClient
      isLoggedIn={false}
      userProfile={null}
      initialActivePass={null}
      hasDelegatePass={false}
    />
  );
}
