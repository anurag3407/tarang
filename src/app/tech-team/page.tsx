import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import { PortraitCard } from "@/components/cards/PortraitCard";
import { TECH_TEAM } from "@/lib/data";

export const metadata: Metadata = {
  title: "Tech Team & Developers — TARANG 2026",
  description:
    "Meet the developers behind the official digital platform of TARANG 2026 at NIT Patna.",
};

const STACK = ["Next.js", "React", "TypeScript", "Tailwind CSS", "Supabase", "Upstash", "Razorpay"];

export default function TechTeamPage() {
  return (
    <>
      <PageHeader
        kicker="Code · Systems · Infrastructure"
        title="TECH"
        accent="GEEKS"
        description="The developers behind the TARANG 2026 digital infrastructure, ticketing system, and interactive platform."
      />

      <section className="kit-field py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            kicker="Built with passion & caffeine"
            title="The platform"
            accent="engineers"
            description="Designed, built and shipped for TARANG at NIT Patna. Tap a portrait to find them online."
          />

          {/* Staggered like pinned posters — every other card drops on wide screens. */}
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-x-10 gap-y-16 sm:grid-cols-2">
            {TECH_TEAM.map((member, i) => (
              <div key={member.name} className={i % 2 === 1 ? "sm:mt-20" : undefined}>
                <PortraitCard
                  name={member.name}
                  role={member.role}
                  initials={member.initials}
                  tone={member.tone}
                  image={member.image}
                  socials={member.socials}
                  index={i + 1}
                  badge="Dev"
                  detail={member.bio}
                />
              </div>
            ))}
          </div>

          {/* Stack + way out */}
          <div className="kit-rise mx-auto mt-24 max-w-4xl border-t border-bone/15 pt-10">
            <p className="t-label text-bone/55">Platform engineering · TARANG 2026 · NIT Patna</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {STACK.map((tech) => (
                <li key={tech} className="t-label rounded-full border border-bone/25 px-3.5 py-2 text-bone/80">
                  {tech}
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <ButtonLink href="/" variant="outline" className="text-xs">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
              </ButtonLink>
              <ButtonLink href="/team" variant="secondary" className="text-xs">
                Fest Leadership & Council →
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <Marquee
        items={[
          "TECH GEEKS",
          "TARANG 2026 · NIT PATNA",
          "NEXT.JS & REACT",
          "HIGH SPEED INFRASTRUCTURE",
          "BUILT BY TECH GEEKS",
          "ENGINEERED WITH PASSION",
        ]}
        variant="secondary"
      />
    </>
  );
}
