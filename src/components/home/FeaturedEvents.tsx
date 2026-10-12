import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { EventCard } from "@/components/cards/EventCard";
import { loadPublicContent } from "@/lib/content-loader";

export default async function FeaturedEvents() {
  const { events } = await loadPublicContent();
  const featured = events.filter((e) => e.featured).slice(0, 6);

  if (featured.length === 0) return null;

  return (
    <section className="border-b-8 border-black bg-neo-secondary dark:bg-[#000000] transition-colors">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading
            kicker="Flagship events"
            title="The big"
            accent="ones"
            description="The events that define PULSE — biggest stages, biggest crowds, biggest prize pools."
          />
          <div className="mb-12 shrink-0 md:mb-16">
            <ButtonLink href="/events" variant="dark">
              All {events.length} events{" "}
              <ArrowRight className="h-5 w-5" strokeWidth={3} />
            </ButtonLink>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}
