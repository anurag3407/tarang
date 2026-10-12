import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import FaqAccordion from "./FaqAccordion";
import { FaqJsonLd } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  title: "FAQs",
  description:
    "Frequently asked questions about TARANG 2026 — registration, passes, entry, events and logistics.",
};

export default function FaqsPage() {
  return (
    <>
      <FaqJsonLd />
      <PageHeader
        kicker="Before you ask"
        title="The"
        accent="FAQs"
        description="Registration, passes, entry, events, logistics — the answers to everything people keep asking us."
      />
      <section className="bg-neo-cream">
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
              Loading FAQs…
            </div>
          }
        >
          <FaqAccordion />
        </Suspense>

        <div className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
          <div className="border-8 border-black bg-neo-accent p-8 text-center text-black shadow-neo-lg md:p-12">
            <p className="text-3xl font-black uppercase tracking-tighter text-black">
              Question not here?
            </p>
            <p className="mx-auto mt-3 max-w-lg text-lg font-bold leading-snug text-black">
              Send it to us directly — the help desk replies within 24 hours
              during the fest week.
            </p>
            <div className="mt-6 flex justify-center">
              <ButtonLink href="/ask" variant="dark">
                Ask a question
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
      <Marquee
        items={["Read before registering", "Judges' decision is final", "Ask us anything"]}
        variant="secondary"
      />
    </>
  );
}
