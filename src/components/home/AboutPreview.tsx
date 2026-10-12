import { ArrowRight, HeartPulse, Sparkles } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { FEST } from "@/lib/data";

export default function AboutPreview() {
  return (
    <section className="border-b-8 border-black bg-neo-muted">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHeading
                kicker="What is PULSE?"
                title="The heartbeat"
                accent="of AIIMS"
              />
              <div className="space-y-4 text-lg font-bold leading-snug md:text-xl text-black/85">
                <p>
                  PULSE is the cultural heartbeat of student life at AIIMS, envisioned, created, and managed entirely by the{" "}
                  <span className="bg-white px-1">AIIMS Student Association (ASA)</span> — the official undergraduate student body of AIIMS New Delhi.
                </p>
                <p>
                  What began in 1973 as a modest sports meet has grown over five decades into{" "}
                  <span className="bg-neo-secondary px-1 text-black">
                    South Asia’s largest medical college festival
                  </span>
                  , attracting over 450+ participating institutions from across India and abroad.
                </p>
                <p>
                  Every day runs on high-octane competitions, cultural showdowns, and medical symposiums — every night explodes in celebration with prime concerts on the main stage.
                </p>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <ButtonLink href="/about" variant="dark">
                  Read The Full Story{" "}
                  <ArrowRight className="h-5 w-5" strokeWidth={3} />
                </ButtonLink>
                <ButtonLink href="/reach" variant="secondary">
                  How To Reach Campus
                </ButtonLink>
              </div>
            </div>

            {/* Sticker collage */}
            <div className="relative mx-auto w-full max-w-md">
              <div className="-rotate-2 border-8 border-black bg-white p-8 shadow-neo-xl">
                <div className="mb-4 flex h-16 w-16 items-center justify-center border-4 border-black bg-neo-accent shadow-neo-sm">
                  <HeartPulse className="h-9 w-9 text-black" strokeWidth={3} />
                </div>
                <p className="text-3xl font-black uppercase leading-none tracking-tighter">
                  Est. 1973
                </p>
                <p className="mt-2 text-base font-bold leading-snug text-black/80">
                  50+ Years of Pulsating Heritage. South Asia’s Largest Medical College Cultural Festival.
                </p>
              </div>
              <div className="absolute -bottom-8 -right-4 rotate-3 border-4 border-black bg-neo-secondary px-5 py-3 text-lg font-black uppercase tracking-widest shadow-neo md:-right-8">
                450+ Colleges
              </div>
              <div className="absolute -top-6 -left-4 -rotate-6 border-4 border-black bg-black px-5 py-3 text-lg font-black uppercase tracking-widest text-white shadow-neo md:-left-8">
                AIIMS ASA
              </div>
            </div>
          </div>
        </div>
    </section>
  );
}

