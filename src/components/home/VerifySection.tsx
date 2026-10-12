import { Suspense } from "react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import VerifyChecker from "@/app/verify/VerifyChecker";

export default function VerifySection() {
  return (
    <section className="border-t-4 border-black bg-neo-cream">
      <div className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 md:pt-28">
        <SectionHeading
          kicker="Anti-fraud check"
          title="Verify"
          accent="your pass"
          description="Every pass and registration gets a unique ID. Enter your pass code to check it before you reach the gate."
        />
        <Suspense
          fallback={
            <div className="py-16 text-center text-xl font-black uppercase tracking-widest">
              Loading verifier…
            </div>
          }
        >
          <VerifyChecker />
        </Suspense>
      </div>
    </section>
  );
}
