import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import CampusAmbassadorForm from "./CampusAmbassadorForm";

export const metadata: Metadata = {
  title: "Campus Ambassador",
  description:
    "Apply as a Campus Ambassador for TARANG 2026 AIIMS New Delhi — represent your college, lead your contingent, and unlock exclusive VIP perks and certificates.",
};

export default function CampusAmbassadorPage() {
  return (
    <>
      <PageHeader
        kicker="Leadership Program"
        title="Campus"
        accent="Ambassador"
        description="Represent your college at TARANG 2026. Lead your campus contingent, earn official certificates from AIIMS New Delhi, and unlock VIP pro-night passes."
      />
      <section className="bg-neo-cream">
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
              Loading application form…
            </div>
          }
        >
          <CampusAmbassadorForm />
        </Suspense>
      </section>
    </>
  );
}
