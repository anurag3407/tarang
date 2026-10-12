"use client";

import { useMemo, useState } from "react";
import { Search, Sparkles, ShoppingBag } from "lucide-react";
import { MerchandiseCard } from "@/components/cards/MerchandiseCard";
import { MerchandiseCheckoutModal } from "@/components/cards/MerchandiseCheckoutModal";
import type { MerchandiseProductRead } from "@/domain/content";

export function MerchandiseExplorer({
  initialItems,
}: {
  initialItems: MerchandiseProductRead[];
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModalItem, setActiveModalItem] = useState<MerchandiseProductRead | null>(null);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of initialItems) {
      if (item.category) set.add(item.category.toUpperCase());
    }
    return ["ALL", ...Array.from(set)];
  }, [initialItems]);

  // Filter items
  const filteredItems = useMemo(() => {
    return initialItems.filter((item) => {
      const matchesCategory =
        selectedCategory === "ALL" ||
        item.category.toUpperCase() === selectedCategory;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [initialItems, selectedCategory, searchQuery]);

  return (
    <div className="space-y-8">
      {/* Category Pills & Search Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-4 border-black bg-white p-4 shadow-neo">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`border-2 border-black px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-all duration-100 cursor-pointer ${
                selectedCategory === cat
                  ? "bg-neo-accent text-black shadow-neo-xs scale-105"
                  : "bg-neo-cream text-black dark:bg-[#18181b] dark:text-white hover:bg-white dark:hover:bg-[#27272a]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50 dark:text-zinc-400" />
          <input
            type="text"
            placeholder="Search merchandise…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border-2 border-black bg-neo-cream dark:bg-[#09090b] py-1.5 pl-9 pr-3 text-xs font-bold uppercase text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-zinc-500 outline-none focus:bg-white dark:focus:bg-[#121214]"
          />
        </div>
      </div>

      {/* Products Grid */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <MerchandiseCard
              key={item.id}
              item={item}
              onSelect={(selected) => setActiveModalItem(selected)}
            />
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="border-4 border-black bg-white dark:bg-[#121214] p-12 text-center shadow-neo">
          <div className="mx-auto flex h-16 w-16 items-center justify-center border-3 border-black bg-neo-cream dark:bg-[#09090b] shadow-neo-sm">
            <ShoppingBag className="h-8 w-8 text-black/50 dark:text-zinc-400" />
          </div>
          <h3 className="mt-4 text-xl font-black uppercase tracking-tight text-black dark:text-white">
            No merchandise found
          </h3>
          <p className="mt-1 text-xs font-bold text-black/60 dark:text-white/60">
            Try adjusting your search query or selecting a different category filter.
          </p>
          {(searchQuery || selectedCategory !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("ALL");
              }}
              className="mt-4 border-2 border-black bg-neo-accent px-4 py-1.5 text-xs font-black uppercase tracking-wider text-black shadow-neo-xs hover:-translate-y-0.5 transition-transform cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Checkout & Detail Modal */}
      {activeModalItem && (
        <MerchandiseCheckoutModal
          item={activeModalItem}
          onClose={() => setActiveModalItem(null)}
        />
      )}
    </div>
  );
}
