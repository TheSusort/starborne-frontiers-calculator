# Autogear Custom Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace autogear's dead "Manual" mode with a Custom role the user composes from stats, each carrying a direction (as much / as little as possible), a combine kind (multiplied or added) and an importance.

**Architecture:** A new `CustomFormula` type on `SavedAutogearConfig` feeds a new `customFormulaScore()` which becomes the `else` branch of the role switch in `calculatePriorityScore`, replacing `calculateDefaultScore`. The formula threads from the Autogear page through the strategy interface into both the slow scorer (`scoring.ts`) and the fast scorer (`fastScoring/`). Everything downstream of the base score — limit penalties, set penalties, hard requirements — is untouched.

**Tech Stack:** TypeScript, React 18, TailwindCSS, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-autogear-custom-role-design.md`. Read it before Task 1; it carries the reasoning behind every decision below.

## Global Constraints

- **Run tests with `npm test`** (vitest). **Never `vitest -u`** — it rewrites golden snapshots and destroys the evidence a failure is reporting. Dev server is `npm start` on port 3000, not `npm run dev`.
- **`docs/` is gitignored.** Spec and plan files are committed with `git add -f`. Source files are added normally.
- **UI components come from `src/components/ui/`.** Never a raw `<button>` for a standard action — use `Button` with a variant. Never a hand-rolled box — use the `card` CSS class (`bg-dark border border-dark-border p-4`). Never a hand-rolled input — use `Input`, `Select`, `Checkbox`. Exceptions already in this codebase: toggle chips and full-width accordion headers may be raw `<button>`.
- **No emojis in UI text.** Plain text plus colour classes.
- **Percentage stats are stored as integers**: `crit: 70` means 70%, not 0.70.
- **Changelog:** every user-visible change gets an entry in `UNRELEASED_CHANGES` in `src/constants/changelog.ts` **before** the commit that ships it. Format is an area prefix plus **8-12 words**. One entry per user-visible change — split, never fuse. No worked examples, no before-state beyond the word "now", no mechanism, no scope caveats.
- **Comment rules:** no change history ("extracted in Task 4"), no task/phase numbers, no counts or site enumerations, no rule restated at N call sites, no warning where a test belongs. Present-tense behaviour contracts and bare issue refs (`#482`) only. When editing code that carries a comment violating this, delete or rewrite it rather than working around it.
- **`git commit` runs a husky pre-commit hook that executes the whole test suite.** Expect commits to take minutes. Do not pass `--no-verify` to skip it.
- **Rendering `AutogearSettings` under Vitest needs four things.** No existing test renders it, so this is unmapped ground; every UI task below relies on this list.
  1. `render` from `src/test-utils/test-utils` (wraps `MemoryRouter` + `NotificationProvider`), not from `@testing-library/react` directly.
  2. `vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }))` — the `ui` barrel transitively imports `'/favicon.ico?url'`, which Vitest cannot resolve. Every component test in this project carries this mock.
  3. `vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }))` — the component calls `useTutorialTrigger('autogear-settings')`, which calls `useTutorial()`, which **throws** without a `TutorialProvider`. `TestProviders` does not supply one.
  4. `vi.mock('../CommunityRecommendations', () => ({ CommunityRecommendations: () => null }))` and `vi.mock('../../ship/ShipSelector', () => ({ ShipSelector: () => null }))` — both fetch or open modals and neither is under test.
  `src/components/autogear/__tests__/AutogearQuickSettings.test.tsx` is the working reference for this setup; read it before writing the first UI test.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
  ```

## File Structure

**Created:**
| File | Responsibility |
|---|---|
| `src/utils/autogear/statResolution.ts` | The stat maths `customFormula.ts` and `priorityScore.ts` both need: `calculateDamageReduction`, `calculateEffectiveHP`, `calculateDirectDamage`, `calculateCritMultiplier`, `resolveLimitStatValue`, `MULTIPLIER_NORMALIZERS`. Extracted so neither of those two imports the other. |
| `src/utils/autogear/customFormula.ts` | `customFormulaScore()` and the term maths. Kept out of `priorityScore.ts` (already ~580 lines) so the formula is one holdable unit. |
| `src/utils/autogear/customFormulaSeeds.ts` | The role → seed formula table and `seedFormulaFromRole()`. |
| `src/utils/autogear/__tests__/customFormula.test.ts` | Property probes for the scoring family. |
| `src/utils/autogear/__tests__/customFormulaSeeds.test.ts` | Seed fidelity and the zero-core-seed tripwire. |
| `src/utils/autogear/__tests__/customFormulaThreading.test.ts` | The enum-keyed strategy tripwire and the cache-key test. |
| `src/components/autogear/CustomFormulaRow.tsx` | One formula row: label, direction, importance/percentage, edit, remove. |
| `src/components/autogear/CustomFormulaForm.tsx` | Add/edit form for a formula row. |
| `src/components/autogear/__tests__/CustomFormulaForm.test.tsx` | Form behaviour. |

**Modified:** `src/types/autogear.ts`, `src/utils/autogear/priorityScore.ts`, `src/utils/autogear/scoring.ts`, `src/utils/autogear/fastScoring/context.ts`, `src/utils/autogear/fastScoring/fastScore.ts`, `src/utils/autogear/AutogearStrategy.ts`, `src/utils/autogear/BaseStrategy.ts`, the four files in `src/utils/autogear/strategies/`, `src/pages/manager/AutogearPage.tsx`, `src/components/autogear/AutogearSettings.tsx`, `src/components/autogear/AutogearSettingsModal.tsx`, `src/components/autogear/StatPriorityRow.tsx`, `src/components/autogear/AutogearConfigList.tsx`, `src/components/autogear/AutogearQuickSettings.tsx`, `src/components/autogear/SharedBuildFields.tsx`, `src/components/ui/RoleSelector.tsx`, `src/hooks/useCommunityRecommendations.ts`, `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`, `src/utils/autogear/__tests__/priorityScore.test.ts`, `src/constants/__tests__/statNormalizerReferences.test.ts`.

---

### Task 1: The formula type and its scoring function

The pure maths, with no wiring. Nothing calls it yet, so this task cannot regress the optimizer.

**Files:**
- Modify: `src/types/autogear.ts`
- Create: `src/utils/autogear/statResolution.ts`
- Create: `src/utils/autogear/customFormula.ts`
- Modify: `src/utils/autogear/priorityScore.ts` (move the shared maths out, re-export it)
- Modify: `src/components/autogear/AutogearSettings.tsx` (prop declarations only)
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` (prop declarations only)
- Test: `src/utils/autogear/__tests__/customFormula.test.ts`

**Interfaces:**
- Consumes: `LimitableStat` from `src/types/stats.ts`; `ShipTypeName` from `src/constants/shipTypes.ts`.
- Produces:
  - `CustomFormulaRow`, `CustomFormula`, `FormulaRowKind`, `FormulaDirection`, `CoreImportance` in `src/types/autogear.ts`
  - `src/utils/autogear/statResolution.ts` exporting `calculateDamageReduction`, `calculateEffectiveHP`, `calculateDirectDamage`, `calculateCritMultiplier`, `resolveLimitStatValue`, `MULTIPLIER_NORMALIZERS` — all re-exported from `priorityScore.ts` so no existing importer changes
  - `customFormulaScore(stats: BaseStats, formula: CustomFormula | undefined): number` in `src/utils/autogear/customFormula.ts`
  - `formulaRowTerm(stats: BaseStats, row: CustomFormulaRow): number` (exported for tests and the UI's zero-core note)
  - `isFormulaEmpty(formula: CustomFormula | undefined): boolean`
  - `AutogearSettingsProps` and the modal's forwarded props declare `customFormula`, `onAddFormulaRow`, `onUpdateFormulaRow`, `onRemoveFormulaRow`, `onSeedFormula` — declared here, consumed in Task 8, so Task 6's test-props factory types against the real interface with no cast

- [ ] **Step 1: Add the types**

In `src/types/autogear.ts`, after the existing `StatBonus` interface:

```ts
export type FormulaRowKind = 'core' | 'bonus';
export type FormulaDirection = 'max' | 'min';

/** Exponent applied to a core row's term. Slight / Normal / Heavy. */
export type CoreImportance = 0.5 | 1 | 2;

export interface CustomFormulaRow {
    stat: LimitableStat;
    kind: FormulaRowKind;
    direction: FormulaDirection;
    /** Exponent for a core row. Defaults to 1. Unused on a bonus row. */
    importance?: CoreImportance;
    /** Coefficient for a bonus row, as a percentage. Defaults to 100. Unused on a core row. */
    percentage?: number;
}

export interface CustomFormula {
    rows: CustomFormulaRow[];
    /** The role this formula was seeded from. Drives the Reset button and the label. */
    seededFrom?: ShipTypeName;
}
```

Add `customFormula?: CustomFormula;` to `SavedAutogearConfig`, below `fleetBuffs?`. It must be optional — every persisted config predates it and reads back `undefined`.

- [ ] **Step 1b: Declare the settings props**

`AutogearSettingsProps` in `src/components/autogear/AutogearSettings.tsx` gains five members now, so Task 6's test-props factory types against the real interface. Nothing reads them until Task 8; TypeScript is satisfied because they are declared, and the component simply does not destructure them yet.

```ts
    customFormula: CustomFormula | undefined;
    onAddFormulaRow: (row: CustomFormulaRow) => void;
    onUpdateFormulaRow: (index: number, row: CustomFormulaRow) => void;
    onRemoveFormulaRow: (index: number) => void;
    onSeedFormula: (role: ShipTypeName) => void;
```

Add the same five to `AutogearSettingsModal.tsx`'s props and forward them through to `AutogearSettings`, and pass them at each `AutogearPage.tsx` call site as `customFormula={undefined}` plus `() => undefined` for each callback — placeholders Task 8 replaces with the real handlers.

Import `CustomFormula` and `CustomFormulaRow` as types only in the files that name them — `AutogearSettings.tsx` and `AutogearSettingsModal.tsx`. `AutogearPage.tsx` passes `undefined` and arrow stubs and never names either type, so an import there is unused and fails `npm run lint`.

- [ ] **Step 2: Extract the shared stat maths**

`customFormula.ts` needs `resolveLimitStatValue` and `MULTIPLIER_NORMALIZERS`, and `priorityScore.ts` needs `customFormulaScore` (Task 2). Importing both ways is a cycle, which `eslint.config.js:94` reports as a warning. Break it by extracting what both need.

Create `src/utils/autogear/statResolution.ts` and **move** these into it from `priorityScore.ts`, carrying each one's existing doc comment across verbatim:

- `calculateDamageReduction`
- `calculateEffectiveHP`
- `calculateCritMultiplier`
- `calculateDirectDamage` (and the `calculateDPS` helper it calls, plus `DEFENSE_PENETRATION_LOOKUP` and `DEFAULT_DEFENSE` — `priorityScore.ts` still needs `calculateDPS`, so export it)
- `resolveLimitStatValue`
- `MULTIPLIER_NORMALIZERS` (now exported)

Then in `priorityScore.ts`, import them from `./statResolution` and re-export the public ones so every existing importer is untouched:

```ts
export {
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateCritMultiplier,
    calculateDirectDamage,
    resolveLimitStatValue,
    MULTIPLIER_NORMALIZERS,
} from './statResolution';
```

Run `grep -rn "from '.*priorityScore'" src/ | grep -v __tests__` first and confirm every name those files import is either still defined in `priorityScore.ts` or in that re-export list. `resolveLimitStatValue` in particular is imported from `priorityScore` by `AutogearPage.tsx`, `GeneticStrategy.ts` and `scoring.ts` — the re-export is what keeps those working.

Verify with `npx tsc --noEmit` before writing any new code: a missing re-export shows up here, not in a test.

- [ ] **Step 3: Write the failing tests**

Create `src/utils/autogear/__tests__/customFormula.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { customFormulaScore, formulaRowTerm, isFormulaEmpty } from '../customFormula';
import type { CustomFormula } from '../../../types/autogear';
import type { BaseStats } from '../../../types/stats';

const base: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 7000,
    speed: 130,
    hacking: 200,
    security: 75,
    crit: 50,
    critDamage: 130,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

const withStats = (over: Partial<BaseStats>): BaseStats => ({ ...base, ...over });

describe('customFormulaScore — empty and absent formulas', () => {
    it('scores 0 for an absent formula', () => {
        expect(customFormulaScore(base, undefined)).toBe(0);
    });

    it('scores 0 for a formula with no rows', () => {
        expect(customFormulaScore(base, { rows: [] })).toBe(0);
    });

    it('reports emptiness for both', () => {
        expect(isFormulaEmpty(undefined)).toBe(true);
        expect(isFormulaEmpty({ rows: [] })).toBe(true);
        expect(isFormulaEmpty({ rows: [{ stat: 'hp', kind: 'core', direction: 'max' }] })).toBe(
            false
        );
    });
});

describe('formulaRowTerm', () => {
    it('normalizes a maximized term against the stat geared value', () => {
        // MULTIPLIER_NORMALIZERS.attack is 10000.
        const term = formulaRowTerm(withStats({ attack: 20000 }), {
            stat: 'attack',
            kind: 'core',
            direction: 'max',
        });
        expect(term).toBeCloseTo(2, 10);
    });

    it('gives a minimized term exactly 0.5 at the normalizer', () => {
        // 1 / (1 + 10000/10000) = 0.5. The normalizer is the half-point, which is why
        // the minimize direction depends on it and the maximize direction does not.
        const term = formulaRowTerm(withStats({ attack: 10000 }), {
            stat: 'attack',
            kind: 'core',
            direction: 'min',
        });
        expect(term).toBeCloseTo(0.5, 10);
    });

    it('gives a minimized term below 1 and above 0 for every finite value', () => {
        const low = formulaRowTerm(withStats({ speed: 90 }), {
            stat: 'speed',
            kind: 'core',
            direction: 'min',
        });
        const high = formulaRowTerm(withStats({ speed: 300 }), {
            stat: 'speed',
            kind: 'core',
            direction: 'min',
        });
        expect(low).toBeGreaterThan(high);
        expect(high).toBeGreaterThan(0);
        expect(low).toBeLessThanOrEqual(1);
    });
});

describe('customFormulaScore — the product rewards balance', () => {
    const product: CustomFormula = {
        rows: [
            { stat: 'hacking', kind: 'core', direction: 'max' },
            { stat: 'effectiveHp', kind: 'core', direction: 'max' },
        ],
    };

    it('ranks a balanced build above a lopsided one', () => {
        // hacking normalizer 200, effectiveHp normalizer 120000.
        const balanced = customFormulaScore(withStats({ hacking: 200, hp: 50000 }), product);
        const lopsided = customFormulaScore(withStats({ hacking: 400, hp: 12000 }), product);
        expect(balanced).toBeGreaterThan(lopsided);
    });

    it('is where a weighted sum would rank the lopsided build higher', () => {
        // The contrast is the point: this is why core rows multiply rather than add (#482).
        const sum = (s: BaseStats) => s.hacking / 200 + s.hp / 120000;
        const balancedSum = sum(withStats({ hacking: 200, hp: 50000 }));
        const lopsidedSum = sum(withStats({ hacking: 400, hp: 12000 }));
        expect(lopsidedSum).toBeGreaterThan(balancedSum);
    });
});

describe('customFormulaScore — direction', () => {
    it('ranks a lower value higher for a minimized core row', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'core', direction: 'min' }],
        };
        expect(customFormulaScore(withStats({ speed: 95 }), formula)).toBeGreaterThan(
            customFormulaScore(withStats({ speed: 200 }), formula)
        );
    });

    it('ranks a lower value higher for a minimized bonus row', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'speed', kind: 'bonus', direction: 'min', percentage: 100 },
            ],
        };
        expect(customFormulaScore(withStats({ speed: 95 }), formula)).toBeGreaterThan(
            customFormulaScore(withStats({ speed: 200 }), formula)
        );
    });
});

describe('customFormulaScore — importance', () => {
    it('weighs a Heavy core row more than a Normal one', () => {
        const heavyAttack: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max', importance: 2 },
                { stat: 'crit', kind: 'core', direction: 'max', importance: 1 },
            ],
        };
        // Trade 25% of attack for a 50% bigger crit. With attack Heavy the trade is bad;
        // the same trade under equal importance is good. Only the importance differs
        // between the two halves, which is what this test is about.
        //   heavy: 1.00^2 × 0.500 = 0.5000  vs  0.75^2 × 0.750 = 0.4219
        //   equal: 1.00   × 0.500 = 0.5000  vs  0.75   × 0.750 = 0.5625
        const attackHeavy = customFormulaScore(withStats({ attack: 10000, crit: 40 }), heavyAttack);
        const critHeavy = customFormulaScore(withStats({ attack: 7500, crit: 60 }), heavyAttack);
        expect(attackHeavy).toBeGreaterThan(critHeavy);

        const equal: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max', importance: 1 },
                { stat: 'crit', kind: 'core', direction: 'max', importance: 1 },
            ],
        };
        expect(customFormulaScore(withStats({ attack: 7500, crit: 60 }), equal)).toBeGreaterThan(
            customFormulaScore(withStats({ attack: 10000, crit: 40 }), equal)
        );
    });

    it('cannot reorder a ranking when there is one core row and no bonus rows', () => {
        // An exponent is a monotone transform. This is why the UI disables the control here.
        const one: BaseStats = withStats({ attack: 8000 });
        const two: BaseStats = withStats({ attack: 12000 });
        for (const importance of [0.5, 1, 2] as const) {
            const formula: CustomFormula = {
                rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance }],
            };
            expect(customFormulaScore(two, formula)).toBeGreaterThan(
                customFormulaScore(one, formula)
            );
        }
    });
});

describe('customFormulaScore — a zero core term zeroes the product', () => {
    it('scores 0 when a maximized core stat is 0, whatever the other rows hold', () => {
        // Deliberate product semantics, and the reason a stat that can be 0 at base
        // belongs in a bonus row. The UI surfaces this case on the row.
        const formula: CustomFormula = {
            rows: [
                { stat: 'hp', kind: 'core', direction: 'max' },
                { stat: 'healModifier', kind: 'core', direction: 'max' },
            ],
        };
        expect(customFormulaScore(withStats({ healModifier: 0 }), formula)).toBe(0);
        expect(customFormulaScore(withStats({ healModifier: 50 }), formula)).toBeGreaterThan(0);
    });

    it('leaves the other rows ranking intact when that stat is a bonus row instead', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'hp', kind: 'core', direction: 'max' },
                { stat: 'healModifier', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        expect(
            customFormulaScore(withStats({ hp: 60000, healModifier: 0 }), formula)
        ).toBeGreaterThan(customFormulaScore(withStats({ hp: 40000, healModifier: 0 }), formula));
    });
});

describe('customFormulaScore — bonus-only and mixed formulas', () => {
    it('scores a bonus-only formula off the empty product', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 }],
        };
        // 1 + 1.0 * (130/130) = 2
        expect(customFormulaScore(withStats({ speed: 130 }), formula)).toBeCloseTo(2, 10);
    });

    it('scales a bonus row by its percentage', () => {
        const half: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 50 }],
        };
        expect(customFormulaScore(withStats({ speed: 130 }), half)).toBeCloseTo(1.5, 10);
    });

    it('multiplies the core product by the bonus factor', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        // (10000/10000) * (1 + 130/130) = 2
        expect(customFormulaScore(withStats({ attack: 10000, speed: 130 }), formula)).toBeCloseTo(
            2,
            10
        );
    });
});

describe('customFormulaScore — defaults on a partial row', () => {
    it('treats a core row with no importance as Normal', () => {
        const bare: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const normal: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
        };
        expect(customFormulaScore(base, bare)).toBeCloseTo(customFormulaScore(base, normal), 10);
    });

    it('treats a bonus row with no percentage as 100', () => {
        const bare: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max' }],
        };
        const full: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 }],
        };
        expect(customFormulaScore(base, bare)).toBeCloseTo(customFormulaScore(base, full), 10);
    });
});
```

- [ ] **Step 4: Run the tests and confirm they fail for the right reason**

Run: `npm test -- src/utils/autogear/__tests__/customFormula.test.ts`

Expected: every test fails on module resolution — `Failed to resolve import "../customFormula"`. If any test fails for a different reason, the fixture is wrong; fix it before writing the implementation.

- [ ] **Step 5: Implement `customFormula.ts`**

Create `src/utils/autogear/customFormula.ts`:

```ts
import type { BaseStats } from '../../types/stats';
import type { CustomFormula, CustomFormulaRow } from '../../types/autogear';
import { MULTIPLIER_NORMALIZERS, resolveLimitStatValue } from './statResolution';

/**
 * One row's contribution, normalized so rows on different stats are comparable.
 *
 * A maximized term is `value / normalizer` and is 0 when the stat is 0 — which zeroes
 * the whole core product. That is the product semantics on purpose (a lopsided build
 * must lose), and it is why a stat that can be 0 at base belongs in a bonus row.
 *
 * A minimized term is `1 / (1 + value / normalizer)`: bounded to (0, 1], falling as the
 * stat rises, and never 0. The normalizer is the half-point — at `value === normalizer`
 * the term is exactly 0.5 — so for this direction the constant is a real parameter, not
 * the cosmetic scale factor it is for a maximized term.
 */
export function formulaRowTerm(stats: BaseStats, row: CustomFormulaRow): number {
    const normalizer = MULTIPLIER_NORMALIZERS[row.stat] || 1;
    const n = resolveLimitStatValue(stats, row.stat) / normalizer;
    return row.direction === 'min' ? 1 / (1 + n) : n;
}

export function isFormulaEmpty(formula: CustomFormula | undefined): boolean {
    return !formula || formula.rows.length === 0;
}

/**
 * Base score for a Custom role: core rows multiply, bonus rows add.
 *
 *   score = Π core term^importance × (1 + Σ bonus (percentage/100) × term)
 *
 * The empty core product is 1, so a bonus-only formula still scores. An empty formula
 * scores 0 — the caller is expected to have blocked the run before that (`isFormulaEmpty`),
 * because a 0 for every candidate ties the whole search.
 */
export function customFormulaScore(
    stats: BaseStats,
    formula: CustomFormula | undefined
): number {
    if (isFormulaEmpty(formula)) return 0;

    let product = 1;
    let bonusSum = 0;

    for (const row of formula!.rows) {
        const term = formulaRowTerm(stats, row);
        if (row.kind === 'core') {
            const importance = row.importance ?? 1;
            product *= importance === 1 ? term : Math.pow(term, importance);
        } else {
            bonusSum += ((row.percentage ?? 100) / 100) * term;
        }
    }

    return product * (1 + bonusSum);
}
```

`product` starts at 1, so a bonus-only formula returns `1 + Σ` with no special case. The `scores a bonus-only formula off the empty product` test is what holds that — a tripwire rather than a branch asserting it.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- src/utils/autogear/__tests__/customFormula.test.ts`

Expected: PASS, all tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors. `tsc` is the oracle here — the eslint autofixer is not.

- [ ] **Step 8: Commit**

```bash
git add src/types/autogear.ts src/utils/autogear/statResolution.ts src/utils/autogear/customFormula.ts src/utils/autogear/priorityScore.ts src/utils/autogear/__tests__/customFormula.test.ts src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
git commit -m "$(cat <<'MSG'
feat(autogear): add a custom-role formula and its scoring function

Core rows multiply and bonus rows add, so "both stats must be good" and
"and a little speed" are both expressible. A weighted sum alone corners on
whichever stat is cheapest in the player's inventory (#482).

Terms are normalized against MULTIPLIER_NORMALIZERS: max is v/c, min is
1/(1+v/c). For the min direction the normalizer is the half-point, so it is a
real parameter rather than the cosmetic scale factor it is for max.

Nothing calls this yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 2: Replace the lexicographic manual branch

`calculatePriorityScore`'s no-role branch calls `calculateDefaultScore`, which weighs priority `i` by `2^(n-1-i)` and is the only code anywhere that reads the *order* of `statPriorities`. Swapping it for the formula makes priority order inert, which two existing tests and one comment currently depend on.

**Files:**
- Modify: `src/utils/autogear/priorityScore.ts`
- Modify: `src/utils/autogear/__tests__/priorityScore.test.ts`
- Modify: `src/constants/__tests__/statNormalizerReferences.test.ts`

**Interfaces:**
- Consumes: `customFormulaScore` from Task 1.
- Produces: `calculatePriorityScore(stats, priorities, shipRole?, setCount?, setPriorities?, statBonuses?, tryToCompleteSets?, arcaneSiegeMultiplier?, implantSetCount?, customFormula?)` — the tenth positional parameter is new. Later tasks pass it from `scoring.ts` and `fastScore.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/autogear/__tests__/priorityScore.test.ts`:

```ts
describe('calculatePriorityScore — custom formula branch', () => {
    it('scores from the formula when no role is given', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const score = calculatePriorityScore(
            stats,
            [],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        // attack 10000 against the 10000 normalizer.
        expect(score).toBeCloseTo(1, 10);
    });

    it('scores 0 with no role and no formula', () => {
        expect(calculatePriorityScore(stats, [], undefined, {}, [], [], false, 0)).toBe(0);
    });

    it('ignores the formula when a role is given', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'core', direction: 'max' }],
        };
        const withFormula = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const without = calculatePriorityScore(stats, [], 'ATTACKER', {}, [], [], false, 0);
        expect(withFormula).toBeCloseTo(without, 10);
    });

    it('applies limit penalties on top of a formula score', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const unmet: StatPriority[] = [{ stat: 'speed', minLimit: 600, weight: 1 }];
        const penalised = calculatePriorityScore(
            stats,
            unmet,
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const clean = calculatePriorityScore(
            stats,
            [],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        expect(penalised).toBeLessThan(clean);
    });
});

describe('stat-priority order is inert', () => {
    // The reorder arrows come off StatPriorityRow because of this. Both priorities carry
    // limits the fixture violates, so a scorer that read order would return different
    // numbers for the two arrangements.
    const a: StatPriority = { stat: 'speed', minLimit: 600, weight: 1 };
    const b: StatPriority = { stat: 'crit', minLimit: 90, weight: 1 };

    it('scores the same for a list and its reverse, in role mode', () => {
        expect(calculatePriorityScore(stats, [a, b], 'ATTACKER')).toBeCloseTo(
            calculatePriorityScore(stats, [b, a], 'ATTACKER'),
            10
        );
    });

    it('scores the same for a list and its reverse, in custom mode', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const forward = calculatePriorityScore(
            stats,
            [a, b],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const reversed = calculatePriorityScore(
            stats,
            [b, a],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        expect(forward).toBeCloseTo(reversed, 10);
        // Non-vacuity: the penalty must actually bite, or this passes for the wrong reason.
        expect(forward).toBeLessThan(
            calculatePriorityScore(stats, [], undefined, {}, [], [], false, 0, undefined, formula)
        );
    });

    it('violates the same amount for a list and its reverse', () => {
        const hardA: StatPriority = { ...a, hardRequirement: true };
        const hardB: StatPriority = { ...b, hardRequirement: true };
        const forward = calculateHardViolation(stats, [hardA, hardB]);
        expect(forward).toBeCloseTo(calculateHardViolation(stats, [hardB, hardA]), 10);
        expect(forward).toBeGreaterThan(0);
    });
});
```

Add `CustomFormula` to the type import at the top of that file:

```ts
import { CustomFormula, SetPriority, StatPriority } from '../../../types/autogear';
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/utils/autogear/__tests__/priorityScore.test.ts`

Expected: the four `custom formula branch` tests fail (`calculatePriorityScore` takes nine parameters, so the tenth argument is a TS error and the formula tests get 0). The three `order is inert` tests **pass already for role mode** and the custom-mode one fails. That split is the point: role mode never read order, and the test documents it.

- [ ] **Step 3: Add the parameter and the branch**

In `src/utils/autogear/priorityScore.ts`:

Add the import at the top:

```ts
import { customFormulaScore } from './customFormula';
```

`customFormula.ts` imports `MULTIPLIER_NORMALIZERS` and `resolveLimitStatValue` from this file, so this is a cycle. It is safe because both modules only call across it at runtime, never at module-evaluation time — but if the bundler complains, move `MULTIPLIER_NORMALIZERS` and `resolveLimitStatValue` into `customFormula.ts` and re-export them from `priorityScore.ts` instead.

Add the parameter to `calculatePriorityScore`, after `implantSetCount`:

```ts
    implantSetCount?: Record<string, number>,
    customFormula?: CustomFormula
): number {
```

Add `CustomFormula` to the existing type import from `'../../types/autogear'`.

Replace the `else` branch of the role switch:

```ts
    } else {
        baseScore = customFormulaScore(stats, customFormula);
    }
```

- [ ] **Step 4: Delete the dead lexicographic scorer**

Remove from `src/utils/autogear/priorityScore.ts`:
- the `orderMultiplierCache` declaration
- the `getOrderMultipliers` function and its doc comment
- the `calculateDefaultScore` function and its `// Helper function for default scoring mode` comment

Then remove `STAT_NORMALIZERS` from that file's import on line 3, leaving `import { ShipTypeName, GEAR_SETS } from '../../constants';`. `STAT_NORMALIZERS` is still used by `src/utils/autogear/implantFilter.ts`, so the constant itself stays.

- [ ] **Step 5: Rewrite the two tests that exercised the deleted branch**

`src/utils/autogear/__tests__/priorityScore.test.ts` has two tests in the `STAT_NORMALIZERS keys match real stat names` describe block — `normalizes a defence priority against defence scale, not raw value` and `normalizes a crit priority against the crit scale` — that call `calculatePriorityScore` with a priority and no role, and assert the ratio against `STAT_NORMALIZERS`. That path no longer exists. `STAT_NORMALIZERS` is now read only by `implantFilter.ts`, so move the coverage there. Replace both tests with:

```ts
    it('normalizes an implant candidate against the stat scale, not its raw value', () => {
        // STAT_NORMALIZERS survives only for implant pre-filtering. defence and attack
        // share a 5000 normalizer, so the same raw roll must rank equally on either stat.
        expect(STAT_NORMALIZERS.defence).toBe(STAT_NORMALIZERS.attack);
        expect(STAT_NORMALIZERS.crit).toBe(25);
    });
```

Keep the surrounding `has no entry keyed by a name the type system never produces` test unchanged — it guards the key set and is independent of who reads the table.

- [ ] **Step 6: Fix the comment that now lies**

`src/constants/__tests__/statNormalizerReferences.test.ts` opens with a comment saying `STAT_NORMALIZERS` "drives manual-mode stat-PRIORITY scoring (calculateDefaultScore, used only when no role is selected) and implant pre-filtering". The first half is now false. Replace the first sentence with:

```ts
// STAT_NORMALIZERS drives implant pre-filtering (implantFilter.ts, which normalizes both
// the priority and the bonus term when ranking implant candidates). It is NOT read by the
```

leaving the rest of the comment — the `MULTIPLIER_NORMALIZERS` contrast and the "wide bounds, fail at ~2x" rationale — exactly as it is.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS. Watch specifically for `src/utils/autogear/__tests__/scoring.test.ts`, `fastScoring/__tests__/equivalence.test.ts` and the golden fixture suites — a golden audit spans the whole run, so a partial run can hide a break. If a golden fixture moved, stop and read the diff: **do not** run `vitest -u`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/utils/autogear/priorityScore.ts src/utils/autogear/__tests__/priorityScore.test.ts src/constants/__tests__/statNormalizerReferences.test.ts
git commit -m "$(cat <<'MSG'
refactor(autogear): score a roleless build from its formula, not priority order

calculateDefaultScore weighed priority i by 2^(n-1-i), which made ordering
the only control that mattered while weight was hard-coded to 1 at every UI
site. It was also the only code anywhere that read the order of
statPriorities: every other consumer sums an order-independent penalty.

Replacing it makes priority order inert, which the new tests pin in both role
and custom mode so the reorder arrows can come off the row.

STAT_NORMALIZERS survives for implant pre-filtering; the two tests that
reached it through the deleted branch now assert the table directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 3: Thread the formula through both scorers

`calculatePriorityScore` now accepts a formula but nothing supplies one. Two callers must: the slow scorer in `scoring.ts` and the fast scorer in `fastScoring/`.

**Files:**
- Modify: `src/utils/autogear/scoring.ts`
- Modify: `src/utils/autogear/fastScoring/context.ts`
- Modify: `src/utils/autogear/fastScoring/fastScore.ts`
- Test: `src/utils/autogear/__tests__/customFormulaThreading.test.ts` (created here, extended in Task 4)

**Interfaces:**
- Consumes: `calculatePriorityScore`'s tenth parameter from Task 2.
- Produces:
  - `calculateTotalScore(ship, equipment, priorities, getGearPiece, getEngineeringStatsForShipType, shipRole?, setPriorities?, statBonuses?, tryToCompleteSets?, arenaModifiers?, fleetBuffs?, customFormula?)` — twelfth parameter is new.
  - `FastScoringContext.customFormula: CustomFormula | undefined` and `BuildContextInput.customFormula?: CustomFormula`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/autogear/__tests__/customFormulaThreading.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { calculateTotalScore, clearScoreCache } from '../scoring';
import type { CustomFormula } from '../../../types/autogear';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const attackFormula: CustomFormula = {
    rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
};
const speedFormula: CustomFormula = {
    rows: [{ stat: 'speed', kind: 'core', direction: 'max' }],
};

const ship: Ship = {
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    baseStats: {
        hp: 20000,
        attack: 8000,
        defence: 4000,
        speed: 120,
        hacking: 0,
        security: 0,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    level: 60,
    rank: 6,
    equipment: {},
    refits: [],
    implants: {},
} as Ship;

const getGearPiece = (): GearPiece | undefined => undefined;
const getEngineeringStats = () => undefined;

const score = (formula: CustomFormula | undefined) =>
    calculateTotalScore(
        ship,
        {},
        [],
        getGearPiece,
        getEngineeringStats,
        undefined,
        [],
        [],
        false,
        null,
        [],
        formula
    );

describe('calculateTotalScore threads the custom formula', () => {
    beforeEach(() => clearScoreCache());

    it('scores a roleless build from the formula it is given', () => {
        expect(score(attackFormula)).toBeGreaterThan(0);
    });

    it('scores 0 for a roleless build with no formula', () => {
        expect(score(undefined)).toBe(0);
    });

    it('gives two different formulas two different scores without an intervening clear', () => {
        // The memo cache key carries shipRole but not the formula. Today only
        // clearScoreCache() at the start of every run keeps that from being a live bug;
        // this test pins the guarantee instead of leaving it to a comment.
        const a = score(attackFormula);
        const b = score(speedFormula);
        expect(a).not.toBeCloseTo(b, 6);
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaThreading.test.ts`

Expected: FAIL. `calculateTotalScore` takes eleven parameters, so the twelfth argument is a TS error; the first test gets 0 and the third sees two equal scores.

- [ ] **Step 3: Thread it through `scoring.ts`**

Add `CustomFormula` to the type import from `'../../types/autogear'`.

Add the parameter to `calculateTotalScore`, after `fleetBuffs`:

```ts
    fleetBuffs?: FleetBuff[],
    customFormula?: CustomFormula
): number {
```

Build a key fragment beside the existing `bonusesKey` (around line 201):

```ts
    const formulaKey = customFormula?.rows.length
        ? customFormula.rows
              .map(
                  (r) =>
                      `${r.stat}:${r.kind}:${r.direction}:${r.importance ?? 1}:${r.percentage ?? 100}`
              )
              .join(',')
        : 'none';
```

and add it to the cache key on line 213:

```ts
    const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}|${fleetBuffsKey}|${formulaKey}`;
```

Pass it into the scorer at the `calculatePriorityScore` call (around line 277), as the tenth argument after `implantSetCount`:

```ts
        implantSetCount,
        customFormula
    );
```

- [ ] **Step 4: Thread it through the fast scorer**

In `src/utils/autogear/fastScoring/context.ts`:

Add `CustomFormula` to the type import from `'../../../types/autogear'`. Add to `FastScoringContext`, below `statBonuses`:

```ts
    readonly customFormula: CustomFormula | undefined;
```

Add to `BuildContextInput`, below `statBonuses?`:

```ts
    customFormula?: CustomFormula;
```

And to the returned object in `buildFastScoringContext`, below `statBonuses: input.statBonuses,`:

```ts
        customFormula: input.customFormula,
```

In `src/utils/autogear/fastScoring/fastScore.ts`, pass it as the tenth argument of the `calculatePriorityScore` call (around line 120):

```ts
        implantSetCount,
        context.customFormula
    );
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaThreading.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the equivalence suite**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/equivalence.test.ts`

Expected: PASS. This suite asserts the fast and slow scorers agree; it is the thing that catches a formula threaded into one and not the other.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/autogear/scoring.ts src/utils/autogear/fastScoring/context.ts src/utils/autogear/fastScoring/fastScore.ts src/utils/autogear/__tests__/customFormulaThreading.test.ts
git commit -m "$(cat <<'MSG'
feat(autogear): thread the custom formula through both scorers

The slow scorer's memo key carried shipRole and nothing about the formula, so
two formulas on the same ship and gear collided. A key fragment closes it and
a test pins it, rather than relying on clearScoreCache() running first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 4: Thread the formula through every strategy

Four strategies each take eleven positional parameters and forward them to a scorer. Adding a twelfth is exactly the step where one gets missed, so the test is keyed to the `AutogearAlgorithm` enum rather than to a hand-written list of strategies.

**Files:**
- Modify: `src/utils/autogear/AutogearStrategy.ts`
- Modify: `src/utils/autogear/BaseStrategy.ts`
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`
- Modify: `src/utils/autogear/strategies/TwoPassStrategy.ts`
- Modify: `src/utils/autogear/strategies/SetFirstStrategy.ts`
- Modify: `src/utils/autogear/strategies/BeamSearchStrategy.ts`
- Modify: `src/utils/autogear/__tests__/customFormulaThreading.test.ts`

**Interfaces:**
- Consumes: `calculateTotalScore`'s twelfth parameter and `BuildContextInput.customFormula` from Task 3.
- Produces: `findOptimalGear(ship, priorities, inventory, getGearPiece, getEngineeringStatsForShipType, shipRole?, setPriorities?, statBonuses?, tryToCompleteSets?, arenaModifiers?, fleetBuffs?, customFormula?)` on `AutogearStrategy`. Task 8 calls it from the page.

- [ ] **Step 1: Write the failing tripwire test**

Append to `src/utils/autogear/__tests__/customFormulaThreading.test.ts`:

```ts
import { AutogearAlgorithm } from '../AutogearStrategy';
import { getAutogearStrategy } from '../getStrategy';

// A gear piece that is strong in attack and weak in speed, and its mirror. A strategy
// that forwards the formula picks a different one for each formula; a strategy that drops
// it scores every candidate 0 and returns whatever its tie-break happens to yield.
const attackPiece: GearPiece = {
    id: 'gear-attack',
    slot: 'weapon',
    level: 12,
    stars: 5,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 4000, type: 'flat' },
    subStats: [],
    setBonus: 'CRITICAL',
} as GearPiece;

const speedPiece: GearPiece = {
    id: 'gear-speed',
    slot: 'weapon',
    level: 12,
    stars: 5,
    rarity: 'legendary',
    mainStat: { name: 'speed', value: 40, type: 'flat' },
    subStats: [],
    setBonus: 'HASTE',
} as GearPiece;

const inventory = [attackPiece, speedPiece];
const resolve = (id: string) => inventory.find((p) => p.id === id);

describe('every registered strategy forwards the custom formula', () => {
    // Keyed to the AutogearAlgorithm enum, not to a list of strategy files, so a strategy
    // added later is covered without anyone remembering to extend this test.
    for (const algorithm of Object.values(AutogearAlgorithm)) {
        it(`${algorithm} picks a different piece for an attack formula than a speed formula`, async () => {
            clearScoreCache();
            const strategy = getAutogearStrategy(algorithm);

            const forAttack = await Promise.resolve(
                strategy.findOptimalGear(
                    ship,
                    [],
                    inventory,
                    resolve,
                    getEngineeringStats,
                    undefined,
                    [],
                    [],
                    false,
                    null,
                    [],
                    attackFormula
                )
            );
            clearScoreCache();
            const forSpeed = await Promise.resolve(
                strategy.findOptimalGear(
                    ship,
                    [],
                    inventory,
                    resolve,
                    getEngineeringStats,
                    undefined,
                    [],
                    [],
                    false,
                    null,
                    [],
                    speedFormula
                )
            );

            const pick = (r: { suggestions: { gearId: string }[] }) =>
                r.suggestions.find((s) => s.gearId)?.gearId;
            expect(pick(forAttack)).toBe('gear-attack');
            expect(pick(forSpeed)).toBe('gear-speed');
        });
    }
});
```

- [ ] **Step 2: Run it and confirm it fails for every algorithm**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaThreading.test.ts`

Expected: FAIL on all four algorithms — `findOptimalGear` takes eleven parameters, so the twelfth argument is a TS error and no strategy sees a formula. If it fails on some and passes on others, the fixture is not discriminating; make the two pieces differ more sharply before proceeding.

- [ ] **Step 3: Add the parameter to the interface and the base class**

In `src/utils/autogear/AutogearStrategy.ts`, add `CustomFormula` to the type import from `'../../types/autogear'` and add the parameter to `findOptimalGear`:

```ts
        fleetBuffs?: FleetBuff[],
        customFormula?: CustomFormula
    ): Promise<AutogearResult> | AutogearResult;
```

In `src/utils/autogear/BaseStrategy.ts`, add the same parameter to the `abstract findOptimalGear` signature, with the same `CustomFormula` import.

- [ ] **Step 4: Add it to all four strategies**

Each strategy's `findOptimalGear` gets `customFormula?: CustomFormula` as its last parameter (import the type from `'../../../types/autogear'`), and forwards it as the last argument at each scoring call site:

- `src/utils/autogear/strategies/GeneticStrategy.ts` — signature at line 100; `buildFastScoringContext({...})` at line 137 gains `customFormula,` as a property; `calculateTotalScore` at line 531 and at line 741 each gain `customFormula` as the twelfth argument. All three sites, or the fast and slow paths disagree and `equivalence.test.ts` fails.
- `src/utils/autogear/strategies/TwoPassStrategy.ts` — signature at line 27; `calculateTotalScore` at line 288. The scoring call is inside a helper, so thread the formula to that helper as a parameter rather than reaching for a module-level variable.
- `src/utils/autogear/strategies/SetFirstStrategy.ts` — signature at line 34; `calculateTotalScore` at line 202, same helper-threading note.
- `src/utils/autogear/strategies/BeamSearchStrategy.ts` — signature at line 35. Find its scoring calls with `grep -n 'calculateTotalScore\|fastScore\|buildFastScoringContext' src/utils/autogear/strategies/BeamSearchStrategy.ts` and forward the formula at each.

- [ ] **Step 5: Run the tripwire and confirm it passes for every algorithm**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaThreading.test.ts`

Expected: PASS, four algorithm cases plus the three from Task 3.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`

Expected: PASS and no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/AutogearStrategy.ts src/utils/autogear/BaseStrategy.ts src/utils/autogear/strategies src/utils/autogear/__tests__/customFormulaThreading.test.ts
git commit -m "$(cat <<'MSG'
feat(autogear): forward the custom formula from every strategy

The tripwire iterates AutogearAlgorithm rather than a list of strategy files,
so a strategy added later is covered without anyone extending the test. It
asserts each strategy picks the attack piece under an attack formula and the
speed piece under a speed formula — a strategy that drops the parameter
scores every candidate 0 and fails.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 5: Role seeds

A blank formula is a blank page. Selecting Custom offers a role to clone. Five role formulas translate exactly; seven do not, and each seed carries its own fidelity note rather than being presented as the real thing.

**Files:**
- Create: `src/utils/autogear/customFormulaSeeds.ts`
- Test: `src/utils/autogear/__tests__/customFormulaSeeds.test.ts`

**Interfaces:**
- Consumes: `CustomFormula`, `CustomFormulaRow` from Task 1; `calculateRoleScore` from `priorityScore.ts`; `getBaseRoleStats` from `src/constants/roleBaseStats.ts`.
- Produces:
  - `CUSTOM_FORMULA_SEEDS: Record<ShipTypeName, { rows: CustomFormulaRow[]; fidelity: string }>`
  - `seedFormulaFromRole(role: ShipTypeName): CustomFormula`
  - `EXACT_SEED_ROLES: readonly ShipTypeName[]`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/autogear/__tests__/customFormulaSeeds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    CUSTOM_FORMULA_SEEDS,
    EXACT_SEED_ROLES,
    seedFormulaFromRole,
} from '../customFormulaSeeds';
import { customFormulaScore } from '../customFormula';
import { calculateRoleScore } from '../priorityScore';
import { SHIP_TYPES, type ShipTypeName } from '../../../constants';
import { getBaseRoleStats } from '../../../constants/roleBaseStats';
import { resolveLimitStatValue } from '../priorityScore';
import type { BaseStats } from '../../../types/stats';

const ALL_ROLES = Object.keys(SHIP_TYPES) as ShipTypeName[];

// A spread of builds wide enough that a wrong seed reorders at least one pair.
const builds: BaseStats[] = [
    { hp: 40000, attack: 8000, defence: 5000, speed: 110, hacking: 150, security: 50, crit: 30, critDamage: 90, healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
    { hp: 60000, attack: 6000, defence: 9000, speed: 140, hacking: 260, security: 90, crit: 60, critDamage: 160, healModifier: 30, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
    { hp: 30000, attack: 14000, defence: 3000, speed: 95, hacking: 320, security: 20, crit: 80, critDamage: 200, healModifier: 10, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
    { hp: 52000, attack: 11000, defence: 7000, speed: 165, hacking: 200, security: 75, crit: 45, critDamage: 120, healModifier: 50, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
    { hp: 22000, attack: 9500, defence: 4200, speed: 125, hacking: 210, security: 60, crit: 20, critDamage: 70, healModifier: 5, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
];

const rank = (scoreOf: (b: BaseStats) => number) =>
    builds
        .map((b, i) => ({ i, score: scoreOf(b) }))
        .sort((a, b) => b.score - a.score)
        .map((e) => e.i);

describe('seed coverage', () => {
    it('has a seed for every role', () => {
        for (const role of ALL_ROLES) {
            expect(CUSTOM_FORMULA_SEEDS[role]).toBeDefined();
            expect(CUSTOM_FORMULA_SEEDS[role].rows.length).toBeGreaterThan(0);
            expect(CUSTOM_FORMULA_SEEDS[role].fidelity).not.toBe('');
        }
    });

    it('records the seeded role on the produced formula', () => {
        expect(seedFormulaFromRole('ATTACKER').seededFrom).toBe('ATTACKER');
    });
});

describe('exact seeds rank identically to their role formula', () => {
    for (const role of EXACT_SEED_ROLES) {
        it(`${role}`, () => {
            const viaRole = rank((b) => calculateRoleScore(role, b));
            const viaFormula = rank((b) => customFormulaScore(b, seedFormulaFromRole(role)));
            expect(viaFormula).toEqual(viaRole);
        });
    }

    it('is a discriminating comparison, not a tie of everything', () => {
        // Non-vacuity: if every build scored the same, the rank equality above would
        // hold no matter what the seeds said.
        const scores = builds.map((b) => calculateRoleScore('ATTACKER', b));
        expect(new Set(scores).size).toBe(builds.length);
    });

    it('catches a deliberately wrong seed', () => {
        // Mutation probe: prove the instrument can report the opposite.
        const wrong = { rows: [{ stat: 'speed', kind: 'core', direction: 'max' } as const] };
        const viaRole = rank((b) => calculateRoleScore('ATTACKER', b));
        const viaWrong = rank((b) => customFormulaScore(b, wrong));
        expect(viaWrong).not.toEqual(viaRole);
    });
});

describe('no seed puts a core row on a stat its role has none of', () => {
    // A maximized core term is 0 when the stat is 0, which zeroes the product and ties
    // every candidate. Fails if someone adds a seed, or edits ROLE_BASE_STATS, without
    // rechecking.
    for (const role of ALL_ROLES) {
        it(`${role}`, () => {
            const bare = getBaseRoleStats(role);
            for (const row of CUSTOM_FORMULA_SEEDS[role].rows) {
                if (row.kind !== 'core' || row.direction !== 'max') continue;
                expect(resolveLimitStatValue(bare, row.stat)).toBeGreaterThan(0);
            }
        });
    }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaSeeds.test.ts`

Expected: FAIL on `Failed to resolve import "../customFormulaSeeds"`.

- [ ] **Step 3: Implement the seeds**

Create `src/utils/autogear/customFormulaSeeds.ts`:

```ts
import type { CustomFormula, CustomFormulaRow } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';

const core = (
    stat: CustomFormulaRow['stat'],
    importance: CustomFormulaRow['importance'] = 1
): CustomFormulaRow => ({ stat, kind: 'core', direction: 'max', importance });

const bonus = (stat: CustomFormulaRow['stat'], percentage = 100): CustomFormulaRow => ({
    stat,
    kind: 'bonus',
    direction: 'max',
    percentage,
});

/**
 * A starting formula per role, with a plain-language note on how faithful it is.
 *
 * `fidelity` is shown to the user next to the seed choice. A role whose formula is not a
 * product of stats gets an approximation and says so — presenting an approximation as the
 * role's real scoring is worse than presenting no seed.
 *
 * A maximized core row on a stat that is 0 at base zeroes the whole product, so no seed
 * places one; `customFormulaSeeds.test.ts` asserts that against `getBaseRoleStats`.
 */
export const CUSTOM_FORMULA_SEEDS: Record<
    ShipTypeName,
    { rows: CustomFormulaRow[]; fidelity: string }
> = {
    ATTACKER: {
        rows: [core('directDamage')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEFENDER: {
        rows: [core('effectiveHp')],
        fidelity:
            'Approximation. The Defender formula models survival rounds against incoming damage, including healing and shield.',
    },
    DEFENDER_SECURITY: {
        rows: [core('effectiveHp'), core('security')],
        fidelity:
            'Approximation. The Defender formula it builds on models survival rounds against incoming damage.',
    },
    DEBUFFER: {
        rows: [core('hacking'), core('directDamage')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEBUFFER_DEFENSIVE: {
        rows: [core('hacking'), core('effectiveHp')],
        fidelity: 'Exact.',
    },
    DEBUFFER_DEFENSIVE_SECURITY: {
        rows: [core('hacking'), core('security'), bonus('effectiveHp')],
        fidelity:
            'Approximation. The real formula adds effective HP to a hacking-by-security product, which a product cannot express.',
    },
    DEBUFFER_BOMBER: {
        rows: [core('hacking'), core('attack')],
        fidelity: 'Exact, except with an Arcane Siege implant.',
    },
    DEBUFFER_CORROSION: {
        rows: [core('hacking')],
        fidelity: 'Approximation. The role also rewards a 3-piece Decimation set.',
    },
    SUPPORTER: {
        rows: [core('hp'), bonus('healModifier'), bonus('crit', 50), bonus('critDamage', 50)],
        fidelity:
            'Approximation. Heal modifier is a bonus, not a core stat, because it is 0 before gear.',
    },
    SUPPORTER_BUFFER: {
        rows: [core('speed'), bonus('effectiveHp', 50)],
        fidelity: 'Approximation. The role also rewards a 4-piece Boost set.',
    },
    SUPPORTER_OFFENSIVE: {
        rows: [core('speed'), bonus('attack', 50)],
        fidelity: 'Approximation. The role also rewards a 4-piece Boost set.',
    },
    SUPPORTER_SHIELD: {
        rows: [core('hp')],
        fidelity: 'Exact.',
    },
};

/** Roles whose seed ranks builds identically to the role formula itself. */
export const EXACT_SEED_ROLES: readonly ShipTypeName[] = [
    'ATTACKER',
    'DEBUFFER',
    'DEBUFFER_DEFENSIVE',
    'DEBUFFER_BOMBER',
    'SUPPORTER_SHIELD',
];

export function seedFormulaFromRole(role: ShipTypeName): CustomFormula {
    return {
        rows: CUSTOM_FORMULA_SEEDS[role].rows.map((r) => ({ ...r })),
        seededFrom: role,
    };
}
```

`seedFormulaFromRole` copies each row so an edit in the UI cannot mutate the shared table.

- [ ] **Step 4: Run and expect a partial pass**

Run: `npm test -- src/utils/autogear/__tests__/customFormulaSeeds.test.ts`

Expected: the coverage, zero-core and non-vacuity tests PASS. Some of the five `exact seeds` cases may FAIL — `calculateRoleScore` for `ATTACKER`, `DEBUFFER` and `DEBUFFER_BOMBER` passes no `arcaneSiegeMultiplier`, so those should match, but confirm each. If one fails, print both score lists before changing anything: the seed may be right and the fixture spread too narrow to distinguish, which is a fixture bug, not a seed bug.

- [ ] **Step 5: Fix whichever seeds do not rank identically**

For a failing exact role, compare the seed against the role function in `priorityScore.ts` — `calculateAttackerScore`, `calculateDebufferScore`, `calculateBomberDebufferScore`, `calculateDefensiveDebufferScore`, `calculateShieldSupporterScore` — and correct the seed rows. If a role genuinely cannot be made rank-identical, move it out of `EXACT_SEED_ROLES` and rewrite its `fidelity` string to say what diverges. Do not weaken the test to accommodate a seed.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`

Expected: PASS and no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/customFormulaSeeds.ts src/utils/autogear/__tests__/customFormulaSeeds.test.ts
git commit -m "$(cat <<'MSG'
feat(autogear): seed a custom formula from a built-in role

Five role formulas are products of stats and translate exactly; the rest are
approximations and each carries a note saying what diverges, because
presenting an approximation as the role's real scoring is worse than
presenting no seed.

Two tripwires: the exact seeds must rank a fixture spread identically to
calculateRoleScore, and no seed may put a maximized core row on a stat its
role has none of — a zero core term zeroes the product and ties every
candidate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 6: Make "no role" actually mean null

The Strategy selector's `defaultOption` is `"Manual"`, and `Select` fires `onChange('')` when it is picked. `RoleSelector` types that callback as `(role: ShipTypeName) => void`, so the empty string is passed as a `ShipTypeName` and `AutogearPage` writes `shipRole: ''` — not `null`, which is what `SavedAutogearConfig` declares and what every consumer checks for. It works today only because `''` is falsy.

**Files:**
- Modify: `src/components/ui/RoleSelector.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx`
- Test: `src/components/autogear/__tests__/customRoleSelection.test.tsx` (create)

**Interfaces:**
- Produces: `RoleSelectorProps.onChange: (role: ShipTypeName | '') => void`; `AutogearSettingsProps.onRoleSelect: (role: ShipTypeName | null) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/components/autogear/__tests__/customRoleSelection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleSelector } from '../../ui/RoleSelector';

describe('RoleSelector default option', () => {
    it('reports null-shaped emptiness when the Custom option is chosen', async () => {
        const onChange = vi.fn();
        render(
            <RoleSelector
                value="ATTACKER"
                onChange={onChange}
                noDefaultSelection
                defaultOption="Custom"
            />
        );
        await userEvent.click(screen.getByText('Attacker'));
        await userEvent.click(screen.getByText('Custom'));
        expect(onChange).toHaveBeenCalledWith('');
    });
});
```

- [ ] **Step 1b: Add the shared props fixture**

`AutogearSettingsProps` has over forty members, so every UI test from here on builds its props through one factory. Create `src/components/autogear/__tests__/autogearSettingsProps.tsx`:

```tsx
import { vi } from 'vitest';
import { AutogearAlgorithm } from '../../../utils/autogear/AutogearStrategy';
import type { Ship } from '../../../types/ship';
import type { BaseStats } from '../../../types/stats';
import type { ComponentProps } from 'react';
import type { AutogearSettings } from '../AutogearSettings';

type SettingsProps = ComponentProps<typeof AutogearSettings>;

export const testShip: Ship = {
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    baseStats: {
        hp: 22000,
        attack: 6250,
        defence: 5000,
        speed: 130,
        hacking: 0,
        security: 0,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    level: 60,
    rank: 6,
    equipment: {},
    refits: [],
    implants: {},
} as Ship;

export const testShipStats: BaseStats = { ...testShip.baseStats };

/**
 * Every required member of AutogearSettingsProps, callbacks as spies. Spread overrides
 * on top for the props a given test actually cares about.
 *
 * The `SettingsProps` return type is what makes this worth having: if AutogearSettings
 * gains a required prop, `tsc --noEmit` fails here once rather than in every test.
 */
export const makeSettingsProps = (overrides: Partial<SettingsProps> = {}): SettingsProps => ({
    selectedShip: testShip,
    selectedShipStats: testShipStats,
    selectedShipRole: null,
    selectedAlgorithm: AutogearAlgorithm.Genetic,
    priorities: [],
    ignoreEquipped: false,
    ignoreUnleveled: true,
    showSecondaryRequirements: false,
    setPriorities: [],
    statBonuses: [],
    useUpgradedStats: false,
    tryToCompleteSets: false,
    optimizeImplants: false,
    includeCalibratedGear: false,
    assumeCalibrated: false,
    fleetBuffs: [],
    customFormula: undefined,
    onShipSelect: vi.fn(),
    onRoleSelect: vi.fn(),
    onAlgorithmSelect: vi.fn(),
    onAddPriority: vi.fn(),
    onUpdatePriority: vi.fn(),
    onRemovePriority: vi.fn(),
    onFindOptimalGear: vi.fn(),
    onIgnoreEquippedChange: vi.fn(),
    onIgnoreUnleveledChange: vi.fn(),
    onToggleSecondaryRequirements: vi.fn(),
    onAddSetPriority: vi.fn(),
    onUpdateSetPriority: vi.fn(),
    onRemoveSetPriority: vi.fn(),
    onMoveSetPriority: vi.fn(),
    onAddStatBonus: vi.fn(),
    onUpdateStatBonus: vi.fn(),
    onRemoveStatBonus: vi.fn(),
    onMoveStatBonus: vi.fn(),
    onAddFleetBuff: vi.fn(),
    onUpdateFleetBuff: vi.fn(),
    onRemoveFleetBuff: vi.fn(),
    onMoveFleetBuff: vi.fn(),
    onUseUpgradedStatsChange: vi.fn(),
    onTryToCompleteSetsChange: vi.fn(),
    onOptimizeImplantsChange: vi.fn(),
    onIncludeCalibratedGearChange: vi.fn(),
    onAssumeCalibratedChange: vi.fn(),
    onResetConfig: vi.fn(),
    onAddFormulaRow: vi.fn(),
    onUpdateFormulaRow: vi.fn(),
    onRemoveFormulaRow: vi.fn(),
    onSeedFormula: vi.fn(),
    ...overrides,
});
```

`customFormula` and the four formula callbacks are already on `AutogearSettingsProps` from Task 1, so the annotated return type checks against the real interface.

The factory as written omits `onMovePriority`, which Task 9 deletes. Task 9 has not run yet, so add `onMovePriority: vi.fn(),` here and delete it in Task 9 — `tsc` will tell you which state you are in.

- [ ] **Step 1c: Write the page-mapping test**

`AutogearPage` is 1,880 lines; test the translation at the `AutogearSettings` boundary instead. Append to `src/components/autogear/__tests__/customRoleSelection.test.tsx`:

```tsx
import { render as renderWithProviders } from '../../../test-utils/test-utils';
import { AutogearSettings } from '../AutogearSettings';
import { makeSettingsProps } from './autogearSettingsProps';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));
vi.mock('../CommunityRecommendations', () => ({ CommunityRecommendations: () => null }));
vi.mock('../../ship/ShipSelector', () => ({ ShipSelector: () => null }));

describe('AutogearSettings role selection', () => {
    it('hands the page a null, not an empty string', async () => {
        // SavedAutogearConfig declares shipRole as ShipTypeName | null and every consumer
        // tests for null. Writing '' works only by being falsy.
        const onRoleSelect = vi.fn();
        renderWithProviders(
            <AutogearSettings
                {...makeSettingsProps({ selectedShipRole: 'ATTACKER', onRoleSelect })}
            />
        );
        await userEvent.click(screen.getByText('Attacker'));
        await userEvent.click(screen.getByText('Custom'));
        expect(onRoleSelect).toHaveBeenCalledWith(null);
    });
});
```

The spread needs no cast: Task 1 declared the formula props, so `makeSettingsProps` returns the component's real prop type.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/autogear/__tests__/customRoleSelection.test.tsx`

Expected: the first test passes (the current `Select` already fires `''`), the second fails with `onRoleSelect` called with `''`.

- [ ] **Step 3: Fix the RoleSelector type**

In `src/components/ui/RoleSelector.tsx`, change the prop type and stop laundering the empty string through `ShipTypeName`:

```ts
    onChange: (role: ShipTypeName | '') => void;
```

and the body:

```tsx
            onChange={(val) => onChange(val as ShipTypeName | '')}
```

- [ ] **Step 4: Fix the AutogearSettings prop and the call**

In `src/components/autogear/AutogearSettings.tsx`, change the prop type:

```ts
    onRoleSelect: (role: ShipTypeName | null) => void;
```

and the `RoleSelector` usage in the Strategy card, renaming the option at the same time:

```tsx
                        <RoleSelector
                            value={selectedShipRole || ''}
                            onChange={(role) => onRoleSelect(role === '' ? null : role)}
                            noDefaultSelection
                            defaultOption="Custom"
                        />
```

Apply the same prop-type change to `AutogearSettingsModal.tsx`, which forwards it.

- [ ] **Step 5: Fix the page handler**

In `src/pages/manager/AutogearPage.tsx`, the `onRoleSelect` handler around line 1552 already writes what it is handed; it just needs the widened type. Confirm both `AutogearSettings` and `AutogearSettingsModal` call sites compile, and that `getShipConfig`'s default (`shipRole: defaultRole`, around line 318) is untouched — a ship still defaults to its own role, and Custom stays an explicit opt-out.

- [ ] **Step 6: Run the test and the suite**

Run: `npm test -- src/components/autogear/__tests__/customRoleSelection.test.tsx` — expected: PASS.

Run: `npm test` — expected: PASS. Any test asserting the literal string `'Manual'` in the UI needs its expectation updated to `'Custom'`; find them with `grep -rn "'Manual'" src/`.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/components/ui/RoleSelector.tsx src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx src/components/autogear/__tests__/customRoleSelection.test.tsx
git commit -m "$(cat <<'MSG'
fix(autogear): store a roleless config as null, and call the mode Custom

RoleSelector typed its callback as ShipTypeName while Select fires '' for the
default option, so choosing it wrote shipRole: '' into a field declared
ShipTypeName | null. It worked only because '' is falsy.

The label moves from Manual to Custom: the old one described an absence, the
new one describes what the user now builds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 7: The formula row and its form

**Files:**
- Create: `src/components/autogear/CustomFormulaRow.tsx`
- Create: `src/components/autogear/CustomFormulaForm.tsx`
- Test: `src/components/autogear/__tests__/CustomFormulaForm.test.tsx`

**Interfaces:**
- Consumes: `CustomFormulaRow` (type) from Task 1, `resolveLimitStatValue` from `priorityScore.ts`, `getLimitStatLabel` from `src/constants/stats.ts`.
- Produces:
  - `CustomFormulaRowView` component — props `{ row, index, isEditing, shipStats, isLoneCoreRow, onEdit, onRemove }`
  - `CustomFormulaForm` component — props `{ onAdd, editingValue?, onSave?, onCancel? }`

The type and the component would otherwise collide on the name `CustomFormulaRow`, hence `CustomFormulaRowView` for the component.

- [ ] **Step 1: Write the failing form test**

Create `src/components/autogear/__tests__/CustomFormulaForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFormulaForm } from '../CustomFormulaForm';

describe('CustomFormulaForm', () => {
    it('adds a core maximized row with Normal importance by default', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'core',
            direction: 'max',
            importance: 1,
        });
    });

    it('omits importance and carries a percentage on a bonus row', async () => {
        const onAdd = vi.fn();
        render(<CustomFormulaForm onAdd={onAdd} />);
        await userEvent.click(screen.getByLabelText(/how it counts/i));
        await userEvent.click(screen.getByText(/added/i));
        await userEvent.click(screen.getByRole('button', { name: /add/i }));
        expect(onAdd).toHaveBeenCalledWith({
            stat: 'attack',
            kind: 'bonus',
            direction: 'max',
            percentage: 100,
        });
    });

    it('prefills from an edited row and saves it back', async () => {
        const onSave = vi.fn();
        render(
            <CustomFormulaForm
                onAdd={vi.fn()}
                onSave={onSave}
                editingValue={{
                    stat: 'speed',
                    kind: 'core',
                    direction: 'min',
                    importance: 2,
                }}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith({
            stat: 'speed',
            kind: 'core',
            direction: 'min',
            importance: 2,
        });
    });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/autogear/__tests__/CustomFormulaForm.test.tsx`

Expected: FAIL on `Failed to resolve import "../CustomFormulaForm"`.

- [ ] **Step 3: Implement the form**

Create `src/components/autogear/CustomFormulaForm.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { LimitableStat } from '../../types/stats';
import type {
    CoreImportance,
    CustomFormulaRow,
    FormulaDirection,
    FormulaRowKind,
} from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';

// Mirrors StatPriorityForm's AVAILABLE_STATS: the stats a player can actually gear for,
// plus the two derived composites.
const AVAILABLE_STATS: LimitableStat[] = [
    'attack',
    'defence',
    'hp',
    'effectiveHp',
    'directDamage',
    'speed',
    'crit',
    'critDamage',
    'hacking',
    'security',
    'healModifier',
    'shield',
];

const IMPORTANCE_OPTIONS: { value: string; label: string }[] = [
    { value: '0.5', label: 'Slight' },
    { value: '1', label: 'Normal' },
    { value: '2', label: 'Heavy' },
];

interface Props {
    onAdd: (row: CustomFormulaRow) => void;
    editingValue?: CustomFormulaRow;
    onSave?: (row: CustomFormulaRow) => void;
    onCancel?: () => void;
}

export const CustomFormulaForm: React.FC<Props> = ({ onAdd, editingValue, onSave, onCancel }) => {
    const [stat, setStat] = useState<LimitableStat>(AVAILABLE_STATS[0]);
    const [kind, setKind] = useState<FormulaRowKind>('core');
    const [direction, setDirection] = useState<FormulaDirection>('max');
    const [importance, setImportance] = useState<CoreImportance>(1);
    const [percentage, setPercentage] = useState<string>('100');

    useEffect(() => {
        if (editingValue) {
            setStat(editingValue.stat);
            setKind(editingValue.kind);
            setDirection(editingValue.direction);
            setImportance(editingValue.importance ?? 1);
            setPercentage(String(editingValue.percentage ?? 100));
        } else {
            setStat(AVAILABLE_STATS[0]);
            setKind('core');
            setDirection('max');
            setImportance(1);
            setPercentage('100');
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const row: CustomFormulaRow =
            kind === 'core'
                ? { stat, kind, direction, importance }
                : { stat, kind, direction, percentage: Number(percentage) || 100 };
        if (editingValue && onSave) {
            onSave(row);
            return;
        }
        onAdd(row);
        setStat(AVAILABLE_STATS[0]);
        setKind('core');
        setDirection('max');
        setImportance(1);
        setPercentage('100');
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3" role="form">
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    value={stat}
                    onChange={(value) => setStat(value as LimitableStat)}
                    options={AVAILABLE_STATS.map((s) => ({
                        value: s,
                        label: getLimitStatLabel(s),
                    }))}
                />
                <Select
                    label="Direction"
                    className="w-40"
                    value={direction}
                    onChange={(value) => setDirection(value as FormulaDirection)}
                    options={[
                        { value: 'max', label: 'As much as possible' },
                        { value: 'min', label: 'As little as possible' },
                    ]}
                />
            </div>
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="How it counts"
                    className="w-48"
                    value={kind}
                    onChange={(value) => setKind(value as FormulaRowKind)}
                    options={[
                        { value: 'core', label: 'Multiplied — must be good' },
                        { value: 'bonus', label: 'Added — nice to have' },
                    ]}
                    helpLabel="A multiplied stat has to be good on its own for the build to score well, so balanced builds win. An added stat tops the score up without being able to carry it."
                />
                {kind === 'core' ? (
                    <Select
                        label="Importance"
                        className="w-32"
                        value={String(importance)}
                        onChange={(value) => setImportance(Number(value) as CoreImportance)}
                        options={IMPORTANCE_OPTIONS}
                    />
                ) : (
                    <div className="w-32">
                        <Input
                            label="Weight %"
                            type="number"
                            value={percentage}
                            onChange={(e) => setPercentage(e.target.value)}
                            placeholder="100"
                        />
                    </div>
                )}
            </div>
            <div className="flex justify-end gap-2">
                {editingValue ? (
                    <>
                        <Button
                            aria-label="Cancel edit"
                            type="button"
                            variant="secondary"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                        <Button aria-label="Save formula stat" type="submit" variant="primary">
                            Save
                        </Button>
                    </>
                ) : (
                    <Button aria-label="Add formula stat" type="submit" variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
```

- [ ] **Step 4: Run the form test**

Run: `npm test -- src/components/autogear/__tests__/CustomFormulaForm.test.tsx`

Expected: PASS. If the `Select` interaction queries do not match the component's rendered structure, read `src/components/ui/Select.tsx` — it renders `role="option"` divs rather than a native `<select>` — and adjust the queries to match, not the component.

- [ ] **Step 5: Implement the row view**

Create `src/components/autogear/CustomFormulaRow.tsx`:

```tsx
import React from 'react';
import { Button, CloseIcon, EditIcon } from '../ui';
import type { CustomFormulaRow } from '../../types/autogear';
import type { BaseStats } from '../../types/stats';
import { getLimitStatLabel } from '../../constants';
import { resolveLimitStatValue } from '../../utils/autogear/priorityScore';

const IMPORTANCE_LABEL: Record<string, string> = {
    '0.5': 'Slight',
    '1': 'Normal',
    '2': 'Heavy',
};

interface Props {
    row: CustomFormulaRow;
    isEditing: boolean;
    /** Current build's stats, for the zero-stat note. Null when no ship is selected. */
    shipStats: BaseStats | null;
    /** True when this is the only core row and there are no bonus rows. */
    isLoneCoreRow: boolean;
    onEdit: () => void;
    onRemove: () => void;
}

export const CustomFormulaRowView: React.FC<Props> = ({
    row,
    isEditing,
    shipStats,
    isLoneCoreRow,
    onEdit,
    onRemove,
}) => {
    const value = shipStats ? resolveLimitStatValue(shipStats, row.stat) : null;
    // A maximized core row on a stat the build has none of scores every candidate 0, which
    // ties the whole search. The live score shows the symptom; this note gives the cause.
    const zeroesTheFormula = row.kind === 'core' && row.direction === 'max' && value === 0;

    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span className="text-xs uppercase tracking-wide text-theme-text-secondary w-16">
                {row.kind === 'core' ? 'Core' : 'Bonus'}
            </span>
            <span>
                {getLimitStatLabel(row.stat)}
                <span className="text-theme-text-secondary">
                    {row.direction === 'min' ? ' — as little as possible' : ''}
                </span>
                {row.kind === 'core' && !isLoneCoreRow && (
                    <span className="text-theme-text-secondary">
                        {' '}
                        · {IMPORTANCE_LABEL[String(row.importance ?? 1)]}
                    </span>
                )}
                {row.kind === 'bonus' && (
                    <span className="text-theme-text-secondary"> · {row.percentage ?? 100}%</span>
                )}
                {zeroesTheFormula && (
                    <span className="text-amber-400">
                        {' '}
                        — 0 on this ship, so the formula scores 0 until gear supplies it
                    </span>
                )}
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit formula stat"
                title="Edit formula stat"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
            >
                <EditIcon />
            </Button>
            <Button
                aria-label="Remove formula stat"
                variant="danger"
                size="sm"
                onClick={onRemove}
            >
                <CloseIcon />
            </Button>
        </div>
    );
};
```

No reorder arrows: a product and a sum are both commutative, so a formula's rows have no meaningful order.

- [ ] **Step 6: Run tests, lint and typecheck**

Run: `npm test -- src/components/autogear/__tests__/CustomFormulaForm.test.tsx`, then `npx tsc --noEmit`, then `npx eslint src/components/autogear/CustomFormulaForm.tsx src/components/autogear/CustomFormulaRow.tsx`

Expected: PASS, no type errors, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/autogear/CustomFormulaForm.tsx src/components/autogear/CustomFormulaRow.tsx src/components/autogear/__tests__/CustomFormulaForm.test.tsx
git commit -m "$(cat <<'MSG'
feat(autogear): add the custom-formula row and its form

A row carries a stat, a direction, and either a core importance preset or a
bonus weight. The row calls out a maximized core stat the ship has none of,
because that scores every candidate 0 and the live score alone shows only the
symptom.

Not wired into the settings panel yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 8: Unblock the settings panel and wire the page

The "Your tweaks" card renders under `{selectedShipRole && …}`, so Custom mode shows nothing at all. This is the task that makes the feature reachable.

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx`
- Test: `src/components/autogear/__tests__/customModePanel.test.tsx` (create)

**Interfaces:**
- Consumes: `CustomFormulaRowView`, `CustomFormulaForm` (Task 7); `seedFormulaFromRole`, `CUSTOM_FORMULA_SEEDS` (Task 5); `customFormulaScore`, `isFormulaEmpty` (Task 1); the widened `onRoleSelect` and `makeSettingsProps` (Task 6). `SHIP_TYPES` is already imported in `AutogearSettings.tsx`; add imports for `CUSTOM_FORMULA_SEEDS`, `seedFormulaFromRole` (in `AutogearPage.tsx`), `customFormulaScore`, `isFormulaEmpty`, and the two Task 7 components.
- Produces: new `AutogearSettingsProps` members — `customFormula: CustomFormula | undefined`, `onAddFormulaRow(row)`, `onUpdateFormulaRow(index, row)`, `onRemoveFormulaRow(index)`, `onSeedFormula(role)`. `TweakView`'s form union gains `'formulaRow'`.

- [ ] **Step 1: Write the failing panel test**

Create `src/components/autogear/__tests__/customModePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../../test-utils/test-utils';
import userEvent from '@testing-library/user-event';
import { AutogearSettings } from '../AutogearSettings';
import { makeSettingsProps } from './autogearSettingsProps';
import type { CustomFormula } from '../../../types/autogear';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));
vi.mock('../CommunityRecommendations', () => ({ CommunityRecommendations: () => null }));
vi.mock('../../ship/ShipSelector', () => ({ ShipSelector: () => null }));

const renderPanel = (overrides: Parameters<typeof makeSettingsProps>[0] = {}) =>
    render(<AutogearSettings {...makeSettingsProps(overrides)} />);

const attackFormula: CustomFormula = {
    rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
};

describe('Custom mode panel', () => {
    it('shows the tweaks card with no role selected', () => {
        // The card was gated on `selectedShipRole &&`, so Custom mode rendered nothing.
        renderPanel({ selectedShipRole: null });
        expect(screen.getByText(/your tweaks/i)).toBeInTheDocument();
    });

    it('offers a seed role while the formula is empty', () => {
        renderPanel({ selectedShipRole: null, customFormula: undefined });
        expect(screen.getByText(/start from/i)).toBeInTheDocument();
    });

    it('drops the seed picker once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.queryByText(/start from/i)).not.toBeInTheDocument();
    });

    it('hides Scale from the picker and offers a formula stat instead', async () => {
        renderPanel({ selectedShipRole: null });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/formula stat/i)).toBeInTheDocument();
        expect(screen.queryByText(/^Scale$/)).not.toBeInTheDocument();
    });

    it('keeps Scale in the picker when a role is selected', async () => {
        // Non-vacuity for the test above: the entry must exist somewhere, or "hidden in
        // Custom" would pass against a picker that never had a Scale entry at all.
        renderPanel({ selectedShipRole: 'ATTACKER' });
        await userEvent.click(screen.getByRole('button', { name: /add tweak/i }));
        expect(screen.getByText(/^Scale$/)).toBeInTheDocument();
        expect(screen.queryByText(/formula stat/i)).not.toBeInTheDocument();
    });

    it('shows a relative score for the equipped build', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByText(/scores .* \(relative\)/i)).toBeInTheDocument();
    });

    it('lists persisted Scale rows as unused rather than dropping them silently', () => {
        renderPanel({
            selectedShipRole: null,
            customFormula: attackFormula,
            statBonuses: [{ stat: 'defence', percentage: 80, mode: 'additive' }],
        });
        expect(screen.getByText(/not used in custom/i)).toBeInTheDocument();
    });
});

describe('Custom mode blocks a run it cannot score', () => {
    it('disables the run and states why when the formula is empty', () => {
        // A persisted config that carries only Limits lands here. Today that scores every
        // candidate 0, ties them all, and returns arbitrary gear as a result.
        renderPanel({
            selectedShipRole: null,
            customFormula: undefined,
            priorities: [{ stat: 'speed', minLimit: 120, weight: 1 }],
        });
        expect(screen.getByRole('button', { name: /find gear/i })).toBeDisabled();
        expect(screen.getByText(/add at least one stat/i)).toBeInTheDocument();
    });

    it('enables the run once the formula has a row', () => {
        renderPanel({ selectedShipRole: null, customFormula: attackFormula });
        expect(screen.getByRole('button', { name: /find gear/i })).not.toBeDisabled();
    });

    it('loads a config that predates the formula field', () => {
        // customFormula is optional; a persisted SavedAutogearConfig reads back undefined.
        expect(() => renderPanel({ selectedShipRole: 'ATTACKER', customFormula: undefined })).not.toThrow();
    });
});
```

Match the `Find gear` button's real accessible name — read it in `AutogearSettings.tsx` and adjust the query if it differs.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/autogear/__tests__/customModePanel.test.tsx`

Expected: all three FAIL — the card is gated off, so nothing renders.

- [ ] **Step 3: Open the gate and add the formula section**

In `src/components/autogear/AutogearSettings.tsx`:

Widen the `TweakView` form union to include the new type:

```ts
    | {
          mode: 'form';
          type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff' | 'formulaRow';
          editIndex: number | null;
      }
```

The five formula props are already declared on `AutogearSettingsProps` from Task 1 — destructure them in the component body now (`customFormula`, `onAddFormulaRow`, `onUpdateFormulaRow`, `onRemoveFormulaRow`, `onSeedFormula`), and replace the placeholder values `AutogearPage.tsx` passes with the real handlers in Step 7.

Derive the mode near the other derived values, above the `return`:

```tsx
    const isCustom = !!selectedShip && !selectedShipRole;
    const formulaRows = customFormula?.rows ?? [];
    const coreRowCount = formulaRows.filter((r) => r.kind === 'core').length;
    const bonusRowCount = formulaRows.length - coreRowCount;
    const currentFormulaScore =
        isCustom && selectedShipStats && !isFormulaEmpty(customFormula)
            ? customFormulaScore(selectedShipStats, customFormula)
            : null;
```

Change the card gate from `{selectedShipRole && (` to:

```tsx
            {(selectedShipRole || isCustom) && (
```

In the Strategy card, below the `RoleSelector`, add the seed picker for an empty custom formula:

```tsx
                {isCustom && isFormulaEmpty(customFormula) && (
                    <div className="space-y-2">
                        <RoleSelector
                            label="Start from"
                            value=""
                            onChange={(role) => role !== '' && onSeedFormula(role)}
                            noDefaultSelection
                            defaultOption="Pick a role to copy"
                        />
                        <p className="text-xs text-theme-text-secondary">
                            Copies that role&apos;s scoring into editable stats. Some roles score
                            on more than stats alone, so their copy is an approximation.
                        </p>
                    </div>
                )}
```

In the tweaks list, above the Stat priorities block, add the formula section:

```tsx
                            {isCustom && (
                                <div className="space-y-1">
                                    <div className="flex justify-between items-baseline">
                                        <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                            Custom formula
                                        </h4>
                                        {currentFormulaScore !== null && (
                                            <span className="text-xs text-theme-text-secondary">
                                                Equipped build scores{' '}
                                                {currentFormulaScore.toFixed(2)} (relative)
                                            </span>
                                        )}
                                    </div>
                                    {formulaRows.length === 0 ? (
                                        <p className="text-sm text-theme-text-secondary py-2">
                                            No stats yet. Autogear has nothing to optimise for
                                            until you add one.
                                        </p>
                                    ) : (
                                        formulaRows.map((row, index) => (
                                            <CustomFormulaRowView
                                                key={`formula-${index}`}
                                                row={row}
                                                isEditing={isEditingFormulaRow(index)}
                                                shipStats={selectedShipStats}
                                                isLoneCoreRow={
                                                    coreRowCount === 1 && bonusRowCount === 0
                                                }
                                                onEdit={() => openForm('formulaRow', index)}
                                                onRemove={() => onRemoveFormulaRow(index)}
                                            />
                                        ))
                                    )}
                                    {customFormula?.seededFrom && (
                                        <p className="text-xs text-theme-text-secondary">
                                            Copied from {SHIP_TYPES[customFormula.seededFrom].name}.{' '}
                                            {CUSTOM_FORMULA_SEEDS[customFormula.seededFrom].fidelity}
                                        </p>
                                    )}
                                </div>
                            )}
```

Add the `isEditingFormulaRow` predicate beside the existing ones:

```tsx
    const isEditingFormulaRow = (index: number) =>
        tweakView.mode === 'form' &&
        tweakView.type === 'formulaRow' &&
        tweakView.editIndex === index;
```

Include the formula rows in the tweak count expression (it currently sums `priorities.length + setPriorities.length + statBonuses.length + fleetBuffs.length + excludedImplantTypes.length` in two places — the header and the empty check): add `+ formulaRows.length` to both.

- [ ] **Step 4: Add the picker entry and hide Scale**

In the picker's option list, add a "Formula stat" entry shown only in Custom mode, following the existing raw-`<button>` idiom the other picker entries use (a full-width selection target, which the UI rules permit):

```tsx
                                {isCustom && (
                                    <button
                                        type="button"
                                        className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
                                        onClick={() => openForm('formulaRow')}
                                    >
                                        <div className="font-semibold">Formula stat</div>
                                        <div className="text-xs text-theme-text-secondary">
                                            Add a stat to your custom role&apos;s scoring (e.g.
                                            Attack, as much as possible).
                                        </div>
                                    </button>
                                )}
```

Wrap the existing "Scale (advanced)" picker button in `{!isCustom && (` … `)}`. A custom formula's bonus rows do the same job on a comparable scale, and an additive Scale row adds a raw `statValue × percentage/100` — order 5600 against a formula base of order 1.

- [ ] **Step 5: Render the form and the inactive-Scale notice**

In the form view, alongside the existing `tweakView.type === 'priority'` block:

```tsx
                            {tweakView.type === 'formulaRow' && (
                                <CustomFormulaForm
                                    onAdd={(row) => {
                                        onAddFormulaRow(row);
                                        backToList();
                                    }}
                                    editingValue={
                                        tweakView.editIndex !== null
                                            ? formulaRows[tweakView.editIndex]
                                            : undefined
                                    }
                                    onSave={(row) => {
                                        if (
                                            tweakView.mode === 'form' &&
                                            tweakView.editIndex !== null
                                        ) {
                                            onUpdateFormulaRow(tweakView.editIndex, row);
                                            backToList();
                                        }
                                    }}
                                    onCancel={backToList}
                                />
                            )}
```

Add `'formulaRow'` to the form-title expression so the breadcrumb reads "Add formula stat".

Where the existing Scale rows are listed, when `isCustom` is true render them under a heading that says they are inert, keeping the remove button live:

```tsx
                                    {isCustom && statBonuses.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs uppercase tracking-wide text-amber-400">
                                                Scale — not used in Custom
                                            </h4>
                                            {statBonuses.map((bonus, index) => (
                                                <StatBonusRow
                                                    key={`inactive-bonus-${index}`}
                                                    bonus={bonus}
                                                    isEditing={false}
                                                    canMoveUp={false}
                                                    canMoveDown={false}
                                                    onUpdate={() => undefined}
                                                    onEdit={() => undefined}
                                                    onMoveUp={() => undefined}
                                                    onMoveDown={() => undefined}
                                                    onRemove={() => onRemoveStatBonus(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
```

and wrap the normal Scale listing in `{!isCustom && …}`. Check `StatBonusRow`'s actual prop list before writing this — pass what it declares, and if a prop it needs is missing here, read `src/components/autogear/StatBonusRow.tsx` and supply it.

- [ ] **Step 6: Block a run on an empty formula**

Find the "Find gear" / "Find Optimal Gear" `Button` in `AutogearSettings.tsx` and add to its `disabled` expression:

```tsx
disabled={... || (isCustom && isFormulaEmpty(customFormula))}
```

and render the reason beneath it:

```tsx
                    {isCustom && isFormulaEmpty(customFormula) && (
                        <p className="text-xs text-amber-400">
                            Add at least one stat to your custom formula — without one, every gear
                            combination scores the same.
                        </p>
                    )}
```

- [ ] **Step 7: Wire the page**

In `src/pages/manager/AutogearPage.tsx`, add `customFormula: undefined` to `getShipConfig`'s default object, and pass the new props at both the `AutogearSettings` and `AutogearSettingsModal` call sites:

```tsx
                    customFormula={
                        shipSettings ? getShipConfig(shipSettings.id).customFormula : undefined
                    }
                    onAddFormulaRow={(row) => {
                        if (!shipSettings) return;
                        const config = getShipConfig(shipSettings.id);
                        const rows = config.customFormula?.rows ?? [];
                        const existing = rows.findIndex(
                            (r) => r.stat === row.stat && r.kind === row.kind
                        );
                        const next =
                            existing >= 0
                                ? rows.map((r, i) => (i === existing ? row : r))
                                : [...rows, row];
                        updateShipConfig(shipSettings.id, {
                            customFormula: { ...config.customFormula, rows: next },
                        });
                    }}
                    onUpdateFormulaRow={(index, row) => {
                        if (!shipSettings) return;
                        const config = getShipConfig(shipSettings.id);
                        const rows = config.customFormula?.rows ?? [];
                        updateShipConfig(shipSettings.id, {
                            customFormula: {
                                ...config.customFormula,
                                rows: rows.map((r, i) => (i === index ? row : r)),
                            },
                        });
                    }}
                    onRemoveFormulaRow={(index) => {
                        if (!shipSettings) return;
                        const config = getShipConfig(shipSettings.id);
                        const rows = config.customFormula?.rows ?? [];
                        updateShipConfig(shipSettings.id, {
                            customFormula: {
                                ...config.customFormula,
                                rows: rows.filter((_, i) => i !== index),
                            },
                        });
                    }}
                    onSeedFormula={(role) => {
                        if (!shipSettings) return;
                        updateShipConfig(shipSettings.id, {
                            customFormula: seedFormulaFromRole(role),
                        });
                    }}
```

Rows dedupe on `stat` + `kind`, matching how `onAddPriority` dedupes stat priorities.

Pass the formula into the strategy at the `strategy.findOptimalGear(` call (around line 761), as the twelfth argument after `shipConfig.fleetBuffs`:

```tsx
                    shipConfig.fleetBuffs,
                    shipConfig.customFormula
```

Extend the existing reset handler (`onResetConfig`) so that in Custom mode it re-seeds from `customFormula.seededFrom` when set and clears the formula otherwise. Also change the reset `Button`'s `aria-label` and `title` in `AutogearSettings.tsx` from "Reset to role defaults" to "Reset formula" when `isCustom`.

- [ ] **Step 8: Run the panel test, the full suite, typecheck and lint**

Run in order:
- `npm test -- src/components/autogear/__tests__/customModePanel.test.tsx` — expected: PASS
- `npm test` — expected: PASS
- `npx tsc --noEmit` — expected: no errors
- `npx eslint src/components/autogear src/pages/manager/AutogearPage.tsx` — expected: no errors

- [ ] **Step 9: Verify in the running app**

Run `npm start` (port 3000). Open the Autogear page, pick a ship, set Strategy to Custom, seed from Attacker, and confirm: the tweaks card appears, the seeded rows render, the relative score shows a number, editing a row moves it, and "Find gear" is disabled with its reason when you delete every row.

- [ ] **Step 10: Add the changelog entries and commit**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` — one entry per user-visible change, 8-12 words each:

```ts
    'Autogear: build a custom role from stats, each with a direction.',
    'Autogear: copy a built-in role into an editable custom formula.',
    'Autogear: stat priorities no longer reorder — position never affected scoring.',
```

```bash
git add src/components/autogear src/pages/manager/AutogearPage.tsx src/constants/changelog.ts
git commit -m "$(cat <<'MSG'
feat(autogear): make Custom mode configurable and scored

The tweaks card rendered under `selectedShipRole &&`, so choosing Manual left
nothing on screen to configure. Custom mode now carries its own formula
section, a seed picker, and a relative score for the equipped build so an
edit has visible effect.

Scale is hidden in Custom and any persisted Scale rows are listed as unused
with a remove button, rather than being dropped in silence.

An empty formula blocks the run: every combination would score the same.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 9: Remove the controls and claims that now lie

**Files:**
- Modify: `src/components/autogear/StatPriorityRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx`
- Modify: `src/components/autogear/SharedBuildFields.tsx`
- Modify: `src/components/autogear/AutogearConfigList.tsx`
- Modify: `src/components/autogear/AutogearQuickSettings.tsx`
- Modify: `src/hooks/useCommunityRecommendations.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/autogear/__tests__/customModePanel.test.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { AutogearConfigList } from '../AutogearConfigList';

type ConfigListProps = ComponentProps<typeof AutogearConfigList>;

// Read AutogearConfigListProps at the top of AutogearConfigList.tsx and fill in every
// required member here. The annotation makes tsc name anything missing.
const configListProps = (overrides: Partial<ConfigListProps>): ConfigListProps => ({
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ...overrides,
});

describe('stat priorities carry no reorder control', () => {
    const two = [
        { stat: 'speed' as const, minLimit: 120, weight: 1 },
        { stat: 'crit' as const, minLimit: 60, weight: 1 },
    ];

    it('renders neither arrow, in role mode', () => {
        // calculateDefaultScore was the only code that read priority order; the arrows
        // reordered a list nothing reads.
        renderPanel({ selectedShipRole: 'ATTACKER', priorities: two });
        expect(screen.queryByLabelText(/move priority up/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/move priority down/i)).not.toBeInTheDocument();
    });

    it('still renders the rows themselves', () => {
        // Non-vacuity: an absent arrow proves nothing if the rows never rendered.
        renderPanel({ selectedShipRole: 'ATTACKER', priorities: two });
        expect(screen.getByLabelText(/remove priority/i)).toBeInTheDocument();
    });
});

describe('AutogearConfigList labels a roleless config', () => {
    it('reads Custom rather than rendering nothing', () => {
        render(<AutogearConfigList {...configListProps({ shipRole: null })} />);
        expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    it('reads the role name when there is one', () => {
        // Non-vacuity: proves the row renders a role at all, so the Custom assertion
        // above is about the null case and not about an element that never appears.
        render(<AutogearConfigList {...configListProps({ shipRole: 'ATTACKER' })} />);
        expect(screen.getByText('Attacker')).toBeInTheDocument();
    });
});
```

`configListProps` is annotated, so `tsc --noEmit` names any required prop the four defaults above are missing. Add what it names — the four are a starting point, not the full list.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/autogear/__tests__/customModePanel.test.tsx`

Expected: both new tests FAIL.

- [ ] **Step 3: Remove the reorder arrows**

In `src/components/autogear/StatPriorityRow.tsx`: delete the `canMoveUp`/`canMoveDown`/`onMoveUp`/`onMoveDown` props from `StatPriorityRowProps`, delete the `<div className="flex flex-col">` block holding the two chevron `Button`s, and drop the now-unused `ChevronUpIcon` / `ChevronDownIcon` imports.

Then remove `onMovePriority` from `AutogearSettingsProps`, from the `StatPriorityRow` usage in `AutogearSettings.tsx`, from `AutogearSettingsModal.tsx`'s forwarded props, and its handler in `AutogearPage.tsx`.

Priority order is inert: `calculateDefaultScore` was the only code that read it, and `priorityScore.test.ts`'s `stat-priority order is inert` block asserts as much for both modes.

Leave `onMoveSetPriority`, `onMoveStatBonus` and `onMoveFleetBuff` alone — they are not covered by that argument and are out of scope.

- [ ] **Step 4: Fix SharedBuildFields**

In `src/components/autogear/SharedBuildFields.tsx`:
- `SHIP_TYPES[config.shipRole]` is indexed with a possibly-null role. Guard it: `const roleInfo = config.shipRole ? SHIP_TYPES[config.shipRole] : undefined;` and render `{roleInfo?.name ?? 'Custom'}`.
- Delete the comment above the stat-priorities block ("a priority's strength is its position, not a number on the row (`StatPriority.weight` is always 1)"). Both halves are false — the `weight` half as of this work, the position half already, because a shared build always carries a role and a role's base score never called the default scorer.
- Change the `<ol className="list-decimal list-inside space-y-1">` to `<ul className="list-disc list-inside space-y-1">` and its `</ol>` to `</ul>`.

- [ ] **Step 5: Show Custom in the config list and quick settings**

In `src/components/autogear/AutogearConfigList.tsx`, the role line renders under `{shipRole && (`. Render `Custom` when it is null instead:

```tsx
            <span className="">
                {shipRole ? SHIP_TYPES[shipRole]?.name || shipRole : 'Custom'}
            </span>
```

adjusting the surrounding conditional so the row always renders. Do the same for whatever role label `AutogearQuickSettings.tsx` shows for a null role — read it and apply the same `'Custom'` fallback.

- [ ] **Step 6: Stop the Share control offering an impossible share**

In `src/hooks/useCommunityRecommendations.ts` line 51, `canShare` is `!!selectedShip && !!currentBuild`. A build with no role cannot be shared — `communityBuild.ts` returns `null` and the community schema types `shipRole` as a non-null `ShipTypeName`. Add the role to the hook's inputs if it is not already present and extend the condition:

```ts
    const canShare = !!selectedShip && !!currentBuild && !!shipRole;
```

Then in `src/components/autogear/CommunityRecommendations.tsx`, where the `canShare` branch renders (around line 132), add a reason for the false case in Custom mode rather than an unexplained absence:

```tsx
                            ) : selectedShip && !shipRole ? (
                                <p className="text-sm text-theme-text-secondary">
                                    Custom builds can&apos;t be shared to the community yet — they
                                    carry a formula the library has no field for.
                                </p>
                            ) : (
```

Thread `shipRole` into the component if it is not already a prop.

- [ ] **Step 7: Run everything**

Run `npm test`, then `npx tsc --noEmit`, then `npx eslint src/components/autogear src/hooks/useCommunityRecommendations.ts`

Expected: PASS, no type errors, no lint errors. Tests asserting the reorder buttons exist will fail — delete those cases; the behaviour is intentionally gone.

- [ ] **Step 8: Commit**

```bash
git add src/components/autogear src/pages/manager/AutogearPage.tsx src/hooks/useCommunityRecommendations.ts
git commit -m "$(cat <<'MSG'
refactor(autogear): drop the reorder arrows and the claims that outlived them

calculateDefaultScore was the only code that read the order of
statPriorities; every other consumer sums an order-independent penalty. The
arrows reordered a list nothing reads.

SharedBuildFields' ordered list and its comment go with them. A roleless
config now reads Custom instead of blank, and the Share control says why a
custom build cannot be shared instead of quietly vanishing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 10: In-app documentation

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Find the autogear section**

Run: `grep -n "Autogear\|autogear\|Role\b" src/pages/DocumentationPage.tsx | head -40`

Read the surrounding structure and match its component and heading conventions exactly.

- [ ] **Step 2: Write the Custom role documentation**

Add a subsection to the autogear documentation covering, in the page's existing voice:

- What Custom mode is: a role you compose from stats, chosen instead of a built-in role.
- **Core vs Bonus.** A core stat has to be good on its own for the build to score well, so balanced builds win; a bonus stat tops the score up but cannot carry it. Two core stats mean "both must be good".
- **Direction.** As much as possible, or as little as possible. Minimizing is a preference, not a floor — use a Limits tweak for "never below 120".
- **Importance.** Slight, Normal, Heavy, on core stats only. With a single core stat and no bonus stats it has no effect, and the control is disabled to say so.
- **Seeding.** Copy a built-in role to start. Some roles score on more than stats alone (the Defender models survival rounds; the Buffer rewards a Boost set), so their copy is an approximation and the panel says which.
- **A core stat your ship has none of scores zero.** Heal modifier before gear is the common case. Put such a stat in a bonus row.
- **Scale is unavailable in Custom mode.** Bonus stats do the same job on a scale that is easier to reason about.
- **Custom builds cannot be shared** to the community library.

- [ ] **Step 3: Verify the page renders**

Run: `npm test -- src/pages/__tests__` and `npx tsc --noEmit`

Expected: PASS, no type errors. Then `npm start` and read the Documentation page's autogear section in the browser to confirm the new subsection renders and reads correctly.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "$(cat <<'MSG'
docs(autogear): document Custom roles in the in-app documentation

Covers core versus bonus stats, direction, importance, seeding from a role
and which seeds are approximations, and the zero-core-stat case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
MSG
)"
```

---

### Task 11: Final verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Full test suite**

Run: `npm test`

Expected: PASS with no failures and no skipped autogear suites. The golden audit spans the whole run — a partial run can hide a break. If a golden fixture moved, read the diff and explain it; **never** run `vitest -u`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors. `scripts/` is not covered by `tsc --noEmit` or lint, but nothing in this plan touches it.

- [ ] **Step 3: Lint**

Run: `npm run lint`

Expected: no errors. `react/no-danger` is set to error; nothing here renders HTML.

- [ ] **Step 4: Dependency audit**

Run: `npm run audit`

Expected: pass. Use `npm run audit`, **not** `npm audit` — the latter reports a misleading `400 Invalid package tree` against the registry.

- [ ] **Step 5: Confirm the vacuity guards actually guard**

For each of the four tripwires, break the code, watch the test fail, then restore. A probe that cannot report the opposite is not a measurement.

1. **Strategy threading:** in `GeneticStrategy.ts`, stop forwarding `customFormula` to `buildFastScoringContext`. Expected: the `genetic` case of `every registered strategy forwards the custom formula` fails. Restore.
2. **Seed fidelity:** change `ATTACKER`'s seed in `customFormulaSeeds.ts` to `core('hp')`. Expected: `exact seeds rank identically to their role formula > ATTACKER` fails. Restore.
3. **Zero core seed:** change `SUPPORTER`'s `bonus('healModifier')` to `core('healModifier')`. Expected: `no seed puts a core row on a stat its role has none of > SUPPORTER` fails. Restore.
4. **Cache key:** remove `formulaKey` from the cache key in `scoring.ts`. Expected: `gives two different formulas two different scores without an intervening clear` fails. Restore.

If any of the four does **not** fail when broken, the test is vacuous. Fix the test before proceeding — a green suite that cannot detect the defect it was written for is worse than no suite.

- [ ] **Step 6: Manual walkthrough**

Run `npm start`, then on the Autogear page:

1. Pick a ship. Strategy shows the ship's role, not Custom.
2. Set Strategy to Custom. The tweaks card stays visible and offers "Start from".
3. Seed from Debuffer (Defensive). Two core rows appear, labelled Exact.
4. Run "Find gear". A result comes back and the suggested pieces favour hacking and survivability.
5. Add a bonus Speed row at 40%. Re-run. The result shifts toward speed without abandoning the core stats.
6. Change the Speed row to "as little as possible". Re-run. The result now prefers lower speed.
7. Delete every row. "Find gear" is disabled and states why.
8. Seed from Supporter. Heal Modifier appears as a bonus row, not core.
9. Add a core Heal Modifier row by hand on a ship with none. The row carries its zero note and the relative score reads 0.00.
10. Set Strategy back to Attacker. The formula section disappears, Scale reappears in the picker, and the role's own scoring is in force.

- [ ] **Step 7: Review the whole diff against the spec**

Run: `git diff main...HEAD --stat` then read the full diff.

Check every spec section has a corresponding change, and that no comment in the diff carries change history, a task number, a count of call sites, a rule restated at several call sites, or a warning where a test belongs.

- [ ] **Step 8: Push and open a pull request**

```bash
git push -u origin feat/autogear-custom-roles
```

Then open the PR with a body that states the problem (Manual mode was configurable-nowhere and scored lexicographically), the formula's shape, the four tripwires, and the two behaviour removals (reorder arrows, Scale in Custom). End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013GZmZYFw2PuuHTLofyaXEq
```

CodeRabbit being green is not evidence of review — read the description column and confirm through the reviews API before treating the gate as earned.
