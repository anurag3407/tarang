import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import ScheduleBoard from "./ScheduleBoard";
import { loadPublicContent } from "@/lib/content-loader";

// Mutable DB-backed content served through unstable_cache (plan §10.6).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "The complete 5-day schedule of PULSE 2026 — day-wise events with timings and venues, and night pro shows highlighted.",
};

export default async function SchedulePage() {
  const { schedule } = await loadPublicContent();

  return (
    <>
      <PageHeader
        kicker={schedule.length > 0 ? `${schedule.length} days · 12 venues` : "Day-wise schedule"}
        title="The"
        accent="schedule"
        description="Day events run 8 AM to 6 PM. Night pro shows are highlighted in black — don't miss them."
      />
      <Suspense
        fallback={
          <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
            Loading schedule…
          </div>
        }
      >
        <ScheduleBoard days={schedule} />
      </Suspense>
      <Marquee
        items={[
          "Timings may shift by ±30 min",
          "Follow the notice board",
          "Pro shows start on time",
          "Carry your pass",
        ]}
        variant="black"
      />
    </>
  );
}
