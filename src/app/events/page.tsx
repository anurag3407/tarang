import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import EventsExplorer from "./EventsExplorer";
import { loadPublicContent } from "@/lib/content-loader";

// Mutable DB-backed content served through unstable_cache (plan §10.6).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  description:
    "All events at TARANG 2026 — schedule, categories, venues, team sizes and delegate registration details across 8 cultural categories.",
};

export default async function EventsPage() {
  const { events, categories } = await loadPublicContent();

  return (
    <>
      <PageHeader
        kicker={events.length > 0 ? `${events.length} competitions` : "All competitions"}
        title="All"
        accent="events"
        description="Schedule, categories, and delegate registration details — everything you need before you register."
      />
      <Suspense
        fallback={
          <div className="mx-auto max-w-7xl px-4 py-20 text-center text-xl font-black uppercase tracking-widest">
            Loading events…
          </div>
        }
      >
        <EventsExplorer events={events} categories={categories} />
      </Suspense>
      <Marquee
        items={[
          "Register Early",
          "Slots Are Limited",
          "Carry College ID",
          "Judges' Decision Is Final",
        ]}
        variant="accent"
      />
    </>
  );
}
