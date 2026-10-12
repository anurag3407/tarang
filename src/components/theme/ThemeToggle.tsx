"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
  /** Minimal outline style for the dark Tarang navbar. */
  variant?: "neo" | "studio";
}

export default function ThemeToggle({
  showLabel = false,
  className = "",
  variant = "neo",
}: ThemeToggleProps) {
  const { toggleTheme } = useTheme();

  if (variant === "studio") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle dark and light mode"
        title="Toggle dark/light mode"
        className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-current/20 text-current opacity-70 transition-opacity hover:opacity-100 ${className}`}
      >
        <Sun className="hidden h-4 w-4 dark:block" strokeWidth={1.5} aria-hidden="true" />
        <Moon className="block h-4 w-4 dark:hidden" strokeWidth={1.5} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle dark and light mode"
      title="Toggle dark/light mode"
      className={`group relative flex items-center justify-center border-2 border-black dark:border-white transition-all duration-100 cursor-pointer select-none bg-neo-secondary dark:bg-[#18181b] text-black dark:text-neo-secondary shadow-neo-xs dark:shadow-[2px_2px_0px_0px_#ffffff] hover:bg-neo-accent dark:hover:bg-neo-secondary dark:hover:text-black dark:hover:border-black hover:shadow-neo-sm hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
        showLabel ? "px-3 py-2" : "p-1.5"
      } ${className}`}
    >
      <div className="relative flex h-5 w-5 items-center justify-center">
        {/* Sun Icon — displayed via CSS only in dark mode */}
        <Sun
          className="hidden dark:block h-5 w-5 fill-neo-secondary stroke-neo-secondary dark:group-hover:fill-black dark:group-hover:stroke-black transition-transform duration-200 group-hover:rotate-45"
          strokeWidth={2}
          aria-hidden="true"
        />
        {/* Moon Icon — displayed via CSS in light mode */}
        <Moon
          className="block dark:hidden h-5 w-5 fill-black stroke-black transition-transform duration-200 group-hover:-rotate-12"
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>

      {showLabel && (
        <span className="ml-2 text-xs font-black uppercase tracking-wider text-black dark:text-white dark:group-hover:text-black">
          <span className="hidden dark:inline">Light Mode</span>
          <span className="inline dark:hidden">Dark Mode</span>
        </span>
      )}
    </button>
  );
}
