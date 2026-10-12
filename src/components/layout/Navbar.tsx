"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { FEST } from "@/lib/data";
import { createClient } from "@/lib/supabase/browser";
import type { User } from "@supabase/supabase-js";
import ThemeToggle from "@/components/theme/ThemeToggle";

const PRIMARY_LINKS = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Events" },
  { href: "/schedule", label: "Schedule" },
  { href: "/merchandise", label: "Merch" },
  { href: "/basic-card", label: "BR Card" },
  { href: "/delegate-card", label: "Delegate Card" },
  { href: "/about", label: "About" },
];

const MORE_LINKS = [
  { href: "/merchandise", label: "Merchandise Store", tag: "Official" },
  // { href: "/map", label: "Campus Venue Map", tag: "Interactive" },
  { href: "/sponsors", label: "Sponsors & Partners", tag: "Featured" },
  { href: "/gallery", label: "Gallery" },
  { href: "/notices", label: "Notices & Updates" },
  { href: "/team", label: "Organizing Team" },
  { href: "/reach", label: "How to Reach" },
  { href: "/faqs", label: "FAQs" },
  { href: "/ask", label: "Ask a Question" },
  { href: "/campus-ambassador", label: "Campus Ambassador", tag: "Join" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isMoreActive = MORE_LINKS.some((l) => pathname === l.href);

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

  return (
    <header className="sticky top-0 z-50 border-b-4 border-black bg-neo-cream">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 border-4 border-black bg-neo-accent px-2.5 py-1.5 shadow-neo-sm transition-all duration-100 hover:-translate-y-0.5 hover:shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          onClick={() => {
            setOpen(false);
            setMoreOpen(false);
          }}
        >
          <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded border-2 border-black bg-white p-0.5 shadow-[2px_2px_0px_0px_#000]">
            <Image
              src="/pulse-logo.png"
              alt="PULSE 2026 Logo"
              width={32}
              height={32}
              unoptimized
              className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-110"
              priority
            />
          </div>
          <span className="text-xl font-black uppercase tracking-tighter text-black">
            {FEST.name}
            <span className="text-sm align-super font-black">’{FEST.year.slice(2)}</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1.5 lg:flex" aria-label="Main">
          {PRIMARY_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`border-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-all duration-100 ${
                  active
                    ? "border-black bg-neo-secondary shadow-neo-sm text-black"
                    : "border-transparent hover:border-black hover:bg-neo-accent hover:text-black hover:shadow-neo-sm text-black dark:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          {/* More Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
              className={`flex items-center gap-1 border-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-all duration-100 cursor-pointer ${
                moreOpen || isMoreActive
                  ? "border-black bg-neo-accent text-black shadow-neo-sm"
                  : "border-transparent hover:border-black hover:bg-neo-accent hover:text-black hover:shadow-neo-sm text-black dark:text-white"
              }`}
            >
              <span>More</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-150 ${
                  moreOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {moreOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 border-4 border-black bg-white p-2 shadow-neo-md z-50">
                <div className="space-y-1">
                  {MORE_LINKS.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        className={`flex items-center justify-between border-2 px-3 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                          active
                            ? "border-black bg-neo-secondary text-black shadow-neo-xs"
                            : "border-transparent hover:border-black hover:bg-neo-cream"
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.tag && (
                          <span className="border border-black bg-neo-accent px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                            {item.tag}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Theme Toggle Button */}
          <div className="ml-1">
            <ThemeToggle />
          </div>

          {/* User Auth / Dashboard CTA */}
          {user ? (
            <Link
              href="/dashboard"
              className="ml-2 border-4 border-black bg-neo-secondary px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-black shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              My Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="ml-2 border-4 border-black bg-black px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-white shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Register / Sign In
            </Link>
          )}
        </nav>

        {/* Mobile items: Theme Toggle + Menu Button */}
        <div className="flex items-center gap-2 lg:hidden">
          {user ? (
            <button
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                window.location.reload();
              }}
              className="flex items-center justify-center border-[3px] border-black bg-neo-accent px-2 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wide text-black shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
            >
              Sign Out
            </button>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-center border-[3px] border-black bg-black px-2 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wide text-white shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
            >
              Sign In
            </Link>
          )}
          <ThemeToggle />
          <button
            type="button"
            className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center border-[3px] sm:border-4 border-black bg-neo-secondary text-black shadow-neo-sm transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <X className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={3} />
            ) : (
              <Menu className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={3} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <nav
          className="max-h-[85vh] overflow-y-auto border-t-4 border-black bg-neo-cream px-4 pb-8 pt-4 lg:hidden"
          aria-label="Mobile"
        >
          {/* Main Links */}
          <div className="grid grid-cols-2 gap-2.5">
            {PRIMARY_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`border-4 border-black px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider shadow-neo-xs transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                    active ? "bg-neo-secondary text-black" : "bg-white text-black dark:bg-[#121214] dark:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* More Links Section */}
          <div className="mt-5 border-t-2 border-black/30 pt-4">
            <p className="mb-2.5 text-[11px] font-black uppercase tracking-widest opacity-60">
              More Festival Links
            </p>
            <div className="grid grid-cols-2 gap-2">
              {MORE_LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between border-2 border-black px-2.5 py-2 text-xs font-bold uppercase tracking-tight shadow-neo-xs ${
                      active ? "bg-neo-accent text-black" : "bg-white text-black dark:bg-[#121214] dark:text-white"
                    }`}
                  >
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Action CTAs & Theme Toggle */}
          <div className="mt-5 space-y-2.5">
            <div className="flex items-center justify-between border-2 border-black bg-white dark:bg-[#121214] p-2.5 shadow-neo-xs">
              <span className="text-xs font-black uppercase tracking-wider">Appearance</span>
              <ThemeToggle showLabel />
            </div>

            {user ? (
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="block border-4 border-black bg-neo-secondary px-4 py-3 text-center text-sm font-black uppercase tracking-wide text-black shadow-neo-sm"
              >
                My Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block border-4 border-black bg-black px-4 py-3 text-center text-sm font-black uppercase tracking-wide text-white shadow-neo-sm"
              >
                Register / Sign In
              </Link>
            )}
            <Link
              href="/ask"
              onClick={() => setOpen(false)}
              className="block border-4 border-black bg-neo-accent px-4 py-2.5 text-center text-xs font-black uppercase tracking-wider text-black shadow-neo-sm"
            >
              Ask a Question / Help Desk
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
