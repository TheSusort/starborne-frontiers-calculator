# SP-1: Real Full-Walk Enemy in the DPS Calculator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DPS calculator's scalar dummy opponent with a real, positioned, full-walk enemy ship that acts, takes damage, and can be killed — so reaction kits fire and the enemy's real defences apply.

**Architecture:** Thread `enemyAttackers` (with `shipSkills` and a board `position`) and a focus `position` through `simulateDPS` into `runCombat`, mirroring `healingEngineAdapter`. Positions make the run positional, which routes the focus's damage to the real enemy per-victim — and which also suppresses the engine's `creditDamage('direct')` fold, so `cumulativeDamage` must be re-derived in `dpsSimulator` from `RoundData.perTargetDealt`.

**Tech Stack:** TypeScript, React, Vitest + React Testing Library, TailwindCSS.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md`. Read it before Task 1.
- **`docs/` is gitignored** — commit plan/spec edits with `git add -f`.
- **Never run `vitest -u`.** Goldens move deliberately, one audited justification per moved golden.
- **`npm run lint` is a separate hard gate.** Neither `npm test` nor the husky pre-commit hook runs it. Run it before every commit (`max-warnings 0`).
- **The engine is NOT deterministic by default** (`rateAccumulator.ts` uses `Math.random`). Every engine-touching test pins RNG via `setupKeyedTestRng` / `resetRateGateRng` + `mulberry32`. The rate gate keys on `ownerId`.
- **Never assert digit-parity against a pre-change DPS number.** Adding an actor changes the count and order of RNG draws, so every later draw shifts. Assert against `perTargetDealt` instead.
- **Column 4 is the FRONT** of the board (`reference_sim_test_harness_traps`). Placement slots are `'T1'`–`'B4'` (`src/types/encounters.ts:1`).
- **UI rule:** use `src/components/ui/` primitives (`Select`, `Input`, `Button`, `card` class). Never raw `<button>` or hand-rolled containers.
- **Changelog:** add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before the final commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/calculators/dpsSimulator.ts` | Accept `enemyAttackers` + `position`; forward to `runCombat`; re-derive the damage metric from `perTargetDealt` |
| `src/utils/calculators/dpsEnemyPlacement.ts` *(new)* | The single source of truth for default slots. Pure, no imports beyond types |
| `src/utils/calculators/dpsMetricFromDealt.ts` *(new)* | Pure re-derivation of per-round + cumulative focus damage from `perTargetDealt` |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Enemy state becomes a config object; thread positions |
| `src/components/calculator/EnemyConfigCard.tsx` *(new)* | Enemy ship-select, stats, `SkillSlotList` |
| `src/components/calculator/ShipConfigCard.tsx` | Attacker slot `Select` |

---

### Task 1: Default placement constants

**Files:**
- Create: `src/utils/calculators/dpsEnemyPlacement.ts`
- Test: `src/utils/calculators/__tests__/dpsEnemyPlacement.test.ts`

**Interfaces:**
- Consumes: `Position` from `src/types/encounters`.
- Produces: `DEFAULT_ATTACKER_SLOT: Position`, `DEFAULT_ENEMY_SLOT: Position`, `ATTACKER_SLOT_OPTIONS: readonly Position[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    ATTACKER_SLOT_OPTIONS,
} from '../dpsEnemyPlacement';

describe('dpsEnemyPlacement', () => {
    it('defaults both sides to the front column (column 4)', () => {
        // Column 4 is the FRONT of the board. A back-column default would silently
        // change targeting semantics for any pattern-bearing kit.
        expect(DEFAULT_ATTACKER_SLOT).toBe('M4');
        expect(DEFAULT_ENEMY_SLOT).toBe('M4');
    });

    it('offers every one of the 12 slots as an attacker option', () => {
        expect(ATTACKER_SLOT_OPTIONS).toHaveLength(12);
        expect(ATTACKER_SLOT_OPTIONS).toContain(DEFAULT_ATTACKER_SLOT);
        expect(new Set(ATTACKER_SLOT_OPTIONS).size).toBe(12);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsEnemyPlacement.test.ts`
Expected: FAIL — "Failed to resolve import ... dpsEnemyPlacement".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Position } from '../../types/encounters';

/** Column 4 is the FRONT of the board. Both sides default to the middle-front slot so a
 *  1v1 DPS run has no adjacency and patterns collapse to single-target — the closest
 *  positional equivalent of the scalar opponent this replaces. */
export const DEFAULT_ATTACKER_SLOT: Position = 'M4';
export const DEFAULT_ENEMY_SLOT: Position = 'M4';

export const ATTACKER_SLOT_OPTIONS: readonly Position[] = [
    'T1', 'T2', 'T3', 'T4',
    'M1', 'M2', 'M3', 'M4',
    'B1', 'B2', 'B3', 'B4',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsEnemyPlacement.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/calculators/dpsEnemyPlacement.ts src/utils/calculators/__tests__/dpsEnemyPlacement.test.ts
git commit -m "feat(dps): default board slots for the real DPS enemy"
```

---

### Task 2: Thread `enemyAttackers` and positions into `simulateDPS`

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts` (the `DPSSimulationInput` interface at `:25`, and the `runCombat({…})` call at `:329`)
- Test: `src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_ATTACKER_SLOT` / `DEFAULT_ENEMY_SLOT` (Task 1).
- Produces: `DPSSimulationInput.enemyAttackers?: NonNullable<CombatEngineInput['enemyAttackers']>` and `DPSSimulationInput.position?: Position`. Later tasks pass these from the page.

**Context the implementer needs:**
- `runCombat`'s enemy shape is `CombatEngineInput['enemyAttackers']` (`engine.ts:1212`) — reuse that type, do NOT define a parallel one. It already carries `position`, `shipSkills`, `chargeCount`, `startCharged`, `stats`.
- `dpsEnemyTarget = enemyAttackerInputs.length === 0` (`engine.ts:2294`) flips false automatically once you pass a non-empty array. You do not set it.
- The focus attacker's own slot is `CombatEngineInput.position` (`engine.ts:1288`).
- Wiring template: the `runCombat({…})` call in `healingEngineAdapter.ts:222-258`, which passes `enemyAttackers: engineEnemyAttackers`.
- The focus actor id is the literal `'attacker'` (`engine.ts:1781`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';

// A real enemy with no kit still acts — EnemyAttackerInput's contract is
// "full kit walk; absent -> one synthesized basic attack per turn".
const realEnemy = () => [
    {
        id: 'enemy-1',
        stats: { attack: 5000, crit: 0, critDamage: 150, speed: 40, defence: 1000, hp: 400000 },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

const baseInput = () => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [
                    {
                        id: 'a1',
                        type: 'damage' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: { type: 'damage' as const, multiplier: 100 },
                    },
                ],
            },
        ],
    },
});

describe('DPS calculator with a real positioned enemy', () => {
    beforeEach(() => {
        // `src/setupTests.ts` already seeds globally; re-seed explicitly so this file is
        // deterministic in isolation too. The rate gate keys on ownerId.
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('routes the focus attacker damage to the REAL enemy, not the dummy', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        // perTargetDealt is attackerId -> victimId -> dealt. The focus actor is 'attacker'.
        // Before positions were threaded, selectTurnTarget fell back to the dummy and this
        // key was absent entirely.
        const dealtToRealEnemy = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        expect(dealtToRealEnemy).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts`
Expected: FAIL — TypeScript rejects `position` / `enemyAttackers` as unknown properties of `DPSSimulationInput`.

- [ ] **Step 3: Add the two input fields**

In `src/utils/calculators/dpsSimulator.ts`, add the import and the fields to `DPSSimulationInput`:

```ts
import type { CombatEngineInput } from '../combat/engine';
import type { Position } from '../../types/encounters';
```

```ts
    /** Real, positioned enemy ships. Non-empty flips the engine's `dpsEnemyTarget` false, so
     *  the focus's damage lands per-victim on these actors instead of the vestigial dummy.
     *  Reuses the engine's own shape — do not define a parallel type. */
    enemyAttackers?: NonNullable<CombatEngineInput['enemyAttackers']>;
    /** Board slot of the focus attacker. Required for `isPositional` to resolve a real target:
     *  it needs BOTH this and an opposing actor's position, else `selectTurnTarget` falls back
     *  to the dummy. */
    position?: Position;
```

- [ ] **Step 4: Forward both to `runCombat`**

In the `runCombat({…})` call (`dpsSimulator.ts:329`), add two properties alongside `bus: input.bus`:

```ts
        enemyAttackers: input.enemyAttackers,
        position: input.position,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite — no goldens should move yet**

Run: `npm test`
Expected: all pass. Both new fields are optional and every existing caller omits them, so this task is behaviour-preserving. **If any golden moves here, stop and investigate — it means something reads the fields unconditionally.**

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts
git commit -m "feat(dps): thread positioned enemyAttackers into simulateDPS"
```

---

### Task 3: Re-derive the damage metric from `perTargetDealt`

**Files:**
- Create: `src/utils/calculators/dpsMetricFromDealt.ts`
- Test: `src/utils/calculators/__tests__/dpsMetricFromDealt.test.ts`

**Interfaces:**
- Consumes: `RoundData` from `src/utils/calculators/dpsSimulator`.
- Produces: `focusDamagePerRound(rounds: RoundData[], focusId: string): number[]` and `focusDamageTotal(rounds: RoundData[], focusId: string): number`.

**Why this exists (do not skip the reasoning):** `cumulativeDamage += totalRoundDamage` (`engine.ts:9702`) is ungated, but `totalRoundDamage` is built from the focus's channel accumulators, and `creditDamage(actor.id, 'direct', turn.directDamage)` sits inside `if (!positional)` (`engine.ts:8430`) — in positional mode the firing hit lands per-victim instead, so crediting it again would double-count. Task 2 makes the run positional, so `rawTotals.cumulative` now reads ~0. `perTargetDealt` is the authoritative per-attacker×victim map SP-F F1 built for exactly this; `battleSimulator` already derives `ShipRoundState.damageDealt` from it the same way.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { focusDamagePerRound, focusDamageTotal } from '../dpsMetricFromDealt';
import type { RoundData } from '../dpsSimulator';

const row = (round: number, dealt?: Record<string, Record<string, number>>): RoundData =>
    ({ round, perTargetDealt: dealt } as unknown as RoundData);

describe('dpsMetricFromDealt', () => {
    it('sums every victim this attacker hit in a round', () => {
        const rounds = [row(1, { attacker: { 'enemy-1': 100, 'enemy-2': 50 } })];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([150]);
    });

    it('ignores damage dealt by other attackers', () => {
        const rounds = [row(1, { attacker: { 'enemy-1': 100 }, ally: { 'enemy-1': 999 } })];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([100]);
    });

    it('treats a round with no entry as zero rather than dropping the round', () => {
        const rounds = [row(1, { attacker: { 'enemy-1': 100 } }), row(2), row(3, {})];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([100, 0, 0]);
    });

    it('totals across rounds', () => {
        const rounds = [
            row(1, { attacker: { 'enemy-1': 100 } }),
            row(2, { attacker: { 'enemy-1': 250 } }),
        ];
        expect(focusDamageTotal(rounds, 'attacker')).toBe(350);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsMetricFromDealt.test.ts`
Expected: FAIL — "Failed to resolve import ... dpsMetricFromDealt".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RoundData } from './dpsSimulator';

/** Per-round damage DEALT by one attacker, summed over every victim it hit that round.
 *  Reads `RoundData.perTargetDealt` (attackerId -> victimId -> amount), the same map
 *  `battleSimulator` derives `ShipRoundState.damageDealt` from. A round with no entry
 *  contributes 0 and KEEPS its slot, so the result is index-aligned with `rounds`. */
export function focusDamagePerRound(rounds: RoundData[], focusId: string): number[] {
    return rounds.map((r) =>
        Object.values(r.perTargetDealt?.[focusId] ?? {}).reduce((sum, n) => sum + n, 0)
    );
}

export function focusDamageTotal(rounds: RoundData[], focusId: string): number {
    return focusDamagePerRound(rounds, focusId).reduce((sum, n) => sum + n, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsMetricFromDealt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/calculators/dpsMetricFromDealt.ts src/utils/calculators/__tests__/dpsMetricFromDealt.test.ts
git commit -m "feat(dps): pure per-attacker damage derivation from perTargetDealt"
```

---

### Task 4: Wire the re-derived metric into `simulateDPS`

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts` (the return assembly around `:366-394`)
- Test: `src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts` (extend Task 2's file)

**Interfaces:**
- Consumes: `focusDamagePerRound` / `focusDamageTotal` (Task 3); `enemyAttackers` input (Task 2).
- Produces: when `enemyAttackers` is non-empty, `result.summary.totalDamage` and each row's `totalRoundDamage` / `cumulativeDamage` come from `perTargetDealt`. When it is empty, the existing scalar path is untouched.

- [ ] **Step 1: Write the failing test (append to the Task 2 file)**

```ts
    it('reports a damage total that reconciles with perTargetDealt', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        const expected = result.rounds.reduce(
            (sum, r) =>
                sum +
                Object.values(r.perTargetDealt?.['attacker'] ?? {}).reduce((s, n) => s + n, 0),
            0
        );

        // NOT asserted against any pre-change number: adding an actor shifts every RNG draw.
        expect(expected).toBeGreaterThan(0);
        expect(result.summary.totalDamage).toBe(Math.round(expected));
    });

    it('keeps the scalar path intact when no real enemy is supplied', () => {
        const result = simulateDPS(baseInput());
        expect(result.summary.totalDamage).toBeGreaterThan(0);
    });
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts`
Expected: the reconciliation test FAILS — `summary.totalDamage` is ~0 because positional mode suppressed the direct credit, while `expected` is > 0. This failure IS the bug this task fixes; confirm you see that shape before implementing.

- [ ] **Step 3: Implement the conditional re-derivation**

In `dpsSimulator.ts`, import the helpers:

```ts
import { focusDamagePerRound, focusDamageTotal } from './dpsMetricFromDealt';
```

Replace `const totalDamage = Math.round(rawTotals.cumulative);` (`:366`) with:

```ts
    // Positional runs (a real enemy is present) suppress the engine's
    // creditDamage(actor,'direct') fold — engine.ts:8430, "lands per-victim via
    // applyPositionalDamage ... would double-count it" — so rawTotals.cumulative reads ~0.
    // Re-derive from perTargetDealt, the same map battleSimulator derives damageDealt from.
    const hasRealEnemy = (input.enemyAttackers?.length ?? 0) > 0;
    const perRoundFocusDamage = hasRealEnemy ? focusDamagePerRound(rounds, 'attacker') : null;
    const totalDamage = hasRealEnemy
        ? Math.round(focusDamageTotal(rounds, 'attacker'))
        : Math.round(rawTotals.cumulative);
```

Then, immediately before the `return {`, overwrite the affected row fields so the charts agree with the summary:

```ts
    // Keep per-round rows consistent with the re-derived total (the charts read these).
    if (perRoundFocusDamage) {
        let running = 0;
        rounds.forEach((r, i) => {
            r.totalRoundDamage = perRoundFocusDamage[i];
            running += perRoundFocusDamage[i];
            r.cumulativeDamage = running;
        });
    }
```

Finally, change the `avgDamagePerRound` line (`:377`) to divide the re-derived total:

```ts
            avgDamagePerRound: Math.round(totalDamage / rounds.length),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass. Every existing caller omits `enemyAttackers`, so `hasRealEnemy` is false and the scalar path runs unchanged. **A moved golden here means the guard leaked — investigate, do not re-pin.**

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsRealEnemy.integration.test.ts
git commit -m "fix(dps): re-derive the damage metric from perTargetDealt in positional runs"
```

---

### Task 5: Prove the enemy acts, reaction kits fire, and both sides can die

**Files:**
- Test: `src/utils/calculators/__tests__/dpsRealEnemyReactions.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-4. Adds no production code — this task exists to lock the behavioural payoff, and to catch a silent regression to dummy-targeting.

**Why a separate task:** Tasks 2-4 prove the *plumbing*. This proves the *point*: an enemy that hits back, and an `on-attacked` kit that could never fire in DPS mode before.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { CombatEvent } from '../../combat/events';

describe('a real DPS enemy acts', () => {
    beforeEach(() => {
        // `src/setupTests.ts` already seeds globally; re-seed explicitly so this file is
        // deterministic in isolation too. The rate gate keys on ownerId.
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('attacks the focus, emitting `attacked` events against it', () => {
        const events: CombatEvent[] = [];
        simulateDPS({
            attack: 20000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 10000,
            enemyHp: 500000,
            rounds: 4,
            selfBuffs: [],
            enemyDebuffs: [],
            speed: 100,
            hp: 300000,
            position: DEFAULT_ATTACKER_SLOT,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'a1',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                ],
            },
            enemyAttackers: [
                {
                    id: 'enemy-1',
                    stats: {
                        attack: 8000,
                        crit: 0,
                        critDamage: 150,
                        speed: 40,
                        defence: 1000,
                        hp: 400000,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: DEFAULT_ENEMY_SLOT,
                },
            ],
            bus: { on: () => {}, emit: (e: CombatEvent) => void events.push(e) },
        });

        const hitsOnFocus = events.filter(
            (e) => e.type === 'attacked' && e.targetId === 'attacker'
        );
        expect(hitsOnFocus.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemyReactions.integration.test.ts`
Expected: PASS. If it fails with zero `attacked` events on `'attacker'`, the enemy is not taking turns — re-check that both `position` fields reached `runCombat`, since `isPositional` needs both.

- [ ] **Step 3: Add the reaction-kit test (the actual payoff)**

Append to the same file. This is the assertion that proves the fidelity gain — an `on-attacked`
rider cannot fire at all in today's DPS calculator, because nothing ever hits the focus.

```ts
    it('fires an on-attacked rider that could never fire against a dummy', () => {
        const events: CombatEvent[] = [];
        simulateDPS({
            ...(/* reuse the input from the test above */ {} as never),
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'a1',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'p1',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-attacked',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up III',
                                    parsedEffects: { attack: 30 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 2,
                                },
                            },
                        ],
                    },
                ],
            },
            bus: { on: () => {}, emit: (e: CombatEvent) => void events.push(e) },
        });

        const granted = events.filter(
            (e) => e.type === 'buff-applied' && e.actorId === 'attacker'
        );
        expect(granted.length).toBeGreaterThan(0);
    });
```

Factor the shared input into a local `const input = () => ({…})` helper rather than the
placeholder spread shown above — the spread is illustrative, not literal.

- [ ] **Step 4: Run it**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemyReactions.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the death-path tests**

Both directions matter: the enemy is now killable (which is what `roundsToKill` reports), and the
focus is now mortal (which it never was against a dummy).

```ts
    it('kills a low-HP enemy and reports roundsToKill', () => {
        const result = simulateDPS({
            ...input(),
            rounds: 10,
            enemyAttackers: [
                {
                    id: 'enemy-1',
                    stats: { attack: 1, crit: 0, critDamage: 150, speed: 1, defence: 0, hp: 1000 },
                    chargeCount: 0,
                    startCharged: false,
                    position: DEFAULT_ENEMY_SLOT,
                },
            ],
        });
        expect(result.summary.roundsToKill).toBeGreaterThan(0);
        expect(result.rounds.length).toBeLessThan(10); // run terminated early on the kill
    });

    it('ends the run when the focus attacker dies', () => {
        const result = simulateDPS({
            ...input(),
            hp: 100,
            rounds: 10,
            enemyAttackers: [
                {
                    id: 'enemy-1',
                    stats: {
                        attack: 500000,
                        crit: 0,
                        critDamage: 150,
                        speed: 9999, // acts first
                        defence: 0,
                        hp: 10_000_000,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: DEFAULT_ENEMY_SLOT,
                },
            ],
        });
        expect(result.rounds.length).toBeLessThan(10);
    });
```

If `roundsToKill` is not on `DPSSimulationResult['summary']` under that name, check the field SP-U
added and use the real one — do not add a new field.

- [ ] **Step 6: Run the file**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsRealEnemyReactions.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/utils/calculators/__tests__/dpsRealEnemyReactions.integration.test.ts
git commit -m "test(dps): lock enemy actions, on-attacked riders, and both death paths"
```

---

### Task 6: Enemy config card

**Files:**
- Create: `src/components/calculator/EnemyConfigCard.tsx`
- Test: `src/components/calculator/__tests__/EnemyConfigCard.test.tsx`

**Interfaces:**
- Consumes: `ShipSkills` (`src/types/abilities`), `buildShipAbilitiesWithEquipment`, `buildDefaultShipSkills`, `SkillSlotList`.
- Produces: `EnemyShipConfig` (exported from `src/types/calculator.ts`) and the `EnemyConfigCard` component. Task 7 renders it.

**Pattern to copy:** `src/components/calculator/HealerConfigCard.tsx` — specifically its ship-select handler and its `SkillSlotList` usage at `:217`.

**Type to add** in `src/types/calculator.ts`, beside `DefenseShipConfig`:

```ts
/** The DPS calculator's real, positioned opponent. Replaces the loose enemy scalars.
 *  `shipSkills` empty-slotted = a skill-less ship, which still acts (the engine
 *  synthesizes one basic attack per turn). */
export interface EnemyShipConfig {
    shipId?: string;
    name: string;
    hp: number;
    defense: number;
    security: number;
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    shipSkills: ShipSkills;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnemyConfigCard } from '../EnemyConfigCard';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import type { EnemyShipConfig } from '../../../types/calculator';

const config = (): EnemyShipConfig => ({
    name: 'Enemy',
    hp: 500000,
    defense: 10000,
    security: 100,
    attack: 8000,
    crit: 0,
    critDamage: 150,
    speed: 40,
    shipSkills: buildDefaultShipSkills(),
});

describe('EnemyConfigCard', () => {
    it('reports an edited stat through onUpdate', () => {
        const onUpdate = vi.fn();
        render(<EnemyConfigCard config={config()} onUpdate={onUpdate} onSelectShip={vi.fn()} />);
        fireEvent.change(screen.getByLabelText(/attack/i), { target: { value: '9000' } });
        expect(onUpdate).toHaveBeenCalledWith('attack', 9000);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/components/calculator/__tests__/EnemyConfigCard.test.tsx`
Expected: FAIL — "Failed to resolve import ... EnemyConfigCard".

- [ ] **Step 3: Implement the card**

`EnemyShipConfig` needs `import { ShipSkills } from './abilities';` in `src/types/calculator.ts` if
it is not already imported there.

```tsx
import React from 'react';
import { EnemyShipConfig } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { Ship } from '../../types/ship';
import { Input } from '../ui/Input';
import { SkillSlotList } from '../skills/SkillSlotList';

interface Props {
    config: EnemyShipConfig;
    onUpdate: (field: keyof EnemyShipConfig, value: number) => void;
    onSelectShip: (ship: Ship) => void;
    onShipSkillsChange?: (shipSkills: ShipSkills) => void;
}

const STAT_FIELDS: Array<{ field: keyof EnemyShipConfig; label: string }> = [
    { field: 'hp', label: 'HP' },
    { field: 'defense', label: 'Defense' },
    { field: 'security', label: 'Security' },
    { field: 'attack', label: 'Attack' },
    { field: 'crit', label: 'Crit' },
    { field: 'critDamage', label: 'Crit Damage' },
    { field: 'speed', label: 'Speed' },
];

export const EnemyConfigCard: React.FC<Props> = ({ config, onUpdate, onShipSkillsChange }) => (
    <div className="card">
        <div className="grid grid-cols-2 gap-2">
            {STAT_FIELDS.map(({ field, label }) => (
                <Input
                    key={field}
                    type="number"
                    label={label}
                    value={String(config[field] ?? 0)}
                    onChange={(e) => onUpdate(field, Number(e.target.value))}
                />
            ))}
        </div>
        {onShipSkillsChange && (
            <SkillSlotList
                shipSkills={config.shipSkills}
                hasPassive
                onChange={onShipSkillsChange}
            />
        )}
    </div>
);
```

Check `Input`'s and `SkillSlotList`'s real prop signatures before writing this — copy them from
`HealerConfigCard.tsx:217` rather than trusting the sketch above. Numeric inputs must report a
`number`, not the raw string. The ship-select control follows `HealerConfigCard`'s pattern; wire
`onSelectShip` to it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/components/calculator/__tests__/EnemyConfigCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/components/calculator/EnemyConfigCard.tsx src/components/calculator/__tests__/EnemyConfigCard.test.tsx src/types/calculator.ts
git commit -m "feat(dps): enemy ship config card with kit editor"
```

---

### Task 7: Page cutover — enemy config, attacker slot, wiring

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx` (enemy state at `:107-127`; the `simulateDPS({…})` call at `:243`)
- Modify: `src/components/calculator/ShipConfigCard.tsx` (add the slot `Select`)
- Test: `src/pages/calculators/__tests__/DPSCalculatorPage.realEnemy.test.tsx`

**Interfaces:**
- Consumes: `EnemyShipConfig` + `EnemyConfigCard` (Task 6); `DEFAULT_*_SLOT` / `ATTACKER_SLOT_OPTIONS` (Task 1); the `enemyAttackers` / `position` inputs (Task 2).
- Produces: the page always passes a non-empty `enemyAttackers`, so the DPS calculator never exercises the dummy path in production again.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DPSCalculatorPage } from '../DPSCalculatorPage';

vi.mock('../../../utils/calculators/dpsSimulator', async (orig) => {
    const actual = await orig<typeof import('../../../utils/calculators/dpsSimulator')>();
    return { ...actual, simulateDPS: vi.fn(actual.simulateDPS) };
});

describe('DPSCalculatorPage supplies a real enemy', () => {
    it('always passes a non-empty enemyAttackers with a position', async () => {
        const { simulateDPS } = await import('../../../utils/calculators/dpsSimulator');
        render(<DPSCalculatorPage />);
        await screen.findByText(/dps/i);

        const call = (simulateDPS as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
        const input = call?.[0] as { enemyAttackers?: unknown[]; position?: string };
        expect(input.enemyAttackers?.length).toBeGreaterThan(0);
        expect(input.position).toBeDefined();
    });
});
```

Wrap `<DPSCalculatorPage />` in whatever provider stack the sibling page tests in `src/pages/calculators/__tests__/` already use — copy that harness rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/pages/calculators/__tests__/DPSCalculatorPage.realEnemy.test.tsx`
Expected: FAIL — `enemyAttackers` is `undefined`.

- [ ] **Step 3: Replace the enemy scalars with one config object**

Collapse the `enemyDefense` / `enemyHp` / `enemySecurity` / `enemySpeed` states into:

```tsx
const [enemyConfig, setEnemyConfig] = useState<EnemyShipConfig>({
    name: 'Enemy',
    hp: 500000,
    defense: 10000,
    security: 100,
    attack: 8000,
    crit: 0,
    critDamage: 150,
    speed: 50,
    shipSkills: buildDefaultShipSkills(),
});
```

Keep `enemyType`, `enemyAffinity` and `enemyBuffs` as they are — they are not part of this config.

- [ ] **Step 4: Add the attacker slot to each config**

Add `slot: Position` to `DPSShipConfig` (in `src/types/calculator.ts`), defaulted to `DEFAULT_ATTACKER_SLOT` wherever a config is created. In `ShipConfigCard.tsx`, render a `Select` labelled "Board slot" over `ATTACKER_SLOT_OPTIONS`, reporting through the existing `onUpdate` prop.

- [ ] **Step 4b: Add a slot to each TEAM ship too**

Team ships are configurable-slot as well. Three edits:

1. `src/types/calculator.ts` — add to `TeamActorInput` (`:329`):

```ts
    /** Board slot of this team actor. Threaded to the engine's teamActors[].position, which
     *  already exists (engine.ts:1098) and drives positional target selection + footprint apply. */
    position?: Position;
```

2. `deriveTeamEngineActors` (in `src/utils/calculators/dpsSimulator.ts`) — forward `position` onto
   the engine actor bundle it builds. It is currently dropped; without this the `Select` is inert.

3. `src/components/calculator/TeamShipRow.tsx` — render the same "Board slot" `Select` over
   `ATTACKER_SLOT_OPTIONS`, next to the existing `SkillSlotList` at `:281`.

**Slot-collision rule:** two player-side ships must not share a slot. Default each new team ship to
the first slot not already taken by the attacker configs or other team ships, and if the user picks
a taken slot, swap the two occupants rather than rejecting the choice. Add a unit test for the swap.

- [ ] **Step 5: Pass both to `simulateDPS`**

In the `simulateDPS({…})` call, replace the scalar enemy args and add:

```tsx
    enemyDefense: enemyConfig.defense,
    enemyHp: enemyConfig.hp,
    enemySecurity: enemyConfig.security,
    enemySpeed: enemyConfig.speed,
    position: config.slot,
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: enemyConfig.attack,
                crit: enemyConfig.crit,
                critDamage: enemyConfig.critDamage,
                speed: enemyConfig.speed,
                defence: enemyConfig.defense,
                hp: enemyConfig.hp,
                security: enemyConfig.security,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: enemyConfig.shipSkills,
            position: DEFAULT_ENEMY_SLOT,
        },
    ],
```

- [ ] **Step 6: Render `EnemyConfigCard`**

Replace the enemy-settings panel's stat inputs with `<EnemyConfigCard …/>`, keeping the existing `CollapsibleForm` wrapper and the enemy-type / affinity / buff controls around it.

- [ ] **Step 7: Run the page test**

Run: `npx vitest --run src/pages/calculators/__tests__/DPSCalculatorPage.realEnemy.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the full suite and AUDIT the moved goldens**

Run: `npm test`

Expected: **DPS-related goldens move.** This is the deliberate change. For each one:
1. Confirm the move is explained by "the enemy now acts" (the attacker takes damage; reaction kits fire; the run may end early on a death).
2. Record a one-line justification per moved golden for the PR body.
3. **Any move you cannot explain that way is a defect — investigate it, do not re-pin.**
4. **Never `vitest -u`.** Update each expectation deliberately.

- [ ] **Step 9: Lint and commit**

```bash
npm run lint
git add src/pages/calculators/DPSCalculatorPage.tsx src/components/calculator/ShipConfigCard.tsx src/components/calculator/TeamShipRow.tsx src/utils/calculators/dpsSimulator.ts src/types/calculator.ts src/pages/calculators/__tests__/DPSCalculatorPage.realEnemy.test.tsx
git commit -m "feat(dps): real full-walk enemy and configurable attacker/team slots"
```

---

### Task 8: Documentation and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Update the in-app docs**

In `DocumentationPage.tsx`, update the DPS calculator section: the opponent is now a real ship with its own stats and skills that takes turns and fights back, and each attacker config sits in a board slot.

- [ ] **Step 2: Add the changelog entry**

Append to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:

```ts
'The DPS calculator now fights a real enemy ship that has its own skills and attacks back, instead of a passive damage dummy. Ships whose kits react to being hit — counters, reflects, and on-hit triggers — now show their real damage. You can also choose which board slot your ship fights from.',
```

Plain English, no emojis.

- [ ] **Step 3: Verify and commit**

```bash
npm test
npm run lint
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs(dps): document the real full-walk enemy"
```

---

## Definition of done

- The DPS calculator always runs against a real, positioned, acting enemy; the dummy path is never exercised from the page.
- `summary.totalDamage` reconciles with `Σ perTargetDealt['attacker']` across rounds.
- An `on-attacked` kit demonstrably fires in the DPS calculator.
- Every moved golden carries a one-line justification; none was updated with `vitest -u`.
- `npm test` and `npm run lint` both clean.
- SP-2 (the buff timeline) can now read the enemy's debuffs from `status-snapshot` with **no** engine change, because a positioned enemy keys its own debuffs under its own actor id.
