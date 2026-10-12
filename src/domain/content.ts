/**
 * Domain read models — content (plan §4.3, §7.5).
 *
 * These are the serializable shapes public pages and client components
 * consume. They are derived from database rows by repositories; mutable
 * production truth lives in Postgres, not `src/lib/data.ts`.
 */

export type CategoryRead = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  iconKey: string;
  colorKey: "accent" | "secondary" | "muted" | "white";
  sortOrder: number;
};

export type VenueRead = {
  id: string;
  name: string;
  shortName: string | null;
};

export type EventAvailability = {
  capacityUnits: number;
  heldUnits: number;
  confirmedUnits: number;
  availableUnits: number;
  unitLabel: "team" | "participant";
};

export type EventRead = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  rulesMarkdown: string | null;
  category: CategoryRead;
  venue: VenueRead | null;
  startsAt: string;
  endsAt: string;
  day: number;
  dateLabel: string;
  timeLabel: string;
  isNightEvent: boolean;
  registrationMode: "INDIVIDUAL" | "TEAM";
  capacityBasis: "TEAM" | "PARTICIPANT";
  priceBasis: "REGISTRATION" | "PARTICIPANT";
  minTeamSize: number;
  maxTeamSize: number;
  teamSizeLabel: string;
  amountPaise: number;
  currency: string;
  prizePoolText: string;
  featured: boolean;
  imageUrl: string | null;
  salesState:
    | "DRAFT"
    | "SCHEDULED"
    | "OPEN"
    | "PAUSED"
    | "SOLD_OUT"
    | "CLOSED"
    | "CANCELLED";
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  availability: EventAvailability | null;
};

export type ScheduleEntryRead = {
  id: string;
  day: number;
  dateLabel: string;
  timeLabel: string;
  title: string;
  venue: string;
  categoryKey: string;
  isNight: boolean;
  linkedEventSlug: string | null;
};

export type DayScheduleRead = {
  day: number;
  dateLabel: string;
  weekday: string;
  theme: string;
  items: ScheduleEntryRead[];
};

export type NoticeRead = {
  id: string;
  slug: string;
  tag: "URGENT" | "UPDATE" | "INFO" | "REGISTRATION";
  title: string;
  bodyMarkdown: string;
  publishedAt: string;
  dateLabel: string;
  pinned: boolean;
};

export type PassProductRead = {
  id: string;
  slug: string;
  name: string;
  description: string;
  isBasePass: boolean;
  requiresBasePass: boolean;
  salesState:
    | "DRAFT"
    | "SCHEDULED"
    | "OPEN"
    | "PAUSED"
    | "SOLD_OUT"
    | "CLOSED"
    | "CANCELLED";
  validFrom: string;
  validUntil: string;
  amountPaise: number;
  currency: string;
};

export type SponsorRead = {
  id: string;
  name: string;
  category: string;
  tagline: string;
  logoUrl: string;
  websiteUrl: string | null;
  colorKey: "accent" | "secondary" | "muted" | "white";
  sortOrder: number;
  isTitle: boolean;
};

export type MerchandiseProductRead = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  detailsMarkdown: string | null;
  category: string;
  pricePaise: number;
  currency: string;
  images: string[];
  sizes: string[];
  stockUnits: number;
  availableUnits: number;
  salesState:
    | "DRAFT"
    | "SCHEDULED"
    | "OPEN"
    | "PAUSED"
    | "SOLD_OUT"
    | "CLOSED"
    | "CANCELLED";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  featured: boolean;
  sortOrder: number;
};

export type MerchandiseOrderRead = {
  id: string;
  publicOrderCode: string;
  productId: string;
  itemName: string;
  selectedSize: string;
  quantity: number;
  unitPricePaise: number;
  totalAmountPaise: number;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  deliveryMode: "PICKUP" | "DELIVERY";
  shippingAddress: Record<string, string> | null;
  state: string;
  createdAt: string;
};
