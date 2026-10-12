/**
 * AIIMS New Delhi — TARANG 2026 Venue Map Dataset
 *
 * Provides structured geometry, road network, gate information,
 * building footprints, and GPS-free wayfinding directions.
 * Built for ultra-lightweight, zero-server-load client rendering.
 */

export type VenueCategory =
  | "all"
  | "stages"
  | "sports"
  | "academic"
  | "arts"
  | "amenities"
  | "hostels";

export type CampusGate = {
  id: string;
  number: number;
  name: string;
  street: string;
  metroConnection?: string;
  dropOff: string;
  x: number; // SVG coordinate (0-1000)
  y: number; // SVG coordinate (0-750)
  description: string;
};

export type CampusRoad = {
  id: string;
  number?: number;
  code: string;
  name: string;
  type: "arterial" | "internal_main" | "internal_secondary" | "pedestrian";
  d: string; // SVG path
  labelX: number;
  labelY: number;
  labelAngle?: number;
  description: string;
};

export type CampusBuilding = {
  id: string;
  name: string;
  shortName: string;
  code: string;
  category: VenueCategory;
  categoryLabel: string;
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius?: number;
  accentColor: string;
  textColor?: string;
  nearestRoad: string;
  nearestGate: string;
  description: string;
  capacity?: string;
  eventsHosted: string[];
  amenities: {
    restroom?: boolean;
    water?: boolean;
    firstAid?: boolean;
    food?: boolean;
    wheelchair?: boolean;
    infoDesk?: boolean;
  };
  highlightedByDefault?: boolean;
};

export type LandmarkPoint = {
  id: string;
  label: string;
  type: "tree" | "fountain" | "parking" | "food" | "medical" | "info" | "metro";
  x: number;
  y: number;
};

/* ------------------------------------------------------------------ */
/* Gates                                                              */
/* ------------------------------------------------------------------ */

export const CAMPUS_GATES: CampusGate[] = [
  {
    id: "gate-1",
    number: 1,
    name: "Gate No. 1 (Main AIIMS Gate)",
    street: "Sri Aurobindo Marg (West)",
    metroConnection: "AIIMS Metro Station (Yellow Line) — Exit 1",
    dropOff: "Main Gate Car/Auto Drop-off bay",
    x: 90,
    y: 350,
    description: "Primary festival entrance facing Sri Aurobindo Marg. Direct access to Road 1 (Director's Avenue), Quadrangle & JL Auditorium.",
  },
  {
    id: "gate-2",
    number: 2,
    name: "Gate No. 2 (OPD & Academic Gate)",
    street: "Sri Aurobindo Marg (North-West)",
    metroConnection: "AIIMS Metro Station (Yellow Line) — Exit 2",
    dropOff: "OPD Frontage & Subway Link",
    x: 90,
    y: 190,
    description: "Quick access to Teaching Block, Lecture Theatres, SET Facility & BB Dikshit Library via Road 2.",
  },
  {
    id: "gate-3",
    number: 3,
    name: "Gate No. 3 (Ring Road / Emergency Gate)",
    street: "Mahatma Gandhi Marg / Ring Road (North)",
    metroConnection: "AIIMS Flyover & Ring Road Bus Stand",
    dropOff: "Ring Road North Entrance",
    x: 430,
    y: 55,
    description: "Direct entry from Ring Road / Safdarjung crossover. Leads into Emergency wing & Road 2 connector.",
  },
  {
    id: "gate-4",
    number: 4,
    name: "Gate No. 4 (East / South Extension Gate)",
    street: "August Kranti Marg (East)",
    metroConnection: "South Extension Metro Station (Pink Line) — Exit 3 & 4 (400m)",
    dropOff: "East Gate Visitor Bay & P1 Parking",
    x: 910,
    y: 290,
    description: "Ideal for visitors coming via Pink Line South Extension. Direct walk to Gymkhana Sports Complex & Hostels via Road 6.",
  },
  {
    id: "gate-5",
    number: 5,
    name: "Gate No. 5 (Gymkhana & Sports Gate)",
    street: "South-East Perimeter Road",
    metroConnection: "South Extension / Andrews Ganj auto link",
    dropOff: "Gymkhana Ground Drop Point & P2 Parking",
    x: 910,
    y: 530,
    description: "Dedicated athlete & spectator access to Gymkhana Cricket/Football Stadium, Swimming Pool, and Squash Courts via Road 3.",
  },
  {
    id: "gate-6",
    number: 6,
    name: "Gate No. 6 (Hostels & Staff Enclave Gate)",
    street: "South Perimeter Link Road",
    metroConnection: "Anand Lok / Khel Gaon Marg link",
    dropOff: "Hostel Quadrangle & Residential Gate",
    x: 450,
    y: 690,
    description: "Southern campus perimeter gate connecting to Student Hostels H1–H8 and ASA Logistics Command Center.",
  },
];

/* ------------------------------------------------------------------ */
/* Roads & Internal Numbered Corridors                                */
/* ------------------------------------------------------------------ */

export const CAMPUS_ROADS: CampusRoad[] = [
  // Outer Arterial Roads
  {
    id: "road-aurobindo",
    code: "EXT-W",
    name: "Sri Aurobindo Marg",
    type: "arterial",
    d: "M 90 20 L 90 730",
    labelX: 55,
    labelY: 450,
    labelAngle: -90,
    description: "Major North-South arterial highway. AIIMS Yellow Line Metro runs directly below.",
  },
  {
    id: "road-ring",
    code: "EXT-N",
    name: "Mahatma Gandhi Marg (Ring Road)",
    type: "arterial",
    d: "M 20 60 L 980 60",
    labelX: 500,
    labelY: 35,
    labelAngle: 0,
    description: "Primary Ring Road corridor connecting AIIMS to Safdarjung Hospital, Dhaula Kuan, and South Ext.",
  },
  {
    id: "road-august",
    code: "EXT-E",
    name: "August Kranti Marg (East Perimeter)",
    type: "arterial",
    d: "M 910 20 L 910 730",
    labelX: 945,
    labelY: 440,
    labelAngle: 90,
    description: "Eastern perimeter avenue leading towards South Extension, Andrews Ganj and Siri Fort.",
  },
  {
    id: "road-south-link",
    code: "EXT-S",
    name: "Ansari Nagar South Perimeter Link",
    type: "arterial",
    d: "M 20 690 L 980 690",
    labelX: 500,
    labelY: 715,
    labelAngle: 0,
    description: "Southern campus border road connecting hostel residential sectors and service bays.",
  },

  // Internal Numbered Roads
  {
    id: "road-1",
    number: 1,
    code: "ROAD 1",
    name: "Road No. 1 (Director's Avenue / Main Spine)",
    type: "internal_main",
    d: "M 90 350 L 530 350",
    labelX: 250,
    labelY: 340,
    labelAngle: 0,
    description: "The primary east-west spine of AIIMS. Connects Gate 1 directly to Quadrangle Main Stage, Admin Block, and JL Auditorium.",
  },
  {
    id: "road-2",
    number: 2,
    code: "ROAD 2",
    name: "Road No. 2 (Hospital & Academic Access Way)",
    type: "internal_main",
    d: "M 90 190 L 530 190 L 530 60",
    labelX: 250,
    labelY: 180,
    labelAngle: 0,
    description: "North internal corridor linking Gate 2 & Gate 3 to Teaching Block, Lecture Theatres, SET Center, and OPD Tower.",
  },
  {
    id: "road-3",
    number: 3,
    code: "ROAD 3",
    name: "Road No. 3 (Gymkhana Boulevard / Sports Lane)",
    type: "internal_main",
    d: "M 530 350 L 910 350 L 910 530",
    labelX: 720,
    labelY: 340,
    labelAngle: 0,
    description: "Sports and celebration thoroughfare connecting Quadrangle to Central Registration Desk, Swimming Pool, and Gymkhana Grounds.",
  },
  {
    id: "road-4",
    number: 4,
    code: "ROAD 4",
    name: "Road No. 4 (Central Academic Crescent)",
    type: "internal_main",
    d: "M 530 190 L 530 520",
    labelX: 545,
    labelY: 260,
    labelAngle: 90,
    description: "Central vertical connector joining Teaching Block, Central Foyer, Quadrangle, and Library.",
  },
  {
    id: "road-5",
    number: 5,
    code: "ROAD 5",
    name: "Road No. 5 (Hostels Promenade / Student Village)",
    type: "internal_secondary",
    d: "M 320 520 L 750 520 L 750 690",
    labelX: 430,
    labelY: 510,
    labelAngle: 0,
    description: "Hostel access avenue running between Hostels 1–8, Student Mess, Dining Hall, and ASA Office.",
  },
  {
    id: "road-6",
    number: 6,
    code: "ROAD 6",
    name: "Road No. 6 (East Gate / South Ext Connector)",
    type: "internal_secondary",
    d: "M 910 290 L 750 290 L 750 520",
    labelX: 830,
    labelY: 280,
    labelAngle: 0,
    description: "Eastern internal boulevard connecting Gate 4 (South Ext Metro) into the Gymkhana & Sports complex.",
  },

  // Pedestrian Walkways & Plazas
  {
    id: "walkway-quad",
    code: "WALK-1",
    name: "Quadrangle Festival Walkway",
    type: "pedestrian",
    d: "M 380 350 L 380 470 L 520 470",
    labelX: 410,
    labelY: 460,
    description: "Pedestrian festival boulevard surrounded by food stalls, event merchandise, and sponsor experiential booths.",
  },
  {
    id: "walkway-sports",
    code: "WALK-2",
    name: "Swimming Pool & CR Desk Walkway",
    type: "pedestrian",
    d: "M 550 420 L 700 420",
    labelX: 610,
    labelY: 410,
    description: "Walkway from Quadrangle to Central Registration Desk & Swimming Pool gathering plaza.",
  },
];

/* ------------------------------------------------------------------ */
/* Campus Buildings & Venues                                          */
/* ------------------------------------------------------------------ */

export const CAMPUS_BUILDINGS: CampusBuilding[] = [
  {
    id: "quadrangle",
    name: "Quadrangle Main Stage",
    shortName: "Quadrangle",
    code: "V1",
    category: "stages",
    categoryLabel: "Prime Stage",
    tag: "Pro Nights & Grand Finals",
    x: 340,
    y: 365,
    width: 175,
    height: 125,
    borderRadius: 8,
    accentColor: "#ffd93d", // Yellow
    textColor: "#000000",
    nearestRoad: "Road No. 1 / Road No. 4",
    nearestGate: "Gate No. 1 (Sri Aurobindo Marg)",
    description: "The electric epicenter of TARANG. Massive open-air lawn hosting 5,000+ attendees for Star Nights, Pro Concerts, Battle of the Bands, and grand opening/closing spectacles.",
    capacity: "5,000+ Standing / Seated",
    eventsHosted: [
      "Star Night Finale",
      "Prime Night Concerts",
      "Battle of the Bands",
      "Street Dance Battles",
      "Grand Opening & Awards Ceremony",
      "EDM / DJ Extravaganza",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: true,
      wheelchair: true,
      infoDesk: true,
    },
    highlightedByDefault: true,
  },
  {
    id: "jl-auditorium",
    name: "JL Auditorium (Jawaharlal Auditorium)",
    shortName: "JL Auditorium",
    code: "V2",
    category: "stages",
    categoryLabel: "Proscenium Auditorium",
    tag: "Cultural & Theatrics",
    x: 180,
    y: 365,
    width: 140,
    height: 110,
    borderRadius: 8,
    accentColor: "#ff6b6b", // Accent Coral Red
    textColor: "#ffffff",
    nearestRoad: "Road No. 1 (Director's Avenue)",
    nearestGate: "Gate No. 1 (Main AIIMS Gate)",
    description: "Iconic 1,000+ seat proscenium auditorium equipped with state-of-the-art acoustics and stage lighting. Hosts classical showcases, prestigious stage plays, dance dramas, and keynote lectures.",
    capacity: "1,050 Seated (Air-Conditioned)",
    eventsHosted: [
      "One Act Stage Play",
      "Classical Solo & Duet Dance",
      "Sufi & Semi-Classical Night",
      "Debate Championships Finals",
      "Inaugural Ceremony",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: false,
      food: false,
      wheelchair: true,
      infoDesk: true,
    },
  },
  {
    id: "gymkhana",
    name: "Gymkhana Sports Stadium & Complex",
    shortName: "Gymkhana Arena",
    code: "V3",
    category: "sports",
    categoryLabel: "Sports Arena",
    tag: "Athletics & Tournaments",
    x: 690,
    y: 365,
    width: 200,
    height: 140,
    borderRadius: 12,
    accentColor: "#86efac", // Green
    textColor: "#000000",
    nearestRoad: "Road No. 3 (Sports Lane) / Road No. 6",
    nearestGate: "Gate No. 5 (Gymkhana Gate) or Gate No. 4",
    description: "Massive multipurpose floodlit sports complex featuring a full cricket stadium, football pitch, synthetic basketball & volleyball courts, and sprint track.",
    capacity: "3,000+ Spectator Stands",
    eventsHosted: [
      "Inter-College Cricket Tournament",
      "Football Championship",
      "Basketball Cup (Men & Women)",
      "Volleyball Knockout",
      "Athletics 100m/400m Track Events",
      "Box Cricket League",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: true,
      wheelchair: true,
      infoDesk: true,
    },
  },
  {
    id: "teaching-block",
    name: "Teaching Block (Lecture Theatres LT1–LT4)",
    shortName: "Teaching Block",
    code: "V4",
    category: "academic",
    categoryLabel: "Academic Complex",
    tag: "Academics & Scientific society",
    x: 180,
    y: 205,
    width: 170,
    height: 110,
    borderRadius: 6,
    accentColor: "#c4b5fd", // Muted Violet
    textColor: "#000000",
    nearestRoad: "Road No. 2 / Road No. 4",
    nearestGate: "Gate No. 2 (OPD & Academic Gate)",
    description: "Central educational hub housing tiered lecture halls LT1, LT2, LT3, LT4, Anatomy & Pathology theatres. Host to high-stakes MedQuizzes, debates, MUN, and clinical paper presentations.",
    capacity: "4x 250 Seated Theatres",
    eventsHosted: [
      "National AIIMS MedQuiz",
      "Case Presentation Slam",
      "Parliamentary Debate & Extempore",
      "Slam Poetry & Creative Writing",
      "IPL Auction Simulation",
      "Medical Trivia & Jeopardy",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "set-facility",
    name: "SET Facility (Simulation, E-learning & Tech)",
    shortName: "SET Facility",
    code: "V5",
    category: "academic",
    categoryLabel: "Clinical Center",
    tag: "Simulation & Workshops",
    x: 370,
    y: 205,
    width: 145,
    height: 110,
    borderRadius: 6,
    accentColor: "#93c5fd", // Light Blue
    textColor: "#000000",
    nearestRoad: "Road No. 2 (Hospital Access)",
    nearestGate: "Gate No. 2 (Sri Aurobindo Marg)",
    description: "World-class advanced surgical robotics, laparoscopy, and emergency clinical simulation facility. Hosts hands-on workshops and emergency trauma bootcamps.",
    capacity: "150 Workshop Delegates",
    eventsHosted: [
      "Basic & Advanced Surgical Skills Workshop",
      "Laparoscopy Simulation Contest",
      "Emergency Trauma Response Drill",
      "Robotic Surgery Demonstration",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "foyer",
    name: "Central Foyer & Exhibition Gallery",
    shortName: "Central Foyer",
    code: "V6",
    category: "arts",
    categoryLabel: "Exhibition Zone",
    tag: "Fine Arts & Informals",
    x: 370,
    y: 320,
    width: 145,
    height: 38,
    borderRadius: 4,
    accentColor: "#fde047", // Amber Yellow
    textColor: "#000000",
    nearestRoad: "Road No. 4 (Central Crescent)",
    nearestGate: "Gate No. 1 or Gate No. 2",
    description: "High-traffic indoor corridor connecting Admin & Teaching Block. Bustling venue for fine arts displays, sketching, origami, face painting, acoustic busking, and sponsor booths.",
    capacity: "Continuous Walkthrough",
    eventsHosted: [
      "Fine Arts & Painting Exhibition",
      "Sketching & Charcoal Duel",
      "Face Painting & Tattoo Art",
      "Origami & Clay Modelling",
      "Acoustic Open Mic & Busking",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: false,
      food: false,
      wheelchair: true,
      infoDesk: true,
    },
  },
  {
    id: "cr-desk-swimming-pool",
    name: "Central Registration (CR) Desk & Swimming Pool",
    shortName: "CR Desk & Pool",
    code: "V7",
    category: "amenities",
    categoryLabel: "Check-in & Registration",
    tag: "Card Collection Hub",
    x: 540,
    y: 365,
    width: 130,
    height: 125,
    borderRadius: 8,
    accentColor: "#38bdf8", // Sky Blue
    textColor: "#000000",
    nearestRoad: "Road No. 3 (Gymkhana Boulevard)",
    nearestGate: "Gate No. 1 or Gate No. 5",
    description: "Mandatory check-in hub for all festival delegates. Collect physical TARANG BR Cards, Delegate Passes, wristbands, and festival merchandise right beside the Olympic-size swimming pool.",
    capacity: "10 Dedicated Counters",
    eventsHosted: [
      "Physical BR Card Pickup & Verification",
      "Delegate Pass VIP Wristband Issue",
      "On-Spot Event Registration Helpdesk",
      "Merchandise & Fest Kit Counters",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: true,
      wheelchair: true,
      infoDesk: true,
    },
    highlightedByDefault: true,
  },
  {
    id: "squash-court",
    name: "Indoor Squash & Badminton Arena",
    shortName: "Squash Court",
    code: "V8",
    category: "sports",
    categoryLabel: "Indoor Arena",
    tag: "Indoor Racket Sports",
    x: 690,
    y: 205,
    width: 140,
    height: 110,
    borderRadius: 8,
    accentColor: "#6ee7b7", // Mint Green
    textColor: "#000000",
    nearestRoad: "Road No. 6 / Road No. 3",
    nearestGate: "Gate No. 4 (South Extension Gate)",
    description: "Air-conditioned indoor arena with two glass-backed international squash courts, wooden badminton courts, and table tennis tables.",
    capacity: "250 Spectators",
    eventsHosted: [
      "Squash Men's & Women's Knockout",
      "Badminton Doubles Invitational",
      "Table Tennis Championship",
      "Chess Grandmasters Blitz",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "bb-dikshit-library",
    name: "B.B. Dikshit Central Library",
    shortName: "Central Library",
    code: "B1",
    category: "academic",
    categoryLabel: "Campus Landmark",
    tag: "Quiet Zone & Reading Hall",
    x: 535,
    y: 205,
    width: 135,
    height: 110,
    borderRadius: 6,
    accentColor: "#e2e8f0", // Slate
    textColor: "#000000",
    nearestRoad: "Road No. 2 / Road No. 4",
    nearestGate: "Gate No. 2 (Main Academic Gate)",
    description: "Iconic 4-storey medical research library housing over 100,000 journals and volumes. Serves as a quiet study area and orientation lounge during TARANG.",
    capacity: "500 Readers",
    eventsHosted: [
      "Literary Quiz Preliminary Rounds",
      "Faculty & Alumni Reception",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: false,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "food-street",
    name: "Festival Food Street & Cafeteria Plaza",
    shortName: "Food Street",
    code: "A1",
    category: "amenities",
    categoryLabel: "Dining & Refreshments",
    tag: "Food & Stalls",
    x: 340,
    y: 505,
    width: 175,
    height: 55,
    borderRadius: 6,
    accentColor: "#fb923c", // Orange
    textColor: "#ffffff",
    nearestRoad: "Road No. 1 / Road No. 5 (Walkway)",
    nearestGate: "Gate No. 1 or Gate No. 6",
    description: "Lively food bazaar with 25+ food trucks and artisan pop-ups serving chaat, rolls, pizzas, coffees, shakes, ice-creams, and late-night festival bites until 2:00 AM.",
    capacity: "30+ Food Brands",
    eventsHosted: [
      "Late-Night Food Hub",
      "Cupid Waltz Informal Gathering",
      "Flash Mobs & Acoustic Busking",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: true,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "hostels-complex",
    name: "Student Hostels Complex (Hostels 1–8)",
    shortName: "Hostels H1–H8",
    code: "H1",
    category: "hostels",
    categoryLabel: "Student Residences",
    tag: "Delegate Accommodation",
    x: 535,
    y: 540,
    width: 355,
    height: 120,
    borderRadius: 8,
    accentColor: "#fbcfe8", // Pink
    textColor: "#000000",
    nearestRoad: "Road No. 5 (Hostels Promenade)",
    nearestGate: "Gate No. 6 (Ansari Nagar South) or Gate No. 5",
    description: "Residential complex of AIIMS New Delhi comprising undergraduate & postgraduate hostels, dining halls, student recreation common rooms, and ASA Headquarters.",
    capacity: "Resident Students & Registered Delegates",
    eventsHosted: [
      "Delegate Hostel Check-In",
      "Informal Jam Sessions",
      "ASA Organizing War Room",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: true,
      wheelchair: true,
      infoDesk: true,
    },
  },
  {
    id: "hospital-main-tower",
    name: "Main Hospital & Emergency Trauma Wing",
    shortName: "AIIMS Hospital",
    code: "HOSP",
    category: "amenities",
    categoryLabel: "Healthcare Landmark",
    tag: "Hospital & 24x7 Emergency",
    x: 180,
    y: 80,
    width: 335,
    height: 105,
    borderRadius: 6,
    accentColor: "#fee2e2", // Soft Red
    textColor: "#000000",
    nearestRoad: "Road No. 2 (Ring Road Connector)",
    nearestGate: "Gate No. 3 (Emergency Gate) or Gate No. 2",
    description: "India's premier apex healthcare facility. (Please note: quiet zone maintained around patient care areas; festival decibels are restricted to Quadrangle and Gymkhana).",
    eventsHosted: [
      "24/7 Apex Emergency Services",
      "Medical Support Base for Fest",
    ],
    amenities: {
      restroom: true,
      water: true,
      firstAid: true,
      food: false,
      wheelchair: true,
      infoDesk: true,
    },
  },
  {
    id: "parking-p1",
    name: "Visitor Parking P1 (East Gate)",
    shortName: "Parking P1",
    code: "P1",
    category: "amenities",
    categoryLabel: "Vehicle Parking",
    tag: "2-Wheeler & 4-Wheeler",
    x: 845,
    y: 190,
    width: 55,
    height: 85,
    borderRadius: 6,
    accentColor: "#cbd5e1", // Slate
    textColor: "#000000",
    nearestRoad: "Road No. 6 / August Kranti Marg",
    nearestGate: "Gate No. 4 (South Extension Gate)",
    description: "Designated festival parking area for registered delegates and visitors entering via Gate 4 / South Extension side.",
    eventsHosted: ["Visitor Parking Area"],
    amenities: {
      restroom: false,
      water: false,
      firstAid: false,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
  {
    id: "parking-p2",
    name: "Participant Parking P2 (Sports Grounds)",
    shortName: "Parking P2",
    code: "P2",
    category: "amenities",
    categoryLabel: "Athlete Parking",
    tag: "Sports Contingent Bay",
    x: 845,
    y: 520,
    width: 55,
    height: 85,
    borderRadius: 6,
    accentColor: "#cbd5e1", // Slate
    textColor: "#000000",
    nearestRoad: "Road No. 3 / South-East Link",
    nearestGate: "Gate No. 5 (Gymkhana Gate)",
    description: "Dedicated parking and bus drop-off zone for inter-college sports teams and equipment vans.",
    eventsHosted: ["Athlete Contingent Parking"],
    amenities: {
      restroom: false,
      water: false,
      firstAid: false,
      food: false,
      wheelchair: true,
      infoDesk: false,
    },
  },
];

/* ------------------------------------------------------------------ */
/* Landmark Icons & Points                                             */
/* ------------------------------------------------------------------ */

export const CAMPUS_LANDMARKS: LandmarkPoint[] = [
  { id: "metro-1", label: "AIIMS Metro (Gate 1)", type: "metro", x: 45, y: 350 },
  { id: "metro-2", label: "AIIMS Metro (Gate 2)", type: "metro", x: 45, y: 190 },
  { id: "metro-3", label: "South Ext Metro (Pink)", type: "metro", x: 955, y: 290 },
  { id: "info-gate1", label: "Help Desk", type: "info", x: 130, y: 330 },
  { id: "firstaid-quad", label: "First Aid Post", type: "medical", x: 345, y: 340 },
  { id: "water-quad", label: "Water Station", type: "food", x: 505, y: 340 },
  { id: "fountain-quad", label: "Central Lawn", type: "fountain", x: 425, y: 495 },
  { id: "tree-1", label: "Green Belt", type: "tree", x: 135, y: 270 },
  { id: "tree-2", label: "Green Belt", type: "tree", x: 135, y: 550 },
  { id: "tree-3", label: "Green Belt", type: "tree", x: 670, y: 330 },
];

/* ------------------------------------------------------------------ */
/* GPS-Free Step-by-Step Wayfinding Routes                             */
/* ------------------------------------------------------------------ */

export type WayfindingRoute = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  distance: string;
  walkTime: string;
  steps: string[];
  viaRoads: string[];
};

export const PRESET_ROUTES: WayfindingRoute[] = [
  {
    fromId: "gate-1",
    fromName: "Gate No. 1 (Main AIIMS Gate)",
    toId: "quadrangle",
    toName: "Quadrangle Main Stage",
    distance: "180 meters",
    walkTime: "2-3 mins",
    viaRoads: ["Road No. 1 (Director's Ave)", "Road No. 4"],
    steps: [
      "Enter through Gate No. 1 from Sri Aurobindo Marg (AIIMS Metro Exit 1).",
      "Walk straight east down Road No. 1 (Director's Avenue) past JL Auditorium on your right.",
      "At the Road No. 4 intersection, look straight ahead into the Quadrangle Main Stage arena.",
      "Follow the neon yellow TARANG banners to the festival entrance arch.",
    ],
  },
  {
    fromId: "gate-1",
    fromName: "Gate No. 1 (Main AIIMS Gate)",
    toId: "cr-desk-swimming-pool",
    toName: "Central Registration (CR) Desk",
    distance: "320 meters",
    walkTime: "4 mins",
    viaRoads: ["Road No. 1", "Road No. 3 (Gymkhana Blvd)"],
    steps: [
      "Enter through Gate No. 1 and walk straight down Road No. 1.",
      "Pass the Quadrangle lawn on your right and continue eastward along Road No. 3 (Gymkhana Boulevard).",
      "You will see the Olympic Swimming Pool on your right.",
      "The Central Registration (CR) Desk counters are located in the pool concourse under the blue canopy.",
    ],
  },
  {
    fromId: "gate-1",
    fromName: "Gate No. 1 (Main AIIMS Gate)",
    toId: "jl-auditorium",
    toName: "JL Auditorium",
    distance: "90 meters",
    walkTime: "1 min",
    viaRoads: ["Road No. 1"],
    steps: [
      "Enter through Gate No. 1.",
      "Walk 70 meters along Road No. 1 — JL Auditorium is the prominent building immediately on your right.",
      "Enter through the main glass portico.",
    ],
  },
  {
    fromId: "gate-2",
    fromName: "Gate No. 2 (OPD & Academic Gate)",
    toId: "teaching-block",
    toName: "Teaching Block (LT1–LT4)",
    distance: "110 meters",
    walkTime: "1-2 mins",
    viaRoads: ["Road No. 2 (Academic Access)"],
    steps: [
      "Enter via Gate No. 2 from Sri Aurobindo Marg (AIIMS Metro Exit 2).",
      "Walk east along Road No. 2.",
      "Teaching Block is located immediately on your right, housing lecture halls LT1 through LT4.",
    ],
  },
  {
    fromId: "gate-2",
    fromName: "Gate No. 2 (OPD & Academic Gate)",
    toId: "set-facility",
    toName: "SET Facility",
    distance: "240 meters",
    walkTime: "3 mins",
    viaRoads: ["Road No. 2"],
    steps: [
      "Enter via Gate No. 2 and walk straight down Road No. 2 past Teaching Block.",
      "The SET Facility (Simulation & E-learning center) is located straight ahead next to the Central Library.",
    ],
  },
  {
    fromId: "gate-4",
    fromName: "Gate No. 4 (South Extension Gate)",
    toId: "gymkhana",
    toName: "Gymkhana Sports Arena",
    distance: "150 meters",
    walkTime: "2 mins",
    viaRoads: ["Road No. 6 (East Connector)", "Road No. 3"],
    steps: [
      "Enter through Gate No. 4 from August Kranti Marg (South Ext Metro Exit 3/4).",
      "Walk west down Road No. 6 past Parking P1.",
      "Turn left onto Road No. 3 — Gymkhana Stadium floodlights and stands are immediately visible.",
    ],
  },
  {
    fromId: "gate-4",
    fromName: "Gate No. 4 (South Extension Gate)",
    toId: "quadrangle",
    toName: "Quadrangle Main Stage",
    distance: "420 meters",
    walkTime: "5 mins",
    viaRoads: ["Road No. 6", "Road No. 3 (Sports Lane)"],
    steps: [
      "Enter through Gate No. 4.",
      "Follow Road No. 6 past Gymkhana grounds onto Road No. 3.",
      "Continue west past the Swimming Pool & CR Desk.",
      "Arrive directly at the Quadrangle Main Stage entrance arch.",
    ],
  },
  {
    fromId: "gate-5",
    fromName: "Gate No. 5 (Gymkhana & Sports Gate)",
    toId: "gymkhana",
    toName: "Gymkhana Sports Arena",
    distance: "60 meters",
    walkTime: "1 min",
    viaRoads: ["Road No. 3 (South-East Link)"],
    steps: [
      "Enter through Gate No. 5.",
      "You are directly at the Gymkhana cricket and football grounds perimeter.",
    ],
  },
  {
    fromId: "gate-6",
    fromName: "Gate No. 6 (Hostels Gate)",
    toId: "food-street",
    toName: "Festival Food Street",
    distance: "180 meters",
    walkTime: "2-3 mins",
    viaRoads: ["Road No. 5 (Hostels Promenade)"],
    steps: [
      "Enter through Gate No. 6.",
      "Walk north along Road No. 5 past Hostels H1–H4.",
      "Festival Food Street is laid out across the promenade leading up to the Quadrangle.",
    ],
  },
];
