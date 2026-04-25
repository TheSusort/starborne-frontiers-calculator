# AuthModal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current full-width `AuthModal` with a focused split-pane dialog: branded left panel (Deep Crevasse background + wordmark + tagline) and a tight form panel on the right. Keep the existing auth flow (Google + email/password sign-in/sign-up) unchanged.

**Architecture:** Single-file rewrite of `src/components/auth/AuthModal.tsx`. The shared `Modal` component is locked to `max-w-4xl`, so this component inlines its own portal/backdrop/scroll-lock/escape logic at `max-w-lg` instead of using `Modal`. Layout is two columns: a desktop-only brand panel (`hidden sm:flex`) and a form panel that fills the rest. Mobile shows a compact wordmark + tagline above the buttons inside the form panel.

**Tech Stack:** React 18, TypeScript, TailwindCSS, Vitest + React Testing Library, existing `Button` / `Input` / `CloseIcon` UI primitives, `useAuth` / `useNotification` hooks.

**Spec:** `docs/superpowers/specs/2026-04-25-auth-modal-redesign-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/components/auth/AuthModal.tsx` | **Rewrite.** Inlined portal dialog, brand panel, choice view, email-form view. |
| `src/components/auth/__tests__/AuthModal.test.tsx` | **New.** Render tests covering testid presence, sub-view switching, mode toggle, back nav. |
| `src/constants/changelog.ts` | **Modify.** Bump `CURRENT_VERSION` and add a new entry. |

No other files change. `LoginButton.tsx` keeps using `<AuthModal isOpen={…} onClose={…} />` unchanged. `Modal.tsx` is left alone.

---

### Task 1: Add render tests for the new AuthModal structure

**Files:**
- Create: `src/components/auth/__tests__/AuthModal.test.tsx`

These tests describe the **target** behavior of the redesigned component, including the new `auth-back-to-choice` testid that doesn't exist yet. They will fail against the current implementation in two ways: (1) the `auth-back-to-choice` element doesn't exist, (2) the Google button text changes from "Continue with Google" to "Google". Existing testids (`auth-google-button`, `auth-continue-with-email`, `auth-email-input`, `auth-password-input`, `auth-signin-submit`, `auth-signup-submit`, `auth-toggle-mode`) are preserved across the redesign.

- [ ] **Step 1: Inspect the existing test patterns**

Read `src/components/ui/__tests__/InlineNumberEdit.test.tsx` for the project's RTL pattern. Read `src/contexts/AuthProvider.tsx` lines 1–30 to confirm the `AuthContext` shape (you'll mock `useAuth`).

- [ ] **Step 2: Write the failing test file**

Create `src/components/auth/__tests__/AuthModal.test.tsx` with this content:

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthModal } from '../AuthModal';

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

describe('AuthModal', () => {
    const onClose = vi.fn();
    beforeEach(() => onClose.mockClear());

    it('does not render when closed', () => {
        const { container } = render(<AuthModal isOpen={false} onClose={onClose} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the choice view by default with Google and Email buttons', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        expect(screen.getByTestId('auth-google-button')).toBeInTheDocument();
        expect(screen.getByTestId('auth-continue-with-email')).toBeInTheDocument();
        // Form fields are hidden in the choice view.
        expect(screen.queryByTestId('auth-email-input')).not.toBeInTheDocument();
    });

    it('Google button label is "Google" (no "Continue with" prefix)', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        const googleBtn = screen.getByTestId('auth-google-button');
        expect(googleBtn).toHaveTextContent(/^Google$/);
    });

    it('Email button label is "Email" (no "Continue with" prefix)', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        const emailBtn = screen.getByTestId('auth-continue-with-email');
        expect(emailBtn).toHaveTextContent(/^Email$/);
    });

    it('clicking Email reveals the email/password form and the back caret', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect(screen.getByTestId('auth-email-input')).toBeInTheDocument();
        expect(screen.getByTestId('auth-password-input')).toBeInTheDocument();
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
        expect(screen.getByTestId('auth-back-to-choice')).toBeInTheDocument();
    });

    it('back caret returns from email form to choice view and clears fields', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        const email = screen.getByTestId('auth-email-input') as HTMLInputElement;
        fireEvent.change(email, { target: { value: 'a@b.c' } });
        fireEvent.click(screen.getByTestId('auth-back-to-choice'));
        expect(screen.getByTestId('auth-google-button')).toBeInTheDocument();
        // Re-enter form, fields are cleared.
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect((screen.getByTestId('auth-email-input') as HTMLInputElement).value).toBe('');
    });

    it('mode toggle switches between sign-in and sign-up submit testids', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('auth-toggle-mode'));
        expect(screen.getByTestId('auth-signup-submit')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('auth-toggle-mode'));
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
    });

    it('clicking the close button calls onClose', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 3: Run the tests, confirm they fail in the expected places**

Run: `npx vitest --run src/components/auth/__tests__/AuthModal.test.tsx`

Expected: Several tests FAIL. Specifically:
- "Google button label is Google" — current label is "Continue with Google".
- "Email button label is Email" — current label is "Continue with Email".
- "clicking Email reveals … the back caret" — `auth-back-to-choice` doesn't exist yet.
- "back caret returns…" — same reason.
- The `does not render when closed` test depends on Modal short-circuiting; current Modal already returns null when closed, so this should already pass.

If a test fails for an unexpected reason (e.g., import error, missing mock), fix the test before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/__tests__/AuthModal.test.tsx
git commit -m "test(auth): add render tests for redesigned AuthModal"
```

---

### Task 2: Reimplement AuthModal with split-pane layout

**Files:**
- Modify: `src/components/auth/AuthModal.tsx` (full rewrite)

The new component:
- Renders its own portal + backdrop + scroll-lock + escape handler at z-index 70 (high), instead of using `Modal`. This is the localised width override the spec calls for.
- Uses `max-w-lg` (~512px) on desktop.
- Has a desktop-only brand panel (`hidden sm:flex`) on the left with the Deep Crevasse background.
- Has a compact wordmark + tagline inside the form panel for mobile (`sm:hidden`).
- Uses `Button` / `Input` UI primitives from `src/components/ui/`.
- Preserves all existing `data-testid` attributes; adds `auth-back-to-choice`.
- Applies `animate-subview-enter` (already defined in `src/index.css`) to the sub-view content via a `key` change so the fade-and-rise plays when switching between choice and form.

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/auth/AuthModal.tsx` with:

```tsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CloseIcon } from '../ui/icons/CloseIcon';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PORTAL_ID = 'modal-root-high';

const getPortalRoot = () => {
    let root = document.getElementById(PORTAL_ID);
    if (!root) {
        root = document.createElement('div');
        root.setAttribute('id', PORTAL_ID);
        root.className = 'z-[80] relative';
        document.body.appendChild(root);
    }
    return root;
};

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showEmailForm, setShowEmailForm] = useState(false);
    const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
    const { addNotification } = useNotification();

    useEffect(() => {
        if (!isOpen) return;
        const scrollY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        let succeeded = false;
        try {
            if (isSignUp) {
                await signUpWithEmail(email, password);
                addNotification('success', 'You can now sign in');
            } else {
                await signInWithEmail(email, password);
                addNotification('success', 'You are now signed in');
            }
            succeeded = true;
        } catch {
            // Error toast fired by AuthProvider; keep modal open.
        }
        if (succeeded) onClose();
    };

    const handleGoogleSignIn = async () => {
        let succeeded = false;
        try {
            await signInWithGoogle();
            addNotification('success', 'You are now signed in');
            succeeded = true;
        } catch {
            // Error toast fired by AuthProvider.
        }
        if (succeeded) onClose();
    };

    const handleBackToChoice = () => {
        setShowEmailForm(false);
        setEmail('');
        setPassword('');
    };

    const title = showEmailForm ? (isSignUp ? 'Sign Up' : 'Sign In') : 'Sign In';

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className="fixed inset-0 z-[70]">
                <div
                    className="flex h-full max-h-[calc(100vh-2rem)] items-center justify-center p-4"
                    onClick={onClose}
                >
                    <div
                        className="relative bg-dark-lighter border border-dark-border shadow-xl w-full max-w-lg flex"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-labelledby="auth-modal-title"
                    >
                        {/* Brand panel — desktop only */}
                        <div
                            aria-hidden="true"
                            className="hidden sm:flex flex-col justify-between w-2/5 p-4 relative overflow-hidden"
                            style={{
                                backgroundImage:
                                    "linear-gradient(180deg, rgba(11,16,24,.45) 0%, rgba(11,16,24,.85) 100%), url('/images/Deep_crevasse_01.png')",
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            }}
                        >
                            <div className="relative">
                                <div className="font-secondary text-[0.65rem] text-primary uppercase tracking-[0.3em] [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
                                    // STARBORNE PLANNER
                                </div>
                                <div className="font-secondary text-lg text-white mt-3 leading-tight [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]">
                                    Sync your fleet
                                    <br />
                                    across devices.
                                </div>
                                <div className="text-xs text-theme-text-secondary mt-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">
                                    Optional. Local-first by default.
                                </div>
                            </div>
                            <div
                                className="relative h-px"
                                style={{
                                    background:
                                        'linear-gradient(90deg, rgb(var(--color-primary)) 0%, transparent 70%)',
                                }}
                            />
                        </div>

                        {/* Form panel */}
                        <div className="flex-1 flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
                                <div className="flex items-center gap-2">
                                    {showEmailForm && (
                                        <button
                                            type="button"
                                            onClick={handleBackToChoice}
                                            aria-label="Back to sign in options"
                                            data-testid="auth-back-to-choice"
                                            className="text-theme-text-secondary hover:text-theme-text leading-none text-lg"
                                        >
                                            ←
                                        </button>
                                    )}
                                    <h3
                                        id="auth-modal-title"
                                        className="text-lg font-semibold font-secondary"
                                    >
                                        {title}
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Close modal"
                                    onClick={onClose}
                                    className="text-theme-text-secondary hover:text-theme-text"
                                >
                                    <CloseIcon />
                                </button>
                            </div>

                            {/* Mobile compact brand */}
                            <div className="sm:hidden px-4 pt-3">
                                <div className="font-secondary text-[0.55rem] text-primary uppercase tracking-[0.3em]">
                                    // STARBORNE PLANNER
                                </div>
                                <div className="text-xs text-theme-text-secondary mt-1">
                                    Sync your fleet across devices. Optional.
                                </div>
                            </div>

                            {/* Sub-view content (animated swap via key change) */}
                            <div
                                key={showEmailForm ? 'form' : 'choice'}
                                className="px-4 py-4 animate-subview-enter"
                            >
                                {showEmailForm ? (
                                    <form
                                        onSubmit={(e) => void handleSubmit(e)}
                                        className="space-y-4"
                                    >
                                        <Input
                                            label="Email"
                                            type="email"
                                            id="email"
                                            name="email"
                                            autoComplete="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            data-testid="auth-email-input"
                                        />
                                        <Input
                                            label="Password"
                                            type="password"
                                            id="password"
                                            name="password"
                                            autoComplete={
                                                isSignUp ? 'new-password' : 'current-password'
                                            }
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            data-testid="auth-password-input"
                                        />
                                        <Button
                                            variant="primary"
                                            fullWidth
                                            type="submit"
                                            data-testid={
                                                isSignUp
                                                    ? 'auth-signup-submit'
                                                    : 'auth-signin-submit'
                                            }
                                        >
                                            {isSignUp ? 'Sign Up' : 'Sign In'}
                                        </Button>
                                        <div className="text-center text-sm text-theme-text-secondary">
                                            {isSignUp
                                                ? 'Already have an account? '
                                                : "Don't have an account? "}
                                            <button
                                                type="button"
                                                onClick={() => setIsSignUp(!isSignUp)}
                                                data-testid="auth-toggle-mode"
                                                className="text-primary hover:underline font-medium"
                                            >
                                                {isSignUp ? 'Sign in' : 'Sign up'}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <Button
                                            onClick={() => void handleGoogleSignIn()}
                                            variant="secondary"
                                            fullWidth
                                            className="flex items-center gap-2 justify-center"
                                            type="button"
                                            data-testid="auth-google-button"
                                        >
                                            <img
                                                src="https://www.google.com/favicon.ico"
                                                alt=""
                                                className="w-4 h-4"
                                            />
                                            Google
                                        </Button>
                                        <div className="relative">
                                            <div className="absolute inset-0 flex items-center">
                                                <div className="w-full border-t border-dark-border" />
                                            </div>
                                            <div className="relative flex justify-center text-xs uppercase tracking-widest">
                                                <span className="px-2 bg-dark-lighter text-theme-text-secondary">
                                                    or
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={() => setShowEmailForm(true)}
                                            variant="secondary"
                                            fullWidth
                                            type="button"
                                            data-testid="auth-continue-with-email"
                                        >
                                            Email
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>,
        getPortalRoot()
    );
};
```

- [ ] **Step 2: Run the tests, confirm they pass**

Run: `npx vitest --run src/components/auth/__tests__/AuthModal.test.tsx`

Expected: All tests PASS.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npm test`

Expected: All tests PASS. Pay attention to anything in `src/__tests__/` or `e2e/` that touches `LoginButton` or `AuthModal`.

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint`

Expected: 0 errors, 0 warnings (the project's ESLint is set to `--max-warnings 0`).

If lint complains about the inline-style backgroundImage, leave it — TailwindCSS can't compose a background-image with a URL alongside a gradient inline using utilities cleanly. The rest of the styling uses Tailwind tokens so themes apply through CSS variables.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/AuthModal.tsx
git commit -m "feat(auth): redesign sign-in modal — split-pane with branded panel"
```

---

### Task 3: Manual verification

**Files:** None (verification only).

This task validates the visual design across both themes and the responsive breakpoint. It can't be automated meaningfully — render tests cover structure but not pixel layout. Per the project's `CLAUDE.md`, "If you can't test the UI, say so explicitly rather than claiming success" — so verify in the browser, don't shortcut.

- [ ] **Step 1: Start the dev server**

Run: `npm start`

Expected: Vite reports "ready in <Nms>" with a local URL (typically `http://localhost:5173`).

- [ ] **Step 2: Verify default theme — choice view**

Open the app. From the sidebar, click "Sign In" to open the modal.

Check:
- Modal is ~512px wide, not the previous full-width 4xl.
- Left panel shows the Deep Crevasse image with a dark gradient overlay.
- "// STARBORNE PLANNER" wordmark in orange Electrolize, "Sync your fleet across devices." headline in white, small disclaimer below.
- Right panel: "Sign In" header in Electrolize, close × button, Google button (with G favicon), divider with "or", Email button.
- Backdrop click and Escape key both close the modal.

- [ ] **Step 3: Verify default theme — email form view**

In the open modal, click "Email".

Check:
- Right panel swaps to email + password inputs.
- Left brand panel stays put.
- A `←` back caret appears next to the title in the header.
- Primary "Sign In" button is orange and prominent.
- "Don't have an account? Sign up" appears as a centered text line; "Sign up" is an orange link.
- Click `←` — the form clears and the choice view returns.
- Click "Sign up" link — title changes to "Sign Up" and the submit button label changes accordingly.

- [ ] **Step 4: Verify default theme — animation**

Click Email → choice → Email again, observing each transition. The sub-view content should fade-and-rise with the `animate-subview-enter` keyframe (180ms). If it feels static, double-check the `key={showEmailForm ? 'form' : 'choice'}` is on the wrapping div.

- [ ] **Step 5: Verify mobile layout**

Open browser dev tools and switch to a narrow viewport (< 640px, e.g. iPhone 13 preset).

Check:
- Brand panel is hidden.
- Form panel goes full-width inside the modal.
- Compact "// STARBORNE PLANNER" wordmark + "Sync your fleet across devices. Optional." line render above the buttons.
- Form view, mode toggle, and back caret all still work.

- [ ] **Step 6: Verify synthwave theme**

Switch to the synthwave theme (see how the rest of the app does this — there's a theme toggle somewhere in settings; if you can't find it quickly, set `data-theme="synthwave"` on `<html>` via dev tools).

Check:
- Modal picks up the synthwave glow / gradient defined in `src/index.css` for `[data-theme='synthwave'] [role='dialog']`.
- Brand panel image is still readable through the synthwave color filter.
- Buttons render with neon glow per existing synthwave styles.

If anything looks broken in synthwave (e.g. text unreadable on the Deep Crevasse image), note it but do not block — the spec marks "theme-specific brand-panel imagery" as future work.

- [ ] **Step 7: Verify auth still works end-to-end**

With a real Supabase session available locally (or via the dev/staging env), perform a sign-in (Google or email/password). The modal should close on success and a "You are now signed in" toast should fire.

If you don't have credentials handy, skip this step — the unit tests in Task 1 already verify the wiring of `signInWithEmail`, `signUpWithEmail`, and `signInWithGoogle` via mocks.

- [ ] **Step 8: Stop the dev server**

Ctrl-C the `npm start` process. Nothing to commit at this step.

---

### Task 4: Update changelog and finalise

**Files:**
- Modify: `src/constants/changelog.ts`

The current `CURRENT_VERSION` is `'1.56.0'` (already shipped today, 2026-04-25). Bump to `1.57.0` and add a new entry above it.

- [ ] **Step 1: Edit the changelog**

In `src/constants/changelog.ts`, change `CURRENT_VERSION` to `'1.57.0'` and prepend a new entry to the `CHANGELOG` array:

```typescript
export const CURRENT_VERSION = '1.57.0';

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.57.0',
        date: '2026-04-25',
        changes: [
            'Sign-in modal redesigned — split-pane layout with a branded left panel and a tighter form on the right',
        ],
    },
    // ...existing entries below
```

- [ ] **Step 2: Run lint to make sure the file is clean**

Run: `npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "chore(changelog): 1.57.0 — auth modal redesign"
```

- [ ] **Step 4: Final sanity check**

Run: `npm test && npm run lint`

Expected: All tests PASS, lint clean.

---

## Done criteria

- All 4 tasks completed and committed.
- New `AuthModal.test.tsx` passes 8 tests.
- `npm test` and `npm run lint` both clean.
- Manual verification confirmed in default theme + synthwave theme + mobile viewport.
- Changelog bumped to 1.57.0.

## Notes for implementer

- **Don't touch `src/components/ui/layout/Modal.tsx`.** The width override is intentionally local. A shared `Modal` width prop is tracked in the spec as future work — if you find yourself wanting to do it, raise it and stop.
- **Don't extract sub-components yet.** The component is ~280 lines after rewrite — manageable as a single file. Splitting `BrandPanel` / `ChoiceView` / `EmailFormView` into separate files is premature; revisit only if the file grows further.
- **Preserve `data-testid` exactly.** E2E or other tests outside this plan may depend on them. If you find an existing test that breaks because of a copy change (e.g., asserts the literal string "Continue with Google"), update that test in the same task — don't ship a half-passing suite.
- **The Google `<img>` `alt` is set to empty string** because the button text "Google" already conveys the action; an `alt="Google"` would duplicate. This is intentional for screen readers.
