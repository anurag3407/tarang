import Image from "next/image";
import type { ReactNode } from "react";

/** Poster field behind sign-in style forms: the hands frame the card from above and below. */
export function AuthStage({ children }: { children: ReactNode }) {
  return (
    <section className="t-halftone relative isolate overflow-hidden">
      <div aria-hidden className="kit-hands pointer-events-none absolute -top-[4%] left-1/2 w-[min(120vw,900px)] -translate-x-1/2 opacity-80">
        <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} loading="eager" sizes="900px" className="h-auto w-full" />
      </div>
      <div aria-hidden className="pointer-events-none absolute -bottom-[6%] left-1/2 w-[min(120vw,900px)] -translate-x-1/2 opacity-80">
        <Image src="/tarang/hands-bottom.webp" alt="" width={1402} height={848} sizes="900px" className="h-auto w-full" />
      </div>
      <div className="relative py-10 md:py-16">{children}</div>
    </section>
  );
}
