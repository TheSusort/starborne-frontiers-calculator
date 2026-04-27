# Gear Slot Set Icon Header Background

**Date:** 2026-04-27
**Status:** Approved

## Overview

Two related improvements:
1. **Visual:** Add the gear set icon as a large decorative background element on the right side of the `GearPieceDisplay` header, with a gradient that fades left-to-right so the text stays readable.
2. **Caching:** Download all 28 gear set icons from Discord CDN and serve them as local static assets, removing the external dependency.

---

## Icon Caching

### Problem

All 28 `GEAR_SETS` entries in `src/constants/gearSets.ts` reference Discord CDN URLs (`https://cdn.discordapp.com/emojis/...`). Discord can change or block these URLs at any time.

### Solution

Download and commit all icons as local `.webp` files under `public/images/gear-sets/`. Update `gearSets.ts` to reference the local paths. Add a `fetch:gear-icons` npm script for future re-fetching.

### Files changed

- **`scripts/fetch-gear-icons.ts`** (new) — downloads all 28 Discord CDN `.webp` icons to `public/images/gear-sets/<SETNAME>.webp` (lowercase set key), using `fetch` + `fs.writeFile`. Idempotent: skips files that already exist unless `--force` is passed.
- **`public/images/gear-sets/`** (new directory) — 28 `.webp` files committed as static assets.
- **`src/constants/gearSets.ts`** — replace each `iconUrl` value from `https://cdn.discordapp.com/emojis/...` to `/images/gear-sets/<setname>.webp`.
- **`package.json`** — add `"fetch:gear-icons": "tsx scripts/fetch-gear-icons.ts"` script.

### Icon filename mapping

Each set key lowercased: `fortitude.webp`, `attack.webp`, `defense.webp`, `protection.webp`, `ambush.webp`, `critical.webp`, `speed.webp`, `boost.webp`, `burner.webp`, `decimation.webp`, `hacking.webp`, `leech.webp`, `repair.webp`, `reflect.webp`, `revenge.webp`, `shield.webp`, `cloaking.webp`, `abyssal_assault.webp`, `abyssal_safeguard.webp`, `abyssal_ward.webp`, `abyssal_breach.webp`, `omnicore.webp`, `swiftness.webp`, `recovery.webp`, `exploit.webp`, `piercer.webp`, `hardened.webp`.

---

## Visual Enhancement

### Goal

Match the screenshot: a large semi-transparent set icon sits in the right half of the header, with a left-to-right gradient that masks the icon's left edge — keeping the slot name, stars, and level text fully readable.

### Scope

Only `GearPieceDisplay.tsx`. All modes (`manage`, `select`, `full`, `compact`, `subcompact`). Only for non-implant gear (implants have distinct iconography). Rendered only when `slotInfo` (the set's `iconUrl`) is present.

### Structural changes to `GearPieceDisplay`

**Header `<div>`:** add `relative overflow-hidden` to the existing class string.

**Two new absolutely-positioned children** (inserted before the existing left-side content `<div>`):

```tsx
{!isImplant && slotInfo && (
    <>
        {/* Large decorative set icon — z-0 keeps it behind the flex content */}
        <img
            src={slotInfo}
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 -translate-y-1/2 h-[150%] w-auto opacity-20 pointer-events-none select-none z-0"
        />
        {/* Gradient overlay — masks the icon on the left so text is readable */}
        <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{ background: 'linear-gradient(to right, rgb(var(--color-bg)) 40%, transparent)' }}
        />
    </>
)}
```

**CSS variable:** `bg-dark` maps to `rgb(var(--color-bg) / <alpha-value>)` in `tailwind.config.js`. The gradient uses `rgb(var(--color-bg))` directly.

**Z-index layering:** both decorative elements use `z-0`. The existing flex content (text, buttons, tooltip trigger) is rendered after them in the DOM and sits naturally on top. The gradient has `pointer-events-none` so no hover/click events are blocked. The existing set icon tooltip (which has its own portal) is unaffected.

**Button readability:** the gradient goes from opaque (left 40%) to transparent (right). Action buttons sit at the right edge of the flex container where the gradient is fully transparent — buttons remain fully readable with no overlay.

### Why these values

- `h-[150%]` — taller than the header so the icon fills the full height without being letterboxed.
- `opacity-20` — subtle enough to not interfere with text, visible enough to add character.
- gradient stop at `40%` — leaves the left ~40% of the header fully clean for text/icons.
- `right-0` — icon anchored to the right edge.
- `aria-hidden="true"` + empty `alt` — purely decorative, hidden from assistive technology.

### No changes to

- `GearSlot.tsx`
- Any constants, types, or other components

---

## Implementation Order

1. Run `fetch-gear-icons.ts` script and commit the downloaded `.webp` files
2. Update `gearSets.ts` `iconUrl` values to local paths
3. Update `GearPieceDisplay.tsx` header with decorative icon + gradient
4. Verify in browser across multiple gear sets and all display modes
