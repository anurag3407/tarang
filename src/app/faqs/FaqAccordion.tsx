"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { FAQS } from "@/lib/data";

const CATEGORY_ORDER = [
  "Registration",
  "Passes & Entry",
  "Events",
  "Logistics",
] as const;

const CATEGORY_BG: Record<string, string> = {
  Registration: "bg-neo-accent text-black",
  "Passes & Entry": "bg-neo-secondary text-black",
  Events: "bg-neo-muted text-black",
  Logistics: "bg-white text-black dark:bg-neo-card dark:text-white",
};

export default function FaqAccordion() {
  const [open, setOpen] = useState<string | null>(
    FAQS.length > 0 ? FAQS[0].q : null
  );

  return (
    <div className="mx-auto max-w-4xl space-y-16 px-4 py-16 sm:px-6 md:py-20">
      {CATEGORY_ORDER.map((cat) => {
        const faqs = FAQS.filter((f) => f.category === cat);
        if (faqs.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-6 flex items-center gap-4">
              <Badge variant="black" className="-rotate-2 text-white">
                {cat}
              </Badge>
              <div className="h-1 flex-1 bg-black dark:bg-white/20" aria-hidden />
            </div>
            <div className="space-y-4">
              {faqs.map((faq) => {
                const isOpen = open === faq.q;
                return (
                  <div
                    key={faq.q}
                    className="border-4 border-black bg-white dark:bg-neo-card text-black dark:text-white shadow-neo transition-all duration-200"
                  >
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : faq.q)}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-100 ${
                        isOpen ? CATEGORY_BG[cat] : "bg-white dark:bg-neo-card text-black dark:text-white"
                      }`}
                    >
                      <span className="text-lg font-black uppercase leading-tight tracking-tight md:text-xl">
                        {faq.q}
                      </span>
                      <ChevronDown
                        className={`h-6 w-6 shrink-0 transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                        strokeWidth={3}
                        aria-hidden
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t-4 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white px-5 py-4">
                        <p className="text-base font-bold leading-relaxed md:text-lg text-black dark:text-zinc-300">
                          {faq.a}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
