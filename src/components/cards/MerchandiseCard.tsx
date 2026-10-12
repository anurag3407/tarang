"use client";

import { useState } from "react";
import { formatPaise } from "@/lib/money";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, ShoppingBag, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import type { MerchandiseProductRead } from "@/domain/content";

export function MerchandiseCard({
  item,
  onSelect,
}: {
  item: MerchandiseProductRead;
  onSelect: (item: MerchandiseProductRead) => void;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const images = item.images && item.images.length > 0
    ? item.images
    : ["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80"];

  const hasMultipleImages = images.length > 1;
  const isAvailable = item.salesState === "OPEN" && item.availableUnits > 0;

  function nextImage(e: React.MouseEvent) {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev + 1) % images.length);
  }

  function prevImage(e: React.MouseEvent) {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev - 1 + images.length) % images.length);
  }

  return (
    <article
      onClick={() => onSelect(item)}
      className="group flex h-full cursor-pointer flex-col border-4 border-black bg-white dark:bg-[#121214] text-black dark:text-white shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg overflow-hidden"
    >
      {/* Top Category / Tag Strip */}
      <div className="flex items-center justify-between gap-2 border-b-4 border-black bg-neo-cream dark:bg-[#0c0c0e] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-black dark:text-neo-secondary" />
          <span className="text-xs font-black uppercase tracking-widest text-black dark:text-white">
            {item.category}
          </span>
        </div>
        {item.featured && (
          <Badge variant="accent" className="shadow-none text-[10px]">
            LIMITED DROP
          </Badge>
        )}
      </div>

      {/* Multi-Image Gallery Container (Instagram Square 1:1 Aspect Ratio) */}
      <div className="relative aspect-square w-full overflow-hidden border-b-4 border-black bg-neo-cream/50 dark:bg-[#000000]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[activeImageIndex]}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80";
          }}
        />

        {/* Multiple Image Arrows */}
        {hasMultipleImages && (
          <>
            <button
              type="button"
              onClick={prevImage}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 -translate-y-1/2 border-2 border-black bg-white/90 dark:bg-[#121214]/90 p-1 opacity-0 shadow-neo-xs transition-opacity hover:bg-neo-accent group-hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={nextImage}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 border-2 border-black bg-white/90 dark:bg-[#121214]/90 p-1 opacity-0 shadow-neo-xs transition-opacity hover:bg-neo-accent group-hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Dot indicators */}
            <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full border-2 border-black bg-white/90 dark:bg-[#121214]/90 px-2 py-1 shadow-neo-xs">
              {images.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImageIndex(idx);
                  }}
                  className={`h-2 w-2 rounded-full border border-black transition-colors ${
                    idx === activeImageIndex ? "bg-black dark:bg-white scale-110" : "bg-white dark:bg-black"
                  }`}
                  aria-label={`View image ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Sold out overlay badge */}
        {!isAvailable && (
          <div className="absolute top-3 right-3 z-10">
            <Badge variant="black" className="shadow-neo-sm">
              SOLD OUT
            </Badge>
          </div>
        )}
      </div>

      {/* Product Information (No ratings, no reviews - pure clean luxury) */}
      <div className="flex flex-1 flex-col justify-between p-5 text-black dark:text-white">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xl font-black uppercase tracking-tight text-black dark:text-white line-clamp-1">
              {item.name}
            </h3>
          </div>

          {/* Clean 3-4 lines of product description */}
          <p className="text-xs font-bold leading-relaxed text-black/75 dark:text-zinc-300 line-clamp-3">
            {item.description}
          </p>

          {/* Size variants (Dynamic admin defined) */}
          {item.sizes && item.sizes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-black uppercase text-black/50 dark:text-zinc-500">Variants:</span>
              {item.sizes.map((size) => (
                <span
                  key={size}
                  className="border border-black bg-neo-cream dark:bg-[#0c0c0e] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-black dark:text-white"
                >
                  {size}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer with Price & Quick Buy Button */}
        <div className="mt-5 flex items-center justify-between border-t-2 border-black pt-3">
          <div>
            <span className="text-2xl font-black tracking-tight text-black dark:text-white">
              {formatPaise(item.pricePaise)}
            </span>
            <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-black/60 dark:text-zinc-400">
              incl. taxes
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item);
            }}
            disabled={!isAvailable}
            className={`flex items-center gap-1.5 border-2 border-black px-3.5 py-1.5 text-xs font-black uppercase tracking-widest shadow-neo-sm transition-transform duration-100 ${
              isAvailable
                ? "bg-neo-accent text-black hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
                : "bg-neo-muted text-black/50 cursor-not-allowed"
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            {isAvailable ? "Order Drop" : "Sold Out"}
            {isAvailable && <ArrowRight className="h-3.5 w-3.5" strokeWidth={3} />}
          </button>
        </div>
      </div>
    </article>
  );
}
