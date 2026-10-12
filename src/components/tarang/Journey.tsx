import Link from "next/link";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "Get your pass",
    body: "The BR Card opens campus access and every competition. The Delegate Card adds the five headline nights.",
    href: "#passes",
    cta: "Compare passes",
  },
  {
    title: "Register for events",
    body: "Enter solo or build your college squad across 250+ competitions. Confirmation lands instantly.",
    href: "/events",
    cta: "Browse events",
  },
  {
    title: "Collect at the CR Desk",
    body: "Swimming Pool complex, from 09:00 daily. Bring the QR from your dashboard and a valid college ID.",
    href: "/reach",
    cta: "How to reach",
  },
  {
    title: "Ride the wave",
    body: "Five days on the floor, five nights at the Quadrangle. Prime Night gates open at 18:30.",
    href: "/schedule",
    cta: "Full schedule",
  },
];

export default function Journey() {
  return (
    <section className="relative px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="08"
          label="Your Tarang"
          title={
            <>
              Four steps to <em className="text-brass">the front row.</em>
            </>
          }
        />
        <ol className="mt-20 grid gap-px overflow-hidden rounded-[2px] bg-bone/12 sm:grid-cols-2 md:mt-28 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 110} className="bg-ink">
              <Link href={s.href} className="group flex h-full min-h-[24rem] flex-col p-8 transition-colors duration-500 hover:bg-ink-2 md:p-10">
                <span className="t-display text-[5.5rem] leading-none text-bone/15 transition-colors duration-500 group-hover:text-brass">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="t-display mt-auto pt-16 text-[2.2rem] leading-[1.02]">{s.title}</h3>
                <p className="mt-4 text-[0.92rem] leading-relaxed text-bone/55">{s.body}</p>
                <span className="t-label mt-8 flex items-center gap-2 text-bone/70 group-hover:text-bone">
                  {s.cta} <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
