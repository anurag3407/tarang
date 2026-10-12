"use client";

import { useState } from "react";
import { Moon, Sun, MapPin, Star } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import type { DayScheduleRead, ScheduleEntryRead } from "@/domain/content";

const CATEGORY_BG: Record<string, string> = {
  music: "bg-neo-accent text-black",
  dance: "bg-neo-secondary text-black",
  drama: "bg-neo-muted text-black",
  arts: "bg-white text-black dark:bg-neo-card dark:text-white",
  literary: "bg-neo-secondary text-black",
  sports: "bg-neo-accent text-black",
  medsci: "bg-neo-muted text-black",
  informal: "bg-white text-black dark:bg-neo-card dark:text-white",
  ceremony: "bg-neo-secondary text-black",
  proshow: "bg-black text-white",
};

const CATEGORY_ICON: Record<string, string> = {
  music: "Music",
  dance: "Drama",
  drama: "Megaphone",
  arts: "Palette",
  literary: "Brain",
  sports: "Dumbbell",
  medsci: "Stethoscope",
  informal: "Gamepad2",
  proshow: "Music",
  ceremony: "Music",
};

function ScheduleRow({ item }: { item: ScheduleEntryRead }) {
  if (item.isNight) {
    return (
      <li className="relative border-4 border-black bg-black p-5 text-white shadow-neo">
        <Badge
          variant="secondary"
          className="absolute -top-4 right-4 rotate-2"
        >
          <Moon className="h-3.5 w-3.5" strokeWidth={3} /> Pro Show
        </Badge>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <span className="shrink-0 text-2xl font-black tracking-tighter text-neo-secondary">
            {item.timeLabel}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-black uppercase leading-tight tracking-tight">
              {item.title}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm font-bold text-white/80">
              <MapPin className="h-4 w-4 shrink-0" strokeWidth={3} />
              {item.venue}
            </p>
          </div>
          <Star
            className="hidden h-10 w-10 shrink-0 fill-neo-secondary stroke-none sm:block"
            aria-hidden
          />
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 border-4 border-black bg-white p-5 shadow-neo-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-neo sm:flex-row sm:items-center sm:gap-6">
      <span className="shrink-0 text-2xl font-black tracking-tighter">
        {item.timeLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-black uppercase leading-tight tracking-tight">
          {item.title}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-bold text-black/70">
          <MapPin className="h-4 w-4 shrink-0" strokeWidth={3} />
          {item.venue}
        </p>
      </div>
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center border-4 border-black shadow-neo-sm ${CATEGORY_BG[item.categoryKey] ?? "bg-white"}`}
        aria-hidden
      >
        {item.categoryKey === "ceremony" ? (
          <Star className="h-6 w-6 fill-black stroke-none" />
        ) : (
          <CategoryIcon
            name={CATEGORY_ICON[item.categoryKey] ?? "Music"}
            className="h-6 w-6"
          />
        )}
      </span>
    </li>
  );
}

export default function ScheduleBoard({ days }: { days: DayScheduleRead[] }) {
  const [day, setDay] = useState(days[0]?.day ?? 1);
  const current = days.find((d) => d.day === day) ?? days[0];

  if (!current) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
        <div className="border-4 border-black bg-white p-12 text-center shadow-neo">
          <p className="text-3xl font-black uppercase tracking-tighter">
            Schedule coming soon
          </p>
          <p className="mt-2 text-lg font-bold">
            The day-wise schedule will appear here once it is published.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
      {/* Day tabs */}
      <div
        className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        role="tablist"
        aria-label="Fest days"
      >
        {days.map((d) => {
          const active = d.day === day;
          return (
            <button
              key={d.day}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDay(d.day)}
              className={`border-4 border-black px-4 py-3 text-left shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                active
                  ? "bg-black text-white"
                  : "bg-white text-black dark:bg-neo-card dark:text-white hover:-translate-y-0.5"
              }`}
            >
              <span
                className={`block text-xs font-black uppercase tracking-widest ${
                  active ? "text-neo-secondary" : "text-black/60 dark:text-white/60"
                }`}
              >
                Day {d.day} · {d.dateLabel}
              </span>
              <span className="block text-lg font-black uppercase tracking-tight">
                {d.weekday}
              </span>
            </button>
          );
        })}
      </div>

      {/* Day header */}
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <h2 className="text-4xl font-black uppercase tracking-tighter md:text-5xl">
          Day {current.day} —{" "}
          <span className="bg-neo-secondary px-2 text-black font-black">{current.theme}</span>
        </h2>
        <Badge variant="accent" className="rotate-1">
          {current.dateLabel} · {current.weekday}
        </Badge>
      </div>

      {/* Legend */}
      <div className="mb-8 flex flex-wrap items-center gap-4 text-sm font-black uppercase tracking-widest">
        <span className="flex items-center gap-2">
          <Sun className="h-5 w-5" strokeWidth={3} /> Day events
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-5 w-5 border-2 border-black bg-black" />{" "}
          Night pro show
        </span>
      </div>

      {/* Items */}
      {current.items.length === 0 ? (
        <div className="border-4 border-black bg-white p-12 text-center shadow-neo">
          <p className="text-2xl font-black uppercase tracking-tighter">
            Nothing scheduled yet
          </p>
          <p className="mt-2 text-lg font-bold">
            Sessions for this day will appear once they are published.
          </p>
        </div>
      ) : (
        <ul className="space-y-6">
          {current.items.map((item) => (
            <ScheduleRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
