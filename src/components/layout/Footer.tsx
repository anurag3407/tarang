import Link from "next/link";
import Image from "next/image";
import { Mail, Phone, MapPin } from "lucide-react";
import { FEST } from "@/lib/data";
import { ClickTracker } from "@/components/analytics/ClickTracker";

function InstagramIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
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

const EXPLORE = [
  // { href: "/map", label: "Campus Venue Map" },
  { href: "/about", label: "About AIIMS & PULSE" },
  { href: "/merchandise", label: "Official Merchandise Drop" },
  { href: "/events", label: "All Events" },
  { href: "/basic-card", label: "PULSE BR Card" },
  { href: "/delegate-card", label: "Delegate Card (Pro Nights)" },
  { href: "/schedule", label: "Schedule" },
  { href: "/gallery", label: "Gallery" },
  { href: "/sponsors", label: "Sponsors & Partners" },
  { href: "/team", label: "Our Team" },
];

const HELP = [
  // { href: "/map", label: "Venue Map & Roads" },
  { href: "/notices", label: "Notices" },
  { href: "/faqs", label: "FAQs" },
  { href: "/ask", label: "Ask a Question" },
  { href: "/campus-ambassador", label: "Campus Ambassador" },
  { href: "/reach", label: "How to Reach" },
];

const STAFF_LINKS = [
  { href: "/admin/login", label: "Staff Sign In" },
  { href: "/admin", label: "Admin Control Room" },
  { href: "/scanner", label: "Gate Scanner" },
  { href: "/dashboard", label: "Delegate Dashboard" },
];

export default function Footer() {
  return (
    <footer className="border-t-8 border-black dark:border-white/15 bg-neo-secondary dark:bg-[#000000] text-black dark:text-white transition-colors">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand (2 cols on lg) */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            <div className="group flex items-center gap-3 border-4 border-black bg-neo-accent px-3 py-2 shadow-neo-sm w-fit transition-transform hover:-translate-y-0.5">
              <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded border-2 border-black bg-white p-0.5 shadow-[2px_2px_0px_0px_#000]">
                <Image
                  src="/pulse-logo.png"
                  alt="PULSE 2026 Logo"
                  width={36}
                  height={36}
                  unoptimized
                  className="h-full w-full object-contain"
                />
              </div>
              <span className="text-2xl font-black uppercase tracking-tighter text-black">
                {FEST.name}
                <span className="text-sm align-super font-black">’{FEST.year.slice(2)}</span>
              </span>
            </div>
            <p className="text-lg font-bold leading-snug">
              {FEST.tagline} The annual cultural fest of {FEST.college}.
            </p>
            <p className="border-4 border-black dark:border-white/60 bg-white dark:bg-[#18181b] px-3 py-2 text-sm font-black uppercase tracking-widest shadow-neo-sm dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.4)] w-fit text-black dark:text-white">
              {FEST.dates}
            </p>

            {/* Quick staff button */}
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Link
                href="/admin/login"
                className="border-2 border-black dark:border-white bg-black dark:bg-neo-secondary text-white dark:text-black px-3.5 py-1.5 text-xs font-black uppercase tracking-wider shadow-neo-sm dark:shadow-[2px_2px_0px_0px_#ffffff] transition-all duration-100 hover:-translate-y-0.5 hover:bg-neo-accent dark:hover:bg-white dark:hover:text-black active:translate-x-[2px] active:translate-y-[2px]"
              >
                Staff Sign In →
              </Link>
              <Link
                href="/scanner"
                className="border-2 border-black dark:border-white bg-white dark:bg-[#18181b] text-black dark:text-white px-3.5 py-1.5 text-xs font-black uppercase tracking-wider shadow-neo-sm dark:shadow-[2px_2px_0px_0px_#ffffff] transition-all duration-100 hover:-translate-y-0.5 hover:bg-neo-accent dark:hover:bg-neo-secondary dark:hover:text-black dark:hover:border-black active:translate-x-[2px] active:translate-y-[2px]"
              >
                Gate Scanner
              </Link>
            </div>
          </div>

          {/* Explore */}
          <div>
            <h3 className="mb-4 text-2xl font-black uppercase tracking-tight text-black dark:text-white">
              Explore
            </h3>
            <ul className="space-y-2">
              {EXPLORE.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-block border-2 border-transparent px-1 text-base font-bold uppercase tracking-wide transition-all duration-100 hover:border-black hover:bg-white hover:text-black hover:shadow-neo-sm dark:hover:bg-neo-secondary dark:hover:text-black"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Help & Portals */}
          <div>
            <h3 className="mb-4 text-2xl font-black uppercase tracking-tight text-black dark:text-white">
              Help Desk
            </h3>
            <ul className="space-y-2">
              {HELP.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-block border-2 border-transparent px-1 text-base font-bold uppercase tracking-wide transition-all duration-100 hover:border-black hover:bg-white hover:text-black hover:shadow-neo-sm dark:hover:bg-neo-secondary dark:hover:text-black"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>

            <h4 className="mb-2 mt-6 text-sm font-black uppercase tracking-widest text-black/70 dark:text-white/70">
              Staff & Crew
            </h4>
            <ul className="space-y-1.5">
              {STAFF_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-block border border-transparent px-1 text-xs font-black uppercase tracking-wider text-black/80 dark:text-white/80 transition-all duration-100 hover:border-black hover:bg-white hover:text-black hover:shadow-neo-sm dark:hover:bg-neo-secondary dark:hover:text-black"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="mb-4 text-2xl font-black uppercase tracking-tight text-black dark:text-white">
              Contact
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="mt-1 h-6 w-6 shrink-0" strokeWidth={3} />
                <span className="text-base font-bold leading-snug">
                  {FEST.venue}
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-6 w-6 shrink-0" strokeWidth={3} />
                <a
                  href={`mailto:${FEST.email}`}
                  className="text-base font-bold underline decoration-4 underline-offset-4 hover:text-neo-accent"
                >
                  {FEST.email}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Phone className="mt-1 h-6 w-6 shrink-0" strokeWidth={3} />
                <div className="flex flex-col gap-1">
                  {FEST.phones.map((phone) => (
                    <a
                      key={phone}
                      href={`tel:${phone.replace(/\s+/g, "")}`}
                      className="text-base font-bold hover:text-neo-accent transition-colors"
                    >
                      {phone}
                    </a>
                  ))}
                </div>
              </li>
            </ul>
            <a
              href={FEST.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 border-4 border-black dark:border-zinc-700 bg-black dark:bg-[#18181b] px-4 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-neo-sm dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.15)] transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:bg-neo-accent dark:hover:bg-neo-accent dark:hover:text-black dark:hover:border-black"
            >
              <InstagramIcon className="h-5 w-5" />
              @pulse.aiims
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t-4 border-black dark:border-white/15 pt-6 md:flex-row">
          <p className="text-sm font-black uppercase tracking-widest">
            © {FEST.year} {FEST.name} · {FEST.college}
          </p>
          <ClickTracker />
          <Link
            href="/tech-team"
            className="group inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-widest transition-colors hover:text-neo-accent dark:hover:text-neo-accent underline decoration-2 underline-offset-4"
          >
            <span>Made by Tech Geeks</span>
            <span className="inline-block transition-transform duration-150 group-hover:translate-x-1" aria-hidden>
              →
            </span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
