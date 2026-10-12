import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { loadPublicContent } from "@/lib/content-loader";

const COLOR_BG: Record<string, string> = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
};

export default async function CategoriesSection() {
  const { categories, events } = await loadPublicContent();
  const countBySlug = new Map<string, number>();
  for (const e of events) {
    countBySlug.set(e.category.slug, (countBySlug.get(e.category.slug) ?? 0) + 1);
  }

  if (categories.length === 0) return null;

  return (
    <section className="border-b-8 border-black bg-neo-cream">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <SectionHeading
          kicker="Pick your arena"
          title="Eight"
          accent="categories"
          description="From battle of bands to box cricket — every kind of competitor has a stage at PULSE."
        />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((cat, i) => {
            const count = countBySlug.get(cat.slug) ?? 0;
            return (
              <Link
                key={cat.id}
                href={`/events?category=${cat.slug}`}
                className={`group flex flex-col gap-3 border-4 border-black p-6 shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg ${COLOR_BG[cat.colorKey]} ${
                  i % 2 === 0 ? "-rotate-1" : "rotate-1"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-14 w-14 items-center justify-center border-4 border-black bg-white shadow-neo-sm">
                    <CategoryIcon name={cat.iconKey} className="h-7 w-7" />
                  </div>
                  <span className="border-2 border-black bg-black px-2 py-1 text-xs font-black uppercase tracking-widest text-white">
                    {count} {count === 1 ? "event" : "events"}
                  </span>
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  {cat.name}
                </h3>
                <p className="flex-1 text-base font-bold leading-snug text-black/80">
                  {cat.tagline}
                </p>
                <span className="flex items-center gap-1 text-sm font-black uppercase tracking-widest">
                  See events
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-100 group-hover:translate-x-1"
                    strokeWidth={3}
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
