import { Badge } from "@/components/ui/Badge";

export function PageHeader({
  kicker,
  title,
  accent,
  description,
}: {
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
}) {
  return (
    <section className="relative overflow-hidden border-b-8 border-black bg-neo-secondary dark:bg-[#000000] text-black dark:text-white transition-colors">
      <div className="bg-halftone absolute inset-0 opacity-40 dark:opacity-15" aria-hidden />
      <div
        className="absolute -bottom-8 -right-8 h-32 w-32 rotate-12 border-8 border-black bg-neo-accent shadow-neo opacity-70"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
        <Badge variant="black" className="-rotate-2 mb-4">
          {kicker}
        </Badge>
        <h1 className="text-5xl font-black uppercase leading-[0.85] tracking-tighter sm:text-7xl md:text-8xl text-black dark:text-white">
          {title}{" "}
          {accent && (
            <span className="inline-block rotate-1 bg-black px-3 text-neo-secondary dark:bg-neo-secondary dark:text-black">
              {accent}
            </span>
          )}
        </h1>
        {description && (
          <p className="mt-6 max-w-2xl text-xl font-bold leading-snug text-black/90 dark:text-zinc-300">
            {description}
          </p>
        )}
      </div>
    </section>
  );
}
