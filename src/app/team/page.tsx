import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TeamCard } from "@/components/cards/TeamCard";
import { PortraitCard } from "@/components/cards/PortraitCard";
import { ButtonLink } from "@/components/ui/Button";
import { TEAM, FEST, type PortraitTone } from "@/lib/data";

export const metadata: Metadata = {
  title: "Our Team",
  description: `Meet the students organising TARANG 2026 at ${FEST.collegeFull}.`,
};

/** Shown while TEAM is empty: three unnamed portraits waiting for their reveal. */
const TEASERS: { role: string; tone: PortraitTone }[] = [
  { role: "Core team", tone: "blood" },
  { role: "Coordinators", tone: "bone" },
  { role: "Volunteers", tone: "crimson" },
];

export default function TeamPage() {
  return (
    <>
      <PageHeader
        kicker="The people behind the wave"
        title="Our"
        accent="Team"
        description={`TARANG is organised by the students of ${FEST.college}. The core team takes the stage here soon.`}
      />

      <section className="kit-field py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {TEAM.length > 0 ? (
            TEAM.map((group) => (
              <div key={group.id} className="mb-28 last:mb-0">
                <SectionHeading kicker={group.name} title={group.name} description={group.blurb} />
                <div className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.members.map((member, i) => (
                    <TeamCard key={member.name} member={member} index={i + 1} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <>
              <SectionHeading
                kicker={`Organising committee · ${FEST.year}`}
                title="Revealing"
                accent="soon"
                description="The core team, coordinators and their contact lines are announced here closer to the fest. Until then, the help desk is one message away."
              />
              <div className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
                {TEASERS.map((t, i) => (
                  <div key={t.role} className={i === 1 ? "lg:mt-16" : undefined}>
                    <PortraitCard name="Coming soon" role={t.role} initials="?" tone={t.tone} index={i + 1} />
                  </div>
                ))}
              </div>
              <div className="kit-rise mt-20 flex flex-wrap gap-4">
                <ButtonLink href="/ask" variant="dark">
                  Ask a question
                </ButtonLink>
                <ButtonLink href="/campus-ambassador" variant="secondary">
                  Become a campus ambassador
                </ButtonLink>
              </div>
            </>
          )}
        </div>
      </section>

      <Marquee items={["Organised by students", FEST.college, "Mute the mundane", `Since ${FEST.year}`]} variant="secondary" />
    </>
  );
}
