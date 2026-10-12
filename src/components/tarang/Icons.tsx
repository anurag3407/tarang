/** Small glyphs shared across the landing page. */

export function Speaker({ muted = false, className = "" }: { muted?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.5 9a4.2 4.2 0 0 1 0 6" strokeLinecap="round" />
          <path d="M18.2 6.5a8 8 0 0 1 0 11" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** The mudra ring — thumb and forefinger closing into a circle. Used as a separator. */
export function Ring({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="20" cy="20" r="3.2" fill="currentColor" />
      <path d="M31 9 L36 4" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Text running round a circle — rubber stamps and badges. */
export function CircleText({
  text,
  className = "",
  id,
}: {
  text: string;
  className?: string;
  id: string;
}) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <defs>
        <path id={id} d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
      </defs>
      <text fill="currentColor" style={{ fontFamily: "var(--font-mono)", fontSize: 15.5, letterSpacing: "0.32em" }}>
        <textPath href={`#${id}`}>{text}</textPath>
      </text>
    </svg>
  );
}
