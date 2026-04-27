# Autogear → Gear Upgrade Analysis Handoff

## Overview

Add a per-ship "Find Gear Upgrades" button to the autogear results. Clicking it navigates to the Gear page's Upgrade Analysis tab with the ship, role, and stat priorities pre-filled and the analysis auto-started.

## Problem

After running autogear, users often notice their ship is short on specific stats (e.g. 350 security, 120 speed). Finding which gear to upgrade for those stats requires manually re-configuring the Gear Upgrade Analysis — selecting the same ship, role, and stats that autogear already knows about. This handoff is tedious and error-prone.

## Solution

A URL-param-based handoff from AutogearPage to GearPage's Upgrade Analysis tab. No new state management or contexts — just an extension of GearPage's existing deep-link pattern.

---

## Section 1 — Button in AutogearPage

**Location:** Per-ship in the autogear results area. Only rendered when `shipResults[shipId]` exists (i.e. a run has completed for that ship). Sits alongside existing per-ship actions.

**On click — navigate to:**
```
/gear?tab=analysis&shipId={shipId}&role={resolvedRole}&stats={stat1,stat2,...}
```

**URL param construction:**
- `shipId` — the ship's ID from the autogear run
- `role` — `config.shipRole` for that ship; falls back to `ship.type` if `shipRole` is null
- `stats` — comma-joined stat names from `config.statPriorities` (e.g. `security,speed,hp`). Weights, limits, and hard requirement flags are not passed — this is a filter handoff, not a scoring handoff.

**Files touched:** `src/pages/manager/AutogearPage.tsx`

---

## Section 2 — GearPage URL param reading

GearPage already parses `?tab=` and `?shipId=` on mount via a `useEffect` over `useSearchParams`. Extend that same effect to also read:

- `role` — validated against `Object.keys(SHIP_TYPES)`; ignored if not a valid `ShipTypeName`
- `stats` — comma-split into `StatName[]`; each value validated against known stat names (`Object.keys(STATS)`); unknown values dropped silently

These are stored as local state (`initialRole`, `initialStats`) alongside the existing `initialShipId`. All three are passed down as props to `GearUpgradeAnalysis`. The URL params are consumed once on mount; they are not kept in sync with component state after that.

**Files touched:** `src/pages/manager/GearPage.tsx`

---

## Section 3 — GearUpgradeAnalysis auto-start

**New optional props:**
```ts
initialShipId?: string;
initialRole?: ShipTypeName;
initialStats?: StatName[];
```

**State initialization:** Props are used as `useState` initializers (not synced via `useEffect`), so they apply exactly once on first render.

**Stat filter mode:** When `initialStats` is provided, `statFilterMode` initializes to `'OR'` — show gear that has *any* of the priority stats. This is the most useful default for the autogear handoff use case.

**Auto-start:** A `useEffect` with an empty dependency array fires once on mount. If any initial prop is present (i.e. we arrived via the autogear handoff), it calls `handleAnalyze()` automatically. This mirrors the user expectation of landing with the analysis already running.

**Files touched:** `src/components/gear/GearUpgradeAnalysis.tsx`

---

## Data Flow

```
AutogearPage (has shipId, config.shipRole, config.statPriorities)
  └─► navigate('/gear?tab=analysis&shipId=X&role=Y&stats=a,b,c')
        └─► GearPage (reads URL params, sets initialShipId/initialRole/initialStats)
              └─► GearUpgradeAnalysis (initializes state from props, auto-calls handleAnalyze)
```

---

## Out of Scope

- Passing autogear stat weights or min/max limits into the scoring algorithm (deferred to a future enhancement)
- A "back to autogear" button from the analysis results
- Persisting the handoff config for future sessions
