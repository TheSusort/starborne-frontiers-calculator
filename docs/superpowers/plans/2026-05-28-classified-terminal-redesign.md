# Classified Archive — Terminal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/classified` card-stack layout with a two-screen terminal interface where arrow keys navigate a fragment index and selecting one transitions to a full-screen fragment detail view.

**Architecture:** Single `ClassifiedPage.tsx` rewrite — add `mode/cursorIndex/activeFragmentId` state alongside all existing state, replace the multi-card stack with one `max-w-2xl` terminal card, and split rendering into an index branch and a detail branch. All auth/decrypt/localStorage logic is unchanged.

**Tech Stack:** React 18, TypeScript, TailwindCSS, React Router v6

**Base branch:** `feature/classified-archive` (the existing classified page implementation — PR #68 open but not yet merged)

**New branch:** `feature/classified-terminal-redesign`

---

## Setup: Create the worktree and branch

Before starting Task 1, create a new branch off `feature/classified-archive`:

```bash
# From the repo root
git worktree add .worktrees/classified-terminal feature/classified-archive
cd .worktrees/classified-terminal
git checkout -b feature/classified-terminal-redesign
npm install
npm test
```

Expected: all tests pass. This is your working directory for all tasks below.

---

## File Structure

Only one file changes in the implementation:

- **Modify:** `src/pages/ClassifiedPage.tsx` — full rewrite of the JSX; state additions; keyboard handler; remove `Button` import

Supporting changes:
- **Modify:** `src/constants/changelog.ts` — add changelog entry
- **Modify:** `src/pages/DocumentationPage.tsx` — add note about keyboard navigation

No other files change. `src/constants/classifiedArchive.ts` and its tests are untouched.

---

## Task 1: Add two-screen state and navigation helpers

This task adds the new state variables and helper functions without changing any JSX. After this task the page renders identically to before — it is just ready to be split into two screens.

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`

- [ ] **Step 1: Update the React import and add the `Mode` type at module level**

First, update the import at line 1 to include `useCallback`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
```

Then add the `Mode` type declaration at **module level** (outside the component, after the `FINAL_TRANSMISSION` constant and before `export default function ClassifiedPage()`):

```tsx
type Mode = 'index' | 'detail';
```

> **Important:** `type Mode` must be at module level, not inside the component function body.

- [ ] **Step 2: Add new state variables inside the component**

Inside the component, after the existing state declarations (after `const intervalsRef = ...`), add:

```tsx
    // New state — two-screen model
    const [mode, setMode] = useState<Mode>('index');
    const [cursorIndex, setCursorIndex] = useState(0);
    const [activeFragmentId, setActiveFragmentId] = useState<string | null>(null);
```

The existing state block (`unlocked`, `inputs`, `errors`, `decrypting`, `barProgress`, `intervalsRef`) is **unchanged** — just append the 3 new declarations after it. The module-level constants (`BAR_TOTAL`, `OPACITY_BY_UNLOCKED`, `FINAL_TRANSMISSION`) are also unchanged.

- [ ] **Step 3: Add `activeFragment` derived value before the return statement**

```tsx
    const activeFragment = activeFragmentId
        ? (CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId) ?? null)
        : null;
```

- [ ] **Step 4: Run lint to confirm no errors**

```bash
npm run lint
```

Expected: 0 warnings, 0 errors. Fix any TypeScript issues before continuing.

- [ ] **Step 5: Run tests to confirm baseline**

```bash
npm test
```

Expected: all tests pass (647+). The classifiedArchive.test.ts tests should be green since we haven't touched that file.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ClassifiedPage.tsx
git commit -m "refactor: add two-screen state model to ClassifiedPage"
```

---

## Task 2: Implement the index screen

Replace the existing multi-card stack (header card + 4 fragment cards + footer button) with a single terminal card containing the full index screen. After this task, the index screen is fully functional visually and with mouse interaction.

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`

- [ ] **Step 1: Replace the entire `<div className="relative z-10 ...">` contents with the new single-card layout**

Replace everything from `<div className="relative z-10 flex flex-col items-center min-h-full p-4 py-12 gap-6">` down to (and including) its closing `</div>` with:

```tsx
                {/* Content */}
                <div className="relative z-10 flex flex-col items-center min-h-full p-4 py-12">
                    <div className="max-w-2xl w-full card backdrop-blur-sm">
                        {/* INDEX SCREEN */}
                        {mode === 'index' && (
                            <div key="index" className="classified-decode">
                                {/* Header */}
                                <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                    {'// STARBORNE PLANNER'}
                                </div>
                                <p className="classified-title-glitch font-mono text-sm font-bold tracking-[0.3em] uppercase text-primary mt-1">
                                    {'> ABYSS INCIDENT — CLASSIFIED ARCHIVE'}
                                </p>
                                <p className="font-mono text-xs text-gray-500 tracking-widest mt-1 mb-3">
                                    {`[${unlockedCount}/${CLASSIFIED_FRAGMENTS.length} FRAGMENTS DECRYPTED]`}
                                </p>

                                <hr className="border-gray-800 mb-3" />

                                {/* Instruction hint */}
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest mb-3">
                                    {'USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS'}
                                </p>

                                {/* Fragment rows */}
                                <div>
                                    {CLASSIFIED_FRAGMENTS.map((fragment, i) => {
                                        const isFocused = cursorIndex === i;
                                        const isRowUnlocked = unlocked.includes(fragment.id);
                                        return (
                                            <div
                                                key={fragment.id}
                                                className={`flex items-center justify-between py-0.5 cursor-pointer ${
                                                    isFocused
                                                        ? 'bg-green-950/30 border-l-2 border-green-400 -mx-4 px-[14px]'
                                                        : 'pl-5'
                                                }`}
                                                onMouseEnter={() => setCursorIndex(i)}
                                                onClick={() => navigateToFragment(i)}
                                            >
                                                <span className="font-mono text-xs tracking-widest flex items-center gap-2">
                                                    <span
                                                        className={`w-3 shrink-0 text-green-400 ${isFocused ? '' : 'invisible'}`}
                                                    >
                                                        ▶
                                                    </span>
                                                    <span className={fragment.barColorClass}>
                                                        {fragment.title.toUpperCase()}
                                                    </span>
                                                </span>
                                                <span
                                                    className={`font-mono text-[0.6rem] font-bold tracking-widest px-1 border ml-2 shrink-0 ${
                                                        isRowUnlocked
                                                            ? 'text-green-400 border-green-900 bg-green-950/50'
                                                            : 'text-red-400 border-red-900 bg-red-950/30'
                                                    }`}
                                                >
                                                    {isRowUnlocked ? 'DECRYPTED' : 'LOCKED'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Final transmission — 4/4 only, index mode only */}
                                {allUnlocked && (
                                    <div className="classified-decode mt-4 space-y-3">
                                        <hr className="border-gray-800" />
                                        <p className="font-mono text-xs text-red-500 tracking-widest uppercase font-bold">
                                            {'> FINAL TRANSMISSION — DECRYPTED'}
                                        </p>
                                        <p className="text-base font-bold tracking-widest uppercase text-primary">
                                            ARCHIVE COMPLETE
                                        </p>
                                        <div className="text-sm text-gray-400 space-y-3 font-mono">
                                            {FINAL_TRANSMISSION.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <hr className="border-gray-800 mt-4 mb-2" />

                                {/* Footer key legend */}
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">
                                        ↑
                                    </span>
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-2">
                                        ↓
                                    </span>
                                    {'move · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                        ↵
                                    </span>
                                    {'open · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                        ESC
                                    </span>
                                    base
                                </p>
                            </div>
                        )}

                        {/* DETAIL SCREEN — implemented in Task 4 */}
                        {mode === 'detail' && activeFragment && (
                            <div key={activeFragmentId} className="classified-decode">
                                <p className="font-mono text-xs text-gray-500">Loading fragment…</p>
                            </div>
                        )}
                    </div>
                </div>
```

- [ ] **Step 2: Remove the `Button` import since the Return to Base button is gone**

The new design uses ESC to return to base. Remove `Button` from the import at the top of the file:

```tsx
// Before:
import { Button } from '../components/ui';

// After: remove this line entirely
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors. If `Button` is still referenced anywhere, fix it. If the IIFE pattern causes lint issues, extract variables before the return.

- [ ] **Step 4: Start the dev server and verify the index screen visually**

```bash
npm start
```

Navigate to `http://localhost:3000/classified`. Verify:
- Single terminal card visible (not the old multi-card stack)
- All 4 fragment rows appear with correct accent colours
- `▶` cursor shows on row 0
- LOCKED/DECRYPTED badges visible on each row
- Header with `ABYSS INCIDENT` glitch animation
- Fragment counter shows `[0/4 FRAGMENTS DECRYPTED]` (or actual state from localStorage)
- Footer key legend visible
- Mouse hover on a row moves the `▶` cursor to that row
- Mouse click on a row shows "Loading fragment…" placeholder (detail screen stub)

- [ ] **Step 5: Commit**

```bash
git add src/pages/ClassifiedPage.tsx
git commit -m "feat: implement index screen for classified terminal redesign"
```

---

## Task 3: Add window keyboard handler

Attach the full `keydown` listener that handles both index and detail modes.

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`

- [ ] **Step 1: Convert navigation helpers to `useCallback` and add the keyboard `useEffect`**

Replace the two plain `function navigateToFragment` / `function navigateToIndex` helpers (added in Task 1) with `useCallback` versions:

```tsx
    const navigateToFragment = useCallback((index: number) => {
        const fragment = CLASSIFIED_FRAGMENTS[index];
        setCursorIndex(index);
        setActiveFragmentId(fragment.id);
        setMode('detail');
    }, []);

    const navigateToIndex = useCallback(() => {
        setMode('index');
        setActiveFragmentId(null);
    }, []);
```

Also convert `handleSubmit` to a `useCallback` so it can be safely listed in the keyboard effect's dependency array:

```tsx
    const handleSubmit = useCallback(
        (fragmentId: string, authCode: string) => {
            const input = (inputs[fragmentId] ?? '').trim().toUpperCase();
            if (input !== authCode.trim().toUpperCase()) {
                setErrors((e) => ({ ...e, [fragmentId]: true }));
                setTimeout(() => setErrors((e) => ({ ...e, [fragmentId]: false })), 800);
                return;
            }
            setDecrypting((d) => ({ ...d, [fragmentId]: true }));
            let count = 0;
            const interval = setInterval(() => {
                count++;
                setBarProgress((p) => ({ ...p, [fragmentId]: count }));
                if (count >= BAR_TOTAL) {
                    clearInterval(interval);
                    setUnlocked((prev) => {
                        const next = [...prev, fragmentId];
                        writeUnlocked(next);
                        return next;
                    });
                    setDecrypting((d) => ({ ...d, [fragmentId]: false }));
                }
            }, 40);
            intervalsRef.current[fragmentId] = interval;
        },
        [inputs],
    );
```

> **Note on `handleSubmit` refactor:** The original version captured `unlocked` via closure in `const next = [...unlocked, fragmentId]` — if `unlocked` was stale, completed decrypts could silently overwrite each other. The `useCallback` version uses the `setUnlocked(prev => [...prev, fragmentId])` functional update form, which always gets the latest state from React. This eliminates the stale closure risk. The dep array only needs `inputs` (for reading the typed value).

Then add the keyboard `useEffect` immediately after these helpers:

```tsx
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (mode === 'index') {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursorIndex(
                        (i) => (i - 1 + CLASSIFIED_FRAGMENTS.length) % CLASSIFIED_FRAGMENTS.length,
                    );
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursorIndex((i) => (i + 1) % CLASSIFIED_FRAGMENTS.length);
                } else if (e.key === 'Enter') {
                    navigateToFragment(cursorIndex);
                } else if (e.key === 'Escape') {
                    void navigate('/');
                }
            } else if (mode === 'detail' && activeFragmentId) {
                if (e.key === 'Escape') {
                    if (decrypting[activeFragmentId]) return;
                    navigateToIndex();
                } else if (
                    e.key === 'Enter' &&
                    document.activeElement?.tagName !== 'INPUT'
                ) {
                    const fragment = CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId);
                    if (
                        fragment &&
                        !unlocked.includes(activeFragmentId) &&
                        !decrypting[activeFragmentId]
                    ) {
                        handleSubmit(activeFragmentId, fragment.authCode);
                    }
                }
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        mode,
        cursorIndex,
        activeFragmentId,
        decrypting,
        unlocked,
        navigate,
        navigateToFragment,
        navigateToIndex,
        handleSubmit,
    ]);
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: 0 warnings, 0 errors. The `useCallback` wrapping satisfies `exhaustive-deps` for all three helpers.

- [ ] **Step 3: Verify keyboard behaviour in the browser**

With the dev server running at `http://localhost:3000/classified`:
- Press `↑`/`↓` — cursor moves through rows, wraps at top/bottom
- Press `Enter` on a row — transitions to the "Loading fragment…" detail stub
- From the stub, pressing `ESC` should return to the index screen (detail → index)
- From the index, pressing `ESC` should navigate to `/` (home page)

- [ ] **Step 4: Commit**

```bash
git add src/pages/ClassifiedPage.tsx
git commit -m "feat: add keyboard handler for classified terminal (index + detail modes)"
```

---

## Task 4: Implement the detail screen

Replace the "Loading fragment…" stub with the full three-state detail view (locked, decrypting, unlocked).

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`

- [ ] **Step 1: Replace the detail screen stub with the full implementation**

Find this block in the JSX:

```tsx
                        {/* DETAIL SCREEN — implemented in Task 4 */}
                        {mode === 'detail' && activeFragment && (
                            <div>
                                <p className="font-mono text-xs text-gray-500">Loading fragment…</p>
                            </div>
                        )}
```

Replace it with:

```tsx
                        {/* DETAIL SCREEN */}
                        {mode === 'detail' && activeFragment && (() => {
                            const detailIsUnlocked = unlocked.includes(activeFragment.id);
                            const detailIsDecrypting = decrypting[activeFragment.id] ?? false;
                            const detailProgress = barProgress[activeFragment.id] ?? 0;
                            const detailHasError = errors[activeFragment.id] ?? false;
                            return (
                                <div>
                                    {/* Comment + title */}
                                    <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                        {'// FRAGMENT ACCESS'}
                                    </div>
                                    <p
                                        className={`font-mono text-sm font-bold tracking-[0.3em] uppercase ${activeFragment.barColorClass} mt-1 mb-3`}
                                    >
                                        {activeFragment.title.toUpperCase()}
                                    </p>

                                    {/* DECRYPTING STATE */}
                                    {detailIsDecrypting && (
                                        <div className="space-y-1 font-mono text-xs">
                                            <p className="text-gray-500 tracking-widest">
                                                {'> STATUS: '}
                                                <span className="text-green-400">DECRYPTING...</span>
                                            </p>
                                            <hr className="border-gray-800 my-2" />
                                            <p className={activeFragment.barColorClass}>
                                                {`> ${'█'.repeat(detailProgress)}${'░'.repeat(BAR_TOTAL - detailProgress)} ${Math.round((detailProgress / BAR_TOTAL) * 100)}%`}
                                            </p>
                                            <hr className="border-gray-800 mt-3 mb-2" />
                                            <p className="text-gray-600 tracking-widest">{'— — —'}</p>
                                        </div>
                                    )}

                                    {/* UNLOCKED STATE */}
                                    {!detailIsDecrypting && detailIsUnlocked && (
                                        <div>
                                            <p
                                                className={`font-mono text-xs tracking-widest ${activeFragment.barColorClass} mb-3`}
                                            >
                                                {`> ${'█'.repeat(BAR_TOTAL)} [DECRYPTED]`}
                                            </p>
                                            <hr className="border-gray-800 mb-3" />
                                            <div className="classified-decode text-sm text-gray-400 space-y-3 font-mono">
                                                {activeFragment.body.split('\n\n').map((para, i) => (
                                                    <p key={i}>{para}</p>
                                                ))}
                                            </div>
                                            <hr className="border-gray-800 mt-3 mb-2" />
                                            <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                                <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-1">
                                                    ESC
                                                </span>
                                                back to index
                                            </p>
                                        </div>
                                    )}

                                    {/* LOCKED STATE */}
                                    {!detailIsDecrypting && !detailIsUnlocked && (
                                        <div>
                                            <p className="font-mono text-xs text-gray-600 tracking-widest">
                                                {`> ORIGIN FILE: ${activeFragment.hintLine} — FIELD AGENTS ONLY`}
                                            </p>
                                            <p className="font-mono text-xs text-gray-600 tracking-widest mt-1">
                                                {'> STATUS: '}
                                                <span className="text-red-400">
                                                    LOCKED — AUTH REQUIRED
                                                </span>
                                            </p>
                                            <hr className="border-gray-800 my-3" />
                                            <p
                                                className={`font-mono text-xs tracking-widest ${
                                                    detailHasError ? 'text-red-400' : 'text-gray-500'
                                                }`}
                                            >
                                                {detailHasError
                                                    ? '> [AUTHORIZATION FAILED]'
                                                    : '> ENTER AUTH CODE TO DECRYPT'}
                                            </p>
                                            <div className="flex items-center gap-2 font-mono text-sm mt-2">
                                                <span className="text-green-400">{'>'}</span>
                                                <input
                                                    type="text"
                                                    maxLength={12}
                                                    placeholder="_ _ _ _ _ _"
                                                    value={inputs[activeFragment.id] ?? ''}
                                                    onChange={(e) =>
                                                        setInputs((p) => ({
                                                            ...p,
                                                            [activeFragment.id]: e.target.value,
                                                        }))
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter')
                                                            handleSubmit(
                                                                activeFragment.id,
                                                                activeFragment.authCode,
                                                            );
                                                    }}
                                                    className={`bg-transparent border-b ${
                                                        detailHasError
                                                            ? 'border-red-500 text-red-400'
                                                            : 'border-gray-600 text-green-400'
                                                    } outline-none uppercase tracking-widest w-40 placeholder-gray-700 text-sm`}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    autoFocus
                                                />
                                            </div>
                                            <hr className="border-gray-800 mt-3 mb-2" />
                                            <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                                <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">
                                                    ↵
                                                </span>
                                                {'submit · '}
                                                <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                                    ESC
                                                </span>
                                                back to index
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
```

> **Note on IIFE pattern:** The `(() => { ... })()` pattern is used to scope `detailIsUnlocked`, `detailIsDecrypting` etc. without polluting the component body. If the linter or team style guide disallows this, extract those four variable declarations to the component body (before the return) and replace the IIFE with a plain `<div>`.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

If the IIFE pattern triggers lint rules, switch to pre-declared variables:

```tsx
// Add these immediately before the return statement (after activeFragment definition):
const detailIsUnlocked = activeFragmentId ? unlocked.includes(activeFragmentId) : false;
const detailIsDecrypting = activeFragmentId ? (decrypting[activeFragmentId] ?? false) : false;
const detailProgress = activeFragmentId ? (barProgress[activeFragmentId] ?? 0) : 0;
const detailHasError = activeFragmentId ? (errors[activeFragmentId] ?? false) : false;
```

Then simplify the detail screen JSX to:

```tsx
                        {mode === 'detail' && activeFragment && (
                            <div>
                                {/* same content, replace detailIsUnlocked etc. — same variable names */}
                            </div>
                        )}
```

- [ ] **Step 3: Verify the detail screen end-to-end**

With the dev server running at `http://localhost:3000/classified`:

**Locked flow:**
- Navigate to a locked fragment (arrow keys + Enter, or mouse click)
- Confirm: `// FRAGMENT ACCESS`, fragment title in accent colour, `> ORIGIN FILE:` line with full hint, `> STATUS: LOCKED — AUTH REQUIRED` in red, auth input auto-focused
- Type a wrong code, press Enter → `> [AUTHORIZATION FAILED]` flashes red for ~800ms then resets
- Type the correct code (e.g. `DOOR-7A` for fragment 1), press Enter → decrypt bar animates in the fragment's accent colour with a percentage, e.g. `> ████████████░░░░░░░░░ 52%`
- After bar completes → lore text fades in with `classified-decode` animation, `▶ ████████████████████ [DECRYPTED]` bar appears
- Press ESC → returns to index screen, `▶` cursor on the fragment just viewed

**Unlocked re-entry:**
- From index, navigate to an already-unlocked fragment
- Confirm: read-only lore view, `classified-decode` animation replays
- Press ESC → returns to index

**ESC blocked during decrypt:**
- Enter a correct code and immediately press ESC while bar is animating → nothing happens (stays on detail screen)
- After bar completes, ESC works again

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ClassifiedPage.tsx
git commit -m "feat: implement detail screen for classified terminal (locked/decrypting/unlocked)"
```

---

## Task 5: Mode transition fade + final visual polish

Add the opacity fade when switching between index and detail, and verify the final transmission block animates correctly.

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`

- [ ] **Step 1: Verify mode-transition animation is correctly in place**

The plan already wired `classified-decode` onto both mode content wrappers in Tasks 2 and 4. Verify both are present:

Index screen wrapper (Task 2):
```tsx
{mode === 'index' && (
    <div key="index" className="classified-decode">
```

Detail screen wrapper (Task 4):
```tsx
{mode === 'detail' && activeFragment && (
    <div key={activeFragmentId} className="classified-decode">
```

The `classified-decode` CSS animation (`opacity: 0 → 1` with a brief blur) fires on mount, producing the screen-switch fade effect. `key={activeFragmentId}` on the detail wrapper ensures the animation replays when navigating between different fragments (React remounts on key change). The index uses `key="index"` as a stable string since there's only one index screen.

Open `http://localhost:3000/classified` and navigate between index and detail — each transition should show a brief fade-in consistent with the existing decrypt animations on the page.

- [ ] **Step 2: Verify the final transmission block**

In `localStorage`, set all 4 fragment IDs as unlocked (or unlock them in the app), then navigate to `/classified`:
```js
// Paste in browser console:
localStorage.setItem('classified_unlocked', JSON.stringify(['the-mechanisms','the-bludgeon','the-abyss','furnace-of-heaven']));
location.reload();
```

Verify:
- Fragment counter shows `[4/4 FRAGMENTS DECRYPTED]`
- All 4 rows show `[DECRYPTED]` badge in green
- Final transmission block appears below the fragment list with `classified-decode` animation
- Navigating to any fragment's detail screen hides the final transmission (it's index-only)
- ESC from detail returns to index and the final transmission is still visible

Clean up localStorage after verifying:
```js
localStorage.removeItem('classified_unlocked');
```

- [ ] **Step 3: Run lint and tests**

```bash
npm run lint && npm test
```

Expected: 0 lint errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ClassifiedPage.tsx
git commit -m "feat: add mode transition fade and final transmission to classified terminal"
```

---

## Task 6: Cleanup + changelog

Verify there are no remnants of the old design, add the changelog entry, and do a final lint pass.

**Files:**
- Modify: `src/pages/ClassifiedPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Verify `classified-fragment-noise` overlay is gone**

Search for any remaining references to the old noise overlay:

```bash
grep -n "classified-fragment-noise" src/pages/ClassifiedPage.tsx
```

Expected: no output. The old `classified-fragment-noise` overlay was applied per-fragment card. Since there are no per-fragment cards now, it should be gone. If found, remove it.

- [ ] **Step 2: Verify `Button` import is removed**

```bash
grep -n "Button" src/pages/ClassifiedPage.tsx
```

Expected: no output. The SUBMIT button and Return to Base button have both been removed.

- [ ] **Step 3: Run Prettier format**

```bash
npm run format
```

Then re-run lint to confirm no new issues:

```bash
npm run lint
```

- [ ] **Step 4: Update DocumentationPage**

Search `src/pages/DocumentationPage.tsx` for any mention of the Classified Archive or `/classified` route. If found, update it to reflect the new keyboard navigation. If not found, add a note in the appropriate section. The minimum acceptable update is a one-liner: "The Classified Archive (`/classified`) uses a terminal interface — navigate fragments with ↑↓ arrow keys, open with Enter or click, and return with ESC."

- [ ] **Step 5: Add changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES`:

```ts
export const UNRELEASED_CHANGES: string[] = [
    'Classified Archive redesigned as a terminal interface — use arrow keys to navigate fragments, Enter or click to access, ESC to return',
];
```

- [ ] **Step 6: Final manual smoke test**

With the dev server running at `http://localhost:3000/classified`, do a quick end-to-end pass:
- Fresh page load — index screen, cursor on row 0, corruption static overlay at 60% opacity
- Arrow keys move cursor (wraps)
- Enter navigates to detail; ESC returns
- Wrong auth code → red flash
- Correct auth code → decrypt bar with percentage → lore fades in → classified-decode animation
- Re-entering unlocked fragment → read-only view, classified-decode replays
- ESC during decrypt → ignored
- ESC from index → navigates to home page `/`
- Mouse hover moves cursor; mouse click opens fragment

- [ ] **Step 7: Run all tests one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ClassifiedPage.tsx src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "feat: classified archive terminal redesign — two-screen terminal UI with keyboard and mouse navigation"
```

---

## Complete final `ClassifiedPage.tsx` for reference

The implementer should arrive at approximately this file after all tasks are complete. Use this as a reference to check your work — do not copy-paste it wholesale as the tasks above are the authoritative source of truth.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Seo from '../components/seo/Seo';
import { CLASSIFIED_FRAGMENTS, readUnlocked, writeUnlocked } from '../constants/classifiedArchive';

const BAR_TOTAL = 22;

const OPACITY_BY_UNLOCKED: Record<number, string> = {
    0: 'opacity-60',
    1: 'opacity-40',
    2: 'opacity-25',
    3: 'opacity-10',
    4: 'opacity-0',
};

const FINAL_TRANSMISSION = `[PLACEHOLDER — awaiting dev lore]\n\nThe mechanisms. The Bludgeon. The blockade. The signal.\n\nFour pieces. One answer.\n\nIt came through before the blockade was established.\n\nIt has been here the whole time.\n\nIt is patient.`;

type Mode = 'index' | 'detail';

export default function ClassifiedPage() {
    const navigate = useNavigate();

    const [unlocked, setUnlocked] = useState<string[]>(() => readUnlocked());
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
    const [barProgress, setBarProgress] = useState<Record<string, number>>({});
    const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    const [mode, setMode] = useState<Mode>('index');
    const [cursorIndex, setCursorIndex] = useState(0);
    const [activeFragmentId, setActiveFragmentId] = useState<string | null>(null);

    useEffect(() => {
        const intervals = intervalsRef.current;
        return () => {
            Object.values(intervals).forEach(clearInterval);
        };
    }, []);

    const unlockedCount = unlocked.length;
    const allUnlocked = unlockedCount === CLASSIFIED_FRAGMENTS.length;
    const staticOpacity = OPACITY_BY_UNLOCKED[Math.min(unlockedCount, 4)];

    const handleSubmit = useCallback(
        (fragmentId: string, authCode: string) => {
            const input = (inputs[fragmentId] ?? '').trim().toUpperCase();
            if (input !== authCode.trim().toUpperCase()) {
                setErrors((e) => ({ ...e, [fragmentId]: true }));
                setTimeout(() => setErrors((e) => ({ ...e, [fragmentId]: false })), 800);
                return;
            }
            setDecrypting((d) => ({ ...d, [fragmentId]: true }));
            let count = 0;
            const interval = setInterval(() => {
                count++;
                setBarProgress((p) => ({ ...p, [fragmentId]: count }));
                if (count >= BAR_TOTAL) {
                    clearInterval(interval);
                    setUnlocked((prev) => {
                        const next = [...prev, fragmentId];
                        writeUnlocked(next);
                        return next;
                    });
                    setDecrypting((d) => ({ ...d, [fragmentId]: false }));
                }
            }, 40);
            intervalsRef.current[fragmentId] = interval;
        },
        [inputs],
    );

    const navigateToFragment = useCallback((index: number) => {
        const fragment = CLASSIFIED_FRAGMENTS[index];
        setCursorIndex(index);
        setActiveFragmentId(fragment.id);
        setMode('detail');
    }, []);

    const navigateToIndex = useCallback(() => {
        setMode('index');
        setActiveFragmentId(null);
    }, []);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (mode === 'index') {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursorIndex(
                        (i) => (i - 1 + CLASSIFIED_FRAGMENTS.length) % CLASSIFIED_FRAGMENTS.length,
                    );
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursorIndex((i) => (i + 1) % CLASSIFIED_FRAGMENTS.length);
                } else if (e.key === 'Enter') {
                    navigateToFragment(cursorIndex);
                } else if (e.key === 'Escape') {
                    void navigate('/');
                }
            } else if (mode === 'detail' && activeFragmentId) {
                if (e.key === 'Escape') {
                    if (decrypting[activeFragmentId]) return;
                    navigateToIndex();
                } else if (
                    e.key === 'Enter' &&
                    document.activeElement?.tagName !== 'INPUT'
                ) {
                    const fragment = CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId);
                    if (
                        fragment &&
                        !unlocked.includes(activeFragmentId) &&
                        !decrypting[activeFragmentId]
                    ) {
                        handleSubmit(activeFragmentId, fragment.authCode);
                    }
                }
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        mode,
        cursorIndex,
        activeFragmentId,
        decrypting,
        unlocked,
        navigate,
        navigateToFragment,
        navigateToIndex,
        handleSubmit,
    ]);

    const activeFragment = activeFragmentId
        ? (CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId) ?? null)
        : null;

    const detailIsUnlocked = activeFragmentId ? unlocked.includes(activeFragmentId) : false;
    const detailIsDecrypting = activeFragmentId ? (decrypting[activeFragmentId] ?? false) : false;
    const detailProgress = activeFragmentId ? (barProgress[activeFragmentId] ?? 0) : 0;
    const detailHasError = activeFragmentId ? (errors[activeFragmentId] ?? false) : false;

    return (
        <>
            <Seo
                title="CLASSIFIED — STARBORNE PLANNER"
                description="Abyss Incident — Classified Archive"
                noIndex
            />
            <div className="not-found-scanlines fixed inset-0 z-[110] font-secondary overflow-y-auto">
                <div className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-top" />
                <div className="absolute inset-0 bg-[url('/images/BG2.png')] bg-cover opacity-[0.15] mix-blend-screen" />
                <div className="absolute inset-0 bg-black/60" />
                <div className={`classified-static absolute inset-0 mix-blend-overlay ${staticOpacity}`} />

                <div className="relative z-10 flex flex-col items-center min-h-full p-4 py-12">
                    <div className="max-w-2xl w-full card backdrop-blur-sm">
                        {/* INDEX SCREEN */}
                        {mode === 'index' && (
                            <div key="index" className="classified-decode">
                                <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                    {'// STARBORNE PLANNER'}
                                </div>
                                <p className="classified-title-glitch font-mono text-sm font-bold tracking-[0.3em] uppercase text-primary mt-1">
                                    {'> ABYSS INCIDENT — CLASSIFIED ARCHIVE'}
                                </p>
                                <p className="font-mono text-xs text-gray-500 tracking-widest mt-1 mb-3">
                                    {`[${unlockedCount}/${CLASSIFIED_FRAGMENTS.length} FRAGMENTS DECRYPTED]`}
                                </p>
                                <hr className="border-gray-800 mb-3" />
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest mb-3">
                                    {'USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS'}
                                </p>
                                <div>
                                    {CLASSIFIED_FRAGMENTS.map((fragment, i) => {
                                        const isFocused = cursorIndex === i;
                                        const isRowUnlocked = unlocked.includes(fragment.id);
                                        return (
                                            <div
                                                key={fragment.id}
                                                className={`flex items-center justify-between py-0.5 cursor-pointer ${
                                                    isFocused
                                                        ? 'bg-green-950/30 border-l-2 border-green-400 -mx-4 px-[14px]'
                                                        : 'pl-5'
                                                }`}
                                                onMouseEnter={() => setCursorIndex(i)}
                                                onClick={() => navigateToFragment(i)}
                                            >
                                                <span className="font-mono text-xs tracking-widest flex items-center gap-2">
                                                    <span className={`w-3 shrink-0 text-green-400 ${isFocused ? '' : 'invisible'}`}>
                                                        ▶
                                                    </span>
                                                    <span className={fragment.barColorClass}>
                                                        {fragment.title.toUpperCase()}
                                                    </span>
                                                </span>
                                                <span
                                                    className={`font-mono text-[0.6rem] font-bold tracking-widest px-1 border ml-2 shrink-0 ${
                                                        isRowUnlocked
                                                            ? 'text-green-400 border-green-900 bg-green-950/50'
                                                            : 'text-red-400 border-red-900 bg-red-950/30'
                                                    }`}
                                                >
                                                    {isRowUnlocked ? 'DECRYPTED' : 'LOCKED'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                                {allUnlocked && (
                                    <div className="classified-decode mt-4 space-y-3">
                                        <hr className="border-gray-800" />
                                        <p className="font-mono text-xs text-red-500 tracking-widest uppercase font-bold">
                                            {'> FINAL TRANSMISSION — DECRYPTED'}
                                        </p>
                                        <p className="text-base font-bold tracking-widest uppercase text-primary">
                                            ARCHIVE COMPLETE
                                        </p>
                                        <div className="text-sm text-gray-400 space-y-3 font-mono">
                                            {FINAL_TRANSMISSION.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <hr className="border-gray-800 mt-4 mb-2" />
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">↑</span>
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-2">↓</span>
                                    {'move · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">↵</span>
                                    {'open · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">ESC</span>
                                    base
                                </p>
                            </div>
                        )}

                        {/* DETAIL SCREEN */}
                        {mode === 'detail' && activeFragment && (
                            <div key={activeFragmentId} className="classified-decode">
                                <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                    {'// FRAGMENT ACCESS'}
                                </div>
                                <p className={`font-mono text-sm font-bold tracking-[0.3em] uppercase ${activeFragment.barColorClass} mt-1 mb-3`}>
                                    {activeFragment.title.toUpperCase()}
                                </p>

                                {detailIsDecrypting && (
                                    <div className="space-y-1 font-mono text-xs">
                                        <p className="text-gray-500 tracking-widest">
                                            {'> STATUS: '}
                                            <span className="text-green-400">DECRYPTING...</span>
                                        </p>
                                        <hr className="border-gray-800 my-2" />
                                        <p className={activeFragment.barColorClass}>
                                            {`> ${'█'.repeat(detailProgress)}${'░'.repeat(BAR_TOTAL - detailProgress)} ${Math.round((detailProgress / BAR_TOTAL) * 100)}%`}
                                        </p>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="text-gray-600 tracking-widest">{'— — —'}</p>
                                    </div>
                                )}

                                {!detailIsDecrypting && detailIsUnlocked && (
                                    <div>
                                        <p className={`font-mono text-xs tracking-widest ${activeFragment.barColorClass} mb-3`}>
                                            {`> ${'█'.repeat(BAR_TOTAL)} [DECRYPTED]`}
                                        </p>
                                        <hr className="border-gray-800 mb-3" />
                                        <div className="classified-decode text-sm text-gray-400 space-y-3 font-mono">
                                            {activeFragment.body.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-1">ESC</span>
                                            back to index
                                        </p>
                                    </div>
                                )}

                                {!detailIsDecrypting && !detailIsUnlocked && (
                                    <div>
                                        <p className="font-mono text-xs text-gray-600 tracking-widest">
                                            {`> ORIGIN FILE: ${activeFragment.hintLine} — FIELD AGENTS ONLY`}
                                        </p>
                                        <p className="font-mono text-xs text-gray-600 tracking-widest mt-1">
                                            {'> STATUS: '}
                                            <span className="text-red-400">LOCKED — AUTH REQUIRED</span>
                                        </p>
                                        <hr className="border-gray-800 my-3" />
                                        <p className={`font-mono text-xs tracking-widest ${detailHasError ? 'text-red-400' : 'text-gray-500'}`}>
                                            {detailHasError ? '> [AUTHORIZATION FAILED]' : '> ENTER AUTH CODE TO DECRYPT'}
                                        </p>
                                        <div className="flex items-center gap-2 font-mono text-sm mt-2">
                                            <span className="text-green-400">{'>'}</span>
                                            <input
                                                type="text"
                                                maxLength={12}
                                                placeholder="_ _ _ _ _ _"
                                                value={inputs[activeFragment.id] ?? ''}
                                                onChange={(e) =>
                                                    setInputs((p) => ({ ...p, [activeFragment.id]: e.target.value }))
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter')
                                                        handleSubmit(activeFragment.id, activeFragment.authCode);
                                                }}
                                                className={`bg-transparent border-b ${
                                                    detailHasError
                                                        ? 'border-red-500 text-red-400'
                                                        : 'border-gray-600 text-green-400'
                                                } outline-none uppercase tracking-widest w-40 placeholder-gray-700 text-sm`}
                                                autoComplete="off"
                                                spellCheck={false}
                                                autoFocus
                                            />
                                        </div>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">↵</span>
                                            {'submit · '}
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">ESC</span>
                                            back to index
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
```
