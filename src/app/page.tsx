import Preloader from "@/components/tarang/Preloader";
import Cursor from "@/components/tarang/Cursor";
import Hero from "@/components/tarang/Hero";
import MuteMundane from "@/components/tarang/MuteMundane";
import Marquee from "@/components/tarang/Marquee";
import Manifesto from "@/components/tarang/Manifesto";
import Lineup, { type LineupArtist } from "@/components/tarang/Lineup";
import Passes from "@/components/tarang/Passes";
import Arenas, { type Arena } from "@/components/tarang/Arenas";
import Journey from "@/components/tarang/Journey";
import Finale from "@/components/tarang/Finale";
import SmoothScroll from "@/components/tarang/SmoothScroll";
import { loadPublicContent } from "@/lib/content-loader";
import { CATEGORIES } from "@/lib/data";
import { formatPaise } from "@/lib/money";
import { isPronitePassProduct } from "@/lib/pronite-pass";

// DB-backed sections (events/passes/categories) are mutable content served
// through unstable_cache; render dynamically so cache revalidation never
// collides with static-page rules. Cloudflare caches the HTML at the edge.
export const dynamic = "force-dynamic";

/** Shown until headline nights are published from the admin panel. */
const FALLBACK_NIGHTS: LineupArtist[] = [
  { id: "n1", night: 1, name: "Opening Night", date: "17 Sep", time: "19:00", detail: "Orchestral & Fusion", image: null },
  { id: "n2", night: 2, name: "Bollywood Night", date: "18 Sep", time: "19:00", detail: "Headliner revealing soon", image: null },
  { id: "n3", night: 3, name: "Rock Night", date: "19 Sep", time: "19:00", detail: "Headliner revealing soon", image: null },
  { id: "n4", night: 4, name: "EDM Night", date: "20 Sep", time: "19:00", detail: "Headliner revealing soon", image: null },
  { id: "n5", night: 5, name: "Closing Night", date: "21 Sep", time: "19:00", detail: "Headliner revealing soon", image: null },
];

export default async function Home() {
  const { events, categories, passProducts } = await loadPublicContent();

  const nights = events
    .filter((e) => e.isNightEvent)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map<LineupArtist>((e) => ({
      id: e.id,
      night: e.day,
      name: e.name,
      date: e.dateLabel,
      time: e.timeLabel,
      detail: e.venue?.shortName ?? e.venue?.name ?? e.category.name,
      image: e.imageUrl,
    }));

  // One pass on sale: the Pronite Pass (the former VIP Delegate product).
  const pass = passProducts.find(isPronitePassProduct);
  const passPrice = pass ? formatPaise(pass.amountPaise) : "—";

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.category.slug, (counts.get(e.category.slug) ?? 0) + 1);
  const arenas: Arena[] =
    categories.length > 0
      ? categories.map((c) => ({ slug: c.slug, name: c.name, tagline: c.tagline, count: counts.get(c.slug) ?? 0 }))
      : CATEGORIES.map((c) => ({ slug: c.id, name: c.name, tagline: c.tagline, count: 0 }));

  return (
    <div className="tarang t-grain">
      <noscript>
        <style>{`.t-preloader{display:none}[data-in] .t-enter-down,[data-in] .t-enter-up,[data-in] .t-enter-letter,[data-in] .t-enter-wipe,[data-in] .t-enter-fade{opacity:1!important;transform:none!important;clip-path:none!important}.t-reveal{opacity:1!important;transform:none!important;clip-path:none!important}`}</style>
      </noscript>
      <SmoothScroll />
      <Preloader />
      <Cursor />
      <Hero />
      <MuteMundane />
      <Marquee />
      <Manifesto />
      <Lineup artists={nights.length > 0 ? nights : FALLBACK_NIGHTS} />
      <Passes price={passPrice} />
      <Arenas arenas={arenas} total={events.length} />
      <Journey />
      <Finale />
    </div>
  );
}
