import { Star } from "lucide-react";

export function Marquee({
  items,
  variant = "black",
  fast = false,
}: {
  items: string[];
  variant?: "black" | "secondary" | "accent";
  fast?: boolean;
}) {
  const bg =
    variant === "black"
      ? "bg-black text-white"
      : variant === "secondary"
        ? "bg-neo-secondary text-black"
        : "bg-neo-accent text-black";

  const row = (ariaHidden: boolean) => (
    <div
      aria-hidden={ariaHidden}
      className="flex shrink-0 items-center gap-6 pr-6"
    >
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="flex items-center gap-6 whitespace-nowrap text-lg font-black uppercase tracking-widest md:text-xl"
        >
          {item}
          <Star className="h-5 w-5 fill-current stroke-none" />
        </span>
      ))}
    </div>
  );

  return (
    <div
      className={`marquee-paused overflow-hidden border-y-4 border-black py-3 ${bg}`}
    >
      <div className={fast ? "marquee-track-fast" : "marquee-track"}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
