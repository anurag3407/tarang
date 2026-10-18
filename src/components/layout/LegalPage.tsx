import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { FEST } from "@/lib/data";

/** Shown under every policy page title. Bump when any policy text changes. */
export const POLICY_UPDATED = "18 October 2026";

/** The party that sells passes and merchandise on this site. */
export const ORGANISER = `the TARANG Organising Committee, ${FEST.collegeFull}`;

export const POLICY_LINKS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Refund & Cancellation" },
  { href: "/shipping-policy", label: "Shipping & Delivery" },
  { href: "/contact", label: "Contact Us" },
];

/** Inline support channel: the published email, or the help desk until one is set. */
export function SupportEmail() {
  if (FEST.email) {
    return (
      <a href={`mailto:${FEST.email}`} className="t-link text-bone hover:text-signal">
        {FEST.email}
      </a>
    );
  }
  return (
    <Link href="/ask" className="t-link text-bone hover:text-signal">
      our help desk
    </Link>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kit-rise border-t border-bone/10 pt-8">
      <h2 className="t-display text-2xl text-bone md:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-bone/75 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  kicker = "Policies",
  title,
  accent,
  description,
  children,
}: {
  kicker?: string;
  title: string;
  accent?: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader kicker={kicker} title={title} accent={accent} description={description} />
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <p className="t-label text-bone/45">Last updated · {POLICY_UPDATED}</p>
        <div className="mt-10 space-y-10">{children}</div>
        <nav aria-label="Policies" className="mt-16 border-t border-bone/10 pt-8">
          <p className="t-label mb-4 text-bone/40">Other policies</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-[0.95rem]">
            {POLICY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="t-link text-bone/70 hover:text-bone">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
