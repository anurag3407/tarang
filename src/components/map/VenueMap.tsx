"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  Search,
  MapPin,
  Compass,
  Navigation,
  Footprints,
  Info,
  Clock,
  Layers,
  Sparkles,
  Award,
  CheckCircle2,
  X,
  Share2,
  Download,
  AlertCircle,
  Car,
  Train,
  HeartPulse,
  Coffee,
  Accessibility,
  Droplets,
  HelpCircle,
  Eye,
} from "lucide-react";
import {
  CAMPUS_GATES,
  CAMPUS_ROADS,
  CAMPUS_BUILDINGS,
  CAMPUS_LANDMARKS,
  PRESET_ROUTES,
  type CampusBuilding,
  type CampusGate,
  type VenueCategory,
  type WayfindingRoute,
} from "@/lib/map-data";

const CATEGORIES: { id: VenueCategory; label: string; iconColor: string }[] = [
  { id: "all", label: "All Grounds", iconColor: "bg-white" },
  { id: "stages", label: "Prime Stages", iconColor: "bg-neo-secondary" },
  { id: "sports", label: "Sports Complex", iconColor: "bg-emerald-300" },
  { id: "academic", label: "Scientific society & Academics", iconColor: "bg-neo-muted" },
  { id: "arts", label: "Arts & Informals", iconColor: "bg-amber-300" },
  { id: "amenities", label: "CR Desk & Amenities", iconColor: "bg-sky-300" },
  { id: "hostels", label: "Hostel Zone", iconColor: "bg-pink-300" },
];

export default function VenueMap() {
  const [selectedBuilding, setSelectedBuilding] = useState<CampusBuilding | null>(
    CAMPUS_BUILDINGS.find((b) => b.id === "quadrangle") || null
  );
  const [selectedGate, setSelectedGate] = useState<CampusGate | null>(null);
  const [activeCategory, setActiveCategory] = useState<VenueCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeRoad, setActiveRoad] = useState<string | null>(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Wayfinding state
  const [navFrom, setNavFrom] = useState<string>("gate-1");
  const [navTo, setNavTo] = useState<string>("quadrangle");
  const [showWayfinder, setShowWayfinder] = useState(false);
  const [activeRoute, setActiveRoute] = useState<WayfindingRoute | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Filtered buildings by category & search
  const filteredBuildings = useMemo(() => {
    return CAMPUS_BUILDINGS.filter((b) => {
      const matchCategory =
        activeCategory === "all" || b.category === activeCategory;
      const matchSearch =
        !searchQuery.trim() ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.nearestRoad.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.tag.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.eventsHosted.some((e) =>
          e.toLowerCase().includes(searchQuery.toLowerCase())
        );
      return matchCategory && matchSearch;
    });
  }, [activeCategory, searchQuery]);

  // Compute active route when navigation points change
  useEffect(() => {
    if (!showWayfinder) {
      setActiveRoute(null);
      return;
    }
    const found = PRESET_ROUTES.find(
      (r) => r.fromId === navFrom && r.toId === navTo
    );

    if (found) {
      setActiveRoute(found);
    } else {
      // Fallback route generator for any pair
      const fromGate = CAMPUS_GATES.find((g) => g.id === navFrom);
      const toB = CAMPUS_BUILDINGS.find((b) => b.id === navTo);
      if (fromGate && toB) {
        setActiveRoute({
          fromId: fromGate.id,
          fromName: fromGate.name,
          toId: toB.id,
          toName: toB.name,
          distance: "250 meters",
          walkTime: "3-4 mins",
          viaRoads: [toB.nearestRoad],
          steps: [
            `Start at ${fromGate.name} (${fromGate.street}).`,
            `Follow the designated campus road signs towards ${toB.nearestRoad}.`,
            `Locate ${toB.name} marked with code ${toB.code}.`,
          ],
        });
      }
    }
  }, [navFrom, navTo, showWayfinder]);

  // Zoom controls
  function handleZoomIn() {
    setZoom((z) => Math.min(z + 0.25, 2.5));
  }
  function handleZoomOut() {
    setZoom((z) => Math.max(z - 0.25, 0.75));
  }
  function handleReset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedGate(null);
    setActiveRoad(null);
  }

  // Pan controls via mouse drag
  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return; // Only primary button
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  // Touch controls for mobile drag
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPan({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }

  function handleTouchEnd() {
    setIsDragging(false);
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => {
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen?.().then(() => {
        setIsFullscreen(false);
      });
    }
  }

  function focusBuilding(b: CampusBuilding) {
    setSelectedBuilding(b);
    setSelectedGate(null);
    setActiveRoad(b.nearestRoad);
  }

  function focusGate(g: CampusGate) {
    setSelectedGate(g);
    setSelectedBuilding(null);
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col border-8 border-black bg-neo-cream shadow-neo-lg ${
        isFullscreen ? "fixed inset-0 z-50 h-screen w-screen overflow-hidden" : ""
      }`}
    >
      {/* Top Map Header & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-6 border-black bg-neo-secondary p-4">
        {/* Title and Badge */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-black bg-neo-accent shadow-neo-xs">
            <Compass className="h-6 w-6 text-black" strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-black/70">
                AIIMS Campus Grounds
              </span>
              <span className="border border-black bg-white px-1.5 py-0.2 text-[9px] font-black uppercase">
                Vector CSS Map
              </span>
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight text-black sm:text-2xl">
              TARANG 2026 Venue Navigator
            </h2>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Wayfinder Toggle */}
          <button
            type="button"
            onClick={() => setShowWayfinder((v) => !v)}
            className={`inline-flex items-center gap-1.5 border-3 border-black px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-neo-xs transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] ${
              showWayfinder ? "bg-neo-accent text-white" : "bg-white text-black"
            }`}
          >
            <Footprints className="h-4 w-4" />
            <span>{showWayfinder ? "Hide Wayfinding" : "Find Where I Am"}</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center border-3 border-black bg-white shadow-neo-xs">
            <button
              type="button"
              onClick={handleZoomIn}
              title="Zoom In"
              className="flex h-8 w-8 items-center justify-center border-r-2 border-black hover:bg-neo-accent"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              title="Zoom Out"
              className="flex h-8 w-8 items-center justify-center border-r-2 border-black hover:bg-neo-accent"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              title="Reset View"
              className="flex h-8 w-8 items-center justify-center hover:bg-neo-secondary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="flex h-9 w-9 items-center justify-center border-3 border-black bg-white shadow-neo-xs hover:bg-neo-accent"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Category Pills & Search Filter */}
      <div className="flex flex-col gap-3 border-b-4 border-black bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`border-2 border-black px-2.5 py-1 text-xs font-black uppercase tracking-wider transition-all duration-100 ${
                  active
                    ? "bg-black text-white shadow-neo-xs"
                    : "bg-neo-cream text-black hover:bg-neo-secondary"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Quick Search */}
        <div className="relative min-w-[240px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search venue, Road 1, gate, event..."
            className="w-full border-2 border-black bg-neo-cream py-1 pl-8 pr-3 text-xs font-bold text-black placeholder:text-black/50 focus:bg-white focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-black"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* "Find Where I Am" (GPS-free Wayfinder Bar) */}
      {showWayfinder && (
        <div className="border-b-4 border-black bg-neo-accent p-4 text-black animate-in fade-in duration-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white text-xs font-black">
                  1
                </span>
                <label className="text-xs font-black uppercase">
                  Where are you right now?
                </label>
                <select
                  value={navFrom}
                  onChange={(e) => setNavFrom(e.target.value)}
                  className="border-3 border-black bg-white px-2.5 py-1 text-xs font-black uppercase text-black"
                >
                  <optgroup label="Campus Entry Gates">
                    {CAMPUS_GATES.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white text-xs font-black">
                  2
                </span>
                <label className="text-xs font-black uppercase">
                  Where do you want to reach?
                </label>
                <select
                  value={navTo}
                  onChange={(e) => setNavTo(e.target.value)}
                  className="border-3 border-black bg-white px-2.5 py-1 text-xs font-black uppercase text-black"
                >
                  <optgroup label="Key Festival Venues">
                    {CAMPUS_BUILDINGS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const targetB = CAMPUS_BUILDINGS.find((b) => b.id === navTo);
                if (targetB) focusBuilding(targetB);
              }}
              className="inline-flex items-center justify-center gap-1.5 border-3 border-black bg-neo-secondary px-4 py-1.5 text-xs font-black uppercase tracking-wider shadow-neo-xs transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
            >
              <Navigation className="h-4 w-4" />
              <span>Show Walking Route</span>
            </button>
          </div>

          {/* Active Route Step Instructions */}
          {activeRoute && (
            <div className="mt-3 border-3 border-black bg-white p-3 shadow-neo-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black/15 pb-2 text-xs font-black uppercase">
                <div className="flex items-center gap-2 text-black">
                  <Footprints className="h-4 w-4 text-neo-accent" />
                  <span>Route: {activeRoute.fromName} → {activeRoute.toName}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span className="border border-black bg-neo-secondary px-1.5 py-0.5">
                    Est. Walk: {activeRoute.walkTime}
                  </span>
                  <span className="border border-black bg-neo-muted px-1.5 py-0.5">
                    Distance: {activeRoute.distance}
                  </span>
                </div>
              </div>

              <ol className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {activeRoute.steps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 border-2 border-black/10 bg-neo-cream p-2 text-[11px] font-bold text-black"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-black bg-neo-accent text-[10px] font-black text-white">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Main Interactive Map Canvas and Side Information Drawer */}
      <div className="relative flex flex-1 flex-col lg:flex-row overflow-hidden min-h-[520px]">
        {/* SVG Canvas Area */}
        <div
          className="relative flex-1 cursor-grab overflow-hidden bg-[#faf8f0] select-none active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Subtle Halftone Pattern Overlay */}
          <div className="absolute inset-0 bg-halftone opacity-15 pointer-events-none" />

          {/* Compass Rose Indicator */}
          <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-center justify-center border-3 border-black bg-white p-2 shadow-neo-sm">
            <span className="text-[10px] font-black">N</span>
            <div className="h-4 w-0.5 bg-neo-accent" />
            <span className="text-[9px] font-black uppercase text-black/60">NORTH</span>
          </div>

          {/* Road Legend Quick Pill */}
          <div className="pointer-events-none absolute left-4 bottom-4 z-10 hidden sm:flex flex-col gap-1 border-3 border-black bg-white p-2.5 shadow-neo-sm text-[10px] font-black">
            <span className="uppercase text-black/60">Road Index</span>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-5 bg-amber-400 border border-black" />
              <span>Road 1 (Director&apos;s Ave)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-5 bg-yellow-300 border border-black" />
              <span>Road 2 (Academic Access)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-5 bg-emerald-400 border border-black" />
              <span>Road 3 (Gymkhana Blvd)</span>
            </div>
          </div>

          {/* SVG Map Render */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 0.15s ease-out",
            }}
            className="flex items-center justify-center h-full w-full"
          >
            <svg
              ref={svgRef}
              viewBox="0 0 1000 750"
              className="h-full w-full max-h-[85vh] drop-shadow-sm"
              style={{ minWidth: "750px", minHeight: "560px" }}
            >
              {/* SVG Definitions: Grids, Patterns, Glows */}
              <defs>
                <pattern
                  id="campus-grass"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="20" height="20" fill="#f0fdf4" />
                  <circle cx="10" cy="10" r="1.5" fill="#bbf7d0" />
                </pattern>
                <pattern
                  id="quad-stripes"
                  width="12"
                  height="12"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="12" fill="#fef08a" />
                  <rect x="6" width="6" height="12" fill="#fde047" />
                </pattern>
                <pattern
                  id="sports-turf"
                  width="16"
                  height="16"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="16" height="16" fill="#86efac" />
                  <rect x="0" y="0" width="8" height="16" fill="#4ade80" />
                </pattern>
                <filter id="neo-shadow" x="-5%" y="-5%" width="115%" height="115%">
                  <feDropShadow dx="5" dy="5" stdDeviation="0" floodColor="#000000" />
                </filter>
                <filter id="neo-shadow-lg" x="-10%" y="-10%" width="125%" height="125%">
                  <feDropShadow dx="8" dy="8" stdDeviation="0" floodColor="#000000" />
                </filter>
                <filter id="active-pulse">
                  <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ff6b6b" />
                </filter>
              </defs>

              {/* Campus Boundary Base Polygon */}
              <rect
                x="80"
                y="50"
                width="840"
                height="650"
                fill="url(#campus-grass)"
                stroke="#000000"
                strokeWidth="4"
                rx="16"
              />

              {/* Outer Arterial Roads (Sri Aurobindo Marg, Ring Road, August Kranti Marg) */}
              {/* Sri Aurobindo Marg (West) */}
              <rect
                x="15"
                y="15"
                width="75"
                height="720"
                fill="#334155"
                stroke="#000000"
                strokeWidth="3"
              />
              <line
                x1="52"
                y1="20"
                x2="52"
                y2="730"
                stroke="#facc15"
                strokeWidth="3"
                strokeDasharray="12 8"
              />

              {/* Mahatma Gandhi Marg / Ring Road (North) */}
              <rect
                x="15"
                y="15"
                width="970"
                height="45"
                fill="#334155"
                stroke="#000000"
                strokeWidth="3"
              />
              <line
                x1="20"
                y1="37"
                x2="980"
                y2="37"
                stroke="#facc15"
                strokeWidth="3"
                strokeDasharray="12 8"
              />

              {/* August Kranti Marg (East) */}
              <rect
                x="910"
                y="15"
                width="75"
                height="720"
                fill="#334155"
                stroke="#000000"
                strokeWidth="3"
              />
              <line
                x1="947"
                y1="20"
                x2="947"
                y2="730"
                stroke="#facc15"
                strokeWidth="3"
                strokeDasharray="12 8"
              />

              {/* South Perimeter Road (South) */}
              <rect
                x="15"
                y="690"
                width="970"
                height="45"
                fill="#334155"
                stroke="#000000"
                strokeWidth="3"
              />
              <line
                x1="20"
                y1="712"
                x2="980"
                y2="712"
                stroke="#facc15"
                strokeWidth="3"
                strokeDasharray="12 8"
              />

              {/* Road Labels (External Arterials) */}
              <text
                x="52"
                y="450"
                transform="rotate(-90 52 450)"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="12"
                fontWeight="900"
                letterSpacing="2"
              >
                SRI AUROBINDO MARG (WEST)
              </text>
              <text
                x="500"
                y="34"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="12"
                fontWeight="900"
                letterSpacing="2"
              >
                MAHATMA GANDHI MARG · RING ROAD (NORTH)
              </text>
              <text
                x="947"
                y="450"
                transform="rotate(90 947 450)"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="12"
                fontWeight="900"
                letterSpacing="2"
              >
                AUGUST KRANTI MARG (EAST)
              </text>

              {/* Internal Road Corridors (Road 1, 2, 3, 4, 5, 6) */}
              {/* Road 1: Director's Avenue */}
              <path
                d="M 90 350 L 540 350"
                stroke="#fbbf24"
                strokeWidth="28"
                strokeLinecap="square"
              />
              <path
                d="M 90 350 L 540 350"
                stroke="#000000"
                strokeWidth="28"
                strokeDasharray="0"
                fill="none"
                opacity="0.15"
              />
              <line
                x1="90"
                y1="350"
                x2="540"
                y2="350"
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 6"
              />

              {/* Road 2: Academic & Hospital Access Way */}
              <path
                d="M 90 190 L 540 190 L 540 60"
                stroke="#fde047"
                strokeWidth="24"
                fill="none"
                strokeLinejoin="miter"
              />
              <path
                d="M 90 190 L 540 190 L 540 60"
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 6"
                fill="none"
              />

              {/* Road 3: Gymkhana Boulevard */}
              <path
                d="M 540 350 L 910 350 L 910 530"
                stroke="#86efac"
                strokeWidth="26"
                fill="none"
                strokeLinejoin="miter"
              />
              <line
                x1="540"
                y1="350"
                x2="910"
                y2="350"
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 6"
              />

              {/* Road 4: Central Academic Crescent */}
              <path
                d="M 535 190 L 535 520"
                stroke="#e2e8f0"
                strokeWidth="22"
                fill="none"
              />
              <line
                x1="535"
                y1="190"
                x2="535"
                y2="520"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />

              {/* Road 5: Hostels Promenade */}
              <path
                d="M 340 520 L 760 520 L 760 690"
                stroke="#fbcfe8"
                strokeWidth="22"
                fill="none"
              />
              <line
                x1="340"
                y1="520"
                x2="760"
                y2="520"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />

              {/* Road 6: East Gate / South Ext Connector */}
              <path
                d="M 910 290 L 760 290 L 760 520"
                stroke="#bae6fd"
                strokeWidth="22"
                fill="none"
              />
              <line
                x1="910"
                y1="290"
                x2="760"
                y2="290"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />

              {/* Road Number Markers & Badges */}
              {/* ROAD 1 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 1 (Director's Avenue)")}
              >
                <rect
                  x="200"
                  y="337"
                  width="95"
                  height="26"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                  filter="url(#neo-shadow)"
                />
                <text
                  x="247"
                  y="354"
                  textAnchor="middle"
                  fill="#ffd93d"
                  fontSize="10"
                  fontWeight="900"
                  letterSpacing="1"
                >
                  ★ ROAD 1
                </text>
              </g>

              {/* ROAD 2 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 2 (Academic Access)")}
              >
                <rect
                  x="200"
                  y="177"
                  width="95"
                  height="26"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                  filter="url(#neo-shadow)"
                />
                <text
                  x="247"
                  y="194"
                  textAnchor="middle"
                  fill="#fde047"
                  fontSize="10"
                  fontWeight="900"
                  letterSpacing="1"
                >
                  ★ ROAD 2
                </text>
              </g>

              {/* ROAD 3 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 3 (Gymkhana Boulevard)")}
              >
                <rect
                  x="720"
                  y="337"
                  width="95"
                  height="26"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                  filter="url(#neo-shadow)"
                />
                <text
                  x="767"
                  y="354"
                  textAnchor="middle"
                  fill="#86efac"
                  fontSize="10"
                  fontWeight="900"
                  letterSpacing="1"
                >
                  ★ ROAD 3
                </text>
              </g>

              {/* ROAD 4 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 4 (Central Crescent)")}
              >
                <rect
                  x="490"
                  y="265"
                  width="85"
                  height="24"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                />
                <text
                  x="532"
                  y="281"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9"
                  fontWeight="900"
                >
                  ROAD 4
                </text>
              </g>

              {/* ROAD 5 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 5 (Hostels Promenade)")}
              >
                <rect
                  x="380"
                  y="508"
                  width="85"
                  height="24"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                />
                <text
                  x="422"
                  y="524"
                  textAnchor="middle"
                  fill="#fbcfe8"
                  fontSize="9"
                  fontWeight="900"
                >
                  ROAD 5
                </text>
              </g>

              {/* ROAD 6 Badge */}
              <g
                className="cursor-pointer"
                onClick={() => setActiveRoad("Road No. 6 (East Connector)")}
              >
                <rect
                  x="800"
                  y="278"
                  width="85"
                  height="24"
                  fill="#000000"
                  stroke="#ffffff"
                  strokeWidth="2"
                  rx="4"
                />
                <text
                  x="842"
                  y="294"
                  textAnchor="middle"
                  fill="#bae6fd"
                  fontSize="9"
                  fontWeight="900"
                >
                  ROAD 6
                </text>
              </g>

              {/* Wayfinding Route Highlight Overlay */}
              {activeRoute && (
                <g className="pointer-events-none animate-pulse">
                  {/* Route path highlight glow */}
                  <path
                    d={
                      activeRoute.fromId === "gate-1" && activeRoute.toId === "quadrangle"
                        ? "M 90 350 L 420 350 L 420 390"
                        : activeRoute.fromId === "gate-1" && activeRoute.toId === "cr-desk-swimming-pool"
                        ? "M 90 350 L 600 350 L 600 390"
                        : activeRoute.fromId === "gate-1" && activeRoute.toId === "jl-auditorium"
                        ? "M 90 350 L 250 350 L 250 390"
                        : activeRoute.fromId === "gate-2" && activeRoute.toId === "teaching-block"
                        ? "M 90 190 L 260 190 L 260 230"
                        : activeRoute.fromId === "gate-4" && activeRoute.toId === "gymkhana"
                        ? "M 910 290 L 790 290 L 790 380"
                        : "M 90 350 L 420 350 L 420 390"
                    }
                    stroke="#ff6b6b"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray="10 6"
                    fill="none"
                  />
                  {/* Glowing Start Beacon */}
                  <circle cx="90" cy="350" r="14" fill="#ff6b6b" opacity="0.75" />
                  <circle cx="90" cy="350" r="7" fill="#ffffff" stroke="#000" strokeWidth="2" />
                </g>
              )}

              {/* Campus Buildings / Venues */}
              {CAMPUS_BUILDINGS.map((building) => {
                const isSelected = selectedBuilding?.id === building.id;
                const isVisible = filteredBuildings.some((b) => b.id === building.id);
                const opacity = isVisible ? 1 : 0.25;

                return (
                  <g
                    key={building.id}
                    className="cursor-pointer transition-transform duration-150 group"
                    onClick={() => focusBuilding(building)}
                    opacity={opacity}
                  >
                    {/* Building Base Footprint */}
                    <rect
                      x={building.x}
                      y={building.y}
                      width={building.width}
                      height={building.height}
                      rx={building.borderRadius || 6}
                      fill={building.accentColor}
                      stroke="#000000"
                      strokeWidth={isSelected ? "5" : "3.5"}
                      filter={isSelected ? "url(#neo-shadow-lg)" : "url(#neo-shadow)"}
                      className={isSelected ? "stroke-black" : "group-hover:stroke-black"}
                    />

                    {/* Distinct pattern for special venues */}
                    {building.id === "quadrangle" && (
                      <rect
                        x={building.x + 4}
                        y={building.y + 4}
                        width={building.width - 8}
                        height={building.height - 8}
                        rx="4"
                        fill="url(#quad-stripes)"
                        opacity="0.3"
                      />
                    )}

                    {building.id === "gymkhana" && (
                      <rect
                        x={building.x + 4}
                        y={building.y + 4}
                        width={building.width - 8}
                        height={building.height - 8}
                        rx="8"
                        fill="url(#sports-turf)"
                        opacity="0.35"
                      />
                    )}

                    {/* Building Code Badge (Top-Right) */}
                    <rect
                      x={building.x + building.width - 34}
                      y={building.y + 6}
                      width="28"
                      height="18"
                      fill="#000000"
                      rx="3"
                    />
                    <text
                      x={building.x + building.width - 20}
                      y={building.y + 19}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="900"
                    >
                      {building.code}
                    </text>

                    {/* Building Name Text */}
                    <text
                      x={building.x + 10}
                      y={building.y + 24}
                      fill={building.textColor || "#000000"}
                      fontSize="12"
                      fontWeight="900"
                      className="uppercase tracking-tight"
                    >
                      {building.shortName}
                    </text>

                    {/* Tag / Category Subtext */}
                    <text
                      x={building.x + 10}
                      y={building.y + 40}
                      fill="#000000"
                      fontSize="9"
                      fontWeight="800"
                      opacity="0.75"
                      className="uppercase"
                    >
                      {building.categoryLabel}
                    </text>

                    {/* Nearest Road Indicator Text inside building footprint */}
                    <text
                      x={building.x + 10}
                      y={building.y + building.height - 10}
                      fill="#000000"
                      fontSize="8"
                      fontWeight="900"
                      opacity="0.6"
                      className="font-mono uppercase"
                    >
                      📍 {building.nearestRoad.split("/")[0]}
                    </text>

                    {/* Active Selected Pulse Beacon */}
                    {isSelected && (
                      <g>
                        <circle
                          cx={building.x + building.width / 2}
                          cy={building.y - 12}
                          r="10"
                          fill="#ff6b6b"
                          stroke="#000000"
                          strokeWidth="2"
                        />
                        <circle
                          cx={building.x + building.width / 2}
                          cy={building.y - 12}
                          r="4"
                          fill="#ffffff"
                        />
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Campus Gates (Interactive Gate Badges 1 to 6) */}
              {CAMPUS_GATES.map((gate) => {
                const isSelected = selectedGate?.id === gate.id;

                return (
                  <g
                    key={gate.id}
                    className="cursor-pointer group"
                    onClick={() => focusGate(gate)}
                  >
                    {/* Gate Outer Hit Box */}
                    <rect
                      x={gate.x - 22}
                      y={gate.y - 14}
                      width="44"
                      height="28"
                      rx="4"
                      fill={isSelected ? "#ff6b6b" : "#000000"}
                      stroke="#ffffff"
                      strokeWidth="2"
                      filter="url(#neo-shadow)"
                      className="group-hover:fill-neo-accent transition-colors"
                    />

                    {/* Gate Text */}
                    <text
                      x={gate.x}
                      y={gate.y + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="900"
                      letterSpacing="0.5"
                    >
                      G{gate.number}
                    </text>

                    {/* Metro icon badge for Gate 1 & 2 */}
                    {gate.number === 1 && (
                      <g transform={`translate(${gate.x - 55}, ${gate.y - 12})`}>
                        <rect
                          width="26"
                          height="24"
                          fill="#facc15"
                          stroke="#000"
                          strokeWidth="2"
                          rx="3"
                        />
                        <text
                          x="13"
                          y="16"
                          textAnchor="middle"
                          fill="#000"
                          fontSize="10"
                          fontWeight="900"
                        >
                          M
                        </text>
                      </g>
                    )}
                    {gate.number === 2 && (
                      <g transform={`translate(${gate.x - 55}, ${gate.y - 12})`}>
                        <rect
                          width="26"
                          height="24"
                          fill="#facc15"
                          stroke="#000"
                          strokeWidth="2"
                          rx="3"
                        />
                        <text
                          x="13"
                          y="16"
                          textAnchor="middle"
                          fill="#000"
                          fontSize="10"
                          fontWeight="900"
                        >
                          M
                        </text>
                      </g>
                    )}
                    {gate.number === 4 && (
                      <g transform={`translate(${gate.x + 30}, ${gate.y - 12})`}>
                        <rect
                          width="26"
                          height="24"
                          fill="#f472b6"
                          stroke="#000"
                          strokeWidth="2"
                          rx="3"
                        />
                        <text
                          x="13"
                          y="16"
                          textAnchor="middle"
                          fill="#000"
                          fontSize="10"
                          fontWeight="900"
                        >
                          M
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Landmark Icons (Water, First Aid, Info, Fountain) */}
              {CAMPUS_LANDMARKS.map((lm) => (
                <g key={lm.id} className="pointer-events-none">
                  {lm.type === "medical" && (
                    <g transform={`translate(${lm.x}, ${lm.y})`}>
                      <circle cx="0" cy="0" r="10" fill="#ef4444" stroke="#000" strokeWidth="2" />
                      <path d="M -5 0 L 5 0 M 0 -5 L 0 5" stroke="#fff" strokeWidth="2.5" />
                    </g>
                  )}
                  {lm.type === "food" && (
                    <g transform={`translate(${lm.x}, ${lm.y})`}>
                      <circle cx="0" cy="0" r="10" fill="#38bdf8" stroke="#000" strokeWidth="2" />
                      <circle cx="0" cy="0" r="3" fill="#fff" />
                    </g>
                  )}
                  {lm.type === "info" && (
                    <g transform={`translate(${lm.x}, ${lm.y})`}>
                      <circle cx="0" cy="0" r="10" fill="#fbbf24" stroke="#000" strokeWidth="2" />
                      <text x="0" y="4" textAnchor="middle" fill="#000" fontSize="10" fontWeight="900">i</text>
                    </g>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Selected Venue or Gate Detail Side Panel */}
        <aside className="w-full border-t-6 border-black bg-white p-6 shadow-neo lg:w-96 lg:border-l-6 lg:border-t-0 lg:overflow-y-auto">
          {selectedBuilding ? (
            <div className="space-y-6">
              {/* Header Badge & Title */}
              <div>
                <div className="flex items-center justify-between border-b-2 border-black pb-3">
                  <div className="flex items-center gap-2">
                    <span className="border-2 border-black bg-neo-accent px-2 py-0.5 text-[10px] font-black uppercase text-white shadow-neo-xs">
                      {selectedBuilding.code}
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-black/70">
                      {selectedBuilding.categoryLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBuilding(null)}
                    className="border-2 border-black bg-neo-cream p-1 text-black hover:bg-neo-secondary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <h3 className="mt-3 text-2xl font-black uppercase tracking-tight text-black">
                  {selectedBuilding.name}
                </h3>
                <p className="mt-1 text-xs font-black uppercase tracking-wide text-neo-accent">
                  {selectedBuilding.tag}
                </p>
              </div>

              {/* Location & Road Connection Bar */}
              <div className="space-y-2 border-4 border-black bg-neo-cream p-4 shadow-neo-xs">
                <div className="flex items-start gap-2.5">
                  <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-black" strokeWidth={2.5} />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-black/60">
                      Nearest Road Number
                    </span>
                    <p className="text-xs font-black text-black">
                      {selectedBuilding.nearestRoad}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 border-t border-black/15 pt-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neo-accent" strokeWidth={2.5} />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-black/60">
                      Closest Campus Entrance
                    </span>
                    <p className="text-xs font-bold text-black">
                      {selectedBuilding.nearestGate}
                    </p>
                  </div>
                </div>

                {selectedBuilding.capacity && (
                  <div className="flex items-start gap-2.5 border-t border-black/15 pt-2">
                    <Layers className="mt-0.5 h-4 w-4 shrink-0 text-black" strokeWidth={2.5} />
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-black/60">
                        Venue Capacity
                      </span>
                      <p className="text-xs font-bold text-black">
                        {selectedBuilding.capacity}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-black/70">
                  Venue Overview
                </h4>
                <p className="mt-1.5 text-xs font-bold leading-relaxed text-black/85">
                  {selectedBuilding.description}
                </p>
              </div>

              {/* Events Taking Place in This Venue */}
              {selectedBuilding.eventsHosted.length > 0 && (
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-black/70">
                    Events &amp; Tournaments Hosted Here
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {selectedBuilding.eventsHosted.map((event, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 border-2 border-black bg-white p-2 text-xs font-bold shadow-neo-xs"
                      >
                        <Award className="h-3.5 w-3.5 shrink-0 text-neo-accent" />
                        <span>{event}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Available Facilities & Amenities */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-black/70">
                  Venue Amenities
                </h4>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold">
                  {selectedBuilding.amenities.restroom && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Restrooms</span>
                    </div>
                  )}
                  {selectedBuilding.amenities.water && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <Droplets className="h-3.5 w-3.5 text-sky-600" />
                      <span>Water Station</span>
                    </div>
                  )}
                  {selectedBuilding.amenities.firstAid && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <HeartPulse className="h-3.5 w-3.5 text-rose-600" />
                      <span>First Aid Post</span>
                    </div>
                  )}
                  {selectedBuilding.amenities.food && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <Coffee className="h-3.5 w-3.5 text-amber-600" />
                      <span>Food &amp; Snacks</span>
                    </div>
                  )}
                  {selectedBuilding.amenities.wheelchair && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <Accessibility className="h-3.5 w-3.5 text-indigo-600" />
                      <span>Wheelchair Ramp</span>
                    </div>
                  )}
                  {selectedBuilding.amenities.infoDesk && (
                    <div className="flex items-center gap-1.5 border border-black bg-neo-cream p-1.5">
                      <HelpCircle className="h-3.5 w-3.5 text-black" />
                      <span>Help Desk</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Set as Waypoint CTA */}
              <button
                type="button"
                onClick={() => {
                  setNavTo(selectedBuilding.id);
                  setShowWayfinder(true);
                }}
                className="w-full border-4 border-black bg-neo-secondary py-3 text-center text-xs font-black uppercase tracking-wider text-black shadow-neo-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
              >
                Directions to this Venue →
              </button>
            </div>
          ) : selectedGate ? (
            <div className="space-y-6">
              {/* Gate Info Card */}
              <div>
                <div className="flex items-center justify-between border-b-2 border-black pb-3">
                  <span className="border-2 border-black bg-black px-2 py-0.5 text-xs font-black uppercase text-white">
                    Gate No. {selectedGate.number}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedGate(null)}
                    className="border-2 border-black bg-neo-cream p-1 text-black hover:bg-neo-secondary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h3 className="mt-3 text-2xl font-black uppercase tracking-tight text-black">
                  {selectedGate.name}
                </h3>
                <p className="mt-1 text-xs font-bold text-black/75">
                  {selectedGate.street}
                </p>
              </div>

              <div className="space-y-3 border-4 border-black bg-neo-cream p-4 shadow-neo-xs text-xs font-bold">
                {selectedGate.metroConnection && (
                  <div className="flex items-start gap-2">
                    <Train className="h-4 w-4 shrink-0 text-black" />
                    <div>
                      <span className="text-[10px] font-black uppercase text-black/60">
                        Metro Access
                      </span>
                      <p>{selectedGate.metroConnection}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-2 border-t border-black/15 pt-2">
                  <Car className="h-4 w-4 shrink-0 text-black" />
                  <div>
                    <span className="text-[10px] font-black uppercase text-black/60">
                      Vehicle &amp; Cab Drop-off
                    </span>
                    <p>{selectedGate.dropOff}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs font-bold leading-relaxed text-black/85">
                {selectedGate.description}
              </p>

              <button
                type="button"
                onClick={() => {
                  setNavFrom(selectedGate.id);
                  setShowWayfinder(true);
                }}
                className="w-full border-4 border-black bg-neo-accent py-3 text-center text-xs font-black uppercase tracking-wider text-white shadow-neo-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
              >
                I Am At Gate {selectedGate.number} → Navigate Inside
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center border-4 border-black bg-neo-secondary shadow-neo-sm">
                <MapPin className="h-7 w-7 text-black" />
              </div>
              <h3 className="mt-4 text-xl font-black uppercase tracking-tight text-black">
                Select Any Building or Gate
              </h3>
              <p className="mt-2 max-w-xs text-xs font-bold text-black/70">
                Click on any building footprint, road number, or gate on the map to view instant directions, capacity, hosted events, and facilities.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Footer Info Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-6 border-black bg-black px-4 py-3 text-white text-xs font-black uppercase tracking-wider">
        <div className="flex items-center gap-2 text-neo-secondary">
          <Info className="h-4 w-4" />
          <span>Need Help? Visit Help Desks at Gate 1, Gate 2 &amp; Quadrangle Entrance</span>
        </div>
        <div className="flex items-center gap-4 text-white/80">
          <span>AIIMS Quadrangle · Ansari Nagar, New Delhi 110029</span>
        </div>
      </div>
    </div>
  );
}
