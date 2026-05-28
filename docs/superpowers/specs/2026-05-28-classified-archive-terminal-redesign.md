# Classified Archive — Terminal Redesign Spec

**Date:** 2026-05-28
**Status:** Approved

---

## Overview

Replace the current card-stack layout of `/classified` with a two-screen terminal interface. Navigation uses arrow keys (or mouse click). The auth codes, localStorage persistence, corruption overlay, and all other mechanics from the original design are unchanged — only the presentation layer is reworked.

---

## Two-Screen Model

### Screen 1 — Index

The page opens in index mode. A single terminal card (same `max-w-2xl` width) contains:

```
// STARBORNE PLANNER
> ABYSS INCIDENT — CLASSIFIED ARCHIVE
[X/4 FRAGMENTS DECRYPTED]
──────────────────────────────
USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS

▶ THE DOORS WERE ALWAYS THERE        [DECRYPTED]
  FIRST CONTACT — FIELD REPORT       [LOCKED]
  INTERNAL MEMO — BLOCKADE CMD       [LOCKED]
  FURNACE SIGNAL — DECRYPTED PKT     [LOCKED]

──────────────────────────────
↑↓ move · ↵ open · ESC return to base
```

- The `▶` cursor sits on the currently focused row. It moves with `↑`/`↓`.
- Each fragment title renders in its accent colour (`text-indigo-400`, `text-yellow-400`, etc.).
- Status badge: `[DECRYPTED]` in green, `[LOCKED]` in red.
- The focused row gets a subtle green-tinted background highlight (`bg-green-950/30` or similar) and a left accent border.
- **Mouse:** hovering a row focuses it; clicking navigates into it.
- **`ESC`** from the index navigates to `/` (same as the current Return to Base button). The Return to Base button is removed — ESC replaces it.
- Arrow-key focus wraps: pressing `↓` on the last row focuses the first, and vice versa.

### Screen 2 — Fragment Detail

Pressing `Enter` (or clicking a row) transitions to detail mode. The same terminal card now shows the selected fragment.

**Locked state:**
```
// FRAGMENT ACCESS
FIRST CONTACT — FIELD REPORT
> ORIGIN FILE: ANOMALY DESIGNATION: THE_BLUDGEON
> STATUS: LOCKED — AUTH REQUIRED
──────────────────────────────
> ENTER AUTH CODE TO DECRYPT
> _

──────────────────────────────
↵ submit · ESC back to index
```

- Wrong code: the prompt line flashes red and shows `> [AUTHORIZATION FAILED]` for 800 ms, then resets.
- Correct code: decrypt bar animation plays (same `BAR_TOTAL = 22` bar in accent colour), then lore fades in with `classified-decode` animation.

**Unlocked state (read-only):**
```
// FRAGMENT ACCESS
THE DOORS WERE ALWAYS THERE
> ████████████████████ [DECRYPTED]
──────────────────────────────
The mechanisms predate every recorded civilisation...

They are not artifacts. They are not ruins.

They are doors.
──────────────────────────────
ESC back to index
```

**Decrypting transition:**
```
> STATUS: DECRYPTING...
> ███████████░░░░░░░░░░ 52%
```
Bar fills left-to-right in the fragment's accent colour. Once complete, the input row disappears and the lore content fades in.

---

## State Model

```ts
type Mode = 'index' | 'detail';

// Component state
const [mode, setMode] = useState<Mode>('index');
const [cursorIndex, setCursorIndex] = useState(0);          // 0–3, index screen cursor
const [activeFragmentId, setActiveFragmentId] = useState<string | null>(null);
```

Navigating into a fragment: `setMode('detail')` + `setActiveFragmentId(fragment.id)`.  
ESC from detail: `setMode('index')` + `setActiveFragmentId(null)`.  
ESC from index: `navigate('/')`.

All existing state (`unlocked`, `inputs`, `errors`, `decrypting`, `barProgress`, `intervalsRef`) is unchanged.

---

## Keyboard Handling

A single `useEffect` attaches a `keydown` listener on `window`. Logic is mode-dependent:

**Index mode:**
- `ArrowUp` — decrement `cursorIndex` (wrap at 0 → 3)
- `ArrowDown` — increment `cursorIndex` (wrap at 3 → 0)
- `Enter` — navigate into `CLASSIFIED_FRAGMENTS[cursorIndex]`
- `Escape` — `navigate('/')`

**Detail mode:**
- `Enter` — submit auth code (only if fragment is locked and not decrypting)
- `Escape` — return to index

The `keydown` listener must `preventDefault()` on `ArrowUp` and `ArrowDown` to prevent page scrolling. When detail mode's input is focused, `Enter` is handled natively by the input's `onKeyDown` (same as current implementation), so the window listener should skip `Enter` when the active element is an `<input>`.

---

## Layout & Visual

- Single terminal card replaces the multi-card stack. Same background layers, scanlines, and corruption overlay as now.
- Card uses existing `card` class + `backdrop-blur-sm`.
- No outer container changes — the `not-found-scanlines` wrapper and background layers are untouched.
- Screen transition: a brief `opacity-0 → opacity-100` fade (100 ms) on the card body content when switching modes, to avoid a jarring hard cut.
- The `classified-title-glitch` animation stays on the `> ABYSS INCIDENT` heading.
- The `classified-fragment-noise` overlay on locked fragments is removed (it was applied per-card; the new design has one card).
- The corruption static overlay (`classified-static`) continues to track `unlockedCount` → opacity steps unchanged.
- The final transmission block (4/4) appears at the bottom of the index screen once all fragments are unlocked, below the fragment list, inside the same card.

---

## Mouse Interaction

Each fragment row in the index is a `<div>` with:
- `onMouseEnter` → `setCursorIndex(i)`
- `onClick` → navigate into that fragment (same as `Enter`)
- `cursor-pointer` class

---

## What Does Not Change

- `src/constants/classifiedArchive.ts` — untouched
- Auth code logic, error flash timing, decrypt bar animation
- localStorage read/write pattern
- `Seo` noIndex, background images, scanlines
- `App.tsx` route
- Tests

---

## Out of Scope

- Left/right arrow navigation between fragments while in detail mode
- Animated "typing" print effect for lore text
- Sound effects
