import type { Metadata } from "next";
import { Camera, Star } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { Badge } from "@/components/ui/Badge";
import { GALLERY, type GalleryItem } from "@/lib/data";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Moments from past editions of TARANG — battle of bands, pro shows, flash mobs and everything in between.",
};

const COLOR_BG: Record<GalleryItem["color"], string> = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
};

const PATTERN: Record<GalleryItem["pattern"], string> = {
  halftone: "bg-halftone",
  grid: "bg-grid-neo",
  dots: "bg-dots-lg",
};

function GalleryTile({ item, index }: { item: GalleryItem; index: number }) {
  return (
    <figure
      className={`group relative overflow-hidden border-4 border-black shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg ${
        COLOR_BG[item.color]
      } ${index % 3 === 0 ? "-rotate-1" : index % 3 === 1 ? "rotate-1" : ""} ${
        item.tall ? "row-span-2" : ""
      }`}
    >
      {/* Pattern stand-in for the photo — swap for next/image when shots land */}
      <div
        className={`flex items-center justify-center ${PATTERN[item.pattern]} ${
          item.tall ? "h-72 md:h-96" : "h-56 md:h-64"
        }`}
        role="img"
        aria-label={`Photo placeholder: ${item.title}`}
      >
        <Camera
          className="h-16 w-16 stroke-black opacity-40 transition-transform duration-200 group-hover:scale-110"
          strokeWidth={2.5}
        />
      </div>
      <figcaption className="border-t-4 border-black bg-white dark:bg-[#121214] text-black dark:text-white px-4 py-3">
        <p className="text-lg font-black uppercase leading-tight tracking-tight text-black dark:text-white">
          {item.title}
        </p>
        <Badge variant="secondary" className="mt-2 shadow-none">
          {item.category}
        </Badge>
      </figcaption>
      <Star
        className="absolute right-3 top-3 h-8 w-8 fill-black stroke-none opacity-20"
        aria-hidden
      />
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

          <div className="mt-16 border-8 border-black bg-neo-secondary p-8 text-center text-black shadow-neo-lg md:p-12">
            <p className="text-3xl font-black uppercase tracking-tighter text-black md:text-4xl">
              Shot something at TARANG?
            </p>
            <p className="mx-auto mt-3 max-w-xl text-lg font-bold leading-snug text-black">
              Tag <span className="bg-white dark:bg-black text-black dark:text-white px-1">@pulse.aiims</span> on
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
