import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import CampusAmbassadorForm from "./CampusAmbassadorForm";

export const metadata: Metadata = {
  title: "Campus Ambassador",
  description:
    "Apply as a Campus Ambassador for TARANG 2026 at NIT Patna — represent your college, lead your contingent, and unlock free Pronite Passes and certificates.",
};

export default function CampusAmbassadorPage() {
  return (
    <>
      <PageHeader
        kicker="Leadership Program"
        title="Campus"
        accent="Ambassador"
        description="Represent your college at TARANG 2026. Lead your campus contingent, earn an official certificate from TARANG, NIT Patna, and unlock free Pronite Passes."
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
