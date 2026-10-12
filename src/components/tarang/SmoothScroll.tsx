"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { setLenis } from "./motion";

/** Inertial scrolling for the landing page only; torn down on navigation. */
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, anchors: { offset: -40 } });
    setLenis(lenis);
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      setLenis(null);
      lenis.destroy();
    };
  }, []);
  return null;
}
