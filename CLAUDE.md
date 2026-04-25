# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A gear and ship calculator for Starborne Frontiers game. Users can import their game data (ships, gear, engineering stats), calculate optimal gear loadouts using autogear algorithms, and manage their fleet.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Supabase

## Development Commands

```bash
npm start              # Start dev server (Vite)
npm run lint           # ESLint check (max-warnings: 0)
npm run lint:fix       # Auto-fix ESLint issues
npm run format         # Prettier format all files
npm test               # Run Vitest tests
npm run fetch-ships    # Update ship data from external source
npm run fetch-buffs    # Update buff data from external source
npm run admin:import -- --file <path> --email <user@email.com>  # Import game data on behalf of a user (uses SUPABASE_SERVICE_ROLE_KEY)
```

## Architecture

### Data Flow & Storage Strategy

**Dual Storage System:** localStorage for unauthenticated users, Supabase for authenticated. All contexts use `useStorage` hook which abstracts persistence and syncs to Supabase on sign-in.

### Autogear System

**Location:** `src/utils/autogear/`

**Strategies** (`strategies/` folder): `GreedyStrategy` (fast single-pass), `TwoPassStrategy` (default, considers set bonuses). All implement `AutogearStrategy` interface.

**Progress Tracking:** `ProgressTracker` with event emitters for UI updates. Autogear is CPU-intensive — use Web Workers for heavy calculations.

### Ship Template Proposals System

**Purpose:** Crowdsource ship stat updates from user uploads. On import, extract level 60 ships, compare against `ship_templates`, submit diffs as proposals to `ship_template_proposals`. Admin approves via Admin Panel → Templates tab.

**Note:** Shield stat is excluded from comparisons (not properly implemented in game).

### Database Schema (Supabase)

**User Data Tables:** `users` (profiles + `is_admin`), `ships` (JSONB stats/equipment/refits), `inventory` (JSONB gear stats), `engineering_stats`

**System Tables:** `ship_templates`, `ship_template_proposals`, `daily_usage_stats`, `system_health`

### Game Data Import

**Entry Point:** `ImportButton` → `importPlayerData()`

**Key Mappings:**

- `HullPoints` → `hp`, `Power` → `attack`, `Defense` → `defence`, `Manipulation` → `hacking`
- `CritChance` → `crit` (multiply by 100)
- `ShieldPoints` → Ignored (not implemented in game)
- `CalibratedForUnitId` → `calibration.shipId` (nil UUID treated as uncalibrated)

**Engineering Points Conversion:** Flat stats divide by 2; percentage stats use as-is.

## Important Conventions

### File Organization

```text
src/
├── components/ui/   # Reusable UI primitives — always prefer these
├── contexts/        # React contexts for global state
├── hooks/           # Custom React hooks
├── pages/           # Route-level page components
├── services/        # API layer (Supabase, external APIs)
├── utils/           # Pure utility functions
├── constants/       # Static data (ship types, factions, gear slots, etc.)
└── types/           # TypeScript type definitions
```

### State Management

- **Global:** React Context (avoid prop drilling)
- **Persistence:** `useStorage` hook (localStorage + Supabase sync)
- **URL State:** React Router search params for shareable filters

### Styling

TailwindCSS utility-first, dark theme by default. Avoid inline styles unless dynamic.

### UI Components

**IMPORTANT:** Always use existing UI components from `src/components/ui/` instead of writing raw HTML elements with inline Tailwind classes.

**Containers & Layout:**

- Use the `card` CSS class (`bg-dark border border-dark-border p-4`) for any boxed/grouped content — never hand-roll card styles
- `Modal` / `ConfirmModal` for dialogs — never build custom modal markup
- `Offcanvas` for sliding panels
- `CollapsibleForm` / `CollapsibleAccordion` for expandable sections
- `Tabs` for tab navigation
- `PageLayout` for page-level structure
- `Tooltip` for hover info (portal-based, auto-repositioning)

**Form Controls:**

- `Button` (variants: `primary` | `secondary` | `danger` | `link`, sizes: `xs` | `sm` | `md` | `lg`)
- `Input` / `Textarea` / `Select` / `Checkbox` / `CheckboxGroup` — all support `label`, `error`, and `helpLabel` props
- `SearchInput` for search fields
- `RoleSelector` for ship role dropdowns (wraps `Select`)

**Data Display:**

- `StatCard` for metric cards (with color variants)
- `DataTable` for tabular data
- `BaseChart` / `ChartTooltip` for Recharts visualizations
- `Pagination` for paged lists
- `Loader` / `ProgressBar` for loading states

**Other:**

- `Dropdown` / `DropdownItem` for action menus
- `IconBadge` for icon badges
- `SectionHeader` for section titles
- Icons live in `src/components/ui/icons/` — check there before adding new icon markup
- `FilterPanel` + `usePersistedFilters` for filter/sort UI with localStorage persistence

**Rules:**

1. Never use raw `<button>` for standard actions — use `Button` with the appropriate variant and size. Exceptions: accordion/collapsible headers (full-width toggle areas), toggle chips/selection grids with custom visual states, autocomplete dropdown items, and non-interactive elements that only respond to hover (use `<span>` instead)
2. Never hand-roll card/box containers — use the `card` class
3. Never build custom modals/dialogs — use `Modal` or `ConfirmModal`
4. Never build custom form inputs — use `Input`, `Select`, `Checkbox`, etc. Exception: `<input type="file">` (no shared component for file inputs)
5. If a UI primitive doesn't exist yet, add it to `src/components/ui/` rather than inlining styles in a feature component

### Documentation Updates

When building or changing user-facing features, update `src/pages/DocumentationPage.tsx` to keep in-app docs in sync with the codebase.

## Testing

**Framework:** Vitest + React Testing Library. Focus on utility functions (autogear scoring, stat calculations) and data transformations (import pipeline).

## Database Migrations

**Location:** `supabase/migrations/` — naming: `YYYYMMDD[sequence]_description.sql`. Apply via Supabase CLI or dashboard.

## Authentication Flow

**Auth:** Supabase Auth (Google OAuth). Key events dispatched on the window:

- Sign-in: `app:migration:start` → sync localStorage → Supabase → `app:migration:end`
- Sign-out: `app:signout` (contexts listen and preserve localStorage)

Always dispatch `app:migration:end` even on error.

## Admin Panel

**Access:** `users.is_admin = true`

- **Analytics Tab:** Daily usage, top users (`get_top_active_users` RPC), total users
- **System Health Tab:** Table size monitoring (500 MB Supabase limit, ~15% overhead)
- **Templates Tab:** Review/approve ship template proposals

## External Integrations

**Cloudinary:** Image hosting for ship/gear icons. **frontiers.cubedweb.net:** Optional hangar sharing on data import.

## Security

### Rules — flag violations immediately

1. **No `dangerouslySetInnerHTML`** — ESLint rule `react/no-danger` is set to `error`. If you need to render HTML, find another way.
2. **No secrets in client code** — anything prefixed `VITE_` is bundled and public. Never add a server-side key (service role, private API key) with a `VITE_` prefix. Server-only operations belong in Supabase Edge Functions.
3. **Service role key is server-only** — `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. It must only appear in server-side scripts (`scripts/`, `e2e/helpers/`) and GitHub Actions secrets, never in a `VITE_` var or committed to `.env`.
4. **New Supabase tables need RLS** — every new table must have RLS enabled and policies for SELECT/INSERT/UPDATE/DELETE. User-owned tables use `public.has_profile_access(user_id)`. Admin-only tables use `public.is_admin()`. Tables without RLS are readable by any authenticated user.
5. **New user-facing inputs need validation** — any data crossing a trust boundary (file uploads, URL params, external API responses) must be validated before use. The game data import uses `src/schemas/exportedPlayData.ts` (Zod) as the pattern.
6. **`users.is_admin` is trigger-protected** — a `BEFORE UPDATE` trigger (`prevent_is_admin_escalation_trigger`) blocks non-admins from self-promoting. Never remove this trigger. Admin promotion is done manually via the Supabase dashboard.
7. **Public API keys need spending caps** — keys in `VITE_*` vars (Cloudinary, OpenRouter, Google, MIMO, Cubedweb) are visible to all users. Every such key must have a billing cap or rate limit set in its service dashboard.

### Patterns to follow

- **RLS helper:** `public.has_profile_access(user_id uuid)` — use this on all user-data table policies (handles both main accounts and alt accounts).
- **Import validation:** `validateExportedPlayData()` in `src/schemas/exportedPlayData.ts` — extend this schema if new fields are added to the import format.
- **Security headers:** Set in `netlify.toml` under `[[headers]]`. CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy are all live. Update the CSP `connect-src` if new external API domains are added.
- **Dependency hygiene:** `npm audit --omit=dev --audit-level=high` runs on every PR via `.github/workflows/security.yml`. Dependabot opens weekly PRs for outdated packages.

## Common Pitfalls

1. **Shield Stat:** Always exclude from comparisons/proposals (game bug)
2. **JSONB Fields:** Supabase stores stats as JSONB, not separate columns
3. **Stat Types:** `percentage` vs `flat` - crit/critDamage are always percentage
4. **Ship Deduplication:** Import dedupes ships by level/rank/stats/refit count
5. **Gear Assignment:** Must validate slot compatibility and ship ownership
6. **Migration Events:** Always dispatch `app:migration:end` even on error
