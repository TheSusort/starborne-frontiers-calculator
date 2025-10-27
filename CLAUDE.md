# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A gear and ship calculator for Starborne Frontiers game. Users can import their game data (ships, gear, engineering stats), calculate optimal gear loadouts using autogear algorithms, and manage their fleet.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Supabase (primary), Firebase (legacy auth fallback)

## Development Commands

### Core Development

```bash
npm start              # Start dev server (Vite)
npm run build          # TypeScript compile + production build, although hot reload is always on, so you NEVER have to run this.
npm run serve          # Preview production build locally
```

### Code Quality

```bash
npm run lint           # ESLint check (max-warnings: 0)
npm run lint:fix       # Auto-fix ESLint issues
npm run format         # Prettier format all files
npm test               # Run Vitest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
```

### Data Scripts

```bash
npm run fetch-ships         # Update ship data from external source
npm run fetch-buffs         # Update buff data from external source
npm run migrate-ships       # Migrate ships to Supabase
npm run migrate-implants    # Migrate implants to Supabase
npm run migrate-to-supabase # Full migration to Supabase
```

## Architecture

### Data Flow & Storage Strategy

**Dual Storage System:**

1. **localStorage** - Local state for unauthenticated users
2. **Supabase** - Persistent storage for authenticated users

**Key Contexts** (all in `src/contexts/`):

- `ShipsContext` - Ship inventory management (CRUD ops)
- `InventoryProvider` - Gear/implant inventory
- `EngineeringStatsProvider` - Per-ship-type engineering bonuses
- `AuthProvider` - User authentication (Supabase primary, Firebase fallback)
- `AutogearConfigContext` - Saved autogear configurations

**Data Sync Pattern:**

- On sign-in: Migrate localStorage → Supabase
- On import: Update localStorage, then sync to Supabase if authenticated
- All contexts use `useStorage` hook which abstracts localStorage/Supabase persistence

### Storage Keys

Defined in `src/constants/storage.ts`:

- `ships` - User's ship collection
- `inventory_items` - Gear and implants
- `engineering_stats` - Ship type bonuses
- `autogear_configs` - Saved gear optimization configs
- `loadouts` / `team_loadouts` - Saved ship configurations

### Autogear System

**Location:** `src/utils/autogear/`

**Strategies:** (`strategies/` folder)

- `GreedyStrategy` - Fast single-pass optimization
- `TwoPassStrategy` - Two-pass with set bonus consideration (default)
- All implement `AutogearStrategy` interface

**Flow:**

1. User selects ship + stat priorities + bonuses
2. Strategy evaluates all gear combinations via scoring system
3. `calculateTotalScore()` weights stats by priority
4. Returns optimal gear suggestions per slot

**Progress Tracking:** Uses `ProgressTracker` with event emitters for UI updates

### Ship Template Proposals System

**Purpose:** Crowdsource ship stat updates from user uploads

**Flow:**

1. On game data import, extract level 60 ships
2. Compare against templates in `ship_templates` table
3. Submit differences as proposals to `ship_template_proposals`
4. Admin reviews/approves in Admin Panel → Templates tab
5. On approval, SQL function updates `ship_templates.base_stats`

**Key Files:**

- `src/utils/shipTemplateComparison.ts` - Comparison logic
- `src/services/shipTemplateProposalService.ts` - API layer
- `src/components/admin/TemplateProposalsTable.tsx` - Admin UI
- `supabase/migrations/20250205000*` - Database schema

**Note:** Shield stat is excluded from comparisons (not properly implemented in game)

### Database Schema (Supabase)

**User Data Tables:**

- `users` - User profiles, includes `is_admin` flag
- `ships` - User ship instances (JSONB for stats, equipment, refits)
- `inventory` - Gear pieces (JSONB for stats)
- `engineering_stats` - Per-user ship type bonuses

**System Tables:**

- `ship_templates` - Reference ship data at level 60
- `ship_template_proposals` - Crowdsourced stat updates (pending/approved/rejected)
- `daily_usage_stats` - Usage analytics
- `system_health` - Database health metrics

**Admin Features:**

- Analytics dashboard with user activity, growth metrics
- Table size monitoring (500 MB Supabase limit, ~15% overhead)
- Template proposal review system

### Game Data Import

**Format:** JSON export from Starborne Frontiers game

**Entry Point:** `ImportButton` component → `importPlayerData()`

**Transform Pipeline:**

1. Parse `Units` array → Ships (dedupe by stats/level/refit)
2. Parse `Equipment` array → Gear + Implants
3. Parse `Engineering` array → Ship type bonuses
4. Assign gear to ships via `EquippedOnUnit` IDs
5. Background: Extract level 60 ships → submit template proposals

**Key Mappings:**

- `HullPoints` → `hp`
- `Power` → `attack`
- `Defense` → `defence`
- `Manipulation` → `hacking`
- `CritChance` → `crit` (multiply by 100)
- `ShieldPoints` → Ignored (not implemented in game)

### Component Patterns

**Filter Pattern:** `FilterPanel` + `usePersistedFilters`

- Reusable filter/sort UI with localStorage persistence
- Used in: Ships page, Gear page, Ship Index

**Modal Pattern:** Shared modals in `src/components/ui/`

- `Modal` - Base modal wrapper
- `ConfirmModal` - Confirmation dialogs
- Context-based (open/close state in parent)

**Virtualization:** `react-window` for large lists (gear inventory)

## Important Conventions

### File Organization

```
src/
├── components/
│   ├── ui/          # Reusable UI primitives (Button, Input, Modal, etc.)
│   ├── ship/        # Ship-specific components
│   ├── gear/        # Gear-specific components
│   ├── autogear/    # Autogear UI components
│   └── admin/       # Admin panel components
├── contexts/        # React contexts for global state
├── hooks/           # Custom React hooks
├── pages/           # Route-level page components
├── services/        # API layer (Supabase, Firebase, external APIs)
├── utils/           # Pure utility functions
├── constants/       # Static data (ship types, factions, gear slots, etc.)
└── types/           # TypeScript type definitions
```

### State Management

- **Global:** React Context (avoid prop drilling)
- **Local:** useState/useReducer
- **Persistence:** `useStorage` hook (localStorage + Supabase sync)
- **URL State:** React Router search params for shareable filters

### TypeScript Patterns

- Strict mode enabled
- Prefer interfaces for objects, types for unions
- Use `as const` for constant objects
- Component props: `ComponentName: React.FC<PropsInterface>`

### Styling

- TailwindCSS utility-first
- Dark theme by default
- Custom colors in `tailwind.config.js`
- Avoid inline styles unless dynamic

### Documentation Updates

**IMPORTANT:** Whenever building a new feature or making changes to an existing feature, you MUST:

1. Review `src/pages/DocumentationPage.tsx`
2. Add or update relevant documentation for the feature
3. Ensure examples, explanations, and usage instructions are current

This keeps the in-app documentation synchronized with the actual codebase functionality.

## Testing Strategy

**Framework:** Vitest + React Testing Library

**Coverage Focus:**

- Utility functions (autogear scoring, stat calculations)
- Data transformations (import pipeline)
- Critical business logic

**Not Heavily Tested:**

- UI components (integration testing via manual QA)
- Context providers (complex setup)

## Database Migrations

**Location:** `supabase/migrations/`

**Naming:** `YYYYMMDD[sequence]_description.sql`

**Pattern:**

1. Schema changes first
2. Data migrations second
3. Functions/triggers last
4. Always include rollback comments

**Applied via:** Supabase CLI or dashboard

## Authentication Flow

**Primary:** Supabase Auth (Google OAuth)
**Fallback:** Firebase Auth (legacy)

**Toggle:** `VITE_USE_SUPABASE` env var

**On Sign-In:**

1. Auth state change detected
2. Trigger localStorage → Supabase migration
3. Dispatch `app:migration:start` event
4. Sync all data types (ships, inventory, engineering stats, etc.)
5. Dispatch `app:migration:end` event

**On Sign-Out:**

1. Dispatch `app:signout` event
2. Contexts listen and preserve localStorage
3. Clear Supabase session

## Admin Panel

**Access:** Users with `users.is_admin = true`

**Features:**

- **Analytics Tab:** Daily usage, top users, total users
- **System Health Tab:** Growth metrics, table sizes, user distribution
- **Templates Tab:** Review/approve ship template proposals

**Critical:** Table size monitoring shows warning colors as database approaches 500 MB Supabase limit (accounts for ~15% overhead)

## External Integrations

**Cloudinary:** Image hosting for ship/gear icons
**Hotjar:** Analytics (production only)
**frontiers.cubedweb.net:** Optional hangar sharing on data import

## Performance Considerations

- Autogear algorithms can be CPU-intensive (use Web Workers for heavy calculations)
- Large gear inventories use `react-window` virtualization
- Template proposal submissions run async, non-blocking during import
- Database queries use indexes on frequently filtered columns

## Common Pitfalls

1. **Shield Stat:** Always exclude from comparisons/proposals (game bug)
2. **JSONB Fields:** Supabase stores stats as JSONB, not separate columns
3. **Stat Types:** `percentage` vs `flat` - crit/critDamage are always percentage
4. **Ship Deduplication:** Import dedupes ships by level/rank/stats/refit count
5. **Gear Assignment:** Must validate slot compatibility and ship ownership
6. **Migration Events:** Always dispatch `app:migration:end` even on error
