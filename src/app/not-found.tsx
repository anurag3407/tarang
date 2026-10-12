import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Speaker } from "@/components/tarang/Icons";

export default function NotFound() {
  return (
    <section className="t-halftone relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden px-6 py-32 text-center">
      <div aria-hidden className="kit-hands pointer-events-none absolute -top-[10%] left-1/2 w-[min(110vw,820px)] -translate-x-1/2">
        <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} loading="eager" sizes="820px" className="h-auto w-full" />
      </div>
      <div aria-hidden className="pointer-events-none absolute -bottom-[14%] left-1/2 w-[min(110vw,820px)] -translate-x-1/2">
        <Image src="/tarang/hands-bottom.webp" alt="" width={1402} height={848} sizes="820px" className="h-auto w-full" />
      </div>

      <div className="relative">
        <p className="t-label kit-fade flex items-center justify-center gap-2 text-bone">
          <Speaker muted className="h-4 w-4" /> Signal lost
        </p>
        <h1 className="t-display t-cut mt-6 text-[clamp(7rem,26vw,20rem)] leading-[0.8]">
          <span className="kit-drop-mask">
            <span className="kit-drop">404</span>
          </span>
        </h1>
        <p className="t-display kit-fade mt-6 text-[clamp(1.4rem,3.4vw,2.4rem)] text-bone">This page is on mute.</p>
        <p className="kit-fade mx-auto mt-4 max-w-md rounded-[10px] bg-ink/70 px-4 py-3 text-bone/80">
          The link may be old, or the page hasn’t been published yet.
        </p>
        <div className="kit-fade mt-10 flex flex-wrap justify-center gap-4">
          <Link href="/" className="t-btn t-btn-ink">
            Back to the wave <span className="t-btn-arrow">→</span>
          </Link>
          <Link href="/events" className="t-btn t-btn-solid" style={{ "--t-shadow": "var(--color-ink)" } as CSSProperties}>
            Browse events
          </Link>
        </div>
      </div>
    </section>
  );
}
