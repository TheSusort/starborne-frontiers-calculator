# Auth modal redesign — design

**Date:** 2026-04-25
**Component:** `src/components/auth/AuthModal.tsx`
**Status:** Design approved by user; awaiting implementation plan.

## Problem

The current sign-in/sign-up modal is functional but visually generic. Specific issues:

- Inherits `Modal`'s `max-w-4xl` width — far too wide for a 2-input auth dialog.
- Heavy intro paragraph competes with the actions for attention.
- Email-form view stacks three secondary buttons of equal weight (submit, mode-toggle, back), so the primary CTA does not stand out.
- No brand presence — pure form, no Starborne identity.
- No transition between the choice and form sub-views.

## Goals

- A focused, branded auth dialog that reads as part of Starborne Planner, not a stock form.
- Clear primary CTA in the email-form view.
- Works in both default and synthwave themes without per-theme markup branches.
- Mobile-friendly: collapses to a clean single-column form below `sm`.

## Non-goals

- Changing the auth flow (Google + email/password sign-in / sign-up) or the providers wired up in `AuthProvider`.
- Adjusting the shared `Modal` component itself. The redesign happens inside `AuthModal` only.
- Adding new auth providers (Apple, GitHub, magic link, etc.).
- Password reset / forgot-password flows.

## Layout

A two-pane modal at **`max-w-lg` (≈520px)** on desktop, full-width form-only below the `sm` breakpoint.

```
┌──────────────────────────────────────────┐
│  BRAND PANEL          │   FORM PANEL     │
│  (Deep Crevasse bg)   │   (Sign In)      │
│                       │                  │
│  // STARBORNE PLANNER │   Sign In    [×] │
│                       │                  │
│  Sync your fleet      │   [G] Google     │
│  across devices.      │   ───── or ───── │
│                       │   Email          │
│  Optional. Local-     │                  │
│  first by default.    │                  │
│  ─────────────        │                  │
└──────────────────────────────────────────┘
```

### Brand panel (left, ~45% width, desktop only)

- **Background:** `/images/Deep_crevasse_01.png`, `center / cover`, with a top-to-bottom dark gradient overlay (`rgba(11,16,24,.45)` → `rgba(11,16,24,.85)`) so text stays legible.
- **Wordmark:** `// STARBORNE PLANNER` in Electrolize, brand orange (`primary`), wide tracking, uppercase, ~0.6rem.
- **Headline:** "Sync your fleet across devices." in Electrolize, white, ~1.1rem, two lines.
- **Disclaimer:** "Optional. Local-first by default." in `text-theme-text-secondary`, small (~0.72rem).
- **Accent line:** A 1px gradient (`#ec8c37` → transparent) across the bottom of the panel.
- All text uses a soft text-shadow (`0 2px 8px rgba(0,0,0,.7)`) so it stays readable against any portion of the image.

### Form panel (right, fills remaining width)

Same content as today, restructured:

**Choice sub-view** (default):
- Header row: "Sign In" title + close (×) button.
- "Google" button — secondary variant, full width, with Google favicon.
- Divider with "or" label (existing pattern).
- "Email" button — secondary variant, full width.

**Email-form sub-view** (after clicking Email):
- Header row: `←` back caret + "Sign In" / "Sign Up" title + close (×) button. The back caret returns to the choice view; it is a small text/icon link, **not** a `Button`.
- Email input.
- Password input.
- Primary CTA: "Sign In" / "Sign Up" — `Button variant="primary"`, full width.
- Mode-toggle: centered text — "Don't have an account? **Sign up**" / "Already have an account? **Sign in**". The bold portion is a text link (orange), not a button.

## Behavior

- **Sub-view transition:** when switching between choice and email-form, fade with `animate-subview-enter` (180ms ease-out fade-and-rise) — already defined in `index.css`.
- **Back navigation:** the `←` caret in the form-view header returns to the choice view and clears email/password state.
- **Mode toggle:** clicking the orange "Sign up" / "Sign in" link flips `isSignUp`. The form fields and password autocomplete attribute update accordingly (existing logic preserved).
- **Submit / OAuth:** unchanged from current implementation. Modal closes on success; stays open on failure (error toast handled by `AuthProvider`).

## Responsive

- **`sm` breakpoint and above (≥ 640px):** two-pane layout described above.
- **Below `sm`:** brand panel is hidden via `hidden sm:flex`. The form panel becomes full-width. The wordmark + tagline render in compact form **above** the buttons inside the form panel, so the brand presence is preserved without breaking on narrow screens.

## Theming

The component uses Tailwind tokens (`bg-dark-lighter`, `border-dark-border`, `text-theme-text`, `text-theme-text-secondary`, `bg-primary`) — both default and synthwave themes pick up automatically through CSS variables.

The synthwave theme already restyles dialogs (`[data-theme='synthwave'] [role='dialog']` in `index.css`) with neon glow, gradient background, and primary-tinted borders. The redesigned modal inherits that treatment.

The brand-panel background image stays the same in both themes — `Deep_crevasse_01.png` reads well under the synthwave color filter and gradient overlay. **No theme-conditional image switching in v1.** If the synthwave variant needs its own image later, it can be added via a `[data-theme='synthwave']` CSS selector without touching the component.

## Width override

The shared `Modal` component currently forces `max-w-4xl`. `AuthModal` needs `max-w-lg`. **In v1, override locally** by replacing `Modal` usage with a small inline portal/dialog inside `AuthModal` that mirrors `Modal`'s behavior (backdrop, scroll lock, escape key, high-z portal) but accepts a width prop. This is the smallest, most contained change.

A broader fix — adding a width prop to the shared `Modal` — is out of scope for v1 but worth tracking as follow-up. Several other modals would benefit.

## Copy

- Title: **"Sign In"** in choice view; **"Sign In"** or **"Sign Up"** in form view (mirrors `isSignUp` state).
- Wordmark: **`// STARBORNE PLANNER`**
- Headline: **"Sync your fleet across devices."**
- Disclaimer: **"Optional. Local-first by default."**

The longer existing disclaimer paragraph ("I recommend backing up your data through the home page before logging in for the first time.") is removed from the modal. Backup-before-sign-in guidance is already covered on the home page; repeating it here adds noise.

## Accessibility

- Brand panel is decorative — `aria-hidden="true"` on its container so screen readers go straight to the form.
- Existing `aria-labelledby="modal-title"` on the dialog stays.
- Back caret has `aria-label="Back to sign in options"`.
- Close button keeps its `aria-label="Close modal"`.
- Focus order: close button → Google → Email (choice view); back → close → email → password → submit → mode-toggle (form view).
- Focus trap, escape-to-close, and scroll lock continue to work — same mechanism as the current `Modal`.

## Testing

- `data-testid` attributes on existing interactive elements are preserved: `auth-google-button`, `auth-continue-with-email`, `auth-email-input`, `auth-password-input`, `auth-signin-submit`, `auth-signup-submit`, `auth-toggle-mode`, `open-auth-modal`. The "back" caret gets a new `auth-back-to-choice` testid.
- No automated visual regression — manually verify both themes and both sub-views before merging.

## Out of scope / future work

- Adding a `widthClass` (or similar) prop to the shared `Modal`.
- Theme-specific brand-panel imagery.
- Forgot-password / magic-link flows.
- Replacing the favicon-based Google "G" icon with a proper SVG (currently `https://www.google.com/favicon.ico`).
