/**
 * PULSE 2026 — centralized content layer.
 *
 * Everything the UI renders lives here. When the backend is ready,
 * replace these exports with fetch calls — the shapes are already
 * API-friendly (stable ids, flat objects, serializable).
 */

/* ------------------------------------------------------------------ */
/* Fest meta                                                           */
/* ------------------------------------------------------------------ */

export const FEST = {
  name: "PULSE",
  year: "2026",
  edition: "51st Edition",
  college: "AIIMS New Delhi",
  tagline: "Feel The Beat. Live The Pulse.",
  dates: "17 – 21 September 2026",
  datesShort: "17–21 SEP '26",
  days: 5,
  venue: "AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi – 110029",
  instagram: "https://instagram.com/pulse.aiims",
  email: "studentsunion@aiims.edu",
  phone: "+91 7007162992",
  phones: [
    "+91 7007162992",
    "+91 9256529200",
    "+91 9565514854",
  ],
  stats: [
    { value: "5", label: "Days of Glory" },
    { value: "450+", label: "Institutions" },
    { value: "50+", label: "Years Legacy" },
    { value: "10K+", label: "Footfall" },
  ],
} as const;

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
    name: "Socio cultural",
    tagline: "Bands, vocals, acoustics & beats",
    icon: "music",
    color: "accent",
  },
  {
    id: "dance",
    name: "aQuSiS",
    tagline: "Solo, duet, street & crew battles",
    icon: "activity",
    color: "secondary",
  },
  {
    id: "drama",
    name: "Workshop",
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
    name: "Scientific society",
    tagline: "Clinical skills, medical quiz & case presentations",
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

export type TeamMember = {
  name: string;
  role: string;
  dept?: string;
  phone?: string;
  rawPhone?: string;
  initials: string;
  color: "accent" | "secondary" | "muted" | "white";
  isChief?: boolean;
};

export type TeamGroup = {
  id: string;
  name: string;
  blurb: string;
  members: TeamMember[];
};

export const CHIEF_COORDINATORS = [
  {
    name: "Abdul Rafey Ansari",
    shortName: "Abdul Rafey",
    phone: "+91 7007162992",
    rawPhone: "7007162992",
    role: "Chief Coordinator",
    initials: "AR",
    color: "accent" as const,
  },
  {
    name: "Abhay Mittal",
    shortName: "Abhay Mittal",
    phone: "+91 9772778706",
    rawPhone: "9772778706",
    role: "Chief Coordinator",
    initials: "AM",
    color: "secondary" as const,
  },
  {
    name: "Priyanshu Dhaka",
    shortName: "Priyanshu Dhaka",
    phone: "+91 9521547110",
    rawPhone: "9521547110",
    role: "Chief Coordinator",
    initials: "PD",
    color: "muted" as const,
  },
  {
    name: "Mohit Dahiya",
    shortName: "Mohit Dahiya",
    phone: "+91 9256529200",
    rawPhone: "9256529200",
    role: "Chief Coordinator",
    initials: "MD",
    color: "white" as const,
  },
];

export const TEAM: TeamGroup[] = [
  {
    id: "chief-coordinators",
    name: "Chief Coordinators",
    blurb: "Leading operations, festival administration, and campus execution for PULSE.",
    members: [
      {
        name: "Abdul Rafey Ansari",
        role: "Chief Coordinator",
        dept: "AIIMS New Delhi",
        phone: "+91 7007162992",
        rawPhone: "7007162992",
        initials: "AR",
        color: "accent",
        isChief: true,
      },
      {
        name: "Abhay Mittal",
        role: "Chief Coordinator",
        dept: "AIIMS New Delhi",
        phone: "+91 9772778706",
        rawPhone: "9772778706",
        initials: "AM",
        color: "secondary",
        isChief: true,
      },
      {
        name: "Priyanshu Dhaka",
        role: "Chief Coordinator",
        dept: "AIIMS New Delhi",
        phone: "+91 9521547110",
        rawPhone: "9521547110",
        initials: "PD",
        color: "muted",
        isChief: true,
      },
      {
        name: "Mohit Dahiya",
        role: "Chief Coordinator",
        dept: "AIIMS New Delhi",
        phone: "+91 9256529200",
        rawPhone: "9256529200",
        initials: "MD",
        color: "white",
        isChief: true,
      },
    ],
  },
  {
    id: "executive-council",
    name: "AIIMS Student Association (ASA) Leadership",
    blurb: "The elected executive student council of AIIMS New Delhi behind PULSE.",
    members: [
      {
        name: "Prashant Yadav",
        role: "President",
        dept: "AIIMS Student Association",
        phone: "+91 9565514854",
        rawPhone: "9565514854",
        initials: "PY",
        color: "secondary",
      },
      {
        name: "Ranit Bagchi",
        role: "Vice President",
        dept: "AIIMS Student Association",
        phone: "+91 7439460925",
        rawPhone: "7439460925",
        initials: "RB",
        color: "accent",
      },
      {
        name: "Shubhamm Bansal",
        role: "General Secretary",
        dept: "AIIMS Student Association",
        phone: "+91 9560425484",
        rawPhone: "9560425484",
        initials: "SB",
        color: "muted",
      },
      {
        name: "Jatin Saharan",
        role: "Finance Secretary",
        dept: "AIIMS Student Association",
        phone: "+91 6350048665",
        rawPhone: "6350048665",
        initials: "JS",
        color: "white",
      },
      {
        name: "Jacob Bivin",
        role: "Gymkhana Secretary",
        dept: "AIIMS Student Association",
        phone: "+91 9080207467",
        rawPhone: "9080207467",
        initials: "JB",
        color: "secondary",
      },
      {
        name: "Kushagra Maru",
        role: "Socio-Cultural Secretary",
        dept: "AIIMS Student Association",
        phone: "+91 8875190605",
        rawPhone: "8875190605",
        initials: "KM",
        color: "accent",
      },
      {
        name: "Ankita Mandal",
        role: "Literary Secretary",
        dept: "AIIMS Student Association",
        phone: "+91 8101748575",
        rawPhone: "8101748575",
        initials: "AM",
        color: "muted",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Key Venues                                                          */
/* ------------------------------------------------------------------ */

export type VenueInfo = {
  id: string;
  name: string;
  category: string;
  description: string;
  tag: string;
};

export const PULSE_VENUES: VenueInfo[] = [
  {
    id: "quadrangle",
    name: "Quadrangle Main Stage",
    category: "Pro Nights & Grand Finals",
    description: "The epic open-air epicenter of PULSE hosting prime night headliners, Star Nights, Battle of the Bands, and grand opening/closing spectacles.",
    tag: "Prime Stage",
  },
  {
    id: "jl-auditorium",
    name: "JL Auditorium",
    category: "Cultural & Theatrics",
    description: "AIIMS's iconic 1,000+ seat proscenium auditorium hosting premier stage play competitions, classical showcases, and prestigious symposiums.",
    tag: "Auditorium",
  },
  {
    id: "gymkhana",
    name: "Gymkhana Sports Complex",
    category: "Athletics & Tournaments",
    description: "Multipurpose floodlit sports arena hosting cricket, football, basketball, badminton, volleyball, and pulse-pounding collegiate face-offs.",
    tag: "Sports Arena",
  },
  {
    id: "teaching-block",
    name: "Teaching Block",
    category: "Academics & Scientific society",
    description: "Hub for cutting-edge medical quizzes, case presentations, literary debates, poetry slams, and creative arts workshops.",
    tag: "Academic Hub",
  },
  {
    id: "set-facility",
    name: "SET Facility",
    category: "Simulation & Workshops",
    description: "Skills, E-learning & Telemedicine center hosting hands-on clinical simulations, surgical workshops, and specialized tech exhibitions.",
    tag: "Clinical Center",
  },
  {
    id: "foyer",
    name: "Foyer",
    category: "Arts & Informals",
    description: "Central exhibition walkway for fine arts displays, sketch-offs, impromptu open mics, face painting, and dynamic interactive stalls.",
    tag: "Exhibition Zone",
  },
  {
    id: "squash-court",
    name: "Squash Court",
    category: "Indoor Racket Sports",
    description: "High-intensity indoor glass-back squash arena for individual knockout championships and rapid-fire racket showdowns.",
    tag: "Indoor Arena",
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
    category: "Registration",
    q: "How do I register for events?",
    a: "First, get your mandatory PULSE BR Card. Then register for individual or team events from the Events page. Team events need one captain to register the squad.",
  },
  {
    category: "Registration",
    q: "Can students from other colleges participate?",
    a: "Yes! PULSE is South Asia's largest medical college festival and is open to students of all colleges for cultural, literary, sports, and informal events. Carry a valid college ID card at the venue.",
  },
  {
    category: "Passes & Entry",
    q: "What is the difference between BR Card and Delegate Card?",
    a: "The Delegate Card gives you access to Prime Events and covers everything included with the BR Card. The BR Card is mandatory for participating in all PULSE events other than Prime Events. If taking a Delegate Card, you do not need a BR Card. If not taking a Delegate Card, you need a BR Card to participate in other events.",
  },
  {
    category: "Passes & Entry",
    q: "Where do I collect my physical cards?",
    a: "Collect your BR Card or Delegate Card from the CR Desk near the Swimming Pool, AIIMS Campus on the day of the event.",
  },
  {
    category: "Logistics",
    q: "How do I reach AIIMS New Delhi?",
    a: "AIIMS has its own metro station on the Yellow Line (Gate 1 or Gate 2). South Extension station on the Pink Line (Gate 3 or Gate 4) is also directly accessible. See the How to Reach page for cab, train, and airport routes.",
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
  { id: "g1", title: "Battle of Bands — finals", category: "Socio cultural", color: "accent", pattern: "halftone", tall: true },
  { id: "g2", title: "Street Dance battle, main stage", category: "aQuSiS", color: "secondary", pattern: "grid" },
  { id: "g3", title: "Nukkad natak at Central Lawn", category: "Workshop", color: "muted", pattern: "dots" },
  { id: "g4", title: "Prime Night under the lights", category: "Pro Shows", color: "white", pattern: "halftone" },
  { id: "g5", title: "Flash mob — cafeteria takeover", category: "Informal", color: "secondary", pattern: "dots", tall: true },
  { id: "g6", title: "MedQuiz finals on the big stage", category: "Scientific society", color: "muted", pattern: "grid" },
  { id: "g7", title: "Box cricket at Gymkhana", category: "Sports", color: "accent", pattern: "grid" },
  { id: "g8", title: "Fine Arts gallery at Foyer", category: "Fine Arts", color: "white", pattern: "dots" },
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
    id: "metro-yellow",
    mode: "metro",
    title: "AIIMS Metro Station",
    lineOrHub: "Yellow Line",
    badgeColor: "bg-yellow-400 text-black border-black",
    summary: "The closest station to the festival grounds — right outside AIIMS main gate.",
    gateExit: "Exit from Gate 1 or Gate 2 for easy access to the AIIMS campus.",
    steps: [
      "Board the Yellow Line (Samaypur Badli ↔ Millennium City Centre Gurugram) to AIIMS Metro Station.",
      "Take Exit Gate 1 or Gate 2 for immediate direct access to the AIIMS campus.",
      "Follow the vibrant PULSE signboards for Central Registration (CR) Desk and festival venues.",
    ],
    tip: "Yellow Line connects directly with Rajiv Chowk (Connaught Place), Kashmere Gate, New Delhi Railway Station, and Huda City Centre.",
  },
  {
    id: "metro-pink",
    mode: "metro",
    title: "South Extension Metro Station",
    lineOrHub: "Pink Line",
    badgeColor: "bg-pink-400 text-black border-black",
    summary: "Convenient Pink Line connection across South and East Delhi with easy campus access.",
    gateExit: "Exit from Gate 3 or Gate 4 for easy access to the AIIMS campus.",
    steps: [
      "Board the Pink Line (Majlis Park ↔ Shiv Vihar) to South Extension Station.",
      "Take Exit Gate 3 or Gate 4 for easy direct access to AIIMS campus.",
      "Just a 3-5 minute walk / quick auto ride directly to AIIMS entrance gates.",
    ],
    tip: "Pink Line connects smoothly with Durgabai Deshmukh South Campus, INA (interchange with Yellow Line), and Hazrat Nizamuddin.",
  },
  {
    id: "cab",
    mode: "cab",
    title: "By Cab / Car",
    lineOrHub: "GPS Drop-Off",
    badgeColor: "bg-blue-400 text-black border-black",
    destination: "AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi – 110029",
    summary: "Direct drop-off at the heart of the AIIMS campus and main stage entrance.",
    gateExit: "Drop at AIIMS Quadrangle / Main Gate on Sri Aurobindo Marg.",
    steps: [
      "Set your navigation app destination to: AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi – 110029.",
      "Ask your cab or auto driver for 'AIIMS Quadrangle / Ansari Nagar'.",
      "Designated drop-off lanes operate at Gate 1 and Gate 2 along Sri Aurobindo Marg / Ring Road.",
    ],
    tip: "Parking inside campus is limited during PULSE. We strongly recommend drop-and-go via Uber/Ola or Delhi Metro.",
  },
  {
    id: "bus",
    mode: "bus",
    title: "By Bus",
    lineOrHub: "DTC & Inter-State Hubs",
    badgeColor: "bg-emerald-400 text-black border-black",
    summary: "Choose your drop-off at Kashmere Gate or Dhaula Kuan as per your convenience.",
    gateExit: "Drop at Kashmere Gate (ISBT) or Dhaula Kuan Hub.",
    steps: [
      "From North/East India: Drop off at ISBT Kashmere Gate → Take Yellow Line Metro directly to AIIMS station (~25 min).",
      "From West/Airport route: Drop off at Dhaula Kuan → Take Airport Express / DTC bus (Route 764/724/605) or Pink Line to AIIMS (~20 min).",
      "Direct DTC buses (routes 348, 465, 502, 505, 605) stop right at 'AIIMS' Ring Road bus stand.",
    ],
    tip: "DTC buses run round-the-clock across Ring Road connecting directly with AIIMS bus shelter.",
  },
  {
    id: "train",
    mode: "train",
    title: "By Train",
    lineOrHub: "Major Delhi Railway Hubs",
    badgeColor: "bg-purple-400 text-black border-black",
    summary: "Drop-off at New Delhi (NDLS), Delhi Cantt, or Sarai Rohilla as per onward travel preference.",
    gateExit: "NDLS, Delhi Cantt, or Sarai Rohilla Railway Stations.",
    steps: [
      "New Delhi Railway Station (NDLS): Walk into Yellow Line Metro (New Delhi Station) and ride directly to AIIMS Station (6 stops, ~15 min).",
      "Delhi Cantt Railway Station: Take an auto or DTC bus via Ring Road (~25 min) or metro to AIIMS.",
      "Sarai Rohilla Railway Station: Take a quick cab (~25 min) or Red Line from Shastri Nagar switching to Yellow Line at Kashmere Gate.",
    ],
    tip: "If carrying heavy luggage from NDLS, prepaid cabs and autos are available 24/7 right outside Ajmeri Gate / Paharganj sides.",
  },
  {
    id: "flight",
    mode: "flight",
    title: "By Air",
    lineOrHub: "IGI Airport (DEL)",
    badgeColor: "bg-cyan-400 text-black border-black",
    summary: "Indira Gandhi International Airport (IGI) is ~15 km away with seamless high-speed connectivity.",
    gateExit: "Terminal 1, 2, or 3 (IGI Airport New Delhi).",
    steps: [
      "Board the high-speed Airport Express Line from Terminal 2/3 to New Delhi Metro Station (~20 min).",
      "Switch to the Yellow Line towards HUDA City Centre / Millennium City and get down at AIIMS Station (~15 min).",
      "Direct app cabs (Uber / Ola / BluSmart) from airport terminals take ~35-45 minutes via Rao Tula Ram Marg & Ring Road.",
    ],
    tip: "Airport Express + Yellow Line is the fastest, traffic-free route to AIIMS during peak morning and evening fest hours.",
  },
];

export const LANDMARKS = [
  "AIIMS Metro Station (Yellow Line) — Gate 1 & 2 (0 m)",
  "South Extension Metro Station (Pink Line) — Gate 3 & 4 (600 m)",
  "AIIMS Quadrangle Main Stage — Ansari Nagar (Inside Campus)",
  "Safdarjung Hospital — Opposite Ring Road",
  "Dilli Haat & INA Market — 1.5 km",
  "Lodhi Art District & Khan Market — 3.5 km",
];

/* ------------------------------------------------------------------ */
/* Landing page flow (The Pulse Flow)                                  */
/* ------------------------------------------------------------------ */

export type FlowHighlight = {
  label: string;
  text: string;
  variant?: "secondary" | "accent" | "muted" | "white";
};

export type FlowNote = {
  label: string;
  items: string[];
};

export type FlowStep = {
  step: string;
  title: string;
  tag: string;
  highlights: FlowHighlight[];
  note?: FlowNote;
  href?: string;
  cta?: string;
  secondaryHref?: string;
  secondaryCta?: string;
};

export const FLOW: FlowStep[] = [
  {
    step: "01",
    title: "GET YOUR BR / DELEGATE CARD",
    tag: "Card Selection",
    highlights: [
      {
        label: "DELEGATE CARD",
        text: "Full access to all 5 Prime Star Nights + covers everything included with the BR Card.",
        variant: "secondary",
      },
      {
        label: "BR CARD",
        text: "Mandatory base card for participating in all 250+ festival competitions and campus access.",
        variant: "accent",
      },
    ],
    note: {
      label: "DO I NEED BOTH ?",
      items: [
        "Taking a Delegate Card? You do not need a BR Card.",
        "Attending day events only? You only need a BR Card.",
      ],
    },
    href: "/delegate-card",
    cta: "Delegate Card",
    secondaryHref: "/basic-card",
    secondaryCta: "BR Card",
  },
  {
    step: "02",
    title: "REGISTER FOR YOUR EVENTS",
    tag: "Competitions & Shows",
    highlights: [
      {
        label: "250+ COMPETITIONS",
        text: "aQuSiS, Socio cultural, Workshop, Fine Arts, Quizzing, Literary, Sports, and Gaming battles.",
        variant: "secondary",
      },
      {
        label: "SOLO & TEAM SLOTS",
        text: "Register directly as an individual or create & manage your college team roster.",
        variant: "accent",
      },
    ],
    note: {
      label: "INSTANT CONFIRMATION",
      items: [
        "Instant digital confirmation and schedule sync.",
        "View prize pools, rules, and team requirements.",
      ],
    },
    href: "/events",
    cta: "Browse Events",
    secondaryHref: "/schedule",
    secondaryCta: "View Schedule",
  },
  {
    step: "03",
    title: "COLLECT YOUR CARDS",
    tag: "At The Venue",
    highlights: [
      {
        label: "CR DESK LOCATION",
        text: "Central Registration (CR) Desk at Swimming Pool complex, AIIMS Campus.",
        variant: "secondary",
      },
      {
        label: "TIMINGS & DESKS",
        text: "Open 09:00 AM daily across all 5 festival days with dedicated express counters.",
        variant: "accent",
      },
    ],
    note: {
      label: "WHAT TO BRING",
      items: [
        "Your digital card QR code from your dashboard.",
        "Valid college student ID or government identity card.",
      ],
    },
    href: "/reach",
    cta: "CR Desk & Venue Map",
    secondaryHref: "/dashboard",
    secondaryCta: "My QR Cards",
  },
  {
    step: "04",
    title: "LIVE THE PULSE",
    tag: "5 Days of Action",
    highlights: [
      {
        label: "FESTIVAL ARENA",
        text: "Non-stop competitive heats, informal games, and festival food village.",
        variant: "secondary",
      },
      {
        label: "LIVE NOTICES & FEED",
        text: "Real-time updates, stage schedules, and live scoreboards on the web app.",
        variant: "accent",
      },
    ],
    note: {
      label: "CAMPUS ACCESS",
      items: [
        "Keep your physical badge or RFID wristband equipped.",
        "Free movement across indoor auditoriums & zones.",
      ],
    },
    href: "/schedule",
    cta: "Full Schedule",
    secondaryHref: "/merchandise",
    secondaryCta: "Official Merch",
  },
  {
    step: "05",
    title: "END THE DAY WITH PRIME NIGHTS 🌙",
    tag: "Prime Pro Nights",
    highlights: [
      {
        label: "5 PRO CONCERTS",
        text: "Star-studded concerts with Bollywood artists, EDM DJs, and Rock headliners.",
        variant: "secondary",
      },
      {
        label: "EXCLUSIVE ENTRY",
        text: "Strictly for Delegate Card holders. Main arena gates open at 06:30 PM daily.",
        variant: "accent",
      },
    ],
    note: {
      label: "NIGHT ACCESS RULES",
      items: [
        "Delegate Card pass required for prime arena gates.",
        "Arrive early for front-stage pit access & checks.",
      ],
    },
    href: "/delegate-pass",
    cta: "Get Delegate Card",
    secondaryHref: "/basic-card",
    secondaryCta: "Compare Passes",
  },
];

/* ------------------------------------------------------------------ */
/* PULSE BR Card Perks & Inclusions                                    */
/* ------------------------------------------------------------------ */

export const BR_CARD_PERKS = {
  mandatoryNotice:
    "A BR Card is mandatory to participate in any event (except Star Nights - for which you will need delegate card) and also gives you access to the AIIMS campus throughout PULSE.",
  recommendations: [
    "Movie Nighters",
    "Literary Nighters",
    "Battle of Bands",
    "Rap Battles",
    "Street Dance",
    "Short Films",
    "Open Mic",
    "JAM",
    "IPL Auction",
    "Fine Arts Exhibitions",
    "All sports events",
  ],
  informals: [
    "Cupid Waltz",
    "Musical Chairs",
    "Mr. & Miss PULSE",
    "Water Balloon Fights, etc.",
  ],
  tagline: "Get your BR Card. Live the Beat. Experience PULSE.",
  leadParagraph:
    "From music and dance to literature, art, comedy, competitions and everything in between, these events form the heart and soul of PULSE.",
};

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





