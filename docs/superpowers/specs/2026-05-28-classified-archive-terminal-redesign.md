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
[X/4 FRAGMENTS DECRYPTED]   ← inside the same header block, not a separate element
──────────────────────────────
USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS

▶ THE DOORS WERE ALWAYS THERE        [DECRYPTED]
  FIRST CONTACT — FIELD REPORT       [LOCKED]
  INTERNAL MEMO — BLOCKADE CMD       [LOCKED]
  FURNACE SIGNAL — DECRYPTED PKT     [LOCKED]

──────────────────────────────
↑↓ move · ↵ open · ESC base
```

- The `▶` cursor sits on the currently focused row. It moves with `↑`/`↓`. The `▶` glyph is always `text-green-400` (terminal green) regardless of the focused row's accent colour.
- Each fragment title renders in its accent colour (`text-indigo-400`, `text-yellow-400`, etc.) — use `fragment.barColorClass` from the existing constant, which already holds the Tailwind colour class.
- Status badge: `[DECRYPTED]` in green, `[LOCKED]` in red.
- The focused row gets a subtle green-tinted background highlight (`bg-green-950/30` or similar) and a left accent border.
- **Mouse:** hovering a row focuses it; clicking navigates into it.
- **`ESC`** from the index navigates to `/` (same as the current Return to Base button). The Return to Base button is removed — ESC replaces it.
- Arrow-key focus wraps: pressing `↓` on the last row focuses the first, and vice versa.

### Screen 2 — Fragment Detail

Pressing `Enter` (or clicking a row) transitions to detail mode. The same terminal card now shows the selected fragment. The `// FRAGMENT ACCESS` line renders in muted gray (`text-gray-500`) — the same dim style as `// STARBORNE PLANNER` in the index.

**Locked state:**
```
// FRAGMENT ACCESS
FIRST CONTACT — FIELD REPORT
> ORIGIN FILE: ANOMALY DESIGNATION: THE_BLUDGEON — GELECEK FIELD INTELLIGENCE — FIELD AGENTS ONLY
> STATUS: LOCKED — AUTH REQUIRED
──────────────────────────────
> ENTER AUTH CODE TO DECRYPT
[<input> field on this line — the > _ is wireframe notation for the cursor inside the input, not a static text element]

──────────────────────────────
↵ submit · ESC back to index
```

The fragment title in the detail header uses the fragment's accent colour (same as the index row). The **SUBMIT button is removed** — submission is via `Enter` key only (input `onKeyDown`) or the window listener when the active element is not an `<input>`. No separate submit button is rendered.

The auth input is a raw `<input type="text">` with custom terminal styling — **deliberate exception** to the `Input` UI component convention (same as the current implementation). The terminal aesthetic requires inline-level styling that the shared `Input` component doesn't support.

The origin file line keeps the existing format verbatim: `> ORIGIN FILE: ${fragment.hintLine} — FIELD AGENTS ONLY`. The `> STATUS: LOCKED — AUTH REQUIRED` line is a new addition below it.

- Wrong code (including empty input): the prompt line flashes red and shows `> [AUTHORIZATION FAILED]` for 800 ms, then resets. Empty input is treated the same as a wrong code — no special handling.
- Correct code: decrypt bar animation plays (same `BAR_TOTAL = 22` bar in accent colour), then lore fades in with `classified-decode` animation applied to the lore content wrapper `<div>` only (same scope as current code — not the card body). During decryption the input is conditionally unmounted (same as current code), so the window `Enter` listener naturally cannot submit again.

The `classified-decode` animation will replay each time the user enters an already-unlocked fragment from the index (since navigating to detail mode re-mounts the detail content). This is intentional — the replay creates a nice "accessing archive" feel on re-entry.

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
The `> STATUS: DECRYPTING...` line is the new format for the detail view — replacing the current `> DECRYPTING...` line (the `STATUS:` prefix is added here to match the locked-state format). The percentage label (`52%`) is new; it is rendered alongside the bar characters and is calculated as `Math.round((barProgress[id] / BAR_TOTAL) * 100)`. The bar logic itself (step timing, `BAR_TOTAL = 22`, accent colour fill) is unchanged.

Once complete, the input row disappears and the lore content fades in. When the user later re-enters a fully-decrypted fragment, `isUnlocked` takes priority over any stale `decrypting` / `barProgress` values — the unlocked read-only view is shown, no special cleanup needed.

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
- `Enter` — submit auth code (only if fragment is locked and not decrypting). When the active element is not an `<input>`, the window listener looks up `activeFragmentId` in `CLASSIFIED_FRAGMENTS`, checks the condition, and calls `handleSubmit(activeFragmentId, inputs[activeFragmentId])`. When the fragment is already unlocked, this condition is false and `Enter` silently does nothing — no navigation or other side effect.
- `Escape` — return to index (blocked during active decryption — when `decrypting[activeFragmentId]` is true, `Escape` is ignored). Once decryption completes and `decrypting[id]` becomes false via React state, `Escape` automatically becomes available again — no separate re-enable step needed.

The `keydown` listener must `preventDefault()` on `ArrowUp` and `ArrowDown` to prevent page scrolling. When detail mode's input is focused, `Enter` is handled natively by the input's `onKeyDown` (same as current implementation), so the window listener should skip `Enter` when the active element is an `<input>`.

`Escape` in detail mode always returns to index — even when the auth input is focused. The window listener handles `Escape` unconditionally (no `activeElement` check needed).

---

## Edge-Case Behaviours

- **Auto-focus on detail entry:** When navigating into a locked fragment (locked state, not decrypting), the auth input is auto-focused so the user can type immediately without clicking. This applies every time the detail screen is entered (including re-entry after returning from index), handled naturally by the `autoFocus` attribute on the input element. When the fragment is already decrypting or unlocked on entry, no input is rendered and no focus logic is needed.
- **Cursor retention on ESC:** When returning from detail to index, `cursorIndex` is not reset — it stays on whichever row was last opened, so the user's position is preserved.
- **Mouse + keyboard coexistence:** `onMouseEnter` sets `cursorIndex` immediately, overriding any keyboard-set position. This is intentional — mouse hover always wins.

---

## Layout & Visual

- Single terminal card replaces the multi-card stack. Same background layers, scanlines, and corruption overlay as now.
- The two screens use **conditional rendering** inside the card body: `{mode === 'index' && <IndexScreen>}` and `{mode === 'detail' && <DetailScreen>}`. This ensures the detail content is fully unmounted when returning to index, so `classified-decode` re-fires naturally on re-entry without any additional logic.
- Card uses existing `card` class + `backdrop-blur-sm`.
- No outer container changes — the `not-found-scanlines` wrapper and background layers are untouched.
- Screen transition: the index and detail content wrappers are conditionally rendered with `key` props (`key="index"` / `key={activeFragmentId}`). Because React unmounts and remounts keyed elements, `transition-opacity` cannot animate between modes — instead, each content wrapper carries `className="classified-decode"` so the existing CSS animation fires on mount. This provides the mode-switch fade naturally without any extra state or refs. The animation also fires when the index screen remounts after returning from detail, and when the detail screen remounts for each new fragment — both are intentional.
- The `classified-title-glitch` animation stays on the `> ABYSS INCIDENT` heading.
- The `classified-fragment-noise` overlay on locked fragments is removed (it was applied per-card; the new design has one card).
- The corruption static overlay (`classified-static`) continues to track `unlockedCount` → opacity steps unchanged.
- The final transmission block (4/4) appears at the bottom of the index screen once all fragments are unlocked, appended below the fragment list rows inside the same outer card `<div>` (not a separate card element). It renders only when `mode === 'index'` — it is not shown in the detail view. Apply `classified-decode` to the wrapper `<div>` of the final transmission content (same as current code) so it animates in when the index screen is rendered.
- Both hint lines in the index are retained: the header hint ("USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS") above the fragment list, and the footer key legend ("↑↓ move · ↵ open · ESC base") below the divider. They serve different purposes — the header is a brief instruction for new visitors; the footer is a compact reference.

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
