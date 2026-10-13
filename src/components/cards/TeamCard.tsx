"use client";

import { useState } from "react";
import { Phone, MessageSquare, Copy, Check } from "lucide-react";
import type { PortraitTone, TeamMember } from "@/lib/data";
import { PortraitCard } from "@/components/cards/PortraitCard";

const TONE: Record<TeamMember["color"], PortraitTone> = {
  accent: "crimson",
  secondary: "blood",
  muted: "ink",
  white: "bone",
};

export function TeamCard({ member, index }: { member: TeamMember; index?: number }) {
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
    <PortraitCard
      name={member.name}
      role={member.role}
      initials={member.initials}
      tone={TONE[member.color]}
      image={member.image}
      socials={member.socials}
      index={index}
      badge={member.isChief ? "Chief Core" : undefined}
      detail={member.dept}
    >
      {member.phone && (
        <div className="mt-5 border-t border-bone/15 pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-bone/85">{member.phone}</span>
            <button
              type="button"
              onClick={copyPhone}
              title="Copy phone number"
              aria-label="Copy phone number"
              className="kit-portrait-social h-8 w-8"
            >
              {copied ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={`tel:${member.phone.replace(/\s+/g, "")}`} className="kit-portrait-action">
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
            <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer" className="kit-portrait-action">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </a>
          </div>
        </div>
      )}
    </PortraitCard>
  );
}
