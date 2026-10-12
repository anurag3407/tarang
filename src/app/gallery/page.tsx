import type { Metadata } from "next";
import { Camera } from "lucide-react";
import { Ring } from "@/components/tarang/Icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { Badge } from "@/components/ui/Badge";
import { GALLERY, type GalleryItem } from "@/lib/data";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Moments from past editions of TARANG — battle of bands, pro shows, flash mobs and everything in between.",
};

/** Each placeholder is printed like a frame off the poster until real photos land. */
const FIELD: Record<GalleryItem["color"], string> = {
  accent: "t-halftone",
  secondary: "bg-neo-secondary",
  muted: "bg-ink-3",
  white: "bg-[#2a0605]",
};

const PATTERN: Record<GalleryItem["pattern"], string> = {
  halftone: "bg-halftone",
  grid: "bg-grid-neo",
  dots: "bg-dots-lg",
};

function GalleryTile({ item, index }: { item: GalleryItem; index: number }) {
  const tilt = index % 3 === 0 ? "-rotate-1" : index % 3 === 1 ? "rotate-1" : "";
  return (
    <figure
      className={`kit-rise group relative flex flex-col overflow-hidden rounded-[6px] border-[3px] border-black bg-neo-card shadow-neo transition-all duration-300 hover:-translate-y-2 hover:rotate-0 hover:shadow-neo-lg ${tilt} ${
        item.tall ? "row-span-2" : ""
      }`}
    >
      {/* Stand-in for the photo — swap for next/image when shots land */}
      <div
        className={`relative flex flex-1 items-end overflow-hidden ${FIELD[item.color]} ${item.tall ? "min-h-80 md:min-h-[30rem]" : "min-h-60 md:min-h-72"}`}
        role="img"
        aria-label={`Photo placeholder: ${item.title}`}
      >
        <div className={`absolute inset-0 opacity-60 ${PATTERN[item.pattern]}`} aria-hidden />
        <span
          aria-hidden
          className="t-display absolute -right-2 -top-4 text-[9rem] leading-none text-transparent [-webkit-text-stroke:2px_rgba(244,234,200,0.35)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-4 md:text-[11rem]"
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <Ring className="absolute left-4 top-4 h-8 w-8 text-bone/70 transition-transform duration-700 group-hover:rotate-180" />
        <Camera className="relative m-4 h-6 w-6 text-bone/60" strokeWidth={1.75} aria-hidden />
      </div>
      <figcaption className="flex items-start justify-between gap-4 border-t-[3px] border-black px-4 py-4">
        <p className="t-display text-lg leading-tight text-bone">{item.title}</p>
        <Badge variant="muted" className="shrink-0">
          {item.category}
        </Badge>
      </figcaption>
    </figure>
  );
}

export default function GalleryPage() {
  return (
    <>
      <PageHeader
        kicker="Through the lens"
        title="The"
        accent="gallery"
        description="Moments from past editions. Photo uploads from TARANG 2026 go live during the fest — tagged by the media team."
      />
      <section className="bg-neo-cream">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
          <div className="grid auto-rows-fr grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {GALLERY.map((item, i) => (
              <GalleryTile key={item.id} item={item} index={i} />
            ))}
          </div>

          <div className="kit-rise t-halftone mt-16 rounded-[6px] border-[3px] border-black p-8 text-center shadow-neo-lg md:p-12">
            <p className="t-display t-cut text-4xl md:text-6xl">
              Shot something at TARANG?
            </p>
            <p className="mx-auto mt-3 max-w-xl text-lg font-bold leading-snug text-black">
              Tag <span className="bg-ink px-1.5 text-bone">@pulse.aiims</span> on
              Instagram with #TARANG26 — the best frames make it to this wall
              and the closing film.
            </p>
          </div>
        </div>
      </section>
      <Marquee
        items={["#TARANG26", "Feel The Beat", "Live The Wave", "Tag Us"]}
        variant="secondary"
      />
    </>
  );
}
