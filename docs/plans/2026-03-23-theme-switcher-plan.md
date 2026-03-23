# Theme Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a theme switcher on the profile page with dark (default) and synthwave themes, including full visual flair effects.

**Architecture:** CSS custom properties on `:root` swapped via `data-theme` attribute on `<html>`. Tailwind config references CSS variables so existing utility classes resolve to theme values. A `ThemeContext` manages state in localStorage. All synthwave flair is scoped behind `[data-theme="synthwave"]`.

**Tech Stack:** React 18, TypeScript, TailwindCSS 3, Vite, CSS custom properties

**Spec:** `docs/plans/2026-03-23-theme-switcher-design.md`

---

## File Structure

### New Files
- `src/contexts/ThemeContext.tsx` — Theme provider, localStorage persistence, `data-theme` attribute management
- `src/hooks/useThemeColors.ts` — Hook returning resolved hex color values for Recharts/SVG components

### Modified Files
- `index.html` — FOUC prevention script, body class updates
- `tailwind.config.js` — CSS variable references instead of hardcoded hex
- `src/index.css` — CSS custom property definitions, synthwave flair effects, fix `theme()` calls
- `src/App.tsx` — Wrap with `ThemeProvider`
- `src/pages/ProfilePage.tsx` — Appearance section with theme selector
- `src/components/ui/Button.tsx` — Themed gradient stops, fix hardcoded grays
- `src/components/ui/Loader.tsx` — Use theme colors for SVG strokes
- `src/components/ui/Input.tsx` — Replace `text-gray-400`
- `src/components/ui/Select.tsx` — Replace `text-gray-400`
- `src/components/ui/Textarea.tsx` — Replace `text-gray-400`
- `src/components/ui/Checkbox.tsx` — Replace `border-gray-600`, `text-gray-400`
- `src/components/ui/ProgressBar.tsx` — Replace `text-gray-400`
- `src/components/ui/StatCard.tsx` — Replace `text-gray-400`
- `src/components/ui/FeatureCard.tsx` — Replace `text-gray-400`
- `src/components/ui/SectionHeader.tsx` — Replace `text-gray-400`
- `src/components/ui/SearchInput.tsx` — Replace `text-gray-400`
- `src/components/ui/Image.tsx` — Replace `text-gray-400`
- `src/components/ui/QuickStartCard.tsx` — Replace `text-gray-300`
- `src/components/ui/MilestoneModal.tsx` — Replace `text-gray-300`
- `src/components/statistics/ShipsStatsTab.tsx` — Theme chart colors
- `src/components/statistics/GearStatsTab.tsx` — Theme chart colors
- `src/components/statistics/ImplantsStatsTab.tsx` — Theme chart colors
- `src/components/statistics/EngineeringStatsTab.tsx` — Theme chart colors
- `src/components/admin/UsageChart.tsx` — Theme chart colors
- `src/components/admin/GrowthChart.tsx` — Theme chart colors
- `src/components/admin/TopUsersTable.tsx` — Replace hardcoded grays
- `src/components/engineering/EngineeringLeaderboards.tsx` — Theme chart colors
- `src/components/calculator/DPSChart.tsx` — Theme background/text colors
- `src/components/calculator/DamageReductionChart.tsx` — Theme chart colors
- `src/components/calculator/DefensePenetrationChart.tsx` — Theme chart colors

---

## Task 1: CSS Custom Properties & Tailwind Config

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`

- [ ] **Step 1: Add CSS custom property definitions to index.css**

Add at the top of the `@layer base` block in `src/index.css`, before the existing `html` rule:

```css
:root {
    --color-bg: 17 24 39;
    --color-bg-lighter: 31 41 55;
    --color-border: 55 65 81;
    --color-primary: 236 140 55;
    --color-primary-hover: 247 176 110;
    --color-text: 229 231 235;
    --color-text-secondary: 156 163 175;
    --color-accent: 236 140 55;
    --color-primary-gradient-from: 217 119 6;
    --color-primary-gradient-to: 217 119 6;
}

[data-theme="synthwave"] {
    --color-bg: 13 10 46;
    --color-bg-lighter: 26 16 80;
    --color-border: 42 26 94;
    --color-primary: 255 45 155;
    --color-primary-hover: 255 94 181;
    --color-text: 224 208 255;
    --color-text-secondary: 160 144 192;
    --color-accent: 0 212 255;
    --color-primary-gradient-from: 204 26 122;
    --color-primary-gradient-to: 204 26 122;
}
```

- [ ] **Step 2: Fix theme() calls in index.css**

In `src/index.css`, replace the two `theme('colors.gray.600')` references:

Line 36-41 (scrollbar): `theme('colors.dark.border')` is already correct — it will resolve to the CSS variable.

Line 191 (skill-tooltip): Change `border-gray-600` to `border-dark-border`.

Line 208 (tooltip arrow): Change `theme('colors.gray.600')` to `theme('colors.dark.border')`.

- [ ] **Step 3: Update tailwind.config.js colors**

Replace the `colors` block in `tailwind.config.js`:

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
    'theme-text': {
        DEFAULT: 'rgb(var(--color-text) / <alpha-value>)',
        secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
    },
    rarity: {
        common: '#d1d5db',
        uncommon: '#a3e635',
        rare: '#3b82f6',
        epic: '#a855f7',
        legendary: '#f59e0b',
    },
    rarityText: {
        common: '#111827',
        uncommon: 'rgb(229 231 235)',
        rare: 'rgb(229 231 235)',
        epic: 'rgb(229 231 235)',
        legendary: 'rgb(229 231 235)',
    },
},
```

Note: `theme-text` avoids collision with Tailwind's built-in `text-*` utilities. Usage: `text-theme-text` for primary text, `text-theme-text-secondary` for secondary.

- [ ] **Step 4: Verify the dev server starts without errors**

Run: `npm start`
Expected: Dev server starts, no Tailwind compilation errors, existing pages render with correct dark theme colors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css tailwind.config.js
git commit -m "feat(theme): add CSS custom properties and update Tailwind config for theme switching"
```

---

## Task 2: FOUC Prevention & Body Classes

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add FOUC prevention script to index.html**

Add this inline script in the `<head>` section of `index.html`, just before the closing `</head>` tag:

```html
<script>
    (function() {
        var theme = localStorage.getItem('app_theme');
        if (theme && theme !== 'dark') {
            document.documentElement.setAttribute('data-theme', theme);
        }
    })();
</script>
```

- [ ] **Step 2: Update body classes**

The `<body>` tag currently uses `text-gray-300`. Change it to use the themed text color:

```html
<body class="text-theme-text bg-dark-lighter bg-gradient-to-bl from-dark-lighter to-dark bg-cover bg-center bg-fixed">
```

- [ ] **Step 3: Verify in browser**

Run: `npm start`
Expected: Page loads with same dark theme appearance. No flash of unstyled content.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(theme): add FOUC prevention script and update body classes"
```

---

## Task 3: ThemeContext

**Files:**
- Create: `src/contexts/ThemeContext.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create ThemeContext**

Create `src/contexts/ThemeContext.tsx`:

```tsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type Theme = 'dark' | 'synthwave';

interface ThemeContextValue {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'app_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'synthwave' ? 'synthwave' : 'dark';
    });

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem(STORAGE_KEY, newTheme);
        if (newTheme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', newTheme);
        }
    }, []);

    // Sync attribute on mount (in case FOUC script didn't run)
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = (): ThemeContextValue => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
```

- [ ] **Step 2: Wrap App with ThemeProvider**

In `src/App.tsx`, import `ThemeProvider` and wrap it right after `HelmetProvider`:

```tsx
import { ThemeProvider } from './contexts/ThemeContext';
```

In the return statement, add `<ThemeProvider>` between `<HelmetProvider>` and `<NotificationProvider>`, and close it before `</HelmetProvider>`. The current structure is:

```tsx
// BEFORE:
<HelmetProvider>
    <NotificationProvider>
        <AuthProvider>
            {/* ... */}
        </AuthProvider>
    </NotificationProvider>
</HelmetProvider>

// AFTER:
<HelmetProvider>
    <ThemeProvider>
        <NotificationProvider>
            <AuthProvider>
                {/* ... everything else unchanged ... */}
            </AuthProvider>
        </NotificationProvider>
    </ThemeProvider>
</HelmetProvider>
```

Also add `<div className="twinkle-stars" />` right after the opening `<main>` tag (line 117) for the starfield twinkling effect.

- [ ] **Step 3: Verify theme context works**

Run: `npm start`
Open browser DevTools console and run: `document.documentElement.setAttribute('data-theme', 'synthwave')`
Expected: Colors change to synthwave palette.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/ThemeContext.tsx src/App.tsx
git commit -m "feat(theme): add ThemeContext with localStorage persistence"
```

---

## Task 4: useThemeColors Hook

**Files:**
- Create: `src/hooks/useThemeColors.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useThemeColors.ts`:

```ts
import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeColors {
    bg: string;
    bgLighter: string;
    border: string;
    primary: string;
    primaryHover: string;
    text: string;
    textSecondary: string;
    accent: string;
    gridStroke: string;
    axisStroke: string;
}

const DARK_COLORS: ThemeColors = {
    bg: '#111827',
    bgLighter: '#1f2937',
    border: '#374151',
    primary: '#ec8c37',
    primaryHover: '#f7b06e',
    text: '#e5e7eb',
    textSecondary: '#9ca3af',
    accent: '#ec8c37',
    gridStroke: '#374151',
    axisStroke: '#9ca3af',
};

const SYNTHWAVE_COLORS: ThemeColors = {
    bg: '#0d0a2e',
    bgLighter: '#1a1050',
    border: '#2a1a5e',
    primary: '#ff2d9b',
    primaryHover: '#ff5eb5',
    text: '#e0d0ff',
    textSecondary: '#a090c0',
    accent: '#00d4ff',
    gridStroke: '#2a1a5e',
    axisStroke: '#a090c0',
};

export const useThemeColors = (): ThemeColors => {
    const { theme } = useTheme();
    return useMemo(() => (theme === 'synthwave' ? SYNTHWAVE_COLORS : DARK_COLORS), [theme]);
};
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useThemeColors.ts
git commit -m "feat(theme): add useThemeColors hook for chart components"
```

---

## Task 5: Profile Page Theme Selector

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Add Appearance section to ProfilePage**

In `src/pages/ProfilePage.tsx`, add imports:

```tsx
import { Select } from '../components/ui/Select';
import { useTheme, Theme } from '../contexts/ThemeContext';
```

Inside the component, after the existing hooks:

```tsx
const { theme, setTheme } = useTheme();
```

Add a new card section after the "Profile Settings" card (after the closing `</div>` of the first `.card` div, around line 266), before the Statistics section:

```tsx
{/* Appearance */}
<div className="card space-y-4">
    <h2 className="text-xl font-semibold">Appearance</h2>
    <Select
        label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
        helpLabel="Choose your visual theme. Changes apply immediately."
    >
        <option value="dark">Dark</option>
        <option value="synthwave">Synthwave</option>
    </Select>
</div>
```

- [ ] **Step 2: Verify in browser**

Run: `npm start`
Navigate to `/profile` (while logged in).
Expected: "Appearance" section visible with theme dropdown. Selecting "Synthwave" immediately changes colors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat(theme): add theme selector to profile page"
```

---

## Task 6: UI Component Color Audit

**Files:** All `src/components/ui/*.tsx` files with hardcoded gray classes

This task replaces hardcoded Tailwind gray classes with themed equivalents across all UI components.

**Mapping:**
- `text-gray-400` → `text-theme-text-secondary`
- `text-gray-300` → `text-theme-text`
- `text-gray-200` → `text-theme-text`
- `border-gray-600` → `border-dark-border`
- `hover:text-white` → keep as-is (white works in both themes)

- [ ] **Step 1: Update Button.tsx**

In `src/components/ui/Button.tsx`, update the variants object:

```tsx
const variants = {
    primary:
        'text-dark clip-1-corner bg-gradient-to-br from-[rgb(var(--color-primary-gradient-from))] via-primary to-[rgb(var(--color-primary-gradient-to))]',
    secondary: 'bg-dark border border-dark-border text-theme-text hover:bg-dark-border',
    danger: 'bg-gradient-to-r from-red-600 to-red-500 text-theme-text hover:bg-gradient-to-r hover:from-red-500 hover:to-red-500',
    link: 'text-theme-text hover:text-white !p-0 bg-dark',
};
```

- [ ] **Step 2: Update remaining UI components**

Apply the mapping to each file. For each file, replace all occurrences:

**`FeatureCard.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`SectionHeader.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`Image.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`SearchInput.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`StatCard.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`ProgressBar.tsx`:** `text-gray-400` → `text-theme-text-secondary` (3 occurrences)
**`Input.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`Select.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`Textarea.tsx`:** `text-gray-400` → `text-theme-text-secondary`
**`Checkbox.tsx`:** `border-gray-600` → `border-dark-border`, `text-gray-400` → `text-theme-text-secondary`
**`QuickStartCard.tsx`:** `text-gray-300` → `text-theme-text`
**`MilestoneModal.tsx`:** `text-gray-300` → `text-theme-text`

- [ ] **Step 3: Verify UI components render correctly**

Run: `npm start`
Expected: All UI components render with correct colors in both themes. Toggle between themes on the profile page to verify.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/
git commit -m "feat(theme): replace hardcoded gray classes in UI components with theme tokens"
```

---

## Task 7: Page-Level & Feature Component Color Audit

**Files:**
- `src/pages/ProfilePage.tsx`
- `src/components/statistics/ShipsStatsTab.tsx`
- `src/components/statistics/GearStatsTab.tsx`
- `src/components/statistics/ImplantsStatsTab.tsx`
- `src/components/statistics/EngineeringStatsTab.tsx`
- `src/components/admin/TopUsersTable.tsx`

- [ ] **Step 1: Update statistics tabs**

In each stats tab file, replace:
- `text-gray-400` → `text-theme-text-secondary`
- `text-gray-300` → `text-theme-text`
- `text-gray-200` → `text-theme-text`
- `border-gray-800` → `border-dark-border`

**ShipsStatsTab.tsx:** 5 occurrences of `text-gray-400`, 1 `border-gray-800`
**GearStatsTab.tsx:** 5 occurrences of `text-gray-400`, 1 `border-gray-800`
**ImplantsStatsTab.tsx:** 2 occurrences of `text-gray-400`
**EngineeringStatsTab.tsx:** 4 occurrences of `text-gray-400`

- [ ] **Step 2: Update TopUsersTable.tsx**

Replace:
- `text-gray-300` → `text-theme-text` (6 occurrences in table headers)
- `text-gray-200` → `text-theme-text`
- `text-gray-400` → `text-theme-text-secondary`
- `border-gray-800` → `border-dark-border`

- [ ] **Step 3: Update ProfilePage.tsx**

Replace:
- `text-gray-400` → `text-theme-text-secondary` (all occurrences — "Please sign in", ship type labels, "No ship rankings" empty state, etc.)

- [ ] **Step 4: Verify pages render correctly**

Run: `npm start`
Check profile page, statistics page, and admin panel in both themes.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfilePage.tsx src/components/statistics/ src/components/admin/TopUsersTable.tsx
git commit -m "feat(theme): replace hardcoded gray classes in page and feature components"
```

---

## Task 8: Chart Components — Theme Colors

**Files:**
- Modify: `src/components/statistics/ShipsStatsTab.tsx`
- Modify: `src/components/statistics/GearStatsTab.tsx`
- Modify: `src/components/statistics/ImplantsStatsTab.tsx`
- Modify: `src/components/statistics/EngineeringStatsTab.tsx`
- Modify: `src/components/admin/UsageChart.tsx`
- Modify: `src/components/admin/GrowthChart.tsx`
- Modify: `src/components/engineering/EngineeringLeaderboards.tsx`
- Modify: `src/components/calculator/DPSChart.tsx`
- Modify: `src/components/calculator/DamageReductionChart.tsx`
- Modify: `src/components/calculator/DefensePenetrationChart.tsx`
- Modify: `src/components/ui/Loader.tsx`

In each chart component, replace hardcoded hex grid/axis colors with `useThemeColors()`.

- [ ] **Step 1: Update statistics chart components**

Import and use the hook in each stats tab:

```tsx
import { useThemeColors } from '../../hooks/useThemeColors';
// inside component:
const colors = useThemeColors();
```

Replace in each file:
- `stroke="#374151"` (CartesianGrid) → `stroke={colors.gridStroke}`
- `stroke="#9CA3AF"` or `stroke="#9ca3af"` (XAxis/YAxis) → `stroke={colors.axisStroke}`

Do this in: `ShipsStatsTab.tsx`, `GearStatsTab.tsx`, `ImplantsStatsTab.tsx`, `EngineeringStatsTab.tsx`

Note: CHART_COLORS arrays (blue, green, yellow, purple, etc.) and RARITY_COLORS are data-visualization colors and should remain hardcoded — they are not theme-dependent.

- [ ] **Step 2: Update admin chart components**

Same pattern for `UsageChart.tsx` and `GrowthChart.tsx`:
- `stroke="#374151"` → `stroke={colors.gridStroke}`
- `stroke="#9CA3AF"` → `stroke={colors.axisStroke}`

And `EngineeringLeaderboards.tsx`:
- Grid/axis strokes → use `colors.gridStroke` / `colors.axisStroke`

- [ ] **Step 3: Update calculator chart components**

**DPSChart.tsx:**
- `backgroundColor: '#111827'` → `backgroundColor: colors.bg`
- `fill="#fff"` / `fill: '#fff'` → `fill={colors.text}` / `fill: colors.text`
- `stroke="#fff"` → `stroke={colors.text}`
- Grid stroke `#444` → `colors.gridStroke`

**DamageReductionChart.tsx:**
- CartesianGrid `#444` → `colors.gridStroke`
- tick `#fff` → `colors.text`

**DefensePenetrationChart.tsx:**
- CartesianGrid `#444` → `colors.gridStroke`
- Axis ticks/labels `#fff` → `colors.text`

- [ ] **Step 4: Update Loader.tsx**

In `src/components/ui/Loader.tsx`:
- `stroke="#fff"` → `stroke="rgb(var(--color-text-secondary))"`
- `stroke="#ec8c37"` → `stroke="rgb(var(--color-primary))"`

The Loader doesn't need the hook since it can use CSS variables directly in SVG inline styles.

- [ ] **Step 5: Verify all charts render correctly**

Run: `npm start`
Check statistics page, admin panel, and calculator pages in both themes.

- [ ] **Step 6: Commit**

```bash
git add src/components/statistics/ src/components/admin/ src/components/calculator/ src/components/engineering/ src/components/ui/Loader.tsx
git commit -m "feat(theme): apply theme colors to chart components and Loader"
```

---

## Task 9: Synthwave Flair Effects

**Files:**
- Modify: `src/index.css`

All flair CSS is scoped to `[data-theme="synthwave"]` and goes in the `@layer components` section of `src/index.css`.

- [ ] **Step 1: Add card glow and button glow (effects C, D)**

Add to `@layer components` in `src/index.css`:

```css
/* Synthwave: Neon card glow */
[data-theme="synthwave"] .card {
    border-color: rgb(var(--color-primary) / 0.3);
    box-shadow: 0 0 8px rgb(var(--color-primary) / 0.15);
    transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

[data-theme="synthwave"] .card:hover {
    border-color: rgb(var(--color-primary) / 0.6);
    box-shadow: 0 0 20px rgb(var(--color-primary) / 0.3), 0 0 40px rgb(var(--color-accent) / 0.1);
}

/* Synthwave: Neon button glow */
[data-theme="synthwave"] button.shine-effect {
    box-shadow: 0 0 10px rgb(var(--color-primary) / 0.4);
}

[data-theme="synthwave"] button.shine-effect:hover {
    box-shadow: 0 0 20px rgb(var(--color-primary) / 0.6), 0 0 40px rgb(var(--color-primary) / 0.3);
}
```

- [ ] **Step 2: Add glowing headers (effect E)**

```css
/* Synthwave: Glowing headers */
[data-theme="synthwave"] h1,
[data-theme="synthwave"] h2 {
    text-shadow: 0 0 10px rgb(var(--color-primary) / 0.5), 0 0 20px rgb(var(--color-primary) / 0.25);
}
```

- [ ] **Step 3: Add neon accent lines (effect G)**

Merge the accent line into the `.card` rule from step 1. The combined rule should be:

```css
/* Synthwave: Neon card glow + accent line */
[data-theme="synthwave"] .card {
    border-color: rgb(var(--color-primary) / 0.3);
    border-top: 2px solid rgb(var(--color-primary) / 0.5);
    box-shadow: 0 0 8px rgb(var(--color-primary) / 0.15), 0 -4px 8px rgb(var(--color-primary) / 0.2);
    transition: box-shadow 0.3s ease, border-color 0.3s ease;
}
```

Also add section header and sidebar accent lines:

```css
/* Synthwave: Section header accent */
[data-theme="synthwave"] h2 {
    padding-left: 0.5rem;
    border-left: 2px solid rgb(var(--color-accent) / 0.6);
    box-shadow: -4px 0 8px rgb(var(--color-accent) / 0.15);
}

/* Synthwave: Sidebar bottom accent */
[data-theme="synthwave"] nav {
    border-bottom: 2px solid rgb(var(--color-primary) / 0.4);
    box-shadow: 0 4px 8px rgb(var(--color-primary) / 0.15);
}
```

- [ ] **Step 4: Add CRT scanlines (effect F)**

```css
/* Synthwave: CRT scanlines */
[data-theme="synthwave"] body::after {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.06) 2px,
        rgba(0, 0, 0, 0.06) 4px
    );
    pointer-events: none;
    z-index: 50;
}
```

- [ ] **Step 5: Add sunset gradient header (effect B)**

```css
/* Synthwave: Sunset gradient at top */
[data-theme="synthwave"] body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 200px;
    background: linear-gradient(
        180deg,
        rgba(255, 107, 43, 0.12),
        rgba(255, 45, 155, 0.08),
        transparent
    );
    pointer-events: none;
    z-index: 0;
}
```

- [ ] **Step 6: Add perspective grid floor (effect A)**

Add a new utility class for the grid background. Apply it via a wrapper or the body background:

```css
/* Synthwave: Perspective grid floor */
[data-theme="synthwave"] #root::after {
    content: '';
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 40vh;
    background:
        repeating-linear-gradient(
            90deg,
            rgb(var(--color-accent) / 0.08) 0px,
            transparent 1px,
            transparent 80px
        ),
        repeating-linear-gradient(
            0deg,
            rgb(var(--color-accent) / 0.05) 0px,
            transparent 1px,
            transparent 40px
        );
    transform: perspective(300px) rotateX(50deg);
    transform-origin: bottom;
    pointer-events: none;
    z-index: 0;
    mask-image: linear-gradient(to top, rgba(0,0,0,0.6), transparent);
    -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,0.6), transparent);
}
```

- [ ] **Step 7: Add starfield background (effect H)**

```css
/* Synthwave: Starfield */
[data-theme="synthwave"] body {
    background-image:
        radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.7) 0%, transparent 100%),
        radial-gradient(1px 1px at 30% 65%, rgba(255,255,255,0.5) 0%, transparent 100%),
        radial-gradient(2px 2px at 50% 10%, rgba(255,255,255,0.8) 0%, transparent 100%),
        radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.4) 0%, transparent 100%),
        radial-gradient(1px 1px at 85% 75%, rgba(255,255,255,0.6) 0%, transparent 100%),
        radial-gradient(2px 2px at 15% 85%, rgba(255,255,255,0.5) 0%, transparent 100%),
        radial-gradient(1px 1px at 60% 90%, rgba(255,255,255,0.3) 0%, transparent 100%),
        radial-gradient(1px 1px at 40% 35%, rgba(255,255,255,0.6) 0%, transparent 100%),
        radial-gradient(2px 2px at 90% 15%, rgba(255,255,255,0.7) 0%, transparent 100%),
        radial-gradient(1px 1px at 25% 50%, rgba(255,255,255,0.4) 0%, transparent 100%),
        radial-gradient(1px 1px at 75% 60%, rgba(255,255,255,0.5) 0%, transparent 100%),
        radial-gradient(1px 1px at 5% 45%, rgba(255,255,255,0.3) 0%, transparent 100%);
    background-color: rgb(var(--color-bg));
}

/* Synthwave: Twinkling star layer */
[data-theme="synthwave"] .twinkle-stars {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background-image:
        radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.8) 0%, transparent 100%),
        radial-gradient(1px 1px at 65% 15%, rgba(255,255,255,0.6) 0%, transparent 100%),
        radial-gradient(2px 2px at 80% 55%, rgba(255,255,255,0.9) 0%, transparent 100%);
    animation: twinkle 4s ease-in-out infinite alternate;
}

@keyframes twinkle {
    0% { opacity: 0.3; }
    100% { opacity: 1; }
}
```

Note: The starfield `background-image` on body will override the Tailwind gradient classes. In `index.html`, the body currently has `bg-gradient-to-bl from-dark-lighter to-dark`. Since `[data-theme="synthwave"] body` sets `background-image` explicitly, this takes precedence in the synthwave theme. The dark theme continues to use the Tailwind gradient as before.

The `.twinkle-stars` class requires a DOM element. Add `<div className="twinkle-stars" />` inside `src/App.tsx`, right after the opening `<main>` tag. It only renders visually under `[data-theme="synthwave"]` due to the CSS scoping — in dark theme the class simply has no styles applied.

- [ ] **Step 8: Verify all flair effects in browser**

Run: `npm start`
Switch to synthwave theme. Expected:
- Starfield dots visible on background
- Sunset glow at top of page
- Perspective grid at bottom
- Cards have pink glow border with hover intensification
- Buttons glow pink
- Headers have text-shadow glow
- Subtle scanlines overlay
- Pink accent line on top of cards

- [ ] **Step 9: Commit**

```bash
git add src/index.css
git commit -m "feat(theme): add synthwave visual flair effects"
```

---

## Task 10: Remaining Hardcoded Colors Sweep

Tasks 6-7 cover UI primitives and statistics/admin. This task covers the remaining ~70+ files with hardcoded gray classes. Work through them by directory.

**Mapping (same as Tasks 6-7):**
- `text-gray-400` / `text-gray-500` → `text-theme-text-secondary`
- `text-gray-300` / `text-gray-200` → `text-theme-text`
- `bg-gray-800` / `bg-gray-900` / `bg-gray-700` → `bg-dark` or `bg-dark-lighter`
- `border-gray-600` / `border-gray-700` / `border-gray-800` → `border-dark-border`
- `hover:bg-gray-*` → `hover:bg-dark-lighter` or `hover:bg-dark-border`
- `divide-gray-*` → `divide-dark-border`

**Exceptions — do NOT change:**
- Colors inside `rarityText` / rarity-related conditional logic (game-canonical)
- Hardcoded colors that are intentionally fixed regardless of theme (e.g., specific data visualization labels)

- [ ] **Step 1: Search for all remaining hardcoded grays**

```bash
grep -rn "text-gray-\|bg-gray-\|border-gray-\|divide-gray-\|hover:bg-gray-" src/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".test."
```

- [ ] **Step 2: Fix pages directory**

Key files (high occurrence count):
- `src/pages/DocumentationPage.tsx` (~127 occurrences — this is the largest file, mostly prose styling)
- `src/pages/calculators/RecruitmentCalculatorPage.tsx` (~19 occurrences)
- `src/pages/database/ShipLorePage.tsx` (~18 occurrences)
- `src/pages/calculators/SpeedCalculatorPage.tsx` (~15 occurrences)
- `src/pages/calculators/DPSCalculatorPage.tsx`
- `src/pages/calculators/HealingCalculatorPage.tsx`
- `src/pages/calculators/DefenseCalculatorPage.tsx`
- `src/pages/calculators/DamageDeconstructionPage.tsx`
- `src/pages/calculators/ChronoReaverCalculatorPage.tsx`
- `src/pages/calculators/JsonDiffCalculatorPage.tsx`
- `src/pages/manager/ShipsPage.tsx`
- `src/pages/manager/GearPage.tsx`
- `src/pages/manager/SimulationPage.tsx`
- `src/pages/manager/EngineeringStatsPage.tsx`
- `src/pages/manager/LoadoutsPage.tsx`
- `src/pages/manager/EncounterNotesPage.tsx`
- `src/pages/manager/ShipDetailsPage.tsx`
- `src/pages/database/ShipIndexPage.tsx`
- `src/pages/database/LeaderboardPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/SharedEncountersPage.tsx`

- [ ] **Step 3: Fix admin components**

- `src/components/admin/ArenaModifiersTab.tsx` (~23 occurrences)
- `src/components/admin/AddShipTemplateForm.tsx` (~20 occurrences)
- `src/components/admin/TemplateProposalsTable.tsx` (~14 occurrences)
- `src/components/admin/TableSizesTable.tsx` (~10 occurrences)
- `src/components/admin/AnalyticsTab.tsx`
- `src/components/admin/SystemHealthTab.tsx`

- [ ] **Step 4: Fix feature components**

- `src/components/engineering/EngineeringPreviewTab.tsx` (~14 occurrences)
- `src/components/stats/StatBreakdown.tsx` (~13 occurrences)
- `src/components/gear/ShipCalibrationAnalysis.tsx` (~11 occurrences)
- `src/components/autogear/RecommendationContent.tsx` (~11 occurrences)
- `src/components/ship/*.tsx` — ship cards, ship display, etc.
- `src/components/gear/*.tsx` — gear cards, gear inventory, etc.
- `src/components/autogear/*.tsx` — autogear UI
- `src/components/encounter/*.tsx` — encounter components
- `src/components/loadout/*.tsx` — loadout components
- `src/components/import/*.tsx` — import components
- `src/components/changelog/*.tsx`
- `src/components/home/*.tsx`
- `src/components/notification/*.tsx`

- [ ] **Step 5: Fix remaining Sidebar and layout components**

- `src/components/ui/Sidebar.tsx` (or wherever the sidebar lives)
- Any remaining `src/components/ui/*.tsx` files not covered in Task 6

- [ ] **Step 6: Verify no remaining hardcoded grays**

Run grep again:
```bash
grep -rn "text-gray-\|bg-gray-\|border-gray-" src/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".test." | wc -l
```

Expected: 0 (or near-zero if some intentional exceptions remain)

- [ ] **Step 3: Full visual test**

Run: `npm start`
Test both themes on: Home page, Ships page, Gear page, Autogear page, Engineering page, Simulation page, Statistics page, Profile page, Documentation page, all calculator pages.

Look for:
- Text that disappears or becomes unreadable
- Borders that are invisible
- Backgrounds that clash
- Any remaining hardcoded gray that looks wrong in synthwave

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(theme): complete hardcoded color sweep for theme support"
```

---

## Task 11: Documentation Update

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (if theme switching is user-facing enough to document)

- [ ] **Step 1: Add theme documentation**

Add a brief section to the documentation page about the theme switcher — where to find it (Profile page), available themes, and that it's stored locally.

- [ ] **Step 2: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: add theme switcher documentation"
```
