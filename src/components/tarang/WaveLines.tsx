"use client";

import { useEffect, useRef } from "react";

/** Layered sine waves drawn on a 2D canvas — the visual motif of “tarang”. */
export default function WaveLines({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    const LINES = 26;
    let raf = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible && !still) return;
      const time = still ? 0 : t * 0.00025;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < LINES; i++) {
        const k = i / (LINES - 1);
        const amp = h * (0.05 + 0.16 * Math.sin(k * Math.PI));
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const u = x / w;
          const env = Math.sin(u * Math.PI); // taper at both edges
          const y =
            h / 2 +
            env *
              amp *
              (Math.sin(u * 9 + time * 3 + k * 2.2) * 0.6 + Math.sin(u * 4.3 - time * 2 + k * 5) * 0.4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const brass = i % 6 === 0;
        ctx.strokeStyle = brass ? `rgba(201,164,106,${0.55})` : `rgba(238,232,221,${0.05 + 0.12 * Math.sin(k * Math.PI)})`;
        ctx.lineWidth = brass ? 1.1 : 0.8;
        ctx.stroke();
      }
      if (still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
