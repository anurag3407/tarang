
import { Moon, MapPin, Ticket, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { EventRead } from "@/domain/content";
import { formatPaise } from "@/lib/money";

const COLOR_BG: Record<string, string> = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
};

export function ProShowCard({ event }: { event: EventRead }) {
  const bg = COLOR_BG[event.category.colorKey] ?? "bg-neo-secondary";
  const feeLabel =
    event.amountPaise === 0
      ? "Free with fest pass"
      : `${formatPaise(event.amountPaise)} entry fee`;

  return (
    <article className="relative flex h-full flex-col border-4 border-black bg-black text-white shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg">
      {/* Night badge */}
      <Badge
        variant="black"
        className="absolute -top-4 -right-3 rotate-3 border-white bg-black text-white shadow-neo-white"
      >
        <Moon className="h-3.5 w-3.5" strokeWidth={3} /> Day {event.day}
      </Badge>

      <div className={`border-b-4 border-black px-5 py-4 ${bg} text-black`}>
        <p className="text-xs font-black uppercase tracking-[0.2em]">
          {event.dateLabel} · {event.timeLabel}
        </p>
        <h3 className="mt-1 text-3xl font-black uppercase leading-none tracking-tighter">
          {event.name}
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        {event.shortDescription || event.description ? (
          <p className="flex-1 text-base font-bold leading-snug text-white/80">
            {event.shortDescription || event.description}
          </p>
        ) : null}
        <ul className="space-y-1.5 text-sm font-bold text-white">
          {event.venue?.name && (
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-neo-secondary" strokeWidth={3} />
              {event.venue.name}
            </li>
          )}
          <li className="flex items-center gap-2">
            <Ticket className="h-4 w-4 shrink-0 text-neo-secondary" strokeWidth={3} />
            {feeLabel}
          </li>
          {event.prizePoolText && (
            <li className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-neo-accent" strokeWidth={3} />
              Prize pool: {event.prizePoolText}
            </li>
          )}
        </ul>
        <span className="w-fit border-2 border-white px-3 py-1 text-xs font-black uppercase tracking-widest">
          {event.category.name}
        </span>
      </div>
    </article>
  );
}
