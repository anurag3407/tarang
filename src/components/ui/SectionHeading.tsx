/** Section header for inner pages: a slugline, then the title with its accent as a red cut-out. */
export function SectionHeading({
  kicker,
  title,
  accent,
  description,
  align = "left",
}: {
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
  align?: "left" | "center";
  /** Kept for existing callers — every surface is ink now. */
  dark?: boolean;
}) {
  const center = align === "center";
  return (
    <div className={`kit-rise mb-12 flex flex-col gap-5 md:mb-16 ${center ? "items-center text-center" : "items-start"}`}>
      <p className={`t-label flex items-center gap-3 text-bone/55 ${center ? "justify-center" : ""}`}>
        <span className="inline-block h-px w-8 bg-signal" />
        {kicker}
      </p>
      <h2 className="t-display text-[clamp(2.4rem,6vw,5.2rem)] leading-[0.9] text-bone">
        {title} {accent && <span className="t-cut-red">{accent}</span>}
      </h2>
      {description && <p className="max-w-2xl text-lg leading-relaxed text-bone/65 md:text-xl">{description}</p>}
    </div>
  );
}
