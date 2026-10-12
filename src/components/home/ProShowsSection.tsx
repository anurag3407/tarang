import { ArrowRight, Moon } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { ProShowCard } from "@/components/cards/ProShowCard";
import { loadPublicContent } from "@/lib/content-loader";
import { formatPaise } from "@/lib/money";

export default async function ProShowsSection() {
  const { events, passProducts } = await loadPublicContent();
  const proShows = events.filter((e) => e.isNightEvent);

  const delegateProd = (passProducts ?? []).find(
    (p) => !p.isBasePass || p.slug === "vip-delegate-pass" || p.name.toLowerCase().includes("delegate")
  );
  const delegatePrice = delegateProd ? formatPaise(delegateProd.amountPaise) : "₹2,000";

  if (proShows.length === 0) return null;

  return (
    <section className="border-b-8 border-black bg-neo-muted dark:bg-[#151226] transition-colors">
      <div className="bg-dots-lg">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              kicker="After sundown"
              title="Pro"
              accent="shows"
              description="Headline night events. Every day of PULSE ends with a show on the main stage."
            />
            <div className="mb-12 flex flex-wrap items-center gap-3 shrink-0 md:mb-16">
              <ButtonLink href="/delegate-card" variant="primary">
                VIP Concert Card ({delegatePrice}) →
              </ButtonLink>
              <ButtonLink href="/schedule" variant="dark">
                <Moon className="h-5 w-5" strokeWidth={3} /> Full schedule
              </ButtonLink>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {proShows.slice(0, 3).map((show) => (
              <ProShowCard key={show.id} event={show} />
            ))}
          </div>

          {proShows.length > 3 && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              {proShows.slice(3).map((show) => (
                <div
                  key={show.id}
                  className="flex items-center gap-3 border-4 border-black bg-black px-5 py-3 text-white shadow-neo"
                >
                  <span className="text-xs font-black uppercase tracking-widest text-neo-secondary">
                    Day {show.day}
                  </span>
                  <span className="text-lg font-black uppercase tracking-tight">
                    {show.name}
                  </span>
                </div>
              ))}
              <ButtonLink href="/schedule" variant="outline">
                See all nights <ArrowRight className="h-5 w-5" strokeWidth={3} />
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
