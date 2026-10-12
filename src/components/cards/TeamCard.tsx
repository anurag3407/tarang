"use client";

import { useState } from "react";
import { Phone, MessageSquare, Copy, Check } from "lucide-react";
import type { TeamMember } from "@/lib/data";

const COLOR_BG: Record<TeamMember["color"], string> = {
  accent: "bg-neo-accent",
  secondary: "bg-neo-secondary",
  muted: "bg-neo-muted",
  white: "bg-white",
};

export function TeamCard({ member }: { member: TeamMember }) {
  const [copied, setCopied] = useState(false);

  function copyPhone() {
    if (!member.phone) return;
    navigator.clipboard.writeText(member.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const rawDigits = member.rawPhone || member.phone?.replace(/[^0-9]/g, "") || "";
  const waNumber = rawDigits.startsWith("91") ? rawDigits : `91${rawDigits}`;

  return (
    <article className="kit-rise group relative flex flex-col justify-between border-4 border-black bg-white dark:bg-neo-card text-black dark:text-white p-6 shadow-neo transition-all duration-200 hover:-translate-y-2 hover:shadow-neo-lg">
      <div>
        {/* Avatar & Chief Pin */}
        <div className="flex items-center justify-between">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full border-4 border-black text-2xl font-black shadow-neo-sm ${COLOR_BG[member.color]} text-black`}
            aria-hidden
          >
            {member.initials}
          </div>
          {member.isChief && (
            <span className="border-2 border-black bg-neo-accent px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-black shadow-neo-xs">
              Chief Core
            </span>
          )}
        </div>

        {/* Member Details */}
        <div className="mt-4">
          <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-black dark:text-white">
            {member.name}
          </h3>
          <p className="mt-1.5 inline-block border-2 border-black bg-neo-secondary px-2 py-0.5 text-xs font-black uppercase tracking-widest text-black shadow-neo-xs">
            {member.role}
          </p>
          {member.dept && (
            <p className="mt-2 text-xs font-bold text-black/70 dark:text-zinc-400">{member.dept}</p>
          )}
        </div>
      </div>

      {/* Contact Section */}
      {member.phone && (
        <div className="mt-6 border-t-2 border-black/15 dark:border-white/10 pt-4">
          <div className="flex items-center justify-between text-xs font-black text-black dark:text-white">
            <span className="font-mono">{member.phone}</span>
            <button
              type="button"
              onClick={copyPhone}
              title="Copy Phone Number"
              className="border border-black bg-neo-cream dark:bg-neo-surface p-1 text-black dark:text-white hover:bg-neo-secondary dark:hover:bg-neo-secondary dark:hover:text-black transition-colors"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" strokeWidth={3} />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`tel:${member.phone.replace(/\s+/g, "")}`}
              className="flex items-center justify-center gap-1.5 border-2 border-black bg-black py-1.5 px-2 text-[11px] font-black uppercase tracking-wider text-white shadow-neo-xs hover:bg-zinc-800 transition-colors"
            >
              <Phone className="h-3 w-3" />
              <span>Call</span>
            </a>
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 border-2 border-black bg-[#17784a] py-1.5 px-2 text-[11px] font-black uppercase tracking-wider text-black shadow-neo-xs hover:bg-[#1d8f58] transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              <span>Chat</span>
            </a>
          </div>
        </div>
      )}
    </article>
  );
}

