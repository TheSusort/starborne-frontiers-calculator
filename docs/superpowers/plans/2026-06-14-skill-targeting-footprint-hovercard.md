# Skill Targeting Footprint in Hovercards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a compact SVG "targeting footprint" board diagram inside ship-skill hovercards for Active and Charge skills that carry targeting data.

**Architecture:** Two pure helpers (`pickDisplayAnchor`, `targetingLabel`) + one presentational SVG component (`SkillTargetingBoard`) that consumes the already-merged targeting model (`parseShipTargeting` → `ParsedPattern`/`SkillTargeting`) and geometry resolver (`resolveCells`, `board.ts`). The component is rendered by `SkillTooltip` via a new optional `targeting` prop; `ShipSkillList` and `ShipIndexPage` supply that prop. Display-only — no engine changes.

**Tech Stack:** React 18 + TypeScript, Vitest + React Testing Library, TailwindCSS, SVG.

**Spec:** `docs/superpowers/specs/2026-06-14-skill-targeting-footprint-hovercard-design.md`

**Sub-skills:** @superpowers:test-driven-development for every code task; @superpowers:verification-before-completion before claiming done.

---

## Working directory

All work happens in the worktree `.worktrees/skill-targeting-footprint` (branch `feat/skill-targeting-footprint-hovercard`). Run all commands from there. The git pre-commit hook runs the full Vitest suite + lint-staged; that is expected.

## File Structure

- **Create** `src/utils/targeting/targetingDisplay.ts` — pure: `pickDisplayAnchor(pattern)` (auto-fit anchor) + `targetingLabel(targeting)` (caption string). Co-located because both are display-only derivations of the parsed targeting; neither belongs in the geometry core (`resolvePattern.ts`).
- **Create** `src/utils/targeting/__tests__/targetingDisplay.test.ts` — unit tests for both helpers.
- **Create** `src/components/ship/SkillTargetingBoard.tsx` — presentational SVG (single/dual board, caption, legend).
- **Create** `src/components/ship/__tests__/SkillTargetingBoard.test.tsx` — render tests.
- **Modify** `src/components/ship/SkillTooltip.tsx` — add optional `targeting?: SkillTargeting` prop; render the board after the skill text.
- **Modify** `src/components/ship/ShipSkillList.tsx` — compute `parseShipTargeting(ship)`, pass `.active`/`.charged` per row.
- **Modify** `src/pages/database/ShipIndexPage.tsx` — pass targeting to the Active and Charge `SkillTooltip`s.
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- **Modify** `src/pages/DocumentationPage.tsx` — short note about footprints in skill hovercards.

> **Naming note (deviation from spec):** spec floated `displayAnchor.ts`; this plan uses `targetingDisplay.ts` since the file holds both the anchor picker and the caption helper. Functionally identical.

---

### Task 1: `pickDisplayAnchor` auto-fit helper

**Files:**
- Create: `src/utils/targeting/targetingDisplay.ts`
- Test: `src/utils/targeting/__tests__/targetingDisplay.test.ts`

Background: `resolveCells(pattern, anchor)` returns only on-board cells (off-board cells are clipped away). So the anchor that yields the **most** cells is the one that clips least — that is our display anchor. Ties are broken by a fixed center-front preference order for deterministic, prototype-like framing. Per spec, pixel-identical reproduction of the prototype's hand-picked anchors is a **non-goal**.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/targeting/__tests__/targetingDisplay.test.ts
import { describe, it, expect } from 'vitest';
import { pickDisplayAnchor } from '../targetingDisplay';
import { parseShipTargeting } from '../../targetingParser';
import { resolveCells } from '../resolvePattern';
import { OFFSET_TABLES, patternSignature } from '../patternOffsets';

function activePattern(pattern: string) {
    return parseShipTargeting({ activeTarget: 'front', activePattern: pattern }).active!.pattern;
}

describe('pickDisplayAnchor', () => {
    it('returns an anchor whose footprint is fully on-board for a standard cone', () => {
        const pattern = activePattern('Pattern-Cone-Range-1');
        const anchor = pickDisplayAnchor(pattern);
        const expected = OFFSET_TABLES[patternSignature(pattern)].length;
        expect(resolveCells(pattern, anchor).length).toBe(expected); // nothing clipped
    });

    it('returns an anchor whose footprint is fully on-board for a backline pattern', () => {
        const pattern = activePattern('Pattern-Backline-Range-2');
        const anchor = pickDisplayAnchor(pattern);
        const expected = OFFSET_TABLES[patternSignature(pattern)].length;
        expect(resolveCells(pattern, anchor).length).toBe(expected);
    });

    it('is deterministic (tie-break) for whole-board "all" patterns', () => {
        const pattern = activePattern('Pattern-All'); // resolves 12 cells from any anchor
        expect(pickDisplayAnchor(pattern)).toBe(pickDisplayAnchor(pattern));
        expect(resolveCells(pattern, pickDisplayAnchor(pattern)).length).toBe(12);
    });
});
```

> If `'Pattern-All'` does not parse to `shape: 'all'`, replace it in the third test with any pattern known to resolve 12 cells, or drop to asserting determinism only. Confirm during the red/green run.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/targeting/__tests__/targetingDisplay.test.ts`
Expected: FAIL — `pickDisplayAnchor` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/targeting/targetingDisplay.ts
import { Position } from '../../types/encounters';
import { ParsedPattern } from '../targetingParser';
import { ALL_POSITIONS } from './board';
import { resolveCells } from './resolvePattern';

// Center-front bias so footprints frame like the prototype; also the deterministic
// tie-break when several anchors clip equally little.
const ANCHOR_PREFERENCE: Position[] = [
    'M3', 'M4', 'M2', 'M1',
    'T3', 'T4', 'T2', 'T1',
    'B3', 'B4', 'B2', 'B1',
];

/**
 * Pick the board cell to anchor a footprint preview on: the anchor that leaves the
 * most cells on-board (resolveCells clips off-board cells), tie-broken by ANCHOR_PREFERENCE.
 * Pure. Throws only if resolveCells throws (unknown pattern signature) — callers guard.
 */
export function pickDisplayAnchor(pattern: ParsedPattern): Position {
    let best: Position = ANCHOR_PREFERENCE[0];
    let bestCount = -1;
    let bestRank = Infinity;
    for (const anchor of ALL_POSITIONS) {
        const count = resolveCells(pattern, anchor).length;
        const rank = ANCHOR_PREFERENCE.indexOf(anchor);
        if (count > bestCount || (count === bestCount && rank < bestRank)) {
            best = anchor;
            bestCount = count;
            bestRank = rank;
        }
    }
    return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/targeting/__tests__/targetingDisplay.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/targeting/targetingDisplay.ts src/utils/targeting/__tests__/targetingDisplay.test.ts
git commit -m "feat(targeting): pickDisplayAnchor auto-fit helper"
```

---

### Task 2: `targetingLabel` caption helper

**Files:**
- Modify: `src/utils/targeting/targetingDisplay.ts`
- Test: `src/utils/targeting/__tests__/targetingDisplay.test.ts`

Caption format (` · `-joined): `<shape> · <range?> · <side selection>`. Range rules from spec:
- numeric `0` → omit the range segment;
- `'all'` → `Whole board` (and no separate range segment);
- `'lane'` → `Whole lane`;
- numeric `>= 1` → `Range N`.

- [ ] **Step 1: Add failing tests**

```ts
// append to targetingDisplay.test.ts
import { targetingLabel } from '../targetingDisplay';
import { parseShipTargeting } from '../../targetingParser';

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('targetingLabel', () => {
    it('labels a ranged cone', () => {
        expect(targetingLabel(active('front', 'Pattern-Cone-Range-1')))
            .toBe('Cone · Range 1 · enemy front');
    });
    it('omits range for single-target base patterns', () => {
        const label = targetingLabel(active('front', 'Pattern-Base'));
        expect(label).toBe('Single target · enemy front');
        expect(label).not.toContain('Range');
    });
});
```

> Verify the exact `activePattern` strings that parse to `shape: 'base'` and `shape: 'cone'` against `parseShipTargeting`/the corpus during the red run; adjust the literal strings (e.g. `'Pattern-Base-Range-0'`) if needed so the parse is valid. The asserted **output** strings are the contract.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/utils/targeting/__tests__/targetingDisplay.test.ts -t targetingLabel`
Expected: FAIL — `targetingLabel` not exported.

- [ ] **Step 3: Implement**

```ts
// add to src/utils/targeting/targetingDisplay.ts
import { ParsedPattern, ParsedTarget, SkillTargeting } from '../targetingParser';

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function shapeSegment(p: ParsedPattern): string {
    if (p.shape === 'base') return 'Single target';
    if (p.shape === 'all') return 'Whole board';
    const prefixes = [
        p.modifiers.reverse && 'Reverse',
        p.modifiers.prolonged && 'Prolonged',
        p.modifiers.double && 'Double',
    ].filter(Boolean);
    const suffixes = [
        p.modifiers.fromCentre && 'from centre',
        p.modifiers.notSelf && 'not self',
        p.modifiers.anchorMod && `(${p.modifiers.anchorMod})`,
    ].filter(Boolean);
    return [...prefixes, cap(p.shape), ...suffixes].join(' ');
}

function rangeSegment(p: ParsedPattern): string | null {
    if (p.shape === 'all' || p.range === 'all') return null; // covered by shapeSegment
    if (p.range === 'lane') return 'Whole lane';
    if (typeof p.range === 'number' && p.range >= 1) return `Range ${p.range}`;
    return null; // range 0 → omit
}

function targetSegment(t: ParsedTarget): string {
    return `${t.side} ${t.selection}`;
}

/** Human-readable one-line caption for a skill's targeting, e.g. "Cone · Range 1 · enemy front". */
export function targetingLabel({ pattern, target }: SkillTargeting): string {
    return [shapeSegment(pattern), rangeSegment(pattern), targetSegment(target)]
        .filter(Boolean)
        .join(' · ');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest --run src/utils/targeting/__tests__/targetingDisplay.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/utils/targeting/targetingDisplay.ts src/utils/targeting/__tests__/targetingDisplay.test.ts
git commit -m "feat(targeting): targetingLabel caption helper"
```

---

### Task 3: `SkillTargetingBoard` SVG component

**Files:**
- Create: `src/components/ship/SkillTargetingBoard.tsx`
- Test: `src/components/ship/__tests__/SkillTargetingBoard.test.tsx`

Renders the footprint. **Support** (`pattern.modifiers.support` OR `target.side === 'ally'`) → one own-board. **Attacker** → your (empty) board + `▶` + mirrored enemy board carrying the footprint. Geometry reuses `positionToAxial` (same axial table the prototype's `AX` used) with the prototype's `rawXY`/`hexPath`/`mirror` math (W=44, H=38, mirror `110 - x`). Each hex group carries `data-position` and `data-role` for testing. Guards `resolveCells` with try/catch (unknown signature → render nothing).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ship/__tests__/SkillTargetingBoard.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTargetingBoard } from '../SkillTargetingBoard';
import { parseShipTargeting } from '../../../utils/targetingParser';

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('SkillTargetingBoard', () => {
    it('renders two boards + arrow for an enemy (attacker) pattern', () => {
        const { container, getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(2);
        expect(getByText('▶')).toBeInTheDocument();
        expect(container.querySelectorAll('[data-role="origin"]').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('[data-role="covered"]').length).toBeGreaterThan(0);
    });

    it('renders a single board for a support (ally) pattern', () => {
        const { container, queryByText } = render(
            <SkillTargetingBoard targeting={active('allies', 'Pattern-Circle-Support-Range-1')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
        expect(queryByText('▶')).toBeNull();
    });

    it('shows the caption', () => {
        const { getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(getByText('Cone · Range 1 · enemy front')).toBeInTheDocument();
    });
});
```

> Confirm `'allies'` parses to `side: 'ally'` and the support pattern string is valid during the red run; substitute a known ally/support pair from the corpus if not. The structural assertions (board count, arrow, roles) are the contract.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/components/ship/__tests__/SkillTargetingBoard.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/ship/SkillTargetingBoard.tsx
import React from 'react';
import { Position } from '../../types/encounters';
import { SkillTargeting } from '../../utils/targetingParser';
import { ALL_POSITIONS, positionToAxial } from '../../utils/targeting/board';
import { CellRole, resolveCells } from '../../utils/targeting/resolvePattern';
import { pickDisplayAnchor, targetingLabel } from '../../utils/targeting/targetingDisplay';

const W = 44;
const H = 38;
const HEX_RX = 21;
const HEX_RY = 24;

const COLORS: Record<CellRole | 'empty', { fill: string; stroke: string }> = {
    origin: { fill: '#7a1020', stroke: '#e0455f' },
    covered: { fill: '#6a4012', stroke: '#e09a45' },
    empty: { fill: '#222a3d', stroke: '#37445e' },
};

function rawXY(pos: Position): [number, number] {
    const { q, r } = positionToAxial(pos);
    return [(q + r / 2) * W, r * H];
}

function hexPath(cx: number, cy: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 90);
        pts.push(
            `${(cx + HEX_RX * Math.cos(a)).toFixed(1)},${(cy + HEX_RY * Math.sin(a)).toFixed(1)}`
        );
    }
    return pts.join(' ');
}

interface BoardProps {
    ox: number;
    oy: number;
    mirror: boolean;
    roles: Map<Position, CellRole>;
    label: string;
}

const Board: React.FC<BoardProps> = ({ ox, oy, mirror, roles, label }) => (
    <g data-board={label}>
        {ALL_POSITIONS.map((pos) => {
            let [x, y] = rawXY(pos);
            if (mirror) x = 110 - x;
            const cx = ox + x + 30;
            const cy = oy + y + 22;
            const role = roles.get(pos);
            const colors = COLORS[role ?? 'empty'];
            return (
                <g key={pos} data-position={pos} data-role={role ?? 'empty'}>
                    <polygon
                        points={hexPath(cx, cy)}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth={1.4}
                    />
                    <text
                        x={cx}
                        y={cy + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fill={role ? '#fff' : '#6b7794'}
                    >
                        {pos}
                    </text>
                </g>
            );
        })}
    </g>
);

interface SkillTargetingBoardProps {
    targeting: SkillTargeting;
}

export const SkillTargetingBoard: React.FC<SkillTargetingBoardProps> = ({ targeting }) => {
    let roles: Map<Position, CellRole>;
    try {
        const anchor = pickDisplayAnchor(targeting.pattern);
        roles = new Map(resolveCells(targeting.pattern, anchor).map((c) => [c.position, c.role]));
    } catch {
        return null; // unknown pattern signature — show nothing rather than crash
    }

    const isSupport =
        targeting.pattern.modifiers.support === true || targeting.target.side === 'ally';
    const caption = targetingLabel(targeting);

    return (
        <div className="mt-2 text-[11px] text-theme-text/70">
            <div className="mb-1">{caption}</div>
            {isSupport ? (
                <svg width={178} height={120} role="img" aria-label={`Targeting footprint: ${caption}`}>
                    <Board ox={0} oy={12} mirror={false} roles={roles} label="own" />
                    <text x={89} y={112} textAnchor="middle" fontSize={10} fill="#5a6a86">
                        your board
                    </text>
                </svg>
            ) : (
                <svg width={402} height={120} role="img" aria-label={`Targeting footprint: ${caption}`}>
                    <Board ox={0} oy={12} mirror={false} roles={new Map()} label="team" />
                    <text x={201} y={62} textAnchor="middle" fontSize={20} fill="#6ca8ff">
                        ▶
                    </text>
                    <Board ox={224} oy={12} mirror roles={roles} label="enemy" />
                </svg>
            )}
            <div className="flex gap-3 mt-1">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-[#e0455f]" />
                    origin
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-[#e09a45]" />
                    covered
                </span>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest --run src/components/ship/__tests__/SkillTargetingBoard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ship/SkillTargetingBoard.tsx src/components/ship/__tests__/SkillTargetingBoard.test.tsx
git commit -m "feat(targeting): SkillTargetingBoard footprint diagram"
```

---

### Task 4: Add `targeting` prop to `SkillTooltip`

**Files:**
- Modify: `src/components/ship/SkillTooltip.tsx`

Pure prop addition — the board renders inside `content` (so both `inline` and boxed variants show it). No behavior change when the prop is absent. (No new test here; covered by Task 3's component tests + Task 5/6 wiring. The pre-commit suite still runs.)

- [ ] **Step 1: Add the import and prop**

In `src/components/ship/SkillTooltip.tsx`, add imports near the top:

```tsx
import { SkillTargeting } from '../../utils/targetingParser';
import { SkillTargetingBoard } from './SkillTargetingBoard';
```

Extend the props interface and destructuring:

```tsx
interface SkillTooltipProps {
    skillText: string;
    skillType: string;
    charge?: number;
    inline?: boolean;
    targeting?: SkillTargeting;
}

export const SkillTooltip: React.FC<SkillTooltipProps> = ({
    skillText,
    skillType,
    charge,
    inline,
    targeting,
}) => {
```

- [ ] **Step 2: Render the board after the text block**

In the `content` JSX, immediately after the closing `</div>` of the `text-sm text-theme-text mb-2` block (currently line ~89) and before the closing `</>`:

```tsx
            {targeting && <SkillTargetingBoard targeting={targeting} />}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ship/SkillTooltip.tsx
git commit -m "feat(targeting): optional targeting prop on SkillTooltip"
```

---

### Task 5: Wire `ShipSkillList`

**Files:**
- Modify: `src/components/ship/ShipSkillList.tsx`

- [ ] **Step 1: Compute targeting and pass per row**

Replace the file body with:

```tsx
import React from 'react';
import { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { parseShipTargeting } from '../../utils/targetingParser';
import { SkillTooltip } from './SkillTooltip';

export const ShipSkillList: React.FC<{ ship: Ship }> = ({ ship }) => {
    const rows = getShipSkillRows(ship);
    if (rows.length === 0) return null;

    const targeting = parseShipTargeting(ship);

    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.label}>
                    <SkillTooltip
                        inline
                        skillText={row.text}
                        skillType={row.label}
                        charge={row.charge}
                        targeting={
                            row.label === 'Active'
                                ? targeting.active
                                : row.label === 'Charge'
                                  ? targeting.charged
                                  : undefined
                        }
                    />
                </div>
            ))}
        </div>
    );
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ship/ShipSkillList.tsx
git commit -m "feat(targeting): show footprint in ShipSkillList skill rows"
```

---

### Task 6: Wire `ShipIndexPage`

**Files:**
- Modify: `src/pages/database/ShipIndexPage.tsx`

- [ ] **Step 1: Import the parser**

Add near the other imports (the file already imports `SkillTooltip` from `'../../components/ship/SkillTooltip'`):

```tsx
import { parseShipTargeting } from '../../utils/targetingParser';
```

- [ ] **Step 2: Pass targeting to the Active `SkillTooltip`**

Find the Active skill `SkillTooltip` (around line 409):

```tsx
                                                            <SkillTooltip
                                                                skillText={ship.activeSkillText}
                                                                skillType="Active Skill"
                                                            />
```

Add the prop:

```tsx
                                                            <SkillTooltip
                                                                skillText={ship.activeSkillText}
                                                                skillType="Active Skill"
                                                                targeting={
                                                                    parseShipTargeting(ship).active
                                                                }
                                                            />
```

- [ ] **Step 3: Pass targeting to the Charge `SkillTooltip`**

Find the Charge skill `SkillTooltip` (around line 454):

```tsx
                                                            <SkillTooltip
                                                                skillText={ship.chargeSkillText}
                                                                skillType="Charge Skill"
                                                                charge={ship.chargeSkillCharge}
                                                            />
```

Add the prop:

```tsx
                                                            <SkillTooltip
                                                                skillText={ship.chargeSkillText}
                                                                skillType="Charge Skill"
                                                                charge={ship.chargeSkillCharge}
                                                                targeting={
                                                                    parseShipTargeting(ship).charged
                                                                }
                                                            />
```

> Passive `SkillTooltip`s are left untouched (no passive targeting in the data model).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/pages/database/ShipIndexPage.tsx
git commit -m "feat(targeting): show footprint in ship database skill hovercards"
```

---

### Task 7: Changelog + in-app docs

**Files:**
- Modify: `src/constants/changelog.ts`
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Add changelog entry**

Add a plain-English bullet to the `UNRELEASED_CHANGES` array in `src/constants/changelog.ts`, matching the existing entry shape (inspect the array first). Suggested text:

> "Skill hovercards now show a board diagram of each Active/Charge skill's targeting footprint — which cells the skill hits (red = primary target, orange = splash)."

- [ ] **Step 2: Update DocumentationPage**

Find the section of `src/pages/DocumentationPage.tsx` that covers the ship database / skills (search for "skill" / "hover"). Add one sentence noting that hovering an Active or Charge skill shows its targeting footprint on a board diagram. Use the existing markup/components in that section — do not hand-roll new containers.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs: changelog + in-app docs for skill targeting footprints"
```

---

### Task 8: Final verification

Apply @superpowers:verification-before-completion — run each command and confirm output before claiming done.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (includes the targeting corpus + new tests).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; 0 lint warnings.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run `npm start` (dev server on :3000), open the ship database, hover an Active/Charge skill on a ship that has targeting data, and confirm the footprint board renders (dual board for enemy-targeting skills, single board for support skills), with a sensible caption and no console errors. Ships lacking targeting data should show the hovercard exactly as before (no board).

- [ ] **Step 4: Report**

Summarize: tests passing (count), typecheck clean, lint clean, manual smoke result. Then proceed to @superpowers:finishing-a-development-branch.
