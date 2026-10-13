import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import { FEST } from "@/lib/data";
import { loadPublicContent } from "@/lib/content-loader";
import { Sparkles, Mail, Award, ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Sponsors & Partners",
  description:
    "Meet the partners powering TARANG 2026 at NIT Patna — and how to become one.",
};

export const dynamic = "force-dynamic";

const COLOR_MAP = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black dark:bg-neo-card dark:text-white",
};

export default async function SponsorsPage() {
  const content = await loadPublicContent();
  const sponsors = content.sponsors ?? [];

  const titleSponsor = sponsors.find(
    (s) => s.isTitle || s.category.toLowerCase().includes("title")
  );

  const otherSponsors = sponsors.filter((s) => s.id !== titleSponsor?.id);

  const marqueeItems =
    sponsors.length > 0
      ? sponsors.map((s) => s.name)
      : [
          "TARANG 2026",
          "NIT PATNA",
          "NOVEMBER 21–22",
          "MUTE THE MUNDANE",
          "TWO PRONITES",
        ];

  return (
    <>
      <PageHeader
        kicker="Powering the Beat"
        title="Our"
        accent="Sponsors"
        description="The brands, studios and media partners making TARANG 2026 possible."
      />

      <section className="bg-neo-cream py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Title Sponsor Spotlight Banner */}
          {titleSponsor && (
            <div className="mb-16 border-8 border-black bg-black p-6 text-white shadow-neo-lg sm:p-10 md:p-12">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-white/30 pb-4">
                <div className="flex items-center gap-2">
                  <Award className="h-6 w-6 text-neo-secondary fill-neo-secondary" />
                  <span className="font-mono text-sm font-black uppercase tracking-widest text-neo-secondary">
                    Official Title Partner
                  </span>
                </div>
                <span className="border-2 border-white bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  TARANG 2026 Headline
                </span>
              </div>

              <div className="mt-8 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
                {/* Clickable Hyperlinked Title Logo */}
                <div className="lg:col-span-4">
                  {titleSponsor.websiteUrl ? (
                    <a
                      href={titleSponsor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block overflow-hidden border-4 border-white bg-white p-4 shadow-neo transition-transform duration-100 hover:-translate-y-1"
                    >
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-neo-cream">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={titleSponsor.logoUrl}
                          alt={titleSponsor.name}
                          className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t-2 border-black/20 pt-2 text-xs font-black uppercase text-black">
                        <span className="truncate">{titleSponsor.name}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] underline">
                          Visit Site <ExternalLink className="h-3 w-3" />
                        </span>
                      </div>
                    </a>
                  ) : (
                    <div className="overflow-hidden border-4 border-white bg-white p-4 shadow-neo">
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-neo-cream">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={titleSponsor.logoUrl}
                          alt={titleSponsor.name}
                          className="h-full w-full object-contain p-2"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Title Sponsor Details */}
                <div className="lg:col-span-8 flex flex-col justify-between gap-6">
                  <div>
                    <h2 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl md:text-5xl">
                      {titleSponsor.name}
                    </h2>
                    <p className="mt-3 text-base font-bold text-white/85 sm:text-lg">
                      {titleSponsor.tagline}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    {titleSponsor.websiteUrl && (
                      <a
                        href={titleSponsor.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 border-4 border-black bg-neo-secondary px-5 py-2.5 text-sm font-black uppercase tracking-wider text-black shadow-neo-sm transition-transform hover:-translate-y-0.5"
                      >
                        Visit Official Website
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <div className="border-2 border-white/40 bg-zinc-900 px-4 py-2 text-xs font-black uppercase tracking-wider text-neo-secondary">
                      2-Day Headline Partner · NIT Patna
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Category Partners & Associates Grid */}
          {otherSponsors.length > 0 && (
            <div className="mb-16">
              <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <h3 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
                  Category Partners &amp; Associates
                </h3>
                <span className="border-2 border-black bg-white px-3 py-1 font-mono text-xs font-black uppercase">
                  {otherSponsors.length} Official Partner{otherSponsors.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {otherSponsors.map((sponsor) => {
                  const colorClass = COLOR_MAP[sponsor.colorKey] ?? "bg-neo-secondary text-black";
                  const CardWrapper = sponsor.websiteUrl ? "a" : "div";
                  const cardProps = sponsor.websiteUrl
                    ? {
                        href: sponsor.websiteUrl,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        title: `Visit ${sponsor.name} (${sponsor.websiteUrl})`,
                      }
                    : {};

                  return (
                    <div
                      key={sponsor.id || sponsor.name}
                      className={`flex flex-col justify-between border-4 border-black p-5 shadow-neo transition-all duration-100 hover:-translate-y-1 ${colorClass}`}
                    >
                      <div>
                        {/* Top category label & icon */}
                        <div className="flex items-center justify-between gap-2 border-b-2 border-black/20 pb-2">
                          <span className="border border-black bg-white px-2 py-0.5 text-xs font-black uppercase text-black">
                            {sponsor.category}
                          </span>
                          <Sparkles className="h-4 w-4 text-black" />
                        </div>

                        {/* Sponsor Logo with Hyperlink */}
                        <CardWrapper
                          {...cardProps}
                          className={`group relative mt-4 block aspect-[16/10] w-full overflow-hidden border-2 border-black bg-white p-3 shadow-neo-xs ${
                            sponsor.websiteUrl ? "cursor-pointer" : ""
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sponsor.logoUrl}
                            alt={sponsor.name}
                            className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                          />
                          {sponsor.websiteUrl && (
                            <span className="absolute bottom-1 right-1 bg-black p-1 text-white shadow-neo-xs transition-colors group-hover:bg-neo-accent group-hover:text-black">
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          )}
                        </CardWrapper>

                        {/* Brand Info */}
                        <h4 className="mt-4 text-xl font-black uppercase tracking-tight sm:text-2xl">
                          {sponsor.name}
                        </h4>
                        <p className="mt-1.5 text-xs font-bold leading-relaxed text-black/80">
                          {sponsor.tagline}
                        </p>
                      </div>

                      {/* Bottom link indicator */}
                      <div className="mt-5 flex items-center justify-between border-t-2 border-black/20 pt-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-black/60">
                          Official Partner
                        </span>
                        {sponsor.websiteUrl ? (
                          <a
                            href={sponsor.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-black uppercase underline hover:text-black/70"
                          >
                            Visit Site <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[10px] font-bold uppercase text-black/40">
                            TARANG · NIT PATNA
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state if no sponsors in backend yet */}
          {sponsors.length === 0 && (
            <div className="mb-16 border-4 border-black bg-white p-10 text-center shadow-neo sm:p-14">
              <Award className="mx-auto h-12 w-12 text-black" />
              <h3 className="mt-4 text-2xl font-black uppercase tracking-tight sm:text-3xl">
                Sponsors &amp; Partners Announcing Soon
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm font-bold text-black/70">
                We are actively curating the official partner and sponsor lineup for TARANG 2026. All confirmed brand collaborations will appear here once published from the admin control room.
              </p>
            </div>
          )}

          {/* Partner with TARANG */}
          <div className="kit-rise t-halftone relative overflow-hidden rounded-[6px] border-[3px] border-black p-8 shadow-neo-xl sm:p-12">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="t-label text-bone/85">Sponsorship desk</p>
                <h3 className="t-display t-cut mt-4 text-[clamp(2.4rem,6vw,4.8rem)] leading-[0.9]">Partner with Tarang</h3>
                <p className="mt-5 max-w-2xl rounded-[8px] bg-ink/70 px-5 py-3 text-base text-bone/85">
                  Two days and two pronites at {FEST.college}, in front of students from colleges across the country.
                  Title, category, stage and stall partnerships are open.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                {FEST.email && (
                  <ButtonLink href={`mailto:${FEST.email}?subject=TARANG ${FEST.year} sponsorship`} variant="secondary">
                    <Mail className="h-4 w-4" /> {FEST.email}
                  </ButtonLink>
                )}
                <ButtonLink href="/ask" variant="dark">
                  Send an enquiry
                </ButtonLink>
              </div>
            </div>
            <p className="mt-10 border-t border-bone/25 pt-5 text-sm text-bone/75">{FEST.venue}</p>
          </div>
        </div>
      </section>

      <Marquee items={marqueeItems} variant="secondary" />
    </>
  );
}

