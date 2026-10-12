"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { EventCard } from "@/components/cards/EventCard";
import EventRegistrationModal from "@/components/cards/EventRegistrationModal";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import type { CategoryRead, EventRead } from "@/domain/content";

const COLOR_BG: Record<string, string> = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
};

export default function EventsExplorer({
  events,
  categories,
}: {
  events: EventRead[];
  categories: CategoryRead[];
}) {
  const searchParams = useSearchParams();
  const initial = searchParams.get("category");
  const [active, setActive] = useState<string>(
    initial && categories.some((c) => c.slug === initial) ? initial : "all"
  );
  const [query, setQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventRead | null>(null);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      const matchesCategory = active === "all" || e.category.slug === active;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        q === "" ||
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.venue?.name ?? "").toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [events, active, query]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
      {/* Registration & Checkout Modal */}
      {selectedEvent && (
        <EventRegistrationModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {/* Filters */}
      <div className="mb-10 flex flex-col gap-6">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActive("all")}
            className={`border-4 border-black px-4 py-2 text-sm font-black uppercase tracking-widest shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
              active === "all"
                ? "bg-black text-white"
                : "bg-white text-black dark:bg-[#121214] dark:text-white hover:-translate-y-0.5"
            }`}
          >
            All ({events.length})
          </button>
          {categories.map((cat) => {
            const isActive = active === cat.slug;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActive(cat.slug)}
                className={`flex items-center gap-2 border-4 border-black px-4 py-2 text-sm font-black uppercase tracking-widest shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
                  isActive
                    ? "bg-black text-white"
                    : `${COLOR_BG[cat.colorKey]} hover:-translate-y-0.5`
                }`}
              >
                <CategoryIcon name={cat.iconKey} className="h-4 w-4" />
                {cat.name}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Search
            className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-black/60 dark:text-zinc-400"
            strokeWidth={3}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            aria-label="Search events"
            className="h-14 w-full border-4 border-black bg-white dark:bg-[#09090b] pl-14 pr-4 text-lg font-bold text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-[#18181b] focus-visible:shadow-neo-sm focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="border-4 border-black bg-white p-12 text-center shadow-neo">
          <p className="text-3xl font-black uppercase tracking-tighter">
            No events found
          </p>
          <p className="mt-2 text-lg font-bold">
            Try a different search or category.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <div key={event.id} id={event.slug} className="scroll-mt-28">
              <EventCard event={event} onRegister={setSelectedEvent} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
