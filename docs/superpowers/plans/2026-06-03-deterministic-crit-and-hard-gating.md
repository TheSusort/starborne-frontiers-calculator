# Deterministic Crit Schedule + Hard Condition Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DPS sim's expected-value crit with a deterministic per-round binary crit schedule, hard-gate all payload ability conditions (currently silently ignored), derive enemy HP% from damage dealt, remove all `Math.random()` from the sim, and emit/edit abilities in skill-text order.

**Architecture:** A tiny `makeRateGate` fractional-accumulator factory powers four deterministic event gates inside `runSinglePass` (active-crit, charged-crit, debuff-landing, extend-chance). A new `gateFiringAbilities` filter in `applyAbilities.ts` walks the firing skill's abilities in array order against the round's condition context (with a same-cast DoT overlay) before the existing extractors run. `ConditionContext` gains binary `roundCrit` and derived `enemyHpPct`. Parser emits abilities sorted by text position; the editor gets up/down reorder buttons.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-deterministic-crit-and-hard-gating-design.md` — read it first; it contains the decision log and the two-tier self-crit semantics (modifiers keep the probability estimate; everything downstream sees binary `roundCrit`).

**Branch:** work directly on `feat/skill-ability-editor` (same as prior phases).

**Conventions you must follow:**
- TDD per task: failing test → implement → pass → commit. @superpowers:test-driven-development
- Sim test convention: `crit: 100, critDamage: 0` → crit multiplier 1; `enemyDefense: 0` for exact-number assertions. Reuse the existing helpers in `src/utils/calculators/__tests__/dpsSimulator.test.ts` (`baseInput`, `chargedRounds`, the `skillsWith*` builders) — read the top of that file before writing sim tests.
- The pre-commit hook runs the FULL test suite — every commit is a full-suite checkpoint.
- `npm test` runs vitest; single file: `npx vitest --run src/path/to/file.test.ts`.

**File structure (what's created/modified):**

| File | Role |
|---|---|
| Create `src/utils/calculators/rateAccumulator.ts` | `makeRateGate` factory |
| Create `src/utils/calculators/__tests__/rateAccumulator.test.ts` | its tests |
| Modify `src/utils/abilities/evaluateConditions.ts` | `roundCrit` in `ConditionContext` + binary self-crit |
| Modify `src/utils/abilities/roundContext.ts` | accept `roundCrit` + `enemyHpPct` |
| Modify `src/utils/abilities/applyAbilities.ts` | add `gateFiringAbilities` |
| Modify `src/utils/calculators/dpsSimulator.ts` | gates, roundCrit, gating wire-up, `didCrit`, zero RNG |
| Modify `src/utils/abilities/buildShipAbilities.ts` | text-order emission |
| Modify `src/components/skills/SkillEditorModal.tsx` + `AbilityCard.tsx` | reorder buttons |
| Modify `src/components/calculator/DPSRoundChart.tsx` | crit badge |
| Modify `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`, `docs/skill-model-coverage.md` | docs |

---

## Task 1: `makeRateGate` accumulator

**Files:**
- Create: `src/utils/calculators/rateAccumulator.ts`
- Create: `src/utils/calculators/__tests__/rateAccumulator.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/calculators/__tests__/rateAccumulator.test.ts
import { describe, it, expect } from 'vitest';
import { makeRateGate } from '../rateAccumulator';

const fires = (rate: number, calls: number): boolean[] => {
    const gate = makeRateGate();
    return Array.from({ length: calls }, () => gate(rate));
};

describe('makeRateGate', () => {
    it('rate 1 fires on every call', () => {
        expect(fires(1, 5)).toEqual([true, true, true, true, true]);
    });

    it('rate 0 never fires', () => {
        expect(fires(0, 5)).toEqual([false, false, false, false, false]);
    });

    it('rate 0.999 still fires every call (EPS sanity)', () => {
        expect(fires(0.999, 5).every(Boolean)).toBe(true);
    });

    it('rate 0.7 over 10 calls fires exactly 7 times, max gap 2', () => {
        const result = fires(0.7, 10);
        expect(result.filter(Boolean)).toHaveLength(7);
        // No stretch of 2+ consecutive misses at 70%
        for (let i = 0; i < result.length - 1; i++) {
            expect(result[i] || result[i + 1]).toBe(true);
        }
    });

    it('rate 0.5 alternates starting on the second call', () => {
        expect(fires(0.5, 6)).toEqual([false, true, false, true, false, true]);
    });

    it('rate 0.1 over 10 calls fires exactly once (float drift)', () => {
        expect(fires(0.1, 10).filter(Boolean)).toHaveLength(1);
    });

    it('clamps rates outside [0, 1]', () => {
        expect(fires(1.5, 3)).toEqual([true, true, true]);
        expect(fires(-0.5, 3)).toEqual([false, false, false]);
    });

    it('handles a varying rate per call', () => {
        const gate = makeRateGate();
        expect(gate(0.5)).toBe(false); // acc 0.5
        expect(gate(0.6)).toBe(true); // acc 1.1 → fire, 0.1
        expect(gate(0.5)).toBe(false); // acc 0.6
        expect(gate(0.5)).toBe(true); // acc 1.1 → fire
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/calculators/__tests__/rateAccumulator.test.ts`
Expected: FAIL — `makeRateGate` not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/calculators/rateAccumulator.ts
/**
 * Deterministic stand-in for a probabilistic event: a fractional accumulator that
 * fires at exactly the supplied rate, evenly spaced (a 70% rate over 10 calls fires
 * 7 times, never with a gap longer than ceil(1/rate)).
 *
 * The rate is supplied per call so callers whose probability changes between events
 * (e.g. crit rate shifting with buffs round-to-round) accumulate correctly. Rates are
 * clamped to [0, 1]. EPS absorbs float drift so e.g. ten 0.1 steps fire exactly once.
 *
 * Used by the DPS simulator for crit scheduling, debuff landing, and chance-based
 * DoT extension — replacing Math.random() so identical inputs give identical output.
 */
const EPS = 1e-9;

export function makeRateGate(): (rate: number) => boolean {
    let acc = 0;
    return (rate: number): boolean => {
        acc += Math.min(1, Math.max(0, rate));
        if (acc >= 1 - EPS) {
            acc -= 1;
            return true;
        }
        return false;
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/utils/calculators/__tests__/rateAccumulator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/rateAccumulator.ts src/utils/calculators/__tests__/rateAccumulator.test.ts
git commit -m "feat: deterministic rate-gate accumulator for sim event scheduling"
```

---

## Task 2: Condition plumbing — binary `roundCrit` + derived `enemyHpPct`

**Files:**
- Modify: `src/utils/abilities/evaluateConditions.ts` (ConditionContext, `self-crit` branch)
- Modify: `src/utils/abilities/roundContext.ts` (new optional inputs)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts`, `src/utils/abilities/__tests__/roundContext.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `evaluateConditions.test.ts` (reuse the file's existing `ctx` fixture pattern):

```ts
describe('binary roundCrit', () => {
    it('self-crit returns 1 when roundCrit is true, 0 when false', () => {
        const cond = { subject: 'self-crit' as const, derivable: true };
        expect(evaluateCondition(cond, { ...baseCtx, effectiveCritRate: 70, roundCrit: true })).toBe(1);
        expect(evaluateCondition(cond, { ...baseCtx, effectiveCritRate: 70, roundCrit: false })).toBe(0);
    });

    it('self-crit falls back to probability when roundCrit is undefined', () => {
        const cond = { subject: 'self-crit' as const, derivable: true };
        expect(evaluateCondition(cond, { ...baseCtx, effectiveCritRate: 70 })).toBe(0.7);
    });
});
```

(NOTE: `evaluateConditions.test.ts` uses a `ctx(over)` factory helper at the top of the file — write these as `ctx({ effectiveCritRate: 70, roundCrit: true })`, not a spread over `baseCtx`.)

Append to `roundContext.test.ts`:

```ts
it('threads roundCrit and enemyHpPct through, defaulting enemyHpPct to 100', () => {
    const base = {
        selfBuffNames: [],
        landedEnemyDebuffCount: 0,
        corrosionEntryCount: 0,
        infernoEntryCount: 0,
        bombCount: 0,
        effectiveCritRate: 50,
    };
    expect(buildRoundContext(base).enemyHpPct).toBe(100);
    expect(buildRoundContext(base).roundCrit).toBeUndefined();
    const ctx = buildRoundContext({ ...base, roundCrit: true, enemyHpPct: 40 });
    expect(ctx.roundCrit).toBe(true);
    expect(ctx.enemyHpPct).toBe(40);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/abilities/__tests__/evaluateConditions.test.ts src/utils/abilities/__tests__/roundContext.test.ts`
Expected: FAIL (unknown property / wrong values).

- [ ] **Step 3: Implement**

In `evaluateConditions.ts`, add to `ConditionContext` (after `effectiveCritRate`):

```ts
    /** This round's binary crit outcome from the deterministic schedule. When set,
     *  'self-crit' evaluates 1/0; when undefined (e.g. modifierCtx — see the two-tier
     *  note in the spec), it falls back to effectiveCritRate/100 as a probability. */
    roundCrit?: boolean;
```

Change the `self-crit` case in `evaluateCondition`:

```ts
        case 'self-crit':
            // Binary when the round's deterministic crit outcome is known; otherwise
            // the legacy probability (0..1) used as gate (>0) and expected-value scaler.
            if (ctx.roundCrit !== undefined) return ctx.roundCrit ? 1 : 0;
            return ctx.effectiveCritRate / 100;
```

In `roundContext.ts`, add to the `state` parameter type:

```ts
    roundCrit?: boolean;
    /** Derived enemy HP% (0..100): 100 × max(0, 1 − cumulativeDamage/enemyHp). Default 100. */
    enemyHpPct?: number;
```

and in the returned object replace `enemyHpPct: 100,` with:

```ts
        selfHpPct: 100,
        enemyHpPct: state.enemyHpPct ?? 100,
        ...(state.roundCrit !== undefined ? { roundCrit: state.roundCrit } : {}),
```

(keep `selfHpPct: 100` — the sim never takes damage; update the doc comment above the function accordingly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/utils/abilities/__tests__/evaluateConditions.test.ts src/utils/abilities/__tests__/roundContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/abilities/__tests__/evaluateConditions.test.ts src/utils/abilities/__tests__/roundContext.test.ts
git commit -m "feat: binary roundCrit + derived enemyHpPct in condition context"
```

---

## Task 3: `gateFiringAbilities` — ordered hard gate with same-cast DoT overlay

**Files:**
- Modify: `src/utils/abilities/applyAbilities.ts`
- Test: `src/utils/abilities/__tests__/applyAbilities.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `applyAbilities.test.ts` (reuse its existing ability/skill literal style):

```ts
import { gateFiringAbilities } from '../applyAbilities';

describe('gateFiringAbilities', () => {
    const baseCtx = {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        enemyDebuffCount: 0,
        effectiveCritRate: 100,
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: 100,
        enemyHpPct: 100,
    };
    const dmg = (id: string, conditions: Condition[] = []): Ability => ({
        id, type: 'damage', target: 'enemy', trigger: 'on-cast', conditions,
        config: { type: 'damage', multiplier: 100 },
    });
    const dot = (id: string): Ability => ({
        id, type: 'dot', target: 'enemy', trigger: 'on-cast', conditions: [],
        config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 2 },
    });

    it('returns undefined skill for undefined input', () => {
        expect(gateFiringAbilities(undefined, baseCtx).gatedSkill).toBeUndefined();
    });

    it('drops abilities whose conditions fail; keeps the rest', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                dmg('a', [{ subject: 'enemy-debuff', derivable: true }]), // 0 debuffs → fail
                dot('b'),
            ],
        };
        const { gatedSkill } = gateFiringAbilities(skill, baseCtx);
        expect(gatedSkill!.abilities.map((a) => a.id)).toEqual(['b']);
    });

    it('a kept dot makes a LATER enemy-debuff gate pass, but not an EARLIER one', () => {
        const failEarly: Skill = {
            slot: 'active',
            abilities: [dmg('a', [{ subject: 'enemy-debuff', derivable: true }]), dot('b')],
        };
        expect(gateFiringAbilities(failEarly, baseCtx).gatedSkill!.abilities.map((a) => a.id)).toEqual(['b']);

        const passLate: Skill = {
            slot: 'active',
            abilities: [dot('b'), dmg('a', [{ subject: 'enemy-debuff', derivable: true }])],
        };
        expect(gateFiringAbilities(passLate, baseCtx).gatedSkill!.abilities.map((a) => a.id)).toEqual(['b', 'a']);
    });

    it('ctxFor records the positional context (overlay applied) per ability', () => {
        const skill: Skill = { slot: 'active', abilities: [dot('b'), dmg('a')] };
        const { ctxFor } = gateFiringAbilities(skill, baseCtx);
        expect(ctxFor.get('b')!.enemyDebuffCount).toBe(0);
        expect(ctxFor.get('a')!.enemyDebuffCount).toBe(1);
    });

    it('honors count-threshold comparators as gates', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                dmg('a', [{ subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 2 }]),
            ],
        };
        expect(gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 1 }).gatedSkill!.abilities).toHaveLength(0);
        expect(gateFiringAbilities(skill, { ...baseCtx, enemyDebuffCount: 2 }).gatedSkill!.abilities).toHaveLength(1);
    });
});
```

(Import `Ability`, `Skill`, `Condition` from `../../../types/abilities` as the file already does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/abilities/__tests__/applyAbilities.test.ts`
Expected: FAIL — `gateFiringAbilities` not exported.

- [ ] **Step 3: Implement**

Add to `applyAbilities.ts` (after `modifierTotalsFromAbilities`; import `conditionMet` is not needed — `conditionsMet` is already imported):

```ts
/**
 * Hard condition gate for the firing skill's payload abilities, walked in ARRAY
 * ORDER (the parser emits in skill-text order — the game's execution order).
 * An ability whose conditions fail contributes nothing this round (dropped from
 * the returned skill). A kept `dot` ability increments an enemy-debuff overlay
 * (+1 ENTRY, matching the sim's entry-count semantics) so LATER abilities in the
 * same cast see it — "Inflicts 2 Corrosion. Deals 90% +30% per debuff" resolves
 * like the game. `ctxFor` records each ability's positional context so scaling
 * (scaledBonus) uses the counts as of that ability's position.
 *
 * Covers the firing-skill payload path only; modifier and extend-dot abilities
 * keep their own firing+passive gating, and buff/debuff abilities gate statically
 * at conversion (see buffAbilityConverters).
 */
export function gateFiringAbilities(
    skill: Skill | undefined,
    baseCtx: ConditionContext
): { gatedSkill: Skill | undefined; ctxFor: Map<string, ConditionContext> } {
    const ctxFor = new Map<string, ConditionContext>();
    if (!skill) return { gatedSkill: undefined, ctxFor };
    let overlay = 0;
    const kept: Ability[] = [];
    for (const ability of skill.abilities) {
        const ctx =
            overlay > 0
                ? { ...baseCtx, enemyDebuffCount: baseCtx.enemyDebuffCount + overlay }
                : baseCtx;
        ctxFor.set(ability.id, ctx);
        if (!conditionsMet(ability.conditions, ctx)) continue;
        kept.push(ability);
        if (ability.config.type === 'dot') overlay += 1;
    }
    return { gatedSkill: { ...skill, abilities: kept }, ctxFor };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/utils/abilities/__tests__/applyAbilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/applyAbilities.ts src/utils/abilities/__tests__/applyAbilities.test.ts
git commit -m "feat: ordered hard condition gate for firing-skill payload abilities"
```

---

## Task 4: Sim — deterministic per-stream crit replaces expected value

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

This task ONLY swaps the crit model and adds `didCrit`. Gating wire-up is Task 6.

- [ ] **Step 1: Write the failing tests**

Add a `describe('deterministic crit schedule', ...)` block. Use the file's helpers; the key inputs: `enemyDefense: 0` for exact numbers, no DoTs/buffs.

```ts
describe('deterministic crit schedule', () => {
    it('crit 50 / critDamage 100 doubles damage on exactly half the active rounds', () => {
        const result = simulateDPS({
            ...baseInput, // attack 10000, activeMultiplier 100-style base — adapt to the file's helper
            attack: 10000,
            crit: 50,
            critDamage: 100,
            activeMultiplier: 100,
            chargeCount: 0,
            enemyDefense: 0,
            rounds: 10,
        });
        const damages = result.rounds.map((r) => r.directDamage);
        // accumulator: rounds 2,4,6,8,10 crit (acc hits 1 on even rounds)
        expect(result.rounds.map((r) => r.didCrit)).toEqual(
            [false, true, false, true, false, true, false, true, false, true]
        );
        expect(damages.filter((d) => d === 20000)).toHaveLength(5);
        expect(damages.filter((d) => d === 10000)).toHaveLength(5);
    });

    it('charged hits crit at the crit rate regardless of cadence (per-stream, no aliasing)', () => {
        // 50% crit + charged every 2nd round: with a single accumulator the charged
        // hit would ALWAYS or NEVER crit; per-stream guarantees half do.
        const result = simulateDPS({
            ...baseInput,
            attack: 10000,
            crit: 50,
            critDamage: 100,
            activeMultiplier: 100,
            chargedMultiplier: 300,
            chargeCount: 1,
            enemyDefense: 0,
            rounds: 12,
        });
        const charged = result.rounds.filter((r) => r.action === 'charged');
        expect(charged.length).toBeGreaterThanOrEqual(5);
        const crits = charged.filter((r) => r.didCrit).length;
        expect(crits).toBe(Math.floor(charged.length / 2));
    });

    it('noCrit damage never crits and consumes no crit charge', () => {
        // explicit shipSkills with noCrit on the active damage; crit 100 would
        // otherwise crit every round.
        const result = simulateDPS({
            ...baseInput,
            attack: 10000,
            crit: 100,
            critDamage: 100,
            chargeCount: 0,
            enemyDefense: 0,
            rounds: 4,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'd1', type: 'damage', target: 'enemy', trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100, noCrit: true },
                            },
                        ],
                    },
                ],
            },
        });
        expect(result.rounds.every((r) => !r.didCrit)).toBe(true);
        expect(result.rounds.every((r) => r.directDamage === 10000)).toBe(true);
    });

    it('crit 100 / critDamage 0 stays multiplier 1 (existing convention unchanged)', () => {
        const result = simulateDPS({
            ...baseInput, attack: 10000, crit: 100, critDamage: 0,
            activeMultiplier: 100, chargeCount: 0, enemyDefense: 0, rounds: 3,
        });
        expect(result.rounds.every((r) => r.didCrit)).toBe(true);
        expect(result.rounds.every((r) => r.directDamage === 10000)).toBe(true);
    });
});
```

Adapt input shapes to the file's actual `baseInput` helper (it must include `selfBuffs: []`, `enemyDebuffs: []`, `enemyHp`, etc. — copy the pattern of neighboring tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsSimulator.test.ts -t 'deterministic crit'`
Expected: FAIL — `didCrit` undefined; partial-crit numbers don't match the schedule.

- [ ] **Step 3: Implement in `dpsSimulator.ts`**

1. Import: `import { makeRateGate } from './rateAccumulator';`. Remove `calculateCritMultiplier` from the line-1 import (keep `calculateDamageReduction`).
2. `RoundData` interface: add after `chargeCount`:

```ts
    /** This round's deterministic binary crit outcome (per-stream schedule). */
    didCrit: boolean;
```

3. In `runSinglePass`, with the other fresh mutable state (~line 252):

```ts
    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    const activeCritGate = makeRateGate();
    const chargedCritGate = makeRateGate();
```

4. Replace the `critMultiplier = calculateCritMultiplier({...})` block (lines ~369-379) with the round-crit decision. `damageNoCrit` is already destructured at this point (extraction is still at the top of the round until Task 6):

```ts
        // This round's binary crit outcome. A noCrit attack cannot crit and consumes
        // no crit chance (the gate does not advance). Decided AFTER the modifier
        // fold-in so the schedule uses the final effective crit rate; modifierCtx
        // above deliberately keeps the probability-based estimate (see spec).
        const roundCrit = damageNoCrit
            ? false
            : (action === 'charged' ? chargedCritGate : activeCritGate)(effectiveCrit / 100);
```

5. Replace `const damageCritMultiplier = damageNoCrit ? 1 : critMultiplier;` (line ~452) with:

```ts
        const damageCritMultiplier = roundCrit ? 1 + effectiveCritDamage / 100 : 1;
```

6. In the `ctx` build (~line 403), pass `roundCrit` (Task 2 added the input):

```ts
            effectiveCritRate: effectiveCrit,
            roundCrit,
```

   (Do NOT add `roundCrit` to `modifierCtx` — two-tier semantics.)
7. In the extend-dot loop (~line 469), the conditions check switches from `modifierCtx` to `ctx` so a self-crit-gated extension uses the binary outcome, and the inner crit-power roll drops its `critGate` factor (now handled by the binary gate) — the `Math.random` part is finished in Task 5, so for now ONLY change:

```ts
            if (!conditionsMet(ab.conditions, ctx)) continue;
            if (ab.config.chanceFromCritPower) {
                const critPowerFactor = Math.min(1, effectiveCritDamage / 100);
                if (Math.random() >= critPowerFactor) continue;
            }
```

   NOTE: the extend loop sits AFTER the `ctx` build in the current code (469 > 403), so `ctx` is in scope.
8. Charge-gain scaling (~line 437-442): no code change — `evaluateCondition(primary, ctx)` now returns 1/0 for self-crit automatically. Verify the comment still reads correctly; update "self-crit expected value" to "binary self-crit".
9. `roundData.push({...})`: add `didCrit: roundCrit,`.

- [ ] **Step 4: Run the full sim suite; fix fallout**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsSimulator.test.ts`
Expected: new tests PASS. Existing tests use `crit: 100` or `crit: 0` (verify: `grep -n "crit:" src/utils/calculators/__tests__/dpsSimulator.test.ts | grep -v "crit: 100\|crit: 0\|critDamage"` — only the `crit: 60` equivalence test, which compares two arms of the same engine and stays green). If any other test fails, the failure means real behavior change — re-pin it to the schedule semantics with a comment explaining the expected crit pattern, never blind-update numbers.

- [ ] **Step 5: Run the abilities integration suite too**

Run: `npx vitest --run src/utils/abilities/__tests__/abilitiesIntegration.test.ts src/utils/abilities/__tests__/flatInputToAbilities.test.ts`
Expected: PASS (both paths share the engine).

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: deterministic per-stream crit schedule replaces expected-value crit"
```

---

## Task 5: Sim — determinize debuff landing + extend chance (zero `Math.random`)

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('deterministic debuff landing', () => {
    it('50% landing chance lands DoTs on exactly half the rounds, evenly spaced', () => {
        // hacking 150 vs security 100 → 50% landing chance
        const result = simulateDPS({
            ...baseInput,
            attack: 10000, crit: 100, critDamage: 0,
            activeMultiplier: 100, chargeCount: 0, enemyDefense: 0,
            hacking: 150, enemySecurity: 100,
            rounds: 10,
            activeDoTs: [{ id: 'd', type: 'corrosion', tier: 6, stacks: 1, duration: 1 }],
        });
        const landedRounds = result.rounds.map((r) => r.dotsLanded);
        expect(landedRounds).toEqual(
            [false, true, false, true, false, true, false, true, false, true]
        );
    });

    it('is reproducible: two identical runs give identical totals', () => {
        const input = {
            ...baseInput, attack: 10000, crit: 37, critDamage: 150,
            activeMultiplier: 100, chargeCount: 0, enemyDefense: 0,
            hacking: 173, enemySecurity: 100, rounds: 30,
        };
        expect(simulateDPS(input).summary).toEqual(simulateDPS(input).summary);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsSimulator.test.ts -t 'deterministic debuff landing'`
Expected: the exact-pattern test FAILS intermittently/by pattern (random landing). The reproducibility test may pass by luck — keep it anyway as a regression guard.

- [ ] **Step 3: Implement**

In `runSinglePass`:

1. Next to the crit gates: `const debuffLandingGate = makeRateGate();` and `const extendChanceGate = makeRateGate();`
2. Line ~306: `const roundDebuffLanded = debuffLandingGate(debuffLandingChance);`
3. Extend loop chance (from Task 4 step 7): `if (!extendChanceGate(critPowerFactor)) continue;`

Verify zero RNG remains: `grep -n "Math.random" src/utils/calculators/dpsSimulator.ts` → no matches.

- [ ] **Step 4: Run the sim suite**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsSimulator.test.ts`
Expected: PASS (existing tests use landing chance 1 → gate fires every round, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: deterministic debuff landing + extend chance — zero Math.random in sim"
```

---

## Task 6: Sim — wire ordered hard gating + derived enemy HP

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

The structural change: payload extraction moves from the top of the round to AFTER the payload `ctx` is built, running on `gateFiringAbilities` output.

- [ ] **Step 1: Write the failing tests**

```ts
describe('hard condition gating of payload abilities', () => {
    const gatedDamageSkills = (conditions: Condition[]): ShipSkills => ({
        slots: [{
            slot: 'active',
            abilities: [{
                id: 'd1', type: 'damage', target: 'enemy', trigger: 'on-cast',
                conditions, config: { type: 'damage', multiplier: 100 },
            }],
        }],
    });

    it('a failing gate zeroes the damage ability', () => {
        const result = simulateDPS({
            ...baseInput, attack: 10000, crit: 100, critDamage: 0,
            chargeCount: 0, enemyDefense: 0, rounds: 3,
            shipSkills: gatedDamageSkills([{ subject: 'enemy-debuff', derivable: true }]),
        });
        expect(result.rounds.every((r) => r.directDamage === 0)).toBe(true);
    });

    it('an execute gate (enemy below 50% HP) switches on once enough damage accumulates', () => {
        // 10k damage/round vs 40k enemy HP: HP% entering rounds 1-3 = 100/75/50,
        // round 4 enters at 25% → below-50 gate passes from round 3 (HP 50 is not <50? then round 4).
        const result = simulateDPS({
            ...baseInput, attack: 10000, crit: 100, critDamage: 0,
            chargeCount: 0, enemyDefense: 0, enemyHp: 40000, rounds: 6,
            shipSkills: {
                slots: [{
                    slot: 'active',
                    abilities: [
                        { id: 'base', type: 'damage', target: 'enemy', trigger: 'on-cast',
                          conditions: [], config: { type: 'damage', multiplier: 100 } },
                        { id: 'exec', type: 'additional-damage', target: 'enemy', trigger: 'on-cast',
                          conditions: [{ subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 50 }],
                          config: { type: 'additional-damage', stat: 'hp', pct: 10 } },
                    ],
                }],
            },
            hp: 50000, // 10% of 50000 = 5000 bonus once the gate opens
        });
        const damages = result.rounds.map((r) => r.directDamage);
        // Work the exact flip round out from cumulative damage; assert the pattern:
        const flipIndex = damages.findIndex((d) => d > 10000);
        expect(flipIndex).toBeGreaterThan(0); // not active round 1
        expect(damages.slice(flipIndex).every((d) => d === 15000)).toBe(true);
        expect(damages.slice(0, flipIndex).every((d) => d === 10000)).toBe(true);
    });

    it('a fresh same-cast dot satisfies a LATER damage gate (text-order overlay)', () => {
        const skills = (order: 'dot-first' | 'damage-first'): ShipSkills => {
            const dmg = {
                id: 'd', type: 'damage' as const, target: 'enemy' as const, trigger: 'on-cast' as const,
                conditions: [{ subject: 'enemy-debuff' as const, derivable: true }],
                config: { type: 'damage' as const, multiplier: 100 },
            };
            const dot = {
                id: 'c', type: 'dot' as const, target: 'enemy' as const, trigger: 'on-cast' as const,
                conditions: [], config: { type: 'dot' as const, dotType: 'corrosion' as const, tier: 6, stacks: 1, duration: 2 },
            };
            return { slots: [{ slot: 'active', abilities: order === 'dot-first' ? [dot, dmg] : [dmg, dot] }] };
        };
        const base = {
            ...baseInput, attack: 10000, crit: 100, critDamage: 0,
            chargeCount: 0, enemyDefense: 0, rounds: 1,
        };
        // dot before damage in text → gate sees the fresh dot → damage fires round 1
        expect(simulateDPS({ ...base, shipSkills: skills('dot-first') }).rounds[0].directDamage).toBe(10000);
        // damage before dot → gate sees nothing round 1 → no direct damage
        expect(simulateDPS({ ...base, shipSkills: skills('damage-first') }).rounds[0].directDamage).toBe(0);
    });

    it('gated-off dot abilities apply nothing', () => {
        const result = simulateDPS({
            ...baseInput, attack: 10000, crit: 100, critDamage: 0,
            chargeCount: 0, enemyDefense: 0, rounds: 3,
            shipSkills: {
                slots: [{
                    slot: 'active',
                    abilities: [{
                        id: 'c', type: 'dot', target: 'enemy', trigger: 'on-cast',
                        conditions: [{ subject: 'self-buff', derivable: true, buffName: 'Stealth' }], // no Stealth → fail
                        config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 2, duration: 3 },
                    }],
                }],
            },
        });
        expect(result.rounds.every((r) => r.corrosionDamage === 0)).toBe(true);
        expect(result.rounds.every((r) => r.activeCorrosionStacks === 0)).toBe(true);
    });
});
```

Pin exact expected numbers once the helper shapes are confirmed; derive the execute-gate flip round by hand from cumulative damage (damage through previous rounds only) and assert it precisely — do not loosen to `toBeGreaterThan` if an exact round is computable.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsSimulator.test.ts -t 'hard condition gating'`
Expected: FAIL — conditions are currently ignored (damage lands despite failing gates) and `enemyHpPct` is fixed at 100.

- [ ] **Step 3: Implement the round restructure in `runSinglePass`**

1. Import `gateFiringAbilities` from `../abilities/applyAbilities`.
2. **Derived enemy HP** — at the top of the round loop (before `modifierCtx`):

```ts
        // Enemy HP% entering this round, derived from damage dealt so far. Floors at 0
        // once cumulative damage exceeds the pool (the sim keeps hitting the "dead" dummy).
        const enemyHpPct =
            enemyHp > 0 ? Math.max(0, 100 * (1 - cumulativeDamage / enemyHp)) : 100;
```

   Pass `enemyHpPct,` into BOTH `buildRoundContext` calls (`modifierCtx` and `ctx`).
3. **Move extraction after gating.** Delete the early extraction block (lines ~281-290: `firingSkill`… `dotsConfig`) EXCEPT keep:

```ts
        const firingSkill = selectFiringSkill(shipSkills, action);
        // noCrit is read from the UNGATED skill: the flag is a property of the attack
        // itself and must be known before the ctx (and therefore the gate) exists.
        const damageNoCrit = damageInputsFromSkill(firingSkill).noCrit;
```

4. Immediately after the `ctx` build, add the gate pass + extraction:

```ts
        // Hard gate: payload abilities whose conditions fail contribute nothing this
        // round. Walked in text order with a same-cast DoT overlay (see applyAbilities).
        const { gatedSkill, ctxFor } = gateFiringAbilities(firingSkill, ctx);
        const { multiplier: rawMultiplier, hits, scalingAbility } = damageInputsFromSkill(gatedSkill);
        const effectiveMultiplier = rawMultiplier * hits;
        const secondary = secondaryFromSkill(gatedSkill);
        const dotsConfig = dotsFromSkill(gatedSkill);
```

5. **Move `secondaryStatValue`** (currently computed ~line 393, before `ctx`): relocate the `let secondaryStatValue = 0; if (secondary) {...}` block to after the extraction in step 4 (its consumers — `preCritDamage`, `secondaryDamage` — come later).
6. **Positional scaling ctx** for the conditional bonus:

```ts
        const conditionalBonusPct = scalingAbility
            ? scaledBonus(scalingAbility, ctxFor.get(scalingAbility.id) ?? ctx)
            : 0;
```

7. **Charge loop:** source from the gated skill and drop the now-redundant gate check, PRESERVING the scaling lines (spec calls this out as the trap — gate ≠ scale):

```ts
            for (const ability of chargeAbilitiesFromSkill(gatedSkill)) {
                if (ability.config.type !== 'charge') continue;
                // Gating already happened in gateFiringAbilities (full AND/OR + thresholds).
                // A thresholded gate contributes the flat amount once; an unthresholded
                // count/probability condition still SCALES it (binary self-crit, per-count
                // subjects). No condition → flat amount.
                const primary = ability.conditions[0];
                const scale =
                    !primary || primary.countComparator != null
                        ? 1
                        : evaluateCondition(primary, ctxFor.get(ability.id) ?? ctx);
                bonusCharges += scale * ability.config.amount;
            }
```

8. **Detonations + accumulators:** switch `detonationsFromSkill(firingSkill)` → `detonationsFromSkill(gatedSkill)` and `accumulatorsFromSkill(firingSkill)` → `accumulatorsFromSkill(gatedSkill)`.
9. Extend-dot and modifier loops keep `firingSkill` + `passiveSkill` sourcing (their own gating paths — do NOT route them through `gatedSkill`, which would drop passive-slot abilities).
10. `roundData.appliedDoTs: dotsConfig` now reflects gated DoTs — correct (only applied DoTs are reported).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: new tests PASS; all existing tests PASS (auto-filled abilities overwhelmingly have empty conditions on damage, which gate to true; conditional-scaling tests keep their scaling because gating with a derivable count of 0 *would* now drop the ability — if any existing conditional-damage test fails because its gate now legitimately gates, re-pin with a comment explaining the new semantics; flag anything surprising to the reviewer instead of force-pinning).

**Known semantics change to verify deliberately:** a damage ability whose ONLY condition is a derivable scaling condition (e.g. "+20% per enemy debuff") with 0 debuffs present previously dealt base damage with +0% bonus; under hard gating `enemy-debuff` count 0 fails the gate and zeroes the whole ability. Scaling conditions ARE gates now (count>0 default) — this is THE design change. The plan reviewer identified the single existing casualty: **"derives the enemy-debuff count from prior-round DoT entries (ramps over rounds)"** (`dpsSimulator.test.ts` ~line 1120) — its round 1 expects `directDamage === 1000`, which becomes 0 (the flat-adapter dot is emitted AFTER the damage ability, so no overlay on round 1). Re-pin exactly that test with a comment, and note the behavior change in the changelog entry. Any OTHER unexpected failure → stop and flag to the reviewer, don't force-pin.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: hard-gate payload ability conditions + derived enemy HP in DPS sim"
```

---

## Task 7: Chart — crit badge in the round tooltip

**Files:**
- Modify: `src/components/calculator/DPSRoundChart.tsx:62-66`

- [ ] **Step 1: Implement** (presentational; no unit test — verified in Task 10)

In `RoundTooltip`, next to the existing `Charged` badge:

```tsx
                            {roundData?.action === 'charged' && (
                                <span className="ml-1 text-yellow-400 text-xs">Charged</span>
                            )}
                            {roundData?.didCrit && (
                                <span className="ml-1 text-red-400 text-xs">Crit</span>
                            )}
```

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint`
Expected: clean (didCrit exists on RoundData from Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/components/calculator/DPSRoundChart.tsx
git commit -m "feat: crit badge in DPS round chart tooltip"
```

---

## Task 8: Parser — emit abilities in skill-text order

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts`
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

**Design note (refines spec §6):** positions are computed inside `buildShipAbilities.ts` via raw-text anchor searches instead of changing every parser signature to return `match.index` — same text-order outcome, no parser churn. All anchors search the SAME string (the raw row text) so indices are comparable. Only relative order has sim meaning (the gate overlay), and only for payload abilities; modifier/buff order is consumed order-independently.

- [ ] **Step 1: Write the failing test**

```ts
describe('text-order emission', () => {
    it('emits a dot BEFORE the damage ability when the DoT comes first in the skill text', () => {
        const ship = makeShip({
            // follow the file's existing makeShip/skill-row fixture helper
            active: 'Inflicts 2 <unit-skill>Corrosion II</unit-skill> for 2 turns, then deals <unit-damage>90%</unit-damage> damage.',
        });
        const skills = buildShipAbilities(ship);
        const active = skills.slots.find((s) => s.slot === 'active')!;
        const types = active.abilities.map((a) => a.type);
        expect(types.indexOf('dot')).toBeLessThan(types.indexOf('damage'));
    });

    it('keeps damage first when it precedes the DoT in text', () => {
        const ship = makeShip({
            active: 'Deals <unit-damage>90%</unit-damage> damage and inflicts 2 <unit-skill>Corrosion II</unit-skill> for 2 turns.',
        });
        const skills = buildShipAbilities(ship);
        const active = skills.slots.find((s) => s.slot === 'active')!;
        const types = active.abilities.map((a) => a.type);
        expect(types.indexOf('damage')).toBeLessThan(types.indexOf('dot'));
    });
});
```

Adapt the fixture helper to whatever `buildShipAbilities.test.ts` already uses to fabricate a ship with skill rows (it has one — find it at the top of the file). Confirm the DoT auto-fill actually produces a Corrosion dot for these texts (it routes through `buildDoTAutoFill`); if the fixture needs template-level fields, mirror an existing DoT test in the file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run src/utils/abilities/__tests__/buildShipAbilities.test.ts -t 'text-order'`
Expected: the dot-first test FAILS (dots are currently appended after text abilities).

- [ ] **Step 3: Implement**

In `buildShipAbilities.ts`:

1. Change `abilitiesFromText(text)` to build `Array<{ ability: Ability; pos: number }>` internally. Anchor positions on the RAW `text` (`Number.MAX_SAFE_INTEGER` when an anchor is missing — sorts to end):
   - damage: `text.search(/<unit-damage>/i)`
   - additional-damage: position of the SECOND `<unit-damage>` tag if present (`text.indexOf('<unit-damage>', firstIdx + 1)`), else first
   - extend-dot (both variants): `text.search(/extend/i)`
   - detonate-dot: `text.search(/detonat/i)`
   - accumulate-detonate: `text.search(/echoing burst/i)` (the named-effect anchor)
   - charge: `text.search(/charge/i)`
   - ally-crit-dot dots: position of the matched `<unit-skill>` effect name (`text.indexOf(eff.buffName)`)
   - modifiers: `text.search(/more|increase|penetration/i)` (order among modifiers is sim-irrelevant; one shared anchor is fine)

   Return `out.sort((a, b) => a.pos - b.pos).map((e) => e.ability);` — `Array.prototype.sort` is stable, so ties keep current category order.
2. In `buildShipAbilities`, give the ship-level merges positions too. Restructure the per-slot assembly to collect `{ ability, pos }`:
   - text abilities: positions from step 1 (have `abilitiesFromText` return the pairs via a second exported-for-merge variant, or inline the sort at slot level — keep it simple: make `abilitiesFromText` return the pairs and sort once per slot after merging)
   - DoT auto-fill (`dotsForSlot`): `pos = rowText.search(new RegExp(entry.type, 'i'))` where `rowText = getSkillRowForSlot(ship, slot)?.text ?? ''` (e.g. `/corrosion/i`); missing → end
   - buff/debuff merge (`mergeBuff`): `pos = rowText.indexOf(buff.buffName)`; missing → end
   - sort each slot's collected pairs by pos before building `Skill.slots`
3. Keep `counter = 0` reset and all existing condition-attachment logic untouched — only the ORDER of the emitted array changes.

- [ ] **Step 4: Run the abilities + parser suites**

Run: `npx vitest --run src/utils/abilities/ src/utils/__tests__/skillTextParser.test.ts`
Expected: new tests PASS. Existing `buildShipAbilities` tests that assert `abilities[0]` by index may break — update them to find-by-type (`abilities.find(a => a.type === 'damage')`) rather than re-pinning indices, EXCEPT where the test is explicitly about order.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat: emit parsed abilities in skill-text order (game execution order)"
```

---

## Task 9: Editor — ability reorder buttons

**Files:**
- Modify: `src/components/skills/SkillEditorModal.tsx:76-133`
- Modify: `src/components/skills/AbilityCard.tsx:487-494` (header) + its `Props`

- [ ] **Step 1: Implement**

`SkillEditorModal.tsx` — add next to `handleAbilityRemove`:

```tsx
    const handleAbilityMove = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= currentSkill.abilities.length) return;
        const abilities = [...currentSkill.abilities];
        [abilities[index], abilities[target]] = [abilities[target], abilities[index]];
        onChange({ ...currentSkill, abilities });
    };
```

and in the `.map`:

```tsx
                    <AbilityCard
                        key={ability.id}
                        ability={ability}
                        onChange={(updated) => handleAbilityChange(index, updated)}
                        onRemove={() => handleAbilityRemove(index)}
                        onMoveUp={index > 0 ? () => handleAbilityMove(index, -1) : undefined}
                        onMoveDown={
                            index < currentSkill.abilities.length - 1
                                ? () => handleAbilityMove(index, 1)
                                : undefined
                        }
                    />
```

`AbilityCard.tsx` — extend `Props`:

```tsx
interface Props {
    ability: Ability;
    onChange: (ability: Ability) => void;
    onRemove: () => void;
    /** Move this ability up/down in the skill's execution order; undefined at the ends. */
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}
```

and in the header row (line ~489), before the remove button:

```tsx
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{ABILITY_TYPE_LABELS[ability.type]}</h4>
                <div className="flex items-center gap-1">
                    {onMoveUp && (
                        <Button variant="secondary" size="xs" onClick={onMoveUp} aria-label="Move ability up">
                            ↑
                        </Button>
                    )}
                    {onMoveDown && (
                        <Button variant="secondary" size="xs" onClick={onMoveDown} aria-label="Move ability down">
                            ↓
                        </Button>
                    )}
                    <Button variant="danger" size="xs" onClick={onRemove} aria-label="Remove ability">
                        ×
                    </Button>
                </div>
            </div>
```

(Check `src/components/ui/icons/` for existing chevron/arrow icon components first — if present, use them instead of the text glyphs, per project convention.)

- [ ] **Step 2: Lint + full suite**

Run: `npm run lint && npm test`
Expected: clean + green (destructure the new props in the component signature).

- [ ] **Step 3: Commit**

```bash
git add src/components/skills/SkillEditorModal.tsx src/components/skills/AbilityCard.tsx
git commit -m "feat: reorder abilities in skill editor (execution order now sim-meaningful)"
```

---

## Task 10: Docs, changelog, coverage doc, live verify

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (DPS section)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `docs/skill-model-coverage.md`
- Check: `src/pages/calculators/DPSCalculatorPage.tsx` "About the Simulation" prose

- [ ] **Step 1: Update in-app docs**

In `DocumentationPage.tsx` DPS section and the DPS page's "About the Simulation" prose, describe:
- Crit is a deterministic per-round schedule at the ship's crit rate (separate schedules for active and charged hits), not an averaged multiplier; crit rounds are badged in the chart.
- Ability conditions now gate: damage, stat-based bonus damage, DoTs, and detonations with unmet conditions contribute nothing that round.
- Enemy HP declines as damage accumulates, so "below X% HP" effects switch on mid-fight.
- Abilities execute in skill-text order; reorder in the skill editor affects which effects "see" earlier ones in the same cast.
- The sim is fully deterministic — same inputs, same result.

- [ ] **Step 2: Changelog entry**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (plain English, user-facing), e.g.:

```text
DPS simulator overhaul: crits now follow a deterministic per-round schedule instead of an averaged multiplier (crit rounds shown in the chart), ability conditions actually gate damage/DoTs/detonations, enemy HP drops as damage accumulates so "below X% HP" effects kick in mid-fight, and results are fully reproducible run-to-run. Skill abilities now execute in skill-text order and can be reordered in the editor.
```

- [ ] **Step 3: Update the coverage doc**

In `docs/skill-model-coverage.md`: flip the §1 matrix "Conditions gate in sim" cells for damage/additional-damage/dot/detonate-dot/accumulate-detonate to ✅ (citing `gateFiringAbilities`); update §2 hp-threshold row (derived, live); update the §1 headline-gaps list and strike backlog items #1, #2, #6 in §6; note Tier 1+2 ordering shipped; remove the "already stochastic" RNG remarks (now zero-RNG). Commit with `git add -f` (docs/ is gitignored).

- [ ] **Step 4: Live verify** (@verify or manual)

Start `npm start`, open the DPS calculator, select a ship with a conditional skill (e.g. one with "deals X% to enemies with <effect>") and confirm: (a) chart tooltips show Crit badges on the scheduled rounds; (b) totals are identical across two recomputes of the same config; (c) editing a damage ability's condition to an unmeetable manual gate zeroes that slice; (d) reorder buttons in the skill editor move abilities and change totals when order matters (dot-before-damage case).

- [ ] **Step 5: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts src/pages/calculators/DPSCalculatorPage.tsx
git add -f docs/skill-model-coverage.md
git commit -m "docs: deterministic crit + hard gating documentation and changelog"
```

---

## Task 11: Final integration check

- [ ] **Step 1:** `npm test` — full suite green (note count vs the 855 baseline; growth expected).
- [ ] **Step 2:** `npm run lint` — zero warnings (max-warnings: 0).
- [ ] **Step 3:** `grep -rn "Math.random" src/utils/calculators/dpsSimulator.ts` — empty.
- [ ] **Step 4:** Re-read the spec's Testing section and confirm every listed case exists in the suite; add any gaps.
- [ ] **Step 5:** Use superpowers:requesting-code-review for a final review pass against the spec before declaring done.
