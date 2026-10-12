import { Badge } from "./Badge";

export function SectionHeading({
  kicker,
  title,
  accent,
  description,
  align = "left",
  dark = false,
}: {
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
  align?: "left" | "center";
  dark?: boolean;
}) {
  return (
    <div
      className={`mb-12 flex flex-col gap-4 md:mb-16 ${
        align === "center" ? "items-center text-center" : "items-start"
      }`}
    >
      <Badge variant={dark ? "secondary" : "accent"} className="-rotate-2">
        {kicker}
      </Badge>
      <h2
        className={`text-4xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl md:text-7xl ${
          dark ? "text-white" : "text-black dark:text-white"
        }`}
      >
        {title}{" "}
        {accent && (
          <span
            className={
              dark
                ? "text-stroke-white"
                : "inline-block bg-neo-secondary px-3 text-black dark:text-black font-black"
            }
          >
            {accent}
          </span>
        )}
      </h2>
      {description && (
        <p
          className={`max-w-2xl text-lg font-bold leading-snug md:text-xl ${
            dark ? "text-white" : "text-black dark:text-zinc-300"
          }`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
