import Link from "next/link";
import { ArrowRight, Moon, Sparkles, Ticket, Trophy, MapPin, Activity } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FLOW } from "@/lib/data";

const STEP_ICONS = [Ticket, Trophy, MapPin, Activity, Moon];

export default function FlowSection() {
  return (
    <section className="relative overflow-hidden border-b-8 border-black bg-black py-20 text-white md:py-28">
      <div className="absolute inset-0 bg-grid-white opacity-20" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 border-b-4 border-white/20 pb-8">
          <div>
            <SectionHeading
              dark
              kicker="Step-by-Step Festival Guide"
              title="THE PULSE"
              accent="FLOW"
            />
          </div>
          <p className="max-w-md text-base font-bold text-white/80">
            Follow the official 5-step festival flow from registration to the main stage prime night celebrations.
          </p>
        </div>

        {/* 5-Step Grid */}
        <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
          {FLOW.map((step, i) => {
            const Icon = STEP_ICONS[i] || Sparkles;
            const isNight = i === 4;

            return (
              <li
                key={step.step}
                className={`group relative flex flex-col justify-between border-4 border-white p-6 shadow-neo-white transition-all duration-200 hover:-translate-y-2 ${
                  isNight
                    ? "bg-gradient-to-b from-purple-950 via-zinc-950 to-black ring-4 ring-neo-secondary"
                    : "bg-zinc-950"
                } ${i % 2 === 0 ? "lg:-rotate-0.5" : "lg:rotate-0.5"}`}
              >
                <div>
                  {/* Top Step Number & Tag */}
                  <div className="flex items-center justify-between border-b-2 border-white/20 pb-3">
                    <span className="font-mono text-xs font-black tracking-widest text-neo-secondary">
                      STEP {step.step}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center border-2 border-white bg-neo-accent text-black shadow-neo-xs">
                      <Icon className="h-4 w-4" strokeWidth={2.5} />
                    </div>
                  </div>

                  {/* Step Title */}
                  <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-white group-hover:text-neo-secondary transition-colors leading-snug">
                    {step.title}
                  </h3>

                  {/* Step Highlights */}
                  <div className="mt-3 space-y-2 text-xs font-bold leading-relaxed">
                    {step.highlights.map((h, hIdx) => (
                      <div
                        key={hIdx}
                        className={`rounded border p-2 text-xs leading-relaxed ${
                          h.variant === "secondary"
                            ? "border-neo-secondary/30 bg-neo-secondary/10 text-white/90"
                            : "border-neo-accent/30 bg-neo-accent/10 text-white/90"
                        }`}
                      >
                        <span
                          className={`font-black uppercase tracking-wide ${
                            h.variant === "secondary"
                              ? "text-neo-secondary"
                              : "text-neo-accent"
                          }`}
                        >
                          {h.label}:
                        </span>{" "}
                        <span className="text-white/80">{h.text}</span>
                      </div>
                    ))}

                    {/* Step Note / Guidelines */}
                    {step.note && (
                      <div className="border-t border-white/20 pt-2 text-[11px]">
                        <span className="block font-black uppercase tracking-wider text-neo-secondary">
                          {step.note.label}
                        </span>
                        <ul className="mt-1 space-y-1 text-white/75">
                          {step.note.items.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <span className="text-neo-accent shrink-0 font-bold">•</span>
                              <span className="leading-tight">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Action / CTA */}
                {step.href && (
                  <div className="mt-5 pt-3.5 border-t-2 border-white/15 space-y-2">
                    <Link
                      href={step.href}
                      className="inline-flex w-full items-center justify-between border-2 border-neo-secondary bg-neo-secondary px-3 py-2 text-xs font-black uppercase tracking-wider text-black transition-all duration-100 hover:bg-white hover:border-white shadow-[2px_2px_0px_0px_#ffffff]"
                    >
                      <span>{step.cta}</span>
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={3} />
                    </Link>
                    {step.secondaryHref && (
                      <Link
                        href={step.secondaryHref}
                        className="inline-flex w-full items-center justify-between border-2 border-white bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-black transition-colors hover:bg-neo-accent hover:border-neo-accent shadow-[2px_2px_0px_0px_rgba(255,255,255,0.4)]"
                      >
                        <span>{step.secondaryCta}</span>
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={3} />
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Bottom Banner */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-4 border-white bg-zinc-900 p-6 shadow-neo-white">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-neo-secondary shrink-0" />
            <p className="text-sm font-bold text-white/90">
              <strong>Need cards on arrival?</strong> Central Registration (CR) Desk operates near the Swimming Pool throughout all 5 days.
            </p>
          </div>
          <Link
            href="/reach"
            className="shrink-0 border-2 border-black bg-neo-accent px-4 py-2 text-xs font-black uppercase tracking-wider text-black shadow-neo-sm hover:bg-neo-secondary transition-colors"
          >
            CR Desk &amp; Venue Map →
          </Link>
        </div>
      </div>
    </section>
  );
}

