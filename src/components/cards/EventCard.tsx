"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, Clock, MapPin, Users, Trophy, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { formatPaise } from "@/lib/money";
import type { EventRead } from "@/domain/content";

const CATEGORY_BG: Record<string, string> = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
};

/** Sales states that block new registrations get a visible label. */
const STATE_LABEL: Partial<Record<EventRead["salesState"], string>> = {
  SOLD_OUT: "Sold out",
  CLOSED: "Closed",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
};

function availabilityLabel(event: EventRead): string | null {
  const av = event.availability;
  if (!av || av.capacityUnits <= 0) return null;
  if (av.availableUnits <= 0) return null; // covered by the SOLD_OUT badge
  const unit = av.availableUnits === 1 ? av.unitLabel : `${av.unitLabel}s`;
  return `${av.availableUnits} ${unit} left`;
}

export function EventCard({
  event,
  onRegister,
}: {
  event: EventRead;
  onRegister?: (event: EventRead) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const category = event.category;
  const stateLabel = STATE_LABEL[event.salesState];
  const left = availabilityLabel(event);
  const showImage = Boolean(event.imageUrl && !imgError);

  return (
    <article className="group flex h-full flex-col border-4 border-black bg-white dark:bg-[#121214] text-black dark:text-white shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg overflow-hidden">
      {/* Header strip */}
      <div
        className={`flex items-center justify-between gap-2 border-b-4 border-black px-4 py-3 ${CATEGORY_BG[category.colorKey] ?? "bg-neo-secondary text-black"}`}
      >
        <div className="flex items-center gap-2">
          <CategoryIcon name={category.iconKey} className="h-6 w-6" />
          <span className="text-sm font-black uppercase tracking-widest">
            {category.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {event.isNightEvent && (
            <span className="text-xs font-black" title="Night Event">🌙</span>
          )}
          <Badge variant="black" className="shadow-none">
            Day {event.day}
          </Badge>
        </div>
      </div>

      {/* Instagram Post Ratio Poster Area (1:1 Ratio) */}
      <div className="relative aspect-square w-full overflow-hidden border-b-4 border-black bg-neo-cream dark:bg-[#000000]">
        {showImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.imageUrl!}
              alt={event.name}
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neo-cream dark:bg-[#000000] p-6 text-center">
            <div
              className={`flex h-16 w-16 items-center justify-center border-3 border-black shadow-neo-sm ${CATEGORY_BG[category.colorKey] ?? "bg-neo-accent text-black"}`}
            >
              <CategoryIcon name={category.iconKey} className="h-8 w-8 text-black" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-black/60 dark:text-zinc-400">
              {event.name}
            </span>
          </div>
        )}

        {stateLabel && (
          <div className="absolute top-3 right-3 z-10">
            <Badge variant="accent" className="shadow-neo-sm">
              {stateLabel}
            </Badge>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-5 text-black dark:text-white">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-2xl font-black uppercase leading-none tracking-tight text-black dark:text-white">
            {event.name}
          </h3>
        </div>
        <p className="flex-1 text-base font-bold leading-snug text-black/80 dark:text-zinc-300">
          {event.shortDescription || event.description}
        </p>

        <ul className="space-y-1.5 text-sm font-bold text-black/90 dark:text-zinc-300">
          <li className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" strokeWidth={3} />
            {event.dateLabel} · Day {event.day}
          </li>
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" strokeWidth={3} />
            {event.timeLabel}
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={3} />
            {event.venue?.name ?? "TBA"}
          </li>
          <li className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0" strokeWidth={3} />
            {event.teamSizeLabel}
          </li>
          {event.prizePoolText && (
            <li className="flex items-center gap-2">
              <Trophy className="h-4 w-4 shrink-0" strokeWidth={3} />
              Prize: {event.prizePoolText}
            </li>
          )}
        </ul>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t-4 border-black px-5 py-3 text-black dark:text-white">
        <span className="text-xl font-black uppercase tracking-tight text-black dark:text-white">
          {formatPaise(event.amountPaise)}
          {event.amountPaise > 0 && (
            <span className="ml-1 text-xs font-bold uppercase tracking-widest text-black/80 dark:text-zinc-400">
              entry
            </span>
          )}
          {left && (
            <span className="ml-2 align-middle text-xs font-black uppercase tracking-widest text-black/60 dark:text-zinc-500">
              {left}
            </span>
          )}
        </span>
        {event.salesState === "OPEN" ? (
          onRegister ? (
            <button
              type="button"
              onClick={() => onRegister(event)}
              className="flex items-center gap-1 border-2 border-black bg-neo-accent px-3 py-1.5 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
            >
              Register <ArrowRight className="h-4 w-4" strokeWidth={3} />
            </button>
          ) : (
            <Link
              href={`/events#${event.slug}`}
              className="flex items-center gap-1 border-2 border-black bg-neo-accent px-3 py-1.5 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Register <ArrowRight className="h-4 w-4" strokeWidth={3} />
            </Link>
          )
        ) : (
          <span className="border-2 border-black/40 bg-neo-muted px-3 py-1.5 text-xs font-black uppercase tracking-widest text-black/50">
            {stateLabel ?? "Closed"}
          </span>
        )}
      </div>
    </article>
  );
}
