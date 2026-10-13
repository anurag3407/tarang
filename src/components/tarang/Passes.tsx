import Link from "next/link";
import { FEST } from "@/lib/data";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";
import PassTicket from "./PassTicket";

/** One pass, printed as a ticket. Every night, the whole campus, every competition. */
export default function Passes({ price }: { price: string }) {
  return (
    <section id="passes" className="relative overflow-hidden px-6 py-32 md:px-12 md:py-44" aria-labelledby="passes-title">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="04"
          label="The Pass"
          id="passes-title"
          title={
            <>
              One pass. <span className="t-cut-red">Every night.</span>
            </>
          }
          aside="No tiers, no add-ons. The Pronite Pass gets you into both pronites, around campus for the whole fest, and into every competition."
        />

        <Reveal variant="stamp" rotate={-1.5} className="mx-auto mt-20 max-w-6xl md:mt-28">
          <PassTicket price={price} />
        </Reveal>

        <Reveal delay={200} className="mx-auto mt-14 flex max-w-6xl flex-wrap items-center justify-between gap-6">
          <p className="t-label leading-loose text-bone/55">
            Gate QR issued instantly · {FEST.dates} ·{" "}
            <Link href="/faqs" className="t-link text-bone/80">
              Pass FAQs
            </Link>
          </p>
          <Link href="/pronite-pass" className="t-btn t-btn-solid">
            Get your Pronite Pass — {price} <span className="t-btn-arrow">→</span>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
