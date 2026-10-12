/**
 * Domain types — admin catalog inputs (plan §11.6).
 *
 * Admin forms submit rupees; the server converts to validated integer paise
 * and remains the owner of the conversion. Structural fields become immutable
 * after the first hold (enforced in the admin mutation DB function).
 */

export type EventAdminInput = {
  name: string;
  slug: string;
  categoryId: string;
  venueId: string | null;
  shortDescription: string;
  description: string;
  rulesMarkdown: string | null;
  startsAt: string;
  endsAt: string;
  isNightEvent: boolean;
  includeInSchedule: boolean;
  registrationMode: "INDIVIDUAL" | "TEAM";
  capacityBasis: "TEAM" | "PARTICIPANT";
  priceBasis: "REGISTRATION" | "PARTICIPANT";
  minTeamSize: number;
  maxTeamSize: number;
  capacityUnits: number;
  priceRupees: number;
  prizePoolText: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  featured: boolean;
  version: number;
};

export type ScheduleAdminInput = {
  linkedEventId: string | null;
  title: string | null;
  venueId: string | null;
  startsAt: string;
  endsAt: string;
  categoryKey: string;
  isNight: boolean;
  dayTheme: string | null;
  version: number;
};

export type NoticeAdminInput = {
  slug: string;
  tag: "URGENT" | "UPDATE" | "INFO" | "REGISTRATION";
  title: string;
  bodyMarkdown: string;
  publishAt: string;
  expiresAt: string | null;
  pinned: boolean;
  version: number;
};
