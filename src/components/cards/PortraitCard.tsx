import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, Globe } from "lucide-react";
import type { PortraitTone, SocialLinks } from "@/lib/data";

type Network = keyof SocialLinks;

const NETWORKS: { key: Network; label: string }[] = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "github", label: "GitHub" },
  { key: "website", label: "Website" },
];

/* lucide-react no longer ships brand marks, so the three we need live here. */
function SocialIcon({ network }: { network: Network }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-[18px] w-[18px]",
    "aria-hidden": true,
  };
  switch (network) {
    case "linkedin":
      return (
        <svg {...common}>
          <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
          <rect width="4" height="12" x="2" y="9" />
          <circle cx="4" cy="4" r="2" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      );
    case "github":
      return (
        <svg {...common}>
          <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
          <path d="M9 18c-4.51 2-5-2-7-2" />
        </svg>
      );
    default:
      return <Globe className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />;
  }
}

/**
 * A member printed like a gig poster: their background-free photo stands on a
 * tinted halftone stage as a cream-keylined sticker, head breaking out of the
 * frame, with their first name set huge and hollow behind them. The photo
 * links to the member's first profile; every profile gets a button below.
 */
export function PortraitCard({
  name,
  role,
  initials,
  tone,
  image,
  socials,
  index,
  badge,
  detail,
  children,
}: {
  name: string;
  role: string;
  initials: string;
  tone: PortraitTone;
  image?: string;
  socials?: SocialLinks;
  /** Printed as a catalogue number in the frame's corner. */
  index?: number;
  badge?: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  const links = NETWORKS.filter(({ key }) => socials?.[key]).map((n) => ({ ...n, href: socials![n.key]! }));
  const primary = links[0];
  const firstName = name.split(" ")[0];

  const stage = (
    <>
      <span className="kit-portrait-frame" aria-hidden>
        <span className="kit-portrait-sun" />
        <span className="kit-portrait-ghost" style={{ "--chars": firstName.length } as CSSProperties}>
          {firstName}
        </span>
        <span className="kit-portrait-fade" />
      </span>

      {image ? (
        <span className="kit-portrait-figure">
          <Image
            src={image}
            alt={`Portrait of ${name}`}
            fill
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 360px"
            className="object-contain object-bottom"
          />
        </span>
      ) : (
        <span className="kit-portrait-initials t-display" aria-hidden>
          {initials}
        </span>
      )}

      <span className="kit-portrait-meta" aria-hidden>
        {badge ? <span className="kit-portrait-badge">{badge}</span> : <span />}
        {index !== undefined && <span className="t-label text-bone/70">{String(index).padStart(2, "0")}</span>}
      </span>

      {primary && (
        <span className="kit-portrait-cta" aria-hidden>
          {primary.label}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      )}
    </>
  );

  return (
    <article className="kit-portrait kit-rise group" data-tone={tone}>
      {primary ? (
        <a
          href={primary.href}
          target="_blank"
          rel="noopener noreferrer"
          className="kit-portrait-stage"
          aria-label={`${name} on ${primary.label}`}
        >
          {stage}
        </a>
      ) : (
        <div className="kit-portrait-stage">{stage}</div>
      )}

      <div className="kit-portrait-plate">
        <div className="min-w-0">
          <h3 className="t-display text-[clamp(1.9rem,3.2vw,2.5rem)] leading-[0.9] text-bone">{name}</h3>
          <p className="t-label mt-3 text-signal">{role}</p>
          {detail && <div className="mt-3 text-sm leading-relaxed text-bone/65">{detail}</div>}
        </div>

        {links.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2.5">
            {links.map((l) => (
              <li key={l.key}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kit-portrait-social"
                  data-network={l.key}
                  aria-label={`${name} on ${l.label}`}
                  title={l.label}
                >
                  <SocialIcon network={l.key} />
                </a>
              </li>
            ))}
          </ul>
        )}

        {children}
      </div>
    </article>
  );
}
