import { notFound } from "next/navigation";

export default function VerifyPage() {
  notFound();
}

/*
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import VerifyChecker from "./VerifyChecker";

export const metadata: Metadata = {
  title: "Verify Pass",
  description:
    "Verify your PULSE fest pass or event registration ID before you arrive at the venue.",
};

export function VerifyPageOriginal() {
  return (
    <>
      <PageHeader
        kicker="Anti-fraud check"
        title="Verify"
        accent="your pass"
        description="Every pass and registration gets a unique ID. Check yours here before you reach the gate."
      />
      <section className="bg-neo-cream">
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
              Loading verifier…
            </div>
          }
        >
          <VerifyChecker />
        </Suspense>
      </section>
      <Marquee
        items={[
          "One ID per person",
          "Non-transferable after 15 Sep",
          "Carry college ID",
          "QR scanned at every gate",
        ]}
        variant="black"
      />
    </>
  );
}
*/
