# Starborne Frontiers Calculator - Design Style Guide

This document provides a comprehensive design system reference for the Starborne Frontiers Calculator project. Use this guide when implementing new features or components to maintain visual consistency.

## Table of Contents

1. [Color Palette](#color-palette)
2. [Typography](#typography)
3. [Buttons](#buttons)
4. [Borders & Containers](#borders--containers)
5. [Layout Patterns](#layout-patterns)
6. [Spacing System](#spacing-system)
7. [Effects & Animations](#effects--animations)
8. [Component Patterns](#component-patterns)
9. [Z-Index Layers](#z-index-layers)
10. [Responsive Breakpoints](#responsive-breakpoints)

---

## Color Palette

### Primary Colors

```css
/* Primary Orange - Main brand color */
primary: #ec8c37
primary-hover: #f7b06e
```

**Usage:**

- Primary buttons
- Active navigation items
- Focus states
- Accent highlights

### Dark Theme Colors

```css
/* Background colors */
dark: #111827          /* Main background */
dark-lighter: #1f2937  /* Elevated surfaces (cards, modals, inputs) */
dark-border: #374151   /* Borders, dividers */
```

**Usage:**

- `bg-dark` - Main page backgrounds, sidebar
- `bg-dark-lighter` - Cards, modals, input fields, elevated containers
- `border-dark-border` - All borders and dividers

### Rarity Colors

```css
/* Rarity background colors */
common: #d1d5db        /* Gray */
uncommon: #a3e635      /* Lime green */
rare: #3b82f6          /* Blue */
epic: #a855f7          /* Purple */
legendary: #f59e0b     /* Amber */
```

**Text Colors for Rarity:**

- `common`: `#111827` (dark text on light background)
- `uncommon`, `rare`, `epic`, `legendary`: `rgb(229 231 235)` (light text on colored background)

### Semantic Colors

```css
/* Standard Tailwind colors used */
gray-300, gray-400, gray-500, gray-600  /* Text, borders, disabled states */
red-500, red-600                        /* Errors, danger actions */
amber-600                               /* Used in primary button gradients */
```

### Background Images

- Sidebar and mobile header use: `bg-[url('/images/Deep_crevasse_01.png')]` with `bg-cover bg-center` or `bg-right`

---

## Typography

### Font Families

**Primary Font:** System default (sans-serif)

**Secondary Font (Headers & Buttons):** `Electrolize` (Google Fonts)

- Applied to: `h1-h6`, `button`, `nav > a`
- Usage: All headings, buttons, and navigation links

### Font Sizes

```css
xxs: 0.5rem    /* 8px - Extra small text */
sm: 0.875rem   /* 14px - Small text, descriptions */
base: 1rem     /* 16px - Body text */
lg: 1.125rem   /* 18px */
xl: 1.25rem    /* 20px - Section titles */
2xl: 1.5rem    /* 24px - Page titles */
```

### Font Weights

- `font-medium` - Buttons, labels
- `font-semibold` - Section headers, important text
- `font-bold` - Page titles, emphasis

### Text Colors

```css
/* Standard text colors */
text-white              /* Primary text on dark backgrounds */
text-gray-300          /* Secondary text, links */
text-gray-400          /* Tertiary text, descriptions, version numbers */
text-gray-500          /* Placeholder text */
text-dark              /* Text on light/primary backgrounds */
```

---

## Buttons

### Base Styles

All buttons include:

- `transition-colors` - Smooth color transitions
- `whitespace-nowrap` - Prevent text wrapping
- `shine-effect` - Animated shine on hover (see Effects section)
- `relative overflow-hidden` - Required for shine effect

### Variants

#### Primary Button

```css
text-dark
clip-1-corner
bg-gradient-to-br from-amber-600 via-primary to-amber-600
```

**Usage:** Main actions, primary CTAs

#### Secondary Button

```css
bg-dark
border border-gray-600
text-gray-300
hover:bg-dark-border
```

**Usage:** Secondary actions, cancel buttons, close buttons

#### Danger Button

```css
bg-gradient-to-r from-red-600 to-red-500
text-gray-300
hover:bg-gradient-to-r hover:from-red-500 hover:to-red-500
```

**Usage:** Destructive actions, delete buttons

#### Link Button

```css
text-gray-300
hover:text-white
!p-0
bg-dark
```

**Usage:** Text-only actions, minimal styling

### Button Sizes

```css
xs: px-2 py-1 text-xxs h-6        /* Extra small */
sm: px-2 py-1 text-sm h-8         /* Small */
md: px-4 py-2 h-10                /* Medium (default) */
lg: px-6 py-3 h-12                /* Large */
```

### Button States

- **Hover:** Color transitions (see variants above)
- **Disabled:** `opacity-50 cursor-not-allowed`
- **Active:** Primary buttons use active state for navigation items

### Full Width Buttons

Add `fullWidth` prop or `w-full` class for full-width buttons.

---

## Borders & Containers

### Border Colors

```css
border-dark-border        /* Standard borders (#374151) */
border-gray-600          /* Alternative borders */
border-primary            /* Active/selected states */
border-red-500            /* Error states */
```

### Border Styles

- **Standard:** `border` (1px solid)
- **Dotted:** `border-dotted` (used for skill names)
- **No border radius:** Most elements use sharp corners (futuristic aesthetic)

### Container Patterns

#### Cards/Containers

```css
bg-dark-lighter          /* Elevated background */
border border-gray-600   /* Standard border */
p-6                      /* Standard padding */
```

#### Input Fields

```css
bg-dark-lighter
border border-dark-border
focus:outline-none
focus:ring-2
focus:ring-primary
focus:border-primary
```

#### Modals

```css
bg-dark-lighter
border border-gray-600
shadow-xl
```

#### Sidebar Navigation Items

```css
/* Inactive */
border-dark-border
bg-dark

/* Active */
bg-primary
hover:bg-primary-hover
text-dark
border-primary
hover:border-primary-hover
```

### Special Border Effects

#### Section Split Effect

Used for navigation items and interactive elements:

```css
section-split-effect
```

Creates an animated border extension on hover (see Effects section).

---

## Layout Patterns

### Page Layout

Standard page structure using `PageLayout` component:

```tsx
<div className="space-y-8">
    <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="text-sm text-gray-400">{description}</p>}
    </div>
    {children}
</div>
```

### Sidebar Layout

**Desktop:**

- Fixed position: `fixed top-0 left-0 h-full w-64`
- Background: `bg-dark` with background image
- Z-index: `z-20`
- Padding: `p-4`

**Mobile:**

- Fixed header: `fixed top-0 left-0 right-0`
- Uses `Offcanvas` component for menu

### Content Area

- Desktop: `lg:ml-64` (offset for sidebar)
- Mobile: Full width with top padding for header

### Grid Layouts

Common patterns:

- `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`
- Responsive columns based on screen size

### Flexbox Patterns

```css
/* Common flex patterns */
flex justify-between items-center    /* Header rows */
flex flex-col gap-2                 /* Vertical stacks */
flex items-center gap-2             /* Horizontal groups */
```

---

## Spacing System

### Padding

```css
p-2    /* 8px - Tight spacing */
p-4    /* 16px - Standard padding */
p-6    /* 24px - Card/modal padding */
px-4   /* Horizontal padding */
py-2   /* Vertical padding */
```

### Margins

```css
mb-2   /* 8px - Small spacing */
mb-4   /* 16px - Standard spacing */
mb-6   /* 24px - Section spacing */
mt-2   /* Top margin */
space-y-2  /* Vertical spacing between children (8px) */
space-y-4  /* Vertical spacing between children (16px) */
space-y-8  /* Vertical spacing between children (32px) */
```

### Gaps

```css
gap-2  /* 8px - Small gap */
gap-3  /* 12px - Medium gap */
gap-4  /* 16px - Standard gap */
```

---

## Effects & Animations

### Shine Effect

Applied to buttons and interactive elements:

```css
shine-effect
```

Creates an animated shine sweep on hover (white overlay moving left to right).

### Section Split Effect

Used for navigation items:

```css
section-split-effect
```

Creates an animated border extension that moves outward on hover.

### Transitions

Standard transition patterns:

```css
transition-all duration-200 ease-in-out     /* Standard transitions */
transition-colors                            /* Color-only transitions */
transition-opacity duration-300              /* Fade transitions */
transition-transform duration-300           /* Transform transitions */
```

### Hover Effects

```css
hover:scale-105        /* Slight scale on hover */
hover:bg-primary-hover /* Color change */
hover:text-white       /* Text color change */
```

### Animations

#### Fade In

```css
animate-fadeIn
animation-delay-200    /* 0.2s delay */
animation-delay-400    /* 0.4s delay */
```

Fades in from below (opacity 0 → 1, translateY 20px → 0).

### Clip Paths

#### One Corner Clip

```css
clip-1-corner
```

Creates a clipped corner effect (used on primary buttons):

- Top-left corner clipped at 10px angle

#### Hex Clip

```css
clip-hex
```

Creates hexagonal shape (if needed for special elements).

---

## Component Patterns

### Modal

**Base Modal:**

- Backdrop: `bg-black bg-opacity-50`
- Container: `bg-dark-lighter border border-gray-600 shadow-xl`
- Header: `px-6 py-4 border-b border-gray-600`
- Content: `px-6 py-4 overflow-y-auto`
- Z-index: `z-50` (standard) or `z-[70]` (high priority)

### Offcanvas

**Panel:**

- Background: `bg-dark`
- Width: `w-72` (default) or `w-80`
- Position: `left` or `right`
- Z-index: `z-50`
- Backdrop: `bg-black bg-opacity-50`

### Input Fields

**Standard Input:**

```css
w-full
px-1 md:px-4
py-2
bg-dark-lighter
border border-dark-border
focus:outline-none
focus:ring-2
focus:ring-primary
focus:border-primary
placeholder-gray-500
h-10
```

**Error State:**

```css
border-red-500
```

### Tooltips

**Standard Tooltip:**

```css
bg-dark
border border-dark-border
p-2
rounded
```

**Alternative (lighter background):**

```css
bg-dark-lighter
border border-dark-lighter
```

### Navigation Items

**Structure:**

- Container: `mb-2`
- Link/Button: `px-4 py-2 border section-split-effect`
- Active state: Primary colors
- Inactive state: Dark background with border
- Hover: `hover:scale-105`

### Collapsible Sections

**Container:**

```css
transition-all duration-300 ease-in-out
overflow-hidden
```

**Content:**

```css
pl-4
border-l border-dark-border
```

---

## Z-Index Layers

```css
z-20    /* Sidebar, fixed headers */
z-40    /* Modal backdrop */
z-50    /* Modals, offcanvas panels */
z-[60]  /* Standard modal root */
z-[70]  /* Offcanvas root, high-priority modals */
z-[80]  /* Highest priority modal root */
```

**Usage:**

- Sidebar: `z-20`
- Modal backdrop: `z-40`
- Modal content: `z-50` or `z-[70]`
- Offcanvas: `z-50`
- Tooltips: `z-50` (via absolute positioning)

---

## Responsive Breakpoints

### Tailwind Defaults

```css
sm: 640px   /* Small devices */
md: 768px   /* Medium devices */
lg: 1024px  /* Large devices */
xl: 1280px  /* Extra large devices */
2xl: 1579px /* Custom 2xl breakpoint */
```

### Common Patterns

**Mobile First:**

- Default: Mobile styles
- `md:` - Tablet and up
- `lg:` - Desktop and up (sidebar visible)
- `xl:` - Large desktop
- `2xl:` - Extra large desktop

**Sidebar Visibility:**

- Mobile: Hidden, uses offcanvas menu
- Desktop (`lg:`): Fixed sidebar visible

**Grid Responsiveness:**

```css
grid-cols-1                    /* Mobile: 1 column */
md:grid-cols-2                  /* Tablet: 2 columns */
lg:grid-cols-3                  /* Desktop: 3 columns */
xl:grid-cols-4                  /* Large: 4 columns */
2xl:grid-cols-5                 /* Extra large: 5 columns */
```

---

## Special Utilities

### Scrollbars

**Vertical Scrollbar:**

- Width: `5px`
- Track: Transparent
- Thumb: `dark-border` color

**Horizontal Scrollbar (Tabs):**

```css
tabs-scrollbar
```

- Height: `6px`
- Thumb: `#4b5563` with hover state `#6b7280`

### Skill Text Styling

```css
skill-name      /* Yellow text with dotted underline */
skill-damage    /* Orange text */
skill-aid       /* Green text */
```

### Damage Type Filters

```css
filter-chemical      /* Green filter */
filter-electric      /* Blue filter */
filter-thermal       /* Red filter */
filter-antimatter    /* Purple filter */
```

---

## Design Principles

1. **Dark Theme First:** All designs assume dark background
2. **Sharp Corners:** Minimal border radius (futuristic aesthetic)
3. **Orange Accent:** Primary color (#ec8c37) for emphasis
4. **Smooth Transitions:** All interactive elements have transitions
5. **Consistent Spacing:** Use Tailwind spacing scale (2, 4, 6, 8)
6. **Accessibility:** Maintain contrast ratios, use semantic HTML
7. **Mobile First:** Design for mobile, enhance for desktop

---

## Quick Reference

### Common Class Combinations

**Card Container:**

```css
bg-dark-lighter border border-gray-600 p-6
```

**Primary Button:**

```css
bg-primary text-dark px-4 py-2 h-10 font-medium
```

**Secondary Button:**

```css
bg-dark border border-gray-600 text-gray-300 px-4 py-2 h-10
```

**Input Field:**

```css
bg-dark-lighter border border-dark-border px-4 py-2 h-10
```

**Page Title:**

```css
text-2xl font-bold
```

**Section Title:**

```css
text-xl font-semibold
```

**Body Text:**

```css
text-gray-300
```

**Secondary Text:**

```css
text-sm text-gray-400
```

---

## Notes for LLMs

When implementing new features:

1. **Always use Tailwind classes** - Avoid inline styles unless absolutely necessary
2. **Follow the color palette** - Use defined colors from `tailwind.config.js`
3. **Maintain spacing consistency** - Use the spacing system (2, 4, 6, 8)
4. **Apply transitions** - Add `transition-*` classes to interactive elements
5. **Use component patterns** - Reference existing components in `src/components/ui/`
6. **Test responsive** - Ensure mobile-first responsive design
7. **Check z-index** - Use appropriate z-index layers for overlays
8. **Maintain accessibility** - Use semantic HTML, proper ARIA labels, keyboard navigation

For questions about specific implementations, refer to:

- `src/components/ui/` - Reusable UI components
- `tailwind.config.js` - Color and theme configuration
- `src/index.css` - Global styles and utilities
