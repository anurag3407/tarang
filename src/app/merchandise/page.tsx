import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { MerchandiseExplorer } from "./MerchandiseExplorer";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { getPublishedMerchandise } from "@/repositories/merchandise";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Official Merchandise",
  description:
    "Explore the official TARANG 2026 festival merchandise collection — limited edition streetwear hoodies, oversized tees, and accessories.",
};

export default async function MerchandisePage() {
  const festivalId = await getCurrentFestivalId();
  const merchandise = festivalId ? await getPublishedMerchandise(festivalId) : [];

  return (
    <>
      <PageHeader
        kicker="Official Festival Drop"
        title="Exclusive"
        accent="Merch"
        description="Limited-edition streetwear apparel, heavyweight hoodies, oversized tees, and official fest gear. Premium comfort crafted for the fest."
      />

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <Suspense
          fallback={
            <div className="py-20 text-center text-xl font-black uppercase tracking-widest">
              Loading merchandise catalog…
            </div>
          }
        >
          <MerchandiseExplorer initialItems={merchandise} />
        </Suspense>
      </section>

      <Marquee
        items={[
          "Official Festival Drop",
          "Heavyweight Cotton Fleece",
          "Limited Edition",
          "Campus Pickup at the Fest",
          "Zero Restocks Once Sold Out",
        ]}
        variant="secondary"
      />
    </>
  );
}
