# Starborne Frontiers Calculator - Design Style Guide

Quick reference for project-specific design patterns and customizations.

## Color Palette

### Custom Colors (from `tailwind.config.js`)

```css
/* Primary */
primary: #ec8c37
primary-hover: #f7b06e

/* Dark Theme */
dark: #111827              /* Main background */
dark-lighter: #1f2937      /* Cards, modals, inputs */
dark-border: #374151       /* Borders */

/* Rarity Colors */
rarity-common: #d1d5db
rarity-uncommon: #a3e635
rarity-rare: #3b82f6
rarity-epic: #a855f7
rarity-legendary: #f59e0b

/* Rarity Text Colors */
rarityText-common: #111827
rarityText-uncommon/rare/epic/legendary: rgb(229 231 235)
```

**Usage:**

- `bg-dark` / `bg-dark-lighter` / `border-dark-border` for containers
- `bg-primary` / `text-primary` for accents
- `bg-rarity-{name}` for rarity backgrounds

### Standard Colors Used

- `gray-300/400/500/600` - Text and borders
- `red-500/600` - Errors, danger actions
- `amber-600` - Primary button gradients

### Background Images

- Sidebar/header: `bg-[url('/images/Deep_crevasse_01.png')] bg-cover bg-right`

## Typography

**Font:** `Electrolize` applied to `h1-h6`, `button`, `nav > a` via CSS

**Custom Size:** `text-xxs` (0.5rem / 8px)

**Text Colors:**

- `text-white` - Primary text
- `text-gray-300` - Secondary text
- `text-gray-400` - Tertiary/descriptions
- `text-dark` - Text on light backgrounds

## Custom Utility Classes

### Effects

- `shine-effect` - Animated shine sweep on hover (buttons)
- `section-split-effect` - Animated border extension on hover (navigation)
- `animate-fadeIn` - Fade in from below (with `animation-delay-200/400`)

### Clip Paths

- `clip-1-corner` - Clipped top-left corner (primary buttons)
- `clip-hex` - Hexagonal shape

### Scrollbars

- `tabs-scrollbar` - Horizontal scrollbar for tabs (6px height, gray thumb)

### Skill Text

- `skill-name` - Yellow with dotted underline
- `skill-damage` - Orange text
- `skill-aid` - Green text

### Damage Type Filters

- `filter-chemical` - Green filter
- `filter-electric` - Blue filter
- `filter-thermal` - Red filter
- `filter-antimatter` - Purple filter

## Button Variants

Use the `Button` component from `src/components/ui/Button.tsx`:

```tsx
<Button variant="primary|secondary|danger|link" size="xs|sm|md|lg" />
```

**Styles:**

- **Primary:** `text-dark clip-1-corner bg-gradient-to-br from-amber-600 via-primary to-amber-600` + `shine-effect`
- **Secondary:** `bg-dark border border-gray-600 text-gray-300 hover:bg-dark-border` + `shine-effect`
- **Danger:** `bg-gradient-to-r from-red-600 to-red-500 text-gray-300` + `shine-effect`
- **Link:** `text-gray-300 hover:text-white !p-0 bg-dark`

## Component Patterns

### Containers

- **Cards/Modals:** `bg-dark-lighter border border-gray-600 p-6`
- **Inputs:** `bg-dark-lighter border border-dark-border focus:ring-2 focus:ring-primary focus:border-primary h-10`
- **Tooltips:** `bg-dark border border-dark-border p-2 rounded`

### Navigation Items

- **Inactive:** `bg-dark border border-dark-border px-4 py-2 section-split-effect`
- **Active:** `bg-primary hover:bg-primary-hover text-dark border-primary`

### Layout

- **Sidebar:** `fixed top-0 left-0 h-full w-64 bg-dark z-20` (desktop)
- **Content:** `lg:ml-64` offset for sidebar
- **Page:** `space-y-8` with `text-2xl font-bold` titles

## Z-Index Layers

```
z-20    Sidebar, fixed headers
z-40    Modal backdrop
z-50    Modals, offcanvas, tooltips
z-[60]  Standard modal root
z-[70]  High-priority modals, offcanvas root
z-[80]  Highest priority modal root
```

## Responsive Breakpoints

Custom `2xl: 1579px` breakpoint. Sidebar visible at `lg:` (1024px+).

## Design Principles

1. **Dark theme** - Always use dark backgrounds
2. **Sharp corners** - Minimal/no border radius (futuristic)
3. **Orange accent** - `primary` (#ec8c37) for emphasis
4. **Smooth transitions** - Add `transition-*` to interactive elements
5. **Mobile first** - Design mobile, enhance for desktop

## Quick Reference

**Card:** `bg-dark-lighter border border-gray-600 p-6`
**Primary Button:** `bg-primary text-dark px-4 py-2 h-10 font-medium`
**Input:** `bg-dark-lighter border border-dark-border px-4 py-2 h-10`
**Page Title:** `text-2xl font-bold`
**Section Title:** `text-xl font-semibold`
**Body Text:** `text-gray-300`
**Secondary Text:** `text-sm text-gray-400`

## Reference Files

- `tailwind.config.js` - Color definitions
- `src/index.css` - Custom utilities and global styles
- `src/components/ui/` - Reusable components
