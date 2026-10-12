import type { ReactNode } from "react";

type Variant = "accent" | "secondary" | "muted" | "white" | "black";

const styles: Record<Variant, string> = {
  accent: "bg-neo-accent text-black dark:text-black",
  secondary: "bg-neo-secondary text-black dark:text-black",
  muted: "bg-neo-muted text-black dark:text-black",
  white: "bg-white text-black dark:bg-[#121214] dark:text-white",
  black: "bg-black text-white dark:bg-[#0c0c0e] dark:text-white",
};

export function Badge({
  variant = "secondary",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 border-black px-3 py-1 font-black text-xs uppercase tracking-widest shadow-neo-sm ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function PillBadge({
  variant = "accent",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-black px-4 py-1 font-black text-xs uppercase tracking-widest shadow-neo-sm ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
