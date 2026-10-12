import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TeamCard } from "@/components/cards/TeamCard";
import { ButtonLink } from "@/components/ui/Button";
import { TEAM, FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Our Team",
  description: `Meet the students organising TARANG 2026 at ${FEST.collegeFull}.`,
};

export default function TeamPage() {
  return (
    <>
      <PageHeader
        kicker="The people behind the wave"
        title="Our"
        accent="Team"
        description={`TARANG is organised by the students of ${FEST.college}. The core team takes the stage here soon.`}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {TEAM.length > 0 ? (
            TEAM.map((group) => (
              <div key={group.id} className="mb-20 last:mb-0">
                <SectionHeading kicker={group.name} title={group.name} description={group.blurb} />
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  {group.members.map((member) => (
                    <TeamCard key={member.name} member={member} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="kit-rise t-halftone relative overflow-hidden rounded-[6px] border-[3px] border-black p-10 text-center shadow-neo-lg md:p-16">
              <Users className="mx-auto h-10 w-10 text-bone" strokeWidth={1.75} aria-hidden />
              <p className="t-label mt-6 text-bone/85">Organising committee · {FEST.year}</p>
              <h2 className="t-display t-cut mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.9]">Revealing soon</h2>
              <p className="mx-auto mt-6 max-w-xl rounded-[8px] bg-ink/70 px-5 py-3 text-bone/85">
                The core team, coordinators and their contact lines are announced here closer to the fest. Until then,
                the help desk is one message away.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <ButtonLink href="/ask" variant="dark">
                  Ask a question
                </ButtonLink>
                <ButtonLink href="/campus-ambassador" variant="secondary">
                  Become a campus ambassador
                </ButtonLink>
              </div>
            </div>
          )}
        </div>
      </section>

      <Marquee items={["Organised by students", FEST.college, "Mute the mundane", `Since ${FEST.year}`]} variant="secondary" />
    </>
  );
}
