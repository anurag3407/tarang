import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "muted" | "outline" | "dark";

const styles: Record<Variant, string> = {
  primary: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  outline: "bg-white text-black dark:bg-[#121214] dark:text-white hover:bg-neo-secondary hover:text-black dark:hover:bg-neo-secondary dark:hover:text-black",
  dark: "bg-black text-white",
};

const base =
  "inline-flex items-center justify-center gap-2 border-4 border-black px-6 py-3 " +
  "font-bold text-sm uppercase tracking-wide shadow-neo-sm transition-transform duration-100 " +
  "hover:-translate-y-0.5 hover:shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2";

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
}) {
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
