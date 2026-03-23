# Theme Switcher Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Add a theme switcher to the profile page, allowing authenticated users to switch between the existing dark theme and a new synthwave theme. The synthwave theme features a deep purple-navy palette with hot pink primary, cyan accents, and extensive visual flair effects.

## Themes

### Dark (default — current)

No changes to existing values. These become the default CSS custom property values. Variables store raw RGB channel values to support Tailwind's opacity modifier syntax (e.g., `bg-primary/50`).

| Token | Channels | Hex |
|-------|----------|-----|
| `--color-bg` | `17 24 39` | `#111827` |
| `--color-bg-lighter` | `31 41 55` | `#1f2937` |
| `--color-border` | `55 65 81` | `#374151` |
| `--color-primary` | `236 140 55` | `#ec8c37` |
| `--color-primary-hover` | `247 176 110` | `#f7b06e` |
| `--color-text` | `229 231 235` | `#e5e7eb` |
| `--color-text-secondary` | `156 163 175` | `#9ca3af` |
| `--color-accent` | `236 140 55` | `#ec8c37` |

### Synthwave

| Token | Channels | Hex |
|-------|----------|-----|
| `--color-bg` | `13 10 46` | `#0d0a2e` |
| `--color-bg-lighter` | `26 16 80` | `#1a1050` |
| `--color-border` | `42 26 94` | `#2a1a5e` |
| `--color-primary` | `255 45 155` | `#ff2d9b` |
| `--color-primary-hover` | `255 94 181` | `#ff5eb5` |
| `--color-text` | `224 208 255` | `#e0d0ff` |
| `--color-text-secondary` | `160 144 192` | `#a090c0` |
| `--color-accent` | `0 212 255` | `#00d4ff` |

## Architecture

### CSS Custom Properties Strategy

Colors are defined as CSS custom properties on `:root`. The `[data-theme="synthwave"]` selector overrides them. Tailwind config references the variables so existing utility classes (`bg-dark`, `border-dark-border`, `text-primary`) resolve to the active theme's values without changing component code.

### ThemeContext (`src/contexts/ThemeContext.tsx`)

- Stores theme in localStorage key `app_theme`
- On mount: reads localStorage, sets `data-theme` attribute on `document.documentElement`
- Provides `theme` (`'dark' | 'synthwave'`) and `setTheme()` via context
- Wrapped around the app in the provider tree

### FOUC Prevention

Add a synchronous inline `<script>` in `index.html` (before any CSS/JS) that reads `localStorage.getItem('app_theme')` and sets `document.documentElement.dataset.theme` immediately. This prevents a flash of the dark theme when a synthwave user loads the page.

### Tailwind Config Changes

Replace hardcoded hex values with CSS variable references. Variables use raw RGB channels to support Tailwind's opacity modifier syntax (`bg-primary/50`):

```js
colors: {
  primary: {
    DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
    hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
  },
  dark: {
    DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
    lighter: 'rgb(var(--color-bg-lighter) / <alpha-value>)',
    border: 'rgb(var(--color-border) / <alpha-value>)',
  },
  accent: 'rgb(var(--color-accent) / <alpha-value>)',
  text: {
    DEFAULT: 'rgb(var(--color-text) / <alpha-value>)',
    secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
  },
}
```

This adds `text-text` and `text-text-secondary` utilities (or use `textColor` extend to alias as `text-secondary`).

### Profile Page UI

New "Appearance" section in the profile page with a `Select` dropdown:
- Options: "Dark", "Synthwave"
- Change applies immediately on selection (no save button — localStorage only)
- Placed after the existing "Profile Settings" card, as its own card

### Hardcoded Color Audit

Components using hardcoded Tailwind colors (`text-gray-400`, `bg-gray-800`, `border-gray-600`, etc.) must be converted to semantic tokens. Key mappings:

- `text-gray-400` → `text-text-secondary`
- `text-gray-200` / `text-gray-300` → `text-text`
- `bg-gray-800` / `bg-gray-900` → `bg-dark` / `bg-dark-lighter`
- `border-gray-600` / `border-gray-700` → `border-dark-border`

**Strategy:** Do a grep-and-replace pass per pattern, then manually verify each file. This is part of the feature work, not deferred — the synthwave theme will look broken on any component still using hardcoded grays.

**CSS `theme()` calls:** `src/index.css` uses `theme('colors.dark.border')` and `theme('colors.gray.600')`. The `dark.border` call will resolve to the CSS variable string at build time (correct). The `gray.600` call must be replaced with `theme('colors.dark.border')` or the raw CSS variable.

### Recharts / Inline Hex Colors

Recharts components accept colors as string props (`stroke="#374151"`), not Tailwind classes. CSS variables can be used directly in Recharts props as `var(--color-border)` since they end up in inline SVG styles. However, create a `useThemeColors()` hook that returns resolved hex values as a fallback for any components where `var()` doesn't work:

```ts
// src/hooks/useThemeColors.ts
const useThemeColors = () => {
  const { theme } = useTheme();
  // Return computed hex values from CSS variables
  // using getComputedStyle(document.documentElement)
};
```

Affected files: `UsageChart.tsx`, `DPSChart.tsx`, `GrowthChart.tsx`, `ShipsStatsTab.tsx`, `EngineeringStatsTab.tsx`, `GearStatsTab.tsx`, `ImplantsStatsTab.tsx`, `Loader.tsx`, `EngineeringLeaderboards.tsx`.

### Button Gradient

The primary Button variant uses `from-amber-600 via-primary to-amber-600`. Under synthwave, `via-primary` resolves to hot pink but the amber stops remain. Add themed gradient stop variables:

- `--color-primary-gradient-from` — dark: `#d97706` (amber-600), synthwave: `#cc1a7a` (darker pink)
- `--color-primary-gradient-to` — dark: `#d97706`, synthwave: `#cc1a7a`

The Button primary variant becomes: `from-[rgb(var(--color-primary-gradient-from))] via-primary to-[rgb(var(--color-primary-gradient-to))]`.

### Flair CSS Location

All synthwave flair CSS lives in `src/index.css` within a `[data-theme="synthwave"]` block in the `@layer components` section. No separate file needed — keeps it discoverable and co-located with the `.card` and other component styles.

### Rarity Colors

Rarity colors (`rarity.*`, `rarityText.*`) are game-canonical and remain hardcoded / theme-independent.

## Synthwave Visual Flair

All flair effects are scoped to `[data-theme="synthwave"]` so they have zero impact on the dark theme.

### A — Perspective Grid Floor

CSS-only perspective grid on the page background. Cyan grid lines receding into the horizon, positioned at the bottom of the viewport. Uses `repeating-linear-gradient` with `perspective` transform. Subtle opacity so content remains readable.

### B — Sunset Gradient Header

Warm orange-to-pink gradient glow at the top of the page body, fading into the background color. Approximately 200px tall, using `linear-gradient` from `#ff6b2b20` through `#ff2d9b15` to `transparent`.

### C — Neon Card Glow

`.card` elements get:
- Default: `box-shadow: 0 0 8px rgba(255, 45, 155, 0.15)`, border-color with pink tint
- Hover: `box-shadow: 0 0 20px rgba(255, 45, 155, 0.3), 0 0 40px rgba(0, 212, 255, 0.1)`, border intensifies
- CSS transition on hover for smooth glow shift

### D — Neon Button Glow

Primary buttons (targeted via `[data-theme="synthwave"] button.shine-effect` which matches the Button primary variant's base class):
- Default: `box-shadow: 0 0 10px rgba(255, 45, 155, 0.4)`
- Hover: `box-shadow: 0 0 20px rgba(255, 45, 155, 0.6), 0 0 40px rgba(255, 45, 155, 0.3)`

### E — Glowing Headers

`h1`, `h2` elements (which already use `font-secondary` / Electrolize) get:
- `text-shadow: 0 0 10px rgba(255, 45, 155, 0.5), 0 0 20px rgba(255, 45, 155, 0.25)`

### F — CRT Scanlines

Full-page overlay using a `::after` pseudo-element on `body`:
- `background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)`
- `pointer-events: none`, fixed position, full viewport
- Very subtle opacity to avoid affecting readability

### G — Neon Accent Lines

- Cards: `border-top: 2px solid` with pink glow (`box-shadow: 0 -4px 8px rgba(255, 45, 155, 0.2)`)
- Section headers: left border accent with cyan glow
- Sidebar: bottom accent line

### H — CSS Starfield Background

Radial gradient dots scattered across the body background using multiple `background-image` layers of tiny radial gradients at fixed positions. A subtle CSS `@keyframes twinkle` animation varies opacity on a few "star" layers. Pure CSS, no JS, no performance impact.

## Storage

- **Key:** `app_theme`
- **Values:** `'dark'` | `'synthwave'`
- **Default:** `'dark'` (if no key exists)
- **Scope:** localStorage only, no Supabase sync
- **Access:** Authenticated users only (switcher on profile page)

## Out of Scope

- Supabase persistence / cross-device sync
- Theme access for unauthenticated users
- Additional themes beyond dark and synthwave
- Per-component theme overrides
- User-customizable colors
