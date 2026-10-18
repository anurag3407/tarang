import Link from "next/link";
import Wordmark from "@/components/tarang/Wordmark";
import { FEST, HAS_CONTACT } from "@/lib/data";
import { ClickTracker } from "@/components/analytics/ClickTracker";
import { POLICY_LINKS } from "@/components/layout/LegalPage";

const EXPLORE = [
  { href: "/events", label: "All Events" },
  { href: "/schedule", label: "Schedule" },
  { href: "/pronite-pass", label: "Pronite Pass" },
  { href: "/merchandise", label: "Merchandise" },
  { href: "/gallery", label: "Gallery" },
  { href: "/sponsors", label: "Sponsors & Partners" },
  { href: "/about", label: "About Tarang" },
  { href: "/team", label: "Our Team" },
];

const HELP = [
  { href: "/notices", label: "Notices" },
  { href: "/faqs", label: "FAQs" },
  { href: "/ask", label: "Ask a Question" },
  { href: "/campus-ambassador", label: "Campus Ambassador" },
  { href: "/reach", label: "How to Reach" },
  { href: "/contact", label: "Contact Us" },
];

const STAFF_LINKS = [
  { href: "/admin/login", label: "Staff Sign In" },
  { href: "/admin", label: "Admin Control Room" },
  { href: "/scanner", label: "Gate Scanner" },
  { href: "/dashboard", label: "My Dashboard" },
];

function Column({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="t-label mb-6 text-bone/40">{title}</h3>
      <ul className="space-y-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="t-link text-[0.95rem] text-bone/75 transition-colors hover:text-bone">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-bone/10 bg-ink font-[family-name:var(--font-body)] font-normal text-bone">
      <div className="mx-auto max-w-[1600px] px-6 pt-20 md:px-12 md:pt-28">
        <div className="grid gap-14 md:grid-cols-12">
          <div className="md:col-span-4">
            <p className="t-display text-4xl leading-[0.95] md:text-5xl">
              Mute the
              <br />
              <span className="t-cut-red">mundane.</span>
            </p>
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-bone/55">
              {FEST.summary} {FEST.dates}.
            </p>
            {FEST.instagram ? (
              <a href={FEST.instagram} target="_blank" rel="noopener noreferrer" className="t-btn t-btn-ghost mt-8">
                Instagram <span className="t-btn-arrow">↗</span>
              </a>
            ) : (
              <Link href="/pronite-pass" className="t-btn t-btn-ghost mt-8">
                Get your Pronite Pass <span className="t-btn-arrow">→</span>
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:col-span-8">
            <Column title="Explore" links={EXPLORE} />
            <div className="space-y-12">
              <Column title="Help desk" links={HELP} />
              <Column title="Policies" links={POLICY_LINKS.filter((l) => l.href !== "/contact")} />
            </div>
            <div className="col-span-2 space-y-12 sm:col-span-1">
              <div>
                <h3 className="t-label mb-6 text-bone/40">Contact</h3>
                <ul className="space-y-3 text-[0.95rem] text-bone/75">
                  {FEST.email && (
                    <li>
                      <a href={`mailto:${FEST.email}`} className="t-link hover:text-bone">
                        {FEST.email}
                      </a>
                    </li>
                  )}
                  {!HAS_CONTACT && (
                    <li>
                      <Link href="/ask" className="t-link hover:text-bone">
                        Ask the help desk
                      </Link>
                    </li>
                  )}
                  {FEST.phones.map((phone) => (
                    <li key={phone}>
                      <a href={`tel:${phone.replace(/\s+/g, "")}`} className="t-link hover:text-bone">
                        {phone}
                      </a>
                    </li>
                  ))}
                  <li className="pt-2 text-sm leading-relaxed text-bone/45">
                    <a href={FEST.mapsUrl} target="_blank" rel="noopener noreferrer" className="t-link hover:text-bone/80">
                      {FEST.venue}
                    </a>
                  </li>
                </ul>
              </div>
              <Column title="Staff & crew" links={STAFF_LINKS} />
            </div>
          </div>
        </div>

        <div className="mt-20 flex flex-col items-start justify-between gap-5 border-t border-bone/10 py-6 md:flex-row md:items-center">
          <p className="t-label text-bone/40">
            © {FEST.year} Tarang · {FEST.college}
          </p>
          <div className="opacity-60 [&_*]:!rounded-full [&>div]:!border-bone/15 [&>div]:!bg-transparent [&>div]:!font-normal [&>div]:!text-bone [&>div]:!shadow-none">
            <ClickTracker />
          </div>
          <Link href="/tech-team" className="t-label t-link text-bone/50 hover:text-bone">
            Made by Tech Geeks →
          </Link>
        </div>
      </div>

      {/* Oversized wordmark, cropped by the page edge */}
      <div aria-hidden className="pointer-events-none -mb-[3vw] select-none px-4 opacity-[0.09] md:px-12">
        <Wordmark tone="hollow" className="w-full" />
      </div>
    </footer>
  );
}
