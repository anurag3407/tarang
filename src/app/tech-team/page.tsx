import type { Metadata } from "next";
import { Code2, Terminal, ExternalLink, ArrowLeft, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Tech Team & Developers — TARANG 2026",
  description:
    "Meet the tech geeks and developers behind the official digital platform of TARANG 2026 at AIIMS New Delhi.",
};

function LinkedinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function InstagramIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

interface TechMember {
  name: string;
  role: string;
  badge: string;
  badgeColor: "accent" | "secondary";
  icon: "code" | "terminal";
  bio?: string;
  linkedin: {
    username: string;
    url: string;
  };
  instagram?: {
    username: string;
    url: string;
  };
}

const TECH_TEAM: TechMember[] = [
  {
    name: "Anurag Mishra",
    role: "Developer · Tech Geek",
    badge: "Tech Geek",
    badgeColor: "accent",
    icon: "code",
    bio: "Building systems, platforms, and high-performance digital experiences.",
    linkedin: {
      username: "anurag3407",
      url: "https://www.linkedin.com/in/anurag3407",
    },
    instagram: {
      username: "anuragmishraxo",
      url: "https://www.instagram.com/anuragmishraxo",
    },
  },
  {
    name: "Mohnish Pamnani",
    role: "Developer · Tech Geek",
    badge: "Tech Geek",
    badgeColor: "secondary",
    icon: "terminal",
    bio: "Crafting interfaces, logic, and web experiences.",
    linkedin: {
      username: "mohnish-pamnani-595a81284",
      url: "https://www.linkedin.com/in/mohnish-pamnani-595a81284",
    },
  },
];

export default function TechTeamPage() {
  return (
    <>
      <PageHeader
        kicker="Code · Systems · Infrastructure"
        title="TECH"
        accent="GEEKS"
        description="The developers behind the TARANG 2026 digital infrastructure, ticketing system, and interactive platform."
      />

      <section className="bg-neo-cream py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {/* Top Intro Section */}
          <div className="mb-12 text-center">
            <div className="inline-flex items-center gap-2 border-2 border-black dark:border-white bg-neo-secondary px-3.5 py-1 text-xs font-black uppercase tracking-wider text-black shadow-neo-sm">
              <Sparkles className="h-4 w-4" />
              Built With Passion & Caffeine
            </div>
            <h2 className="mt-4 text-3xl font-black uppercase tracking-tight sm:text-4xl text-black dark:text-white">
              The Platform Engineers
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-bold text-black/75 dark:text-zinc-400">
              Designed, built, and shipped for South Asia&apos;s largest medical fest. Connect with the team below.
            </p>
          </div>

          {/* 2 Mini Cards Grid */}
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
            {TECH_TEAM.map((member) => (
              <article
                key={member.name}
                className="group relative flex flex-col justify-between border-4 border-black dark:border-white/20 bg-white dark:bg-[#121214] p-6 shadow-neo transition-all duration-200 hover:-translate-y-1 hover:shadow-neo-lg"
              >
                <div>
                  {/* Top Badge & Icon */}
                  <div className="flex items-center justify-between border-b-2 border-black/15 dark:border-white/10 pb-3">
                    <span
                      className={`border-2 border-black px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-black shadow-neo-xs ${
                        member.badgeColor === "accent"
                          ? "bg-neo-accent"
                          : "bg-neo-secondary"
                      }`}
                    >
                      {member.badge}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center border-2 border-black dark:border-white bg-black dark:bg-[#1f1f23] text-white">
                      {member.icon === "code" ? (
                        <Code2 className="h-4 w-4 text-neo-secondary" />
                      ) : (
                        <Terminal className="h-4 w-4 text-neo-accent" />
                      )}
                    </div>
                  </div>

                  {/* Name and Role */}
                  <div className="mt-4">
                    <h3 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white">
                      {member.name}
                    </h3>
                    <p className="mt-1 inline-block border border-black dark:border-white/30 bg-neo-cream dark:bg-[#1a1a1e] px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-black dark:text-zinc-300">
                      {member.role}
                    </p>
                    {member.bio && (
                      <p className="mt-3 text-xs font-bold leading-relaxed text-black/70 dark:text-zinc-400">
                        {member.bio}
                      </p>
                    )}
                  </div>
                </div>

                {/* Social Links / IDs */}
                <div className="mt-6 space-y-2.5 border-t-2 border-black/15 dark:border-white/10 pt-4">
                  {/* LinkedIn */}
                  <a
                    href={member.linkedin.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between border-2 border-black dark:border-white/40 bg-white dark:bg-[#18181b] px-3 py-2 text-xs font-black uppercase tracking-wider text-black dark:text-white shadow-neo-xs transition-all duration-100 hover:bg-[#0077b5] hover:text-white hover:border-black dark:hover:bg-[#0077b5] dark:hover:text-white dark:hover:border-white"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <LinkedinIcon className="h-4 w-4 shrink-0 text-[#0077b5] group-hover:text-white" />
                      <span className="truncate">{member.linkedin.username}</span>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  </a>

                  {/* Instagram (if present) */}
                  {member.instagram && (
                    <a
                      href={member.instagram.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between border-2 border-black dark:border-white/40 bg-white dark:bg-[#18181b] px-3 py-2 text-xs font-black uppercase tracking-wider text-black dark:text-white shadow-neo-xs transition-all duration-100 hover:bg-gradient-to-r hover:from-[#f09433] hover:via-[#dc2743] hover:to-[#bc1888] hover:text-white hover:border-black dark:hover:from-[#f09433] dark:hover:via-[#dc2743] dark:hover:to-[#bc1888] dark:hover:text-white dark:hover:border-white"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <InstagramIcon className="h-4 w-4 shrink-0 text-[#e1306c] group-hover:text-white" />
                        <span className="truncate">{member.instagram.username}</span>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Bottom Actions Banner */}
          <div className="mt-14 border-4 border-black dark:border-white/20 bg-white dark:bg-[#121214] p-6 text-center shadow-neo sm:p-8 max-w-3xl mx-auto">
            <p className="text-sm font-black uppercase tracking-widest text-black dark:text-white">
              Platform Engineering · TARANG 2026 · AIIMS New Delhi
            </p>
            <p className="mt-2 text-xs font-bold text-black/60 dark:text-zinc-400">
              Next.js · React · TypeScript · Tailwind CSS · Supabase
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
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
          "AIIMS TARANG 2026",
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
