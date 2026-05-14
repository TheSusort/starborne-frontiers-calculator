# Starborne Frontiers Calculator

A fleet and gear calculator for [Starborne Frontiers](https://starborne.com/). Import your game data and get optimal gear loadouts, DPS/healing projections, and engineering spend recommendations for your ships.

**Live app:** https://starborneplanner.com

---

## Features

- **Game data import** — paste your exported hangar data to sync ships, gear, and implants
- **Autogear** — automatically finds the best gear combination for a ship given a scoring strategy
- **DPS Calculator** — skill damage projections with per-ship buff pickers and enemy debuffs
- **Healing Calculator** — charged heal support, HoT simulation, and bubble/round charts
- **Engineering Optimizer** — optimize engineering point allocation across your starred ships
- **Gear Wishlist** — track gear you're farming with filters for slot, rarity, set bonus, and stats
- **Fleet management** — star ships, manage refits, and track gear assignments across your fleet
- **Ship details & skills** — full stat breakdowns and skill data per ship

---

## Getting started

### Prerequisites

- Node.js v20+
- A Supabase project (free tier is fine for local dev)

### Install

```bash
git clone https://github.com/TheSusort/starborne-frontiers-calculator.git
cd starborne-frontiers-calculator
npm install
```

### Environment variables

Create a `.env.local` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional — needed for ship/gear icons
VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name

# Optional — needed for hangar sharing via frontiers.cubedweb.net
VITE_CUBEDWEB_PUBLIC_KEY=your-key
```

### Run

```bash
npm start
```

---

## Development commands

| Command | Description |
|---|---|
| `npm start` | Start dev server |
| `npm run build` | Production build |
| `npm test` | Run unit tests (Vitest) |
| `npm run lint` | ESLint (zero warnings policy) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier format |
| `npm run fetch-buffs` | Update buff data from external source |
| `npm run e2e` | Run end-to-end tests (Playwright) |

---

## Project structure

```
src/
├── components/
│   └── ui/          # Shared UI primitives (Button, Input, Modal, etc.)
├── contexts/        # React contexts for global state
├── hooks/           # Custom React hooks
├── pages/           # Route-level page components
├── services/        # API layer (Supabase, external APIs)
├── utils/           # Pure utility functions
│   └── autogear/    # Gear optimisation strategies and scoring
├── constants/       # Static game data (ships, factions, gear slots, buffs)
└── types/           # TypeScript type definitions
```

### Key architectural decisions

**Storage:** A `useStorage` hook abstracts all persistence. Unauthenticated users get localStorage; on sign-in, data syncs to Supabase automatically. Contexts never talk to storage directly.

**Autogear:** Lives in `src/utils/autogear/`. Two strategies — `GreedyStrategy` (fast, single-pass) and `TwoPassStrategy` (default, accounts for set bonuses). Both implement the `AutogearStrategy` interface. Heavy runs use Web Workers to avoid blocking the UI.

**Auth:** Supabase Auth (Google OAuth). Sign-in triggers `app:migration:start` → localStorage-to-Supabase sync → `app:migration:end`. Contexts listen for `app:signout` to revert to localStorage.

**Game data import:** Entry point is `ImportButton` → `importPlayerData()`. Raw export JSON is validated with Zod (`src/schemas/exportedPlayData.ts`) before any processing.

---

## Contributing

Issues and PRs are welcome. For larger changes, open an issue first to discuss the approach.

---

## License

[MIT](./LICENSE)

---

## Tech stack

React 18 · TypeScript · Vite · TailwindCSS · Supabase (auth + database) · Vitest · Playwright
