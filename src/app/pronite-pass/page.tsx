import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { FEST } from "@/lib/data";
import { isPronitePassProduct } from "@/lib/pronite-pass";
import PronitePassClient, { type ActivePassInfo } from "./PronitePassClient";

export const metadata: Metadata = {
  title: "Pronite Pass",
  description: `One pass for every night of ${FEST.short} at ${FEST.college} — all pronites, campus access and competition registration. ${FEST.dates}.`,
};

export const dynamic = "force-dynamic";

export default async function PronitePassPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let userProfile: { displayName?: string | null; collegeName?: string | null } | null = null;
  let activePass: ActivePassInfo | null = null;

  if (user) {
    const sb = createServiceRoleClient();
    const [profileRes, passesRes] = await Promise.all([
      sb.from("profiles").select("display_name, college_name").eq("user_id", user.id).maybeSingle(),
      sb
        .from("delegate_passes")
        .select("id, public_pass_code, state, expires_at, pass_products ( name, slug, is_base_pass )")
        .eq("user_id", user.id)
        .eq("state", "ACTIVE")
        .order("created_at", { ascending: false }),
    ]);

    userProfile = profileRes.data
      ? { displayName: profileRes.data.display_name, collegeName: profileRes.data.college_name }
      : null;

    const productOf = (p: { pass_products: unknown }) =>
      (Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products) as
        | { name?: string; slug?: string; is_base_pass?: boolean }
        | null;
    // Only the Pronite Pass counts; a retired basic pass does not.
    const pass = (passesRes.data ?? []).find((p) => isPronitePassProduct(productOf(p)));
    if (pass) {
      const product = productOf(pass);
      activePass = {
        id: pass.id,
        publicPassCode: pass.public_pass_code,
        state: pass.state,
        productName: product?.name ?? "Pronite Pass",
        expiresAt: pass.expires_at,
      };
    }
  }

  return <PronitePassClient isLoggedIn={Boolean(user)} userProfile={userProfile} initialActivePass={activePass} />;
}
