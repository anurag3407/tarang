"use client";

import { useEffect, useRef } from "react";
import { onFrame } from "./motion";

/** Trailing keyline ring. Grows over anything clickable. CSS hides it on touch. */
export default function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).display === "none") return;
    let x = -100;
    let y = -100;
    let tx = -100;
    let ty = -100;

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      el.dataset.hidden = "false";
      const target = e.target instanceof Element ? e.target.closest("a, button, [data-cursor]") : null;
      el.dataset.hover = String(Boolean(target));
    };
    const leave = () => {
      el.dataset.hidden = "true";
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    const stop = onFrame(() => {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
    return () => {
      stop();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={ref} className="t-cursor" data-hidden="true" aria-hidden>
      <span />
    </div>
  );
}
