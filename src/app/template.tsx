"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Wordmark from "@/components/tarang/Wordmark";

/** Routes that skip the transition: the landing page has its own preloader, tools stay instant. */
const BARE = [/^\/$/, /^\/admin/, /^\/scanner/];

/**
 * Remounts on every top-level navigation: a red halftone shutter carrying the
 * wordmark lifts off the screen while the new page rises in beneath it.
 */
export default function Template({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (BARE.some((r) => r.test(pathname))) return children;

  return (
    <>
      <div aria-hidden className="kit-shutter t-halftone flex items-center justify-center">
        <Wordmark eager className="w-[min(60vw,420px)]" sizes="70px" />
      </div>
      <div className="kit-page-in">{children}</div>
    </>
  );
}
