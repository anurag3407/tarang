import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import AskForm from "./AskForm";

export const metadata: Metadata = {
  title: "Ask a Question",
  description:
    "Send a question to the TARANG 2026 help desk — registration, passes, sponsorship, volunteering or anything else.",
};

export default function AskPage() {
  return (
    <>
      <PageHeader
        kicker="Help desk"
        title="Ask a"
        accent="question"
        description="Stuck on something? Send it here — the help desk replies within 24 hours."
      />
      <section className="bg-neo-cream">
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
              Loading form…
            </div>
          }
        >
          <AskForm />
        </Suspense>
      </section>
    </>
  );
}
