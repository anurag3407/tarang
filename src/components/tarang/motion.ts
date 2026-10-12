"use client";

import { useEffect, useRef, type RefObject } from "react";
import type Lenis from "lenis";

/**
 * One requestAnimationFrame loop shared by every animated section on the
 * landing page. Scenes subscribe only while they are near the viewport, so
 * the page never runs more work than what is on screen.
 */

type Frame = (time: number) => void;

const subscribers = new Set<Frame>();
let raf = 0;
let lastY = 0;
let velocity = 0;

function loop(time: number) {
  raf = requestAnimationFrame(loop);
  const y = window.scrollY;
  velocity += (y - lastY - velocity) * 0.18;
  lastY = y;
  subscribers.forEach((fn) => fn(time));
}

export function onFrame(fn: Frame) {
  subscribers.add(fn);
  if (!raf) {
    lastY = window.scrollY;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Smoothed scroll velocity in px/frame — positive when scrolling down. */
export function scrollVelocity() {
  return velocity;
}

export const clamp = (v: number, min = 0, max = 1) => Math.min(Math.max(v, min), max);

/** Maps `v` from [a, b] onto [0, 1], clamped. */
export const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(a: number, b: number, v: number) {
  const t = range(v, a, b);
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** 0 when a tall section's top meets the viewport top, 1 when its bottom meets the viewport bottom. */
export function pinnedProgress(el: Element) {
  const r = el.getBoundingClientRect();
  const span = r.height - window.innerHeight;
  return span > 0 ? clamp(-r.top / span) : 0;
}

/** 0 when the element's top enters the bottom of the viewport, 1 when its bottom leaves the top. */
export function passProgress(el: Element) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return clamp((vh - r.top) / (vh + r.height));
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs `render` every frame while `ref` is within `margin` of the viewport.
 * `render` is read through a ref, so it may close over fresh props.
 */
export function useScene(
  ref: RefObject<Element | null>,
  render: (time: number, el: Element) => void,
  margin = "25% 0px"
) {
  const fn = useRef(render);
  useEffect(() => {
    fn.current = render;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !stop) {
          stop = onFrame((t) => fn.current(t, el));
        } else if (!entry.isIntersecting && stop) {
          stop();
          stop = null;
        }
      },
      { rootMargin: margin }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [ref, margin]);
}

/* ------------------------------------------------------------------ */
/* Intro handshake — the preloader holds the hero’s entrance           */
/* ------------------------------------------------------------------ */

let introDone = false;
const introWaiters = new Set<() => void>();

export function finishIntro() {
  if (introDone) return;
  introDone = true;
  introWaiters.forEach((fn) => fn());
  introWaiters.clear();
}

/** Calls `fn` once the preloader has lifted (immediately if it already has). */
export function whenIntroDone(fn: () => void) {
  if (introDone) {
    fn();
    return () => {};
  }
  introWaiters.add(fn);
  return () => introWaiters.delete(fn);
}

/* ------------------------------------------------------------------ */
/* Smooth-scroll handle, so the preloader can hold the page still      */
/* ------------------------------------------------------------------ */

let lenis: Lenis | null = null;
export const setLenis = (l: Lenis | null) => {
  lenis = l;
};
export const getLenis = () => lenis;
