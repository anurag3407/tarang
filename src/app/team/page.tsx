import type { Metadata } from "next";
import { Mail, Phone, ShieldCheck, Sparkles, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TeamCard } from "@/components/cards/TeamCard";
import { ButtonLink } from "@/components/ui/Button";
import { TEAM, FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Our Team & Leadership — PULSE 2026",
  description:
    "Meet the Chief Coordinators and AIIMS Student Association (ASA) leadership running PULSE 2026 at AIIMS New Delhi.",
};

export default function TeamPage() {
  const chiefGroup = TEAM.find((g) => g.id === "chief-coordinators") || TEAM[0];
  const execGroup = TEAM.find((g) => g.id === "executive-council") || TEAM[1];

  return (
    <>
      <PageHeader
        kicker="Student Leadership & Administration"
        title="OUR"
        accent="TEAM"
        description="PULSE is envisioned, organized, and executed by the undergraduate students of AIIMS New Delhi under the AIIMS Student Association (ASA)."
      />

      <section className="bg-neo-cream py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Chief Coordinators Highlight Banner */}
          {chiefGroup && (
            <div className="mb-20">
              <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
                <div>
                  <div className="inline-flex items-center gap-2 border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider">
                    <Sparkles className="h-4 w-4" />
                    Festival Leadership
                  </div>
                  <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl">
                    Chief Coordinators
                  </h2>
                </div>
                <p className="max-w-md text-sm font-bold text-black/75">
                  Direct contacts for festival operations, events administration, registrations, and official brand collaborations.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {chiefGroup.members.map((member) => (
                  <TeamCard key={member.name} member={member} />
                ))}
              </div>
            </div>
          )}

          {/* AIIMS Student Association (ASA) Leadership */}
          {execGroup && (
            <div className="mb-20">
              <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
                <div>
                  <div className="inline-flex items-center gap-2 border-2 border-black bg-neo-secondary px-3 py-1 text-xs font-black uppercase tracking-wider">
                    <ShieldCheck className="h-4 w-4" />
                    Elected Executive Council
                  </div>
                  <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl">
                    AIIMS Student Association (ASA)
                  </h2>
                </div>
                <p className="max-w-md text-sm font-bold text-black/75">
                  The official undergraduate student council of AIIMS New Delhi steering South Asia&apos;s largest medical fest.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {execGroup.members.map((member) => (
                  <TeamCard key={member.name} member={member} />
                ))}
              </div>
            </div>
          )}

          {/* Official Contact & Inquiry Desk Banner */}
          <div className="border-8 border-black bg-black p-8 sm:p-12 text-white shadow-neo-lg">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              <div className="space-y-3">
                <span className="border-2 border-white bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  Official Communication Channel
                </span>
                <h3 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
                  Connect with AIIMS Student Association
                </h3>
                <p className="max-w-2xl text-sm font-bold leading-relaxed text-white/80">
                  For official correspondence, media inquiries, inter-college delegation partnerships, and institutional registrations, write to the official student body.
                </p>
                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <a
                    href={`mailto:${FEST.email}`}
                    className="inline-flex items-center gap-2 border-2 border-white bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-wider text-black shadow-neo-sm hover:bg-white transition-colors"
                  >
                    <Mail className="h-4 w-4" />
                    {FEST.email}
                  </a>
                  <span className="text-xs font-bold text-white/60">
                    AIIMS Campus, Ansari Nagar, New Delhi
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <ButtonLink href="/sponsors" variant="primary">
                  Sponsorship Desk
                </ButtonLink>
                <ButtonLink href="/ask" variant="secondary">
                  Ask a Question
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Marquee
        items={[
          "AIIMS Student Association (ASA)",
          "Envisioned & Managed by Students",
          "Since 1973",
          "50+ Years of PULSE Legacy",
          "South Asia's Largest Medical Fest",
        ]}
        variant="black"
      />
    </>
  );
}

