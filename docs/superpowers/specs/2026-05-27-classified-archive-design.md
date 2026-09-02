# Classified Archive — Design Spec

**Date:** 2026-05-27
**Status:** Approved (v2)

---

## Overview

A hidden terminal page (`/classified`) housing 4 locked lore fragments about the Abyss hivemind. Players discover it by following hints on the default 404 page, visiting Easter egg URLs to find auth codes, and entering those codes to unlock fragments. No nav link — found by exploring.

The narrative arc: the Mechanisms were doors, the Bludgeon was first contact, the blockade exists to contain not protect, and something already came through.

---

## Discovery Flow

1. **Default 404 page** — after the progress bar, a new rotating line appears:
   `> TRANSMISSION REF: [slug]`
   The slug is drawn randomly (on each page load) from the full pool of all ~25 existing Easter egg slugs — not just the 4 code-bearing ones. Most hints lead to pure lore flavor. Four lead to auth codes.

2. **Easter egg pages (4 of them)** — each gets one new terminal line added to its `terminalLines` sequence or appended below the bar:
   `> SIGNAL ID: [REDACTED]`
   Hovering `[REDACTED]` reveals the auth code. No other change to those pages.

3. **`/classified`** — player enters the auth code into a terminal-style input under the relevant locked fragment. On correct entry, the fragment decrypts and unlocks. Code + unlock state persisted in `localStorage` so it survives page reloads.

---

## The Four Fragments

| # | Fragment title | Source Easter egg | Bar color |
|---|---|---|---|
| 1 | The Doors Were Always There | `/the-mechanisms` | `text-indigo-400` |
| 2 | First Contact — Field Report | `/the-bludgeon` | `text-yellow-400` |
| 3 | Internal Memo — Blockade Command | `/the-abyss` | `text-purple-400` |
| 4 | Furnace Signal — Decrypted Packet | `/furnace-of-heaven` | `text-orange-400` |

**Content:** placeholder lore at ship time; real dev-sourced campaign/NPC text to be swapped in when available. The system is content-agnostic — fragment body is a plain string.

---

## Auth Codes

Short, thematic, manually chosen — not generated. 6–10 characters. Examples:
- Fragment 1: `DOOR-7A`
- Fragment 2: `HIVE-3X`
- Fragment 3: `KEEP-OUT`
- Fragment 4: `ALREADY`

Exact codes are set as constants in the data file alongside the fragment content. No server-side validation — all client-side. This is deliberately low-security; the point is discovery, not gatekeeping.

**Input normalization:** the player's input is `.trim().toUpperCase()` before comparison, so `keep-out`, `KEEP-OUT`, and `  keep-out  ` all match `KEEP-OUT`.

**Single source of truth:** auth codes live only in `src/constants/classifiedArchive.ts` inside the `CLASSIFIED_FRAGMENTS` array. The `authCode` field on `EasterEggConfig` in `NotFoundPage.tsx` is set by importing the same constant — never duplicated as a string literal.

---

## `/classified` Page — Structure & Behaviour

### Header
```
// ABYSS INCIDENT — CLASSIFIED ARCHIVE
[X/4 FRAGMENTS DECRYPTED]
```
Glitch animation on the title, matching 404 aesthetic. Subtitle updates as fragments unlock.

### Corruption level
A `data-unlocked` attribute (0–4) on the page root drives a CSS opacity step for the static overlay:
- 0/4: `opacity-60` (heavy noise)
- 1/4: `opacity-40`
- 2/4: `opacity-25`
- 3/4: `opacity-10`
- 4/4: `opacity-0` (clears entirely); final transmission appears at the bottom

Transition: `transition-opacity duration-700` on the overlay element so each unlock fades smoothly.

### Fragment slot — locked state
- Static/noise overlay on the content area
- Hint line: `> ORIGIN FILE: [EASTER EGG HINT] — FIELD AGENTS ONLY`
  The hint is a cryptic description pointing at the source Easter egg URL without naming it directly (e.g. "Gravimetric anomaly survey — Tau Scorpii region" for `the-mechanisms`).
- Terminal input: `ENTER AUTH CODE > _`
- On wrong entry: brief red flash + `[AUTHORIZATION FAILED]`
- On correct entry: triggers decrypt animation

### Fragment slot — unlocked state
- Decrypt animation: progress bar fills (same mechanic as the 404 bar), then content fades in
- Color accent matches the source Easter egg's `barColorClass`
- Lore fragment renders in monospace, same style as Easter egg body text
- Small `[DECRYPTED]` badge in the accent color

### Final transmission (4/4 only)
A short additional block appears below all fragments once all 4 are unlocked. Thematically: the fragments assembled reveal something that none of them said individually. Content TBD pending dev lore.

---

## `/classified` Page — Visual Design

Extends the 404 terminal aesthetic:
- Same `not-found-scanlines`, scanline overlay, `font-secondary`, dark background
- Same `card` container, but wider (`max-w-2xl`) to accommodate fragment panels
- Background image: same Deep Crevasse or a new void/space image if available
- Heavier corruption effects than the 404 — more glitch, more static, feels "deeper"
- Each fragment panel is its own `card`-classed sub-container

No top navigation rendered on this page (same as 404 — full-screen overlay).

---

## Data Shape

```ts
interface ClassifiedFragment {
  id: string;                // e.g. 'the-mechanisms'
  title: string;
  hintLine: string;          // shown in locked state, cryptic pointer to source egg
  authCode: string;          // correct code, stored client-side
  body: string;              // lore text, multiline
  barColorClass: string;     // accent color, matches source Easter egg
  sourceEggSlug: string;     // the Easter egg URL that holds the auth code
}
```

localStorage key: `classified_unlocked` — array of unlocked fragment IDs (strings).

**Read pattern:** always wrap in try/catch with fallback to `[]`; validate that the parsed value is an array before use:

```ts
function readUnlocked(): string[] {
  try {
    const raw = localStorage.getItem('classified_unlocked');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
```

---

## Easter Egg Pages — Change

Four Easter egg entries in `EASTER_EGGS` (in `NotFoundPage.tsx`) get a new optional field:

```ts
interface EasterEggConfig {
  // ... existing fields ...
  authCode?: string;   // if present, show hoverable [REDACTED] line
}
```

The `[REDACTED]` reveal uses CSS hover: a `<span className="group inline-block cursor-pointer">` wrapping a child `<span className="blur-sm group-hover:blur-none transition-[filter] duration-300 select-all font-mono">` containing the plain-text code. No JS required. The code is readable in the DOM source — intentional; this is casual ARG, not a cryptographic lock.

---

## 404 Page — Change

One new line added to the reveal section (after the `[CORRUPTED]` bar resolves, below the existing content):

```
> TRANSMISSION REF: [random-slug]
```

Rendered in `text-gray-600` or similar — subtle, easy to miss. The slug is chosen once per mount using a `useState` lazy initializer:

```ts
const [hintSlug] = useState(
  () => EASTER_EGG_SLUGS[Math.floor(Math.random() * EASTER_EGG_SLUGS.length)]
);
```

where `EASTER_EGG_SLUGS = Object.keys(EASTER_EGGS)`. This is stable across Strict Mode double-invocations (unlike `useMemo`) and does not re-randomize on re-renders.

---

## Routing

Add `/classified` to the React Router config. No auth guard — it's just a URL. Security through obscurity is the point.

---

## Out of Scope

- No server-side code tracking or analytics on unlocks
- No social sharing mechanic ("share your unlock")
- No hint system beyond what's described — if a player is stuck, that's fine
- No mobile-specific layout changes beyond what responsive CSS handles naturally
- Per-faction locked pages (deferred — possible future expansion)
