/**
 * TARANG 2026 — centralized content layer.
 *
 * Everything the UI renders lives here. When the backend is ready,
 * replace these exports with fetch calls — the shapes are already
 * API-friendly (stable ids, flat objects, serializable).
 */

/* ------------------------------------------------------------------ */
/* Fest meta                                                           */
/* ------------------------------------------------------------------ */

export const FEST = {
  name: "TARANG",
  short: "Tarang ’26",
  year: "2026",
  edition: "Edition ’26",
  college: "NIT Patna",
  collegeShort: "NIT Patna",
  collegeFull: "National Institute of Technology Patna",
  tagline: "Mute the mundane.",
  dates: "21 – 22 November 2026",
  datesShort: "21–22 NOV '26",
  /** Printed on the Pronite Pass, set in Noot. */
  ticketDate: "21—22.11",
  ticketDateShort: "21-22/11/26",
  proniteTime: "7 PM",
  days: 2,
  venue: "NIT Patna, Ashok Rajpath, Mahendru, Patna, Bihar – 800005",
  venueShort: "NIT Patna · Ashok Rajpath · Patna",
  /** Map pin for the campus (Wikipedia: 25°36′38″N 85°08′30″E). */
  geo: { lat: 25.61056, lng: 85.14167 },
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=National+Institute+of+Technology+Patna",
  /**
   * Official contact channels. Left empty until the organising committee
   * confirms them — every place that shows contact details hides itself
   * while these are blank.
   */
  instagram: "" as string,
  email: "" as string,
  phone: "" as string,
  phones: [] as string[],
  stats: [
    { value: "2", label: "Days" },
    { value: "2", label: "Pronites" },
    { value: "8", label: "Arenas" },
    { value: "1886", label: "NIT Patna roots" },
  ],
} as const;

/** True once the committee has published at least one contact channel. */
export const HAS_CONTACT = Boolean(FEST.email || FEST.phone || FEST.phones.length);

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export type CategoryId =
  | "music"
  | "dance"
  | "drama"
  | "arts"
  | "literary"
  | "sports"
  | "medsci"
  | "informal";

export type Category = {
  id: CategoryId;
  name: string;
  tagline: string;
  icon: string;
  color: "accent" | "secondary" | "muted" | "white";
};

export const CATEGORIES: Category[] = [
  {
    id: "music",
    name: "Music",
    tagline: "Bands, vocals, acoustics & beats",
    icon: "music",
    color: "accent",
  },
  {
    id: "dance",
    name: "Dance",
    tagline: "Solo, duet, street & crew battles",
    icon: "activity",
    color: "secondary",
  },
  {
    id: "drama",
    name: "Dramatics",
    tagline: "Stage plays, street theatre & workshops",
    icon: "film",
    color: "muted",
  },
  {
    id: "arts",
    name: "Fine Arts",
    tagline: "Painting, sketching, digital art & crafts",
    icon: "palette",
    color: "white",
  },
  {
    id: "literary",
    name: "Literary",
    tagline: "Debate, quiz, poetry & creative writing",
    icon: "book-open",
    color: "accent",
  },
  {
    id: "sports",
    name: "Sports",
    tagline: "Cricket, football, badminton, athletics & gaming",
    icon: "trophy",
    color: "secondary",
  },
  {
    id: "medsci",
    name: "Tech & Quiz",
    tagline: "Quizzing, robotics, hackathons & tech showcases",
    icon: "cross",
    color: "muted",
  },
  {
    id: "informal",
    name: "Informals",
    tagline: "Fun games, scavenger hunts & casual contests",
    icon: "sparkles",
    color: "white",
  },
];

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type FestEvent = {
  id: string;
  name: string;
  category: CategoryId;
  description: string;
  day: number; // 1–5
  date: string;
  time: string;
  venue: string;
  entryFee: number; // 0 = free
  prizePool: string;
  teamSize: string;
  featured?: boolean;
  imageUrl?: string;
};

export const EVENTS: FestEvent[] = [];

/* ------------------------------------------------------------------ */
/* Pro shows (night events)                                            */
/* ------------------------------------------------------------------ */

export type ProShow = {
  id: string;
  day: number;
  date: string;
  title: string;
  artist: string;
  genre: string;
  time: string;
  venue: string;
  entry: string;
  description: string;
  color: "accent" | "secondary" | "muted" | "white";
};

export const PRO_SHOWS: ProShow[] = [];

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export type ScheduleItem = {
  time: string;
  title: string;
  venue: string;
  category: CategoryId | "proshow" | "ceremony";
  night?: boolean; // pro shows / night events — highlighted in UI
};

export type DaySchedule = {
  day: number;
  date: string;
  weekday: string;
  theme: string;
  items: ScheduleItem[];
};

export const SCHEDULE: DaySchedule[] = [];

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

export type Notice = {
  id: string;
  date: string;
  tag: "URGENT" | "UPDATE" | "INFO" | "REGISTRATION";
  title: string;
  body: string;
};

export const NOTICES: Notice[] = [];

/* ------------------------------------------------------------------ */
/* Team & Chief Coordinators                                           */
/* ------------------------------------------------------------------ */

/** Profile links shown under a portrait. The first one present also wraps the photo. */
export type SocialLinks = {
  linkedin?: string;
  instagram?: string;
  github?: string;
  website?: string;
};

/** Backdrop behind a portrait cut-out. */
export type PortraitTone = "blood" | "crimson" | "ink" | "bone";

export type TeamMember = {
  name: string;
  role: string;
  dept?: string;
  phone?: string;
  rawPhone?: string;
  initials: string;
  color: "accent" | "secondary" | "muted" | "white";
  isChief?: boolean;
  /**
   * Background-removed portrait (transparent PNG/WebP, roughly 4:5, subject
   * cropped at the chest) under /public/team, e.g. "/team/jane-doe.webp".
   * Without one the card shows the member's initials.
   */
  image?: string;
  socials?: SocialLinks;
};

export type TeamGroup = {
  id: string;
  name: string;
  blurb: string;
  members: TeamMember[];
};

/**
 * The organising committee. Empty until the NIT Patna team is announced —
 * the team page shows a “revealing soon” state while this is empty.
 */
export const TEAM: TeamGroup[] = [];

export type TechMember = {
  name: string;
  role: string;
  initials: string;
  tone: PortraitTone;
  bio?: string;
  /** Same format as TeamMember.image — a background-removed portrait under /public/team. */
  image?: string;
  socials: SocialLinks;
};

/** The developers behind the platform, shown on /tech-team. */
export const TECH_TEAM: TechMember[] = [
  {
    name: "Anurag Mishra",
    role: "Developer · Tech Geek",
    initials: "AM",
    tone: "blood",
    bio: "Building systems, platforms, and high-performance digital experiences.",
    socials: {
      linkedin: "https://www.linkedin.com/in/anurag3407",
      instagram: "https://www.instagram.com/anuragmishraxo",
    },
  },
  {
    name: "Mohnish Pamnani",
    role: "Developer · Tech Geek",
    initials: "MP",
    tone: "crimson",
    bio: "Crafting interfaces, logic, and web experiences.",
    socials: {
      linkedin: "https://www.linkedin.com/in/mohnish-pamnani-595a81284",
    },
  },
];

/* ------------------------------------------------------------------ */
/* FAQs                                                                */
/* ------------------------------------------------------------------ */

export type Faq = {
  q: string;
  a: string;
  category: "Registration" | "Passes & Entry" | "Events" | "Logistics";
};

export const FAQS: Faq[] = [
  {
    category: "Passes & Entry",
    q: "What pass do I need?",
    a: "Just one — the TARANG Pronite Pass. It gets you into every pronite (the headline night shows), opens campus access for the festival days, and lets you register for competitions.",
  },
  {
    category: "Registration",
    q: "How do I register for events?",
    a: "Get your Pronite Pass first, then register for individual or team events from the Events page. For team events, one captain registers the whole squad.",
  },
  {
    category: "Registration",
    q: "Can students from other colleges participate?",
    a: "Yes. TARANG is open to students of all colleges for cultural, literary, sports and informal events. Carry a valid college ID to the venue.",
  },
  {
    category: "Passes & Entry",
    q: "How do I get in on the night?",
    a: "Your Pronite Pass lives in your dashboard as a gate QR. Keep it ready on your phone along with a valid photo ID; volunteers scan it at the gate.",
  },
  {
    category: "Logistics",
    q: "Where is TARANG held?",
    a: "At NIT Patna on Ashok Rajpath, Mahendru — on the south bank of the Ganga, behind Gandhi Ghat. The How to Reach page has routes from Patna Junction and the airport.",
  },
];

/* ------------------------------------------------------------------ */
/* Gallery                                                             */
/* ------------------------------------------------------------------ */

export type GalleryItem = {
  id: string;
  title: string;
  category: string;
  color: "accent" | "secondary" | "muted" | "white";
  pattern: "halftone" | "grid" | "dots";
  tall?: boolean;
};

export const GALLERY: GalleryItem[] = [
  { id: "g1", title: "Battle of Bands — finals", category: "Music", color: "accent", pattern: "halftone", tall: true },
  { id: "g2", title: "Street Dance battle, main stage", category: "Dance", color: "secondary", pattern: "grid" },
  { id: "g3", title: "Nukkad natak on the lawns", category: "Dramatics", color: "muted", pattern: "dots" },
  { id: "g4", title: "Prime Night under the lights", category: "Pro Shows", color: "white", pattern: "halftone" },
  { id: "g5", title: "Flash mob — cafeteria takeover", category: "Informal", color: "secondary", pattern: "dots", tall: true },
  { id: "g6", title: "Quiz finals on the big stage", category: "Tech & Quiz", color: "muted", pattern: "grid" },
  { id: "g7", title: "Box cricket on the main ground", category: "Sports", color: "accent", pattern: "grid" },
  { id: "g8", title: "Fine arts gallery walk", category: "Fine Arts", color: "white", pattern: "dots" },
  { id: "g9", title: "Sufi & Classical showcase", category: "Pro Shows", color: "secondary", pattern: "halftone" },
  { id: "g10", title: "Cupid Waltz & Informals", category: "Informal", color: "accent", pattern: "dots" },
  { id: "g11", title: "Literary Nighter & Slam Poetry", category: "Literary", color: "muted", pattern: "halftone", tall: true },
  { id: "g12", title: "Star Night grand finale", category: "Pro Shows", color: "white", pattern: "grid" },
];

/* ------------------------------------------------------------------ */
/* How to reach                                                        */
/* ------------------------------------------------------------------ */

export type RouteOption = {
  id: string;
  mode: "metro" | "bus" | "train" | "flight" | "cab";
  title: string;
  lineOrHub?: string;
  badgeColor?: string;
  summary: string;
  gateExit?: string;
  destination?: string;
  steps: string[];
  tip: string;
};

export const ROUTES: RouteOption[] = [
  {
    id: "train",
    mode: "train",
    title: "By Train",
    lineOrHub: "Patna Junction (PNBE)",
    summary: "Patna Junction is about 8 km from campus — the most common way into the city.",
    gateExit: "Arrive at Patna Junction, then head east along Ashok Rajpath.",
    steps: [
      "Arrive at Patna Junction (PNBE).",
      "Take an app cab, auto or e-rickshaw towards Ashok Rajpath, Mahendru.",
      "Ask for “NIT Patna” — the campus sits on Ashok Rajpath, behind Gandhi Ghat.",
    ],
    tip: "Prepaid autos and app cabs are available outside the station round the clock.",
  },
  {
    id: "flight",
    mode: "flight",
    title: "By Air",
    lineOrHub: "Patna Airport (PAT)",
    summary: "Jay Prakash Narayan International Airport is about 20 km from campus.",
    gateExit: "Jay Prakash Narayan International Airport, Patna.",
    steps: [
      "Land at Jay Prakash Narayan International Airport (PAT).",
      "Book an app cab or prepaid taxi to “NIT Patna, Ashok Rajpath”.",
      "Allow extra time in the evening — Ashok Rajpath gets busy during peak hours.",
    ],
    tip: "Share your cab from the airport with friends heading to TARANG — it is the quickest door-to-door option.",
  },
  {
    id: "cab",
    mode: "cab",
    title: "By Cab / Auto",
    lineOrHub: "Drop at main gate",
    destination: FEST.venue,
    summary: "Set your map to NIT Patna and get dropped right at the main gate on Ashok Rajpath.",
    gateExit: "Drop-off at the NIT Patna main gate, Ashok Rajpath.",
    steps: [
      `Set your navigation destination to: ${FEST.venue}.`,
      "Autos and e-rickshaws run along Ashok Rajpath all day.",
      "Parking on campus is limited during the fest — drop-and-go is easiest.",
    ],
    tip: "Coming in a group? Pin the main gate as your meeting point before you set off.",
  },
  {
    id: "bus",
    mode: "bus",
    title: "By Bus",
    lineOrHub: "Patna bus terminals",
    summary: "Inter-city buses arrive at Patna’s bus terminals; finish the trip by cab or auto.",
    gateExit: "Any Patna bus terminal, then local transport to Ashok Rajpath.",
    steps: [
      "Arrive at your Patna bus terminal.",
      "Take an app cab or auto to “NIT Patna, Ashok Rajpath”.",
      "Follow the TARANG signboards from the main gate to the festival grounds.",
    ],
    tip: "Check the Notices page on the day for any traffic or gate advisories.",
  },
];

export const LANDMARKS = [
  "Gandhi Ghat, on the Ganga — right behind campus",
  "Ashok Rajpath — the campus frontage road",
  "Patna Junction — about 8 km",
  "Jay Prakash Narayan International Airport — about 20 km",
];

/* ------------------------------------------------------------------ */
/* Sponsors & Partners                                                */
/* ------------------------------------------------------------------ */

export type SponsorTier =
  | "Title Sponsor"
  | "Co-Powered By"
  | "Associate Partner"
  | "Beverage Partner"
  | "Audio & Stage Partner"
  | "Media & Outreach Partner";

export type Sponsor = {
  name: string;
  category: SponsorTier;
  tagline: string;
  logoUrl?: string;
  website?: string;
  color: "accent" | "secondary" | "muted" | "white";
};

export const SPONSORS: Sponsor[] = [];
