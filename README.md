# TARANG ’26 — NIT Patna Cultural Fest

The official website for **TARANG**, the cultural festival of NIT Patna — *Mute the Mundane*.
Five days of music, dance, drama, sports and med-science — built as a
neo-brutalist frontend in **Next.js (App Router) + TypeScript + Tailwind CSS v4**.

> **Status:** frontend-only. All content lives in a single typed data layer
> (`src/lib/data.ts`) so a backend can be wired in later without touching the UI.

## Quick start

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Production:

```bash
pnpm build
pnpm start
```

Lint:

```bash
pnpm lint
```

## Pages

| Route       | What's on it                                                        |
| ----------- | ------------------------------------------------------------------- |
| `/`         | Hero, about preview, categories, featured events, flow, pro shows, notices |
| `/about`    | Full story, venue, four pillars, timeline                            |
| `/events`   | All events with entry fees, prize pools, timings — filter + search   |
| `/schedule` | Day-wise schedule (5 tabs), night pro shows highlighted              |
| `/gallery`  | Photo grid (pattern placeholders until real shots land)              |
| `/notices`  | Official notice board                                                |
| `/team`     | Team cards grouped by committee                                      |
| `/reach`    | How to reach NIT Patna — train, flight, cab, bus                     |
| `/faqs`     | Accordion FAQs grouped by topic                                      |
| `/ask`      | Ask-a-question form (simulated submit)                               |
| `/pronite-pass` | The single Pronite Pass — ticket, perks and checkout             |
| `/verify`   | Pass / registration ID verifier (currently disabled)                 |

## Architecture

```
src/
├── app/                  # App Router pages (one folder per route)
│   ├── layout.tsx        # Root layout: Space Grotesk font, Navbar, Footer
│   ├── globals.css       # Neo-brutalism design tokens + textures
│   ├── events/           # page.tsx + EventsExplorer.tsx (client, filters)
│   ├── schedule/         # page.tsx + ScheduleBoard.tsx (client, day tabs)
│   ├── faqs/             # page.tsx + FaqAccordion.tsx (client)
│   ├── ask/              # page.tsx + AskForm.tsx (client, simulated submit)
│   └── verify/           # page.tsx + VerifyChecker.tsx (client, mock lookup)
├── components/
│   ├── layout/           # Navbar, Footer
│   ├── ui/               # Button, Badge, SectionHeading, PageHeader, Marquee, CategoryIcon
│   ├── cards/            # EventCard, ProShowCard, NoticeCard, TeamCard
│   └── home/             # Landing-page sections (Hero, AboutPreview, …)
└── lib/
    └── data.ts           # ★ Single source of truth for ALL content
```

### The data layer (`src/lib/data.ts`)

Every event, pro show, schedule item, notice, team member, FAQ, gallery tile,
route option and verification record is a typed export here. The UI only reads
from this file. **To add a backend later:**

- Replace the exported arrays with `fetch` calls (or Server Components reading
  a DB) — the shapes are already API-friendly (stable `id`s, flat, serializable).
- `AskForm` and `VerifyChecker` have clearly-marked `// Frontend-only for now`
  blocks where a `POST /api/questions` / `GET /api/verify` call should go.
- Mock verification records live in `VERIFY_RECORDS` (try `PULSE-2026-0001`).

## Design system — Neo-brutalism

Tokens are defined once in `src/app/globals.css` via Tailwind v4 `@theme`:

- **Palette:** cream `#FFFDF5`, hot red `#FF6B6B`, vivid yellow `#FFD93D`,
  soft violet `#C4B5FD`, pure black ink.
- **Shadows:** hard offset, zero blur — `shadow-neo-sm` (4px) → `shadow-neo-xl` (16px).
- **Borders:** `border-4` black everywhere; sharp corners (or `rounded-full` only).
- **Type:** Space Grotesk, weights 700/900, uppercase, tight tracking.
- **Motion:** mechanical push/lift hovers, marquees, slow-spin stars;
  `prefers-reduced-motion` respected.
- **Textures:** `.bg-halftone`, `.bg-grid-neo`, `.bg-dots-lg`, `.text-stroke`.

## Notes

- No vision/image tasks are used anywhere — gallery tiles render CSS pattern
  placeholders, so nothing depends on image analysis.
- Icons come from `lucide-react` (brand icons like Instagram are inlined as SVG).
- Fully responsive, keyboard-accessible, semantic HTML throughout.
