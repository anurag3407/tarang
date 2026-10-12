"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FEST } from "@/lib/data";
import { createClient } from "@/lib/supabase/browser";
import type { User } from "@supabase/supabase-js";

const PRIMARY_LINKS = [
  { href: "/events", label: "Events" },
  { href: "/schedule", label: "Schedule" },
  { href: "/#lineup", label: "Lineup" },
  { href: "/pronite-pass", label: "Pass" },
  { href: "/merchandise", label: "Merch" },
  { href: "/about", label: "About" },
];

const MORE_LINKS = [
  { href: "/pronite-pass", label: "Pronite Pass" },
  { href: "/sponsors", label: "Sponsors & Partners" },
  { href: "/gallery", label: "Gallery" },
  { href: "/notices", label: "Notices & Updates" },
  { href: "/team", label: "Organizing Team" },
  { href: "/reach", label: "How to Reach" },
  { href: "/faqs", label: "FAQs" },
  { href: "/ask", label: "Ask a Question" },
  { href: "/campus-ambassador", label: "Campus Ambassador" },
];

function Wordmark() {
  return (
    <span aria-label={FEST.short} className="t-display t-cut text-[1.75rem] leading-none md:text-[2rem]">
      Tarang
    </span>
  );
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isHome = pathname === "/";

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Close menus on route change
  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Lock page scroll behind the full-screen mobile menu
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        setUser(data.user ?? null);
      });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      return () => subscription.unsubscribe();
    } catch {
      // Supabase is unconfigured or static fallback
    }
  }, []);

  const solid = !isHome || scrolled || open;

  return (
    <header
      className={`${isHome ? "fixed" : "sticky"} inset-x-0 top-0 z-50 font-[family-name:var(--font-body)] font-normal text-bone transition-[background-color,border-color,backdrop-filter] duration-500 ${
        !isHome
          ? "border-b border-bone/10 bg-ink"
          : solid
          ? "border-b border-bone/10 bg-ink/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-6 px-6 md:h-[4.5rem] md:px-12">
        <Link href="/" aria-label={`${FEST.short} — home`} onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Main">
          {PRIMARY_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`t-label t-link transition-colors duration-300 ${active ? "text-bone" : "text-bone/60 hover:text-bone"}`}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
              className={`t-label flex cursor-pointer items-center gap-1.5 transition-colors duration-300 ${moreOpen ? "text-bone" : "text-bone/60 hover:text-bone"}`}
            >
              More
              <span className={`inline-block transition-transform duration-300 ${moreOpen ? "rotate-45" : ""}`}>+</span>
            </button>

            <div
              className={`absolute right-0 top-full mt-5 w-64 origin-top-right rounded-[10px] border border-bone/10 bg-ink-2/95 p-2 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
                moreOpen ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"
              }`}
            >
              {MORE_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`block rounded-md px-3 py-2.5 text-sm transition-colors ${
                    pathname === item.href ? "bg-bone/10 text-bone" : "text-bone/70 hover:bg-bone/5 hover:text-bone"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          {user ? (
            <Link href="/dashboard" className="t-label t-link text-bone/70 hover:text-bone">
              Dashboard
            </Link>
          ) : (
            <Link href="/login" className="t-label t-link text-bone/70 hover:text-bone">
              Sign in
            </Link>
          )}
          <Link href={isHome ? "#passes" : "/pronite-pass"} className="t-btn t-btn-solid !py-2.5 !px-5">
            Get passes
          </Link>
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          className="t-label flex cursor-pointer items-center gap-3 text-bone lg:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
          <span className="relative block h-2.5 w-6">
            <span className={`absolute left-0 h-px w-full bg-current transition-transform duration-500 ${open ? "top-1/2 rotate-45" : "top-0"}`} />
            <span className={`absolute left-0 h-px w-full bg-current transition-transform duration-500 ${open ? "top-1/2 -rotate-45" : "bottom-0"}`} />
          </span>
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={`fixed inset-x-0 bottom-0 top-16 overflow-y-auto bg-ink px-6 pb-10 pt-6 transition-[opacity,visibility] duration-500 lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <nav aria-label="Mobile" className="flex flex-col">
          {[{ href: "/", label: "Home" }, ...PRIMARY_LINKS].map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="t-display flex items-baseline justify-between border-b border-bone/10 py-4 text-[2.6rem] leading-none transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                transform: open ? "none" : "translateY(24px)",
                opacity: open ? 1 : 0,
                transitionDelay: open ? `${80 + i * 50}ms` : "0ms",
              }}
            >
              {link.label}
              <span className="t-label text-bone/35">0{i + 1}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-3">
          {MORE_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="text-sm text-bone/60">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <Link href="/pronite-pass" onClick={() => setOpen(false)} className="t-btn t-btn-solid justify-between">
            Get passes <span>→</span>
          </Link>
          {user ? (
            <div className="grid grid-cols-2 gap-3">
              <Link href="/dashboard" onClick={() => setOpen(false)} className="t-btn t-btn-ghost justify-center">
                Dashboard
              </Link>
              <button
                type="button"
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  window.location.reload();
                }}
                className="t-btn t-btn-ghost cursor-pointer justify-center"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/login" onClick={() => setOpen(false)} className="t-btn t-btn-ghost justify-center">
              Register / Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
