"use client";

import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";

export function ClickTracker() {
  const [clicks, setClicks] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function trackOrFetch() {
      try {
        const hasTracked = typeof window !== "undefined" && sessionStorage.getItem("pulse_site_visited");
        const method = hasTracked ? "GET" : "POST";

        const res = await fetch("/api/stats/track", {
          method,
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) return;

        const data = (await res.json()) as { clicks?: number; success?: boolean };
        if (isMounted && typeof data.clicks === "number") {
          setClicks(data.clicks);
          if (!hasTracked && typeof window !== "undefined") {
            sessionStorage.setItem("pulse_site_visited", "true");
          }
        }
      } catch {
        // Silently ignore network failures on tracker
      }
    }

    trackOrFetch();

    return () => {
      isMounted = false;
    };
  }, []);

  if (clicks === null) {
    return (
      <div className="inline-flex items-center gap-2 border-2 border-black dark:border-white/30 bg-white dark:bg-[#18181b] px-3 py-1 text-xs font-black uppercase tracking-wider text-black dark:text-white shadow-neo-xs opacity-75">
        <span className="h-2 w-2 rounded-full bg-zinc-400" />
        <span>Tracking...</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 border-2 border-black dark:border-white/40 bg-white dark:bg-[#18181b] px-3 py-1 text-xs font-black uppercase tracking-wider text-black dark:text-white shadow-neo-xs transition-transform hover:-translate-y-0.5"
      title="Total verified website clicks & visits"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <MousePointerClick className="h-3.5 w-3.5 text-neo-accent" />
      <span>{clicks.toLocaleString()} Clicks</span>
    </div>
  );
}
