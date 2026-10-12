const WORDS = [
  "Music",
  "Dance",
  "Theatre",
  "Literary",
  "Fine Arts",
  "Quizzing",
  "Sports",
  "Informals",
  "Pro Nights",
];

/** Slow, oversized serif ticker. Duplicated once so the loop is seamless. */
export default function Marquee() {
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {WORDS.map((w) => (
        <span key={w} className="flex items-center">
          <span className="t-display px-8 text-[clamp(3rem,7vw,7rem)] italic text-bone/85 md:px-12">{w}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brass md:h-7 md:w-7" aria-hidden>
            <path d="M12 0 L13.4 10.6 L24 12 L13.4 13.4 L12 24 L10.6 13.4 L0 12 L10.6 10.6 Z" fill="currentColor" />
          </svg>
        </span>
      ))}
    </div>
  );
  return (
    <div className="relative overflow-hidden border-y border-bone/12 py-8 md:py-10">
      <div className="t-marquee flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
