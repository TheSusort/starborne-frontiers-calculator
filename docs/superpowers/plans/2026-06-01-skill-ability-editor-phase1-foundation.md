# Skill & Ability Editor — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, fully unit-tested foundation of the shared ability model — the TypeScript types, the condition-evaluation engine, and the `buildShipAbilities` parser assembler — without changing any user-facing behavior yet.

**Architecture:** Three new, dependency-ordered modules. `src/types/abilities.ts` defines the calc-agnostic data model (spec §3). `src/utils/abilities/evaluateConditions.ts` resolves a `Condition[]` to a count against a `ConditionContext` (gate + scale + OR-groups + caps). `src/utils/abilities/buildShipAbilities.ts` reuses the existing regex detectors in `skillTextParser.ts` plus a few new ones to emit a `ShipSkills` per ship. Nothing imports these yet — Phase 2 (simulator) and Phase 3 (editor) consume them.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-01-skill-ability-editor-design.md` (read §3 and §5 before starting).

**Baseline branch:** Branch from `feat/dps-charge-manipulation` (or from `main` after PR #71 merges) — NOT bare `main`. This plan reuses `parseChargeGain`, the `ChargeGain`/`SecondaryDamage`/`ConditionalDamage` types, and the `always`/`self-crit`/`enemy-type` `ConditionalCondition` values, all of which live on that branch. Confirm with: `git log --oneline | grep -i "charge"` should show commit `1caa2f7` ("charges only gain on active rounds and cap at chargeCount").

**Conventions:**
- Tests live in `__tests__/` next to the code (e.g. `src/utils/abilities/__tests__/evaluateConditions.test.ts`).
- Run a single test file: `npx vitest run <path>`. Run all: `npm test`. Lint: `npm run lint` (max-warnings 0).
- Pre-commit hook runs lint + the full suite on every commit — a commit only succeeds if both pass.
- Reference data: `docs/ship-skills.csv` (147 ships; columns: `name, active_skill_text, charge_skill_charge, first_passive_skill_text, second_passive_skill_text, third_passive_skill_text`).

---

## File Structure (Phase 1)

| File | Responsibility |
|---|---|
| `src/types/abilities.ts` (create) | The shared model: `ShipSkills`, `Skill`, `Ability`, `Condition`, `ScalingRule`, all configs + enums. Pure types. |
| `src/utils/abilities/evaluateConditions.ts` (create) | `ConditionContext`, `evaluateCondition(cond, ctx)`, `conditionsMet(conds, ctx)`, `scaledBonus(ability, ctx)`. Pure functions. |
| `src/utils/abilities/buildShipAbilities.ts` (create) | `buildShipAbilities(ship): ShipSkills` — resolve skills via `getShipSkillRows`, run detectors, emit abilities. |
| `src/utils/abilities/__tests__/*.test.ts` (create) | Unit tests for each module. |
| `src/utils/abilities/abilityFixtures.ts` (create) | Hand-built `Ability`/`Skill` fixtures (Selenite, Lodolite, Lionheart, Chakara) reused by tests across phases. |

---

## Task 1: The ability model types

**Files:**
- Create: `src/types/abilities.ts`
- Create: `src/types/__tests__/abilities.test.ts`

The model is pure types, so the "test" is a compile-time shape lock: a fixture file that constructs representative abilities. If the types are wrong, the fixture file won't compile and the test won't run.

- [ ] **Step 1: Write the type module**

Create `src/types/abilities.ts` exactly per spec §3 (reproduced here — this is the source of truth for the implementer):

```ts
import { EnemyBaseClass } from './calculator';
import { DoTType, StackTrigger } from './calculator';

export type SkillSlot = 'active' | 'charged' | 'passive';

export type AbilityType =
    | 'damage'
    | 'additional-damage'
    | 'modifier'
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'charge'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'purge'
    | 'control';

export type AbilityTarget = 'self' | 'ally' | 'all-allies' | 'enemy' | 'all-enemies';

export type AbilityTrigger =
    | 'on-cast'
    | 'start-of-round'
    | 'on-crit'
    | 'on-attacked' // reactive — represented, not simulated for DPS
    | 'on-ally-destroyed' // reactive
    | 'on-destroyed'; // reactive

export type ConditionSubject =
    | 'always'
    | 'self-buff'
    | 'self-debuff' // NEW vs ConditionalCondition
    | 'enemy-buff'
    | 'enemy-debuff'
    | 'enemy-type'
    | 'self-crit'
    | 'adjacent-ally'
    | 'enemy-adjacent'
    | 'enemy-destroyed'
    | 'hp-threshold'; // NEW

export interface Condition {
    subject: ConditionSubject;
    derivable: boolean;
    manualCount?: number;
    anyOf?: boolean; // OR-grouped with adjacent anyOf conditions
    requiredEnemyType?: EnemyBaseClass;
    buffName?: string; // e.g. 'Stealth' for enemy-buff/self-buff matching
    hpComparator?: 'below' | 'above';
    hpPercent?: number;
}

export interface ScalingRule {
    conditionIndex: number; // which condition in `conditions` supplies the count
    perUnit: number;
    cap?: number;
}

export type ModifierChannel =
    | 'attack'
    | 'defense'
    | 'hp'
    | 'crit'
    | 'critDamage'
    | 'outgoingDamage'
    | 'outgoingHeal'
    | 'incomingDamage';

export type BuffStat = 'attack' | 'crit' | 'critDamage' | 'outgoingDamage' | 'defence' | 'hp';

export type AbilityConfig =
    | { type: 'damage'; multiplier: number; hits?: number }
    | { type: 'additional-damage'; stat: 'hp' | 'defense'; pct: number }
    | { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
    | {
          type: 'buff';
          stat: BuffStat;
          value: number;
          isMultiplicative: boolean;
          duration: number | 'recurring';
          stackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
      }
    | {
          type: 'debuff';
          stat: BuffStat;
          value: number;
          duration: number | 'recurring';
          application: 'inflict' | 'apply';
      }
    | { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
    | { type: 'charge'; amount: number }
    | { type: 'heal' | 'shield'; pct: number; basis: 'hp' | 'attack' }
    | { type: 'cleanse' | 'purge'; count: number }
    | {
          type: 'control';
          effect: 'provoke' | 'taunt' | 'stasis' | 'overload' | 'concentrate-fire';
      };

export interface Ability {
    id: string;
    type: AbilityType;
    target: AbilityTarget;
    trigger: AbilityTrigger;
    conditions: Condition[];
    scaling?: ScalingRule;
    config: AbilityConfig;
    autoFilled?: boolean;
}

export interface Skill {
    slot: SkillSlot;
    name?: string;
    abilities: Ability[];
}

export interface ShipSkills {
    slots: Skill[];
}
```

Note: `config.type` duplicates `Ability.type` so the union can be discriminated on `config` alone in `applyAbility` (Phase 2). The builder/editor must keep them in sync.

- [ ] **Step 2: Write the fixture file (this is the compile-time test)**

Create `src/utils/abilities/abilityFixtures.ts` with named, exported fixtures used by later tests. These encode real ships and lock the model shape:

```ts
import { ShipSkills } from '../../types/abilities';

// Selenite: Active deals 200% + 10% max HP; adds 1 charge if enemy Stealthed. Charge cost 4.
export const SELENITE: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                { id: 's1', type: 'damage', target: 'enemy', trigger: 'on-cast', conditions: [],
                  config: { type: 'damage', multiplier: 200 } },
                { id: 's2', type: 'additional-damage', target: 'enemy', trigger: 'on-cast', conditions: [],
                  config: { type: 'additional-damage', stat: 'hp', pct: 10 } },
                { id: 's3', type: 'charge', target: 'self', trigger: 'on-cast',
                  conditions: [{ subject: 'enemy-buff', derivable: false, manualCount: 1, buffName: 'Stealth' }],
                  config: { type: 'charge', amount: 1 } },
            ],
        },
        { slot: 'charged', abilities: [
            { id: 's4', type: 'damage', target: 'enemy', trigger: 'on-cast', conditions: [],
              config: { type: 'damage', multiplier: 300 } } ] },
    ],
};

// Lodolite: +X% damage scaling, OR-grouped over Defender / Stealth / Concentrate Fire.
export const LODOLITE: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'l1', type: 'damage', target: 'enemy', trigger: 'on-cast',
                    conditions: [
                        { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender', anyOf: true },
                        { subject: 'enemy-buff', derivable: false, manualCount: 1, buffName: 'Stealth', anyOf: true },
                        { subject: 'enemy-debuff', derivable: true, buffName: 'Concentrate Fire', anyOf: true },
                    ],
                    scaling: { conditionIndex: 0, perUnit: 10, cap: 30 },
                    config: { type: 'damage', multiplier: 200 },
                },
            ],
        },
    ],
};

// Lionheart: ILLUSTRATIVE hand-built shape only (a +10% HP all-allies aura) to
// lock the `modifier` shape. The real Lionheart text is a start-of-combat grant
// of 10% HP to *adjacent* allies — do NOT use this as a parser-output assertion.
export const LIONHEART: ShipSkills = {
    slots: [
        {
            slot: 'passive',
            abilities: [
                { id: 'h1', type: 'modifier', target: 'all-allies', trigger: 'on-cast', conditions: [],
                  config: { type: 'modifier', channel: 'hp', value: 10, isMultiplicative: true } },
            ],
        },
    ],
};
```

- [ ] **Step 3: Write the shape-lock test**

Create `src/types/__tests__/abilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SELENITE, LODOLITE, LIONHEART } from '../../utils/abilities/abilityFixtures';

describe('ability model shape', () => {
    it('Selenite has a conditional self charge ability gated on enemy Stealth', () => {
        const active = SELENITE.slots.find((s) => s.slot === 'active')!;
        const charge = active.abilities.find((a) => a.type === 'charge')!;
        expect(charge.target).toBe('self');
        expect(charge.conditions[0].buffName).toBe('Stealth');
        expect(charge.config).toEqual({ type: 'charge', amount: 1 });
    });

    it('Lodolite damage scales by an OR-group with a cap', () => {
        const dmg = LODOLITE.slots[0].abilities[0];
        expect(dmg.conditions.every((c) => c.anyOf)).toBe(true);
        expect(dmg.scaling).toEqual({ conditionIndex: 0, perUnit: 10, cap: 30 });
    });

    it('Lionheart is an unconditional all-allies HP modifier', () => {
        const mod = LIONHEART.slots[0].abilities[0];
        expect(mod.target).toBe('all-allies');
        expect(mod.config).toEqual({ type: 'modifier', channel: 'hp', value: 10, isMultiplicative: true });
    });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/types/__tests__/abilities.test.ts`
Expected: PASS (3 tests). If it fails to compile, the types in Step 1 are wrong — fix `abilities.ts`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/types/abilities.ts src/utils/abilities/abilityFixtures.ts src/types/__tests__/abilities.test.ts
git commit -m "feat: add shared ability model types + fixtures"
```

---

## Task 2: Condition evaluation engine

**Files:**
- Create: `src/utils/abilities/evaluateConditions.ts`
- Create: `src/utils/abilities/__tests__/evaluateConditions.test.ts`

The sim (Phase 2) calls these per round. Phase 1 tests them against hand-built contexts — no sim needed.

- [ ] **Step 1: Write failing tests**

Create `src/utils/abilities/__tests__/evaluateConditions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    ConditionContext,
    evaluateCondition,
    conditionsMet,
    scaledBonus,
} from '../evaluateConditions';
import { Ability, Condition } from '../../../types/abilities';

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    enemyType: undefined,
    effectiveCritRate: 0,
    adjacentAllyCount: 0,
    enemyAdjacentCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
    ...over,
});

const cond = (over: Partial<Condition>): Condition => ({ subject: 'always', derivable: true, ...over });

describe('evaluateCondition', () => {
    it("'always' is 1", () => {
        expect(evaluateCondition(cond({ subject: 'always' }), ctx())).toBe(1);
    });

    it("derivable 'self-buff' counts active self buffs (all, or by name)", () => {
        const c = ctx({ selfBuffNames: ['Attack Up II', 'Defense Up II'] });
        expect(evaluateCondition(cond({ subject: 'self-buff', derivable: true }), c)).toBe(2);
        expect(
            evaluateCondition(cond({ subject: 'self-buff', derivable: true, buffName: 'Attack Up II' }), c)
        ).toBe(1);
    });

    it("'enemy-debuff' uses the derived count", () => {
        expect(
            evaluateCondition(cond({ subject: 'enemy-debuff', derivable: true }), ctx({ enemyDebuffCount: 3 }))
        ).toBe(3);
    });

    it("'enemy-buff' by name is 1 when present, else 0", () => {
        expect(
            evaluateCondition(cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }), ctx({ enemyBuffNames: ['Stealth'] }))
        ).toBe(1);
        expect(
            evaluateCondition(cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }), ctx())
        ).toBe(0);
    });

    it("'self-crit' is effective crit rate / 100", () => {
        expect(evaluateCondition(cond({ subject: 'self-crit', derivable: true }), ctx({ effectiveCritRate: 100 }))).toBe(1);
        expect(evaluateCondition(cond({ subject: 'self-crit', derivable: true }), ctx({ effectiveCritRate: 50 }))).toBe(0.5);
    });

    it("'enemy-type' is 1 on match else 0", () => {
        const c = cond({ subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' });
        expect(evaluateCondition(c, ctx({ enemyType: 'Defender' }))).toBe(1);
        expect(evaluateCondition(c, ctx({ enemyType: 'Attacker' }))).toBe(0);
    });

    it("'hp-threshold' below/above resolves against context HP", () => {
        const below = cond({ subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 50 });
        expect(evaluateCondition(below, ctx({ enemyHpPct: 40 }))).toBe(1); // enemy HP basis: see note
        expect(evaluateCondition(below, ctx({ enemyHpPct: 60 }))).toBe(0);
    });

    it('non-derivable uses manualCount (default 1)', () => {
        expect(evaluateCondition(cond({ subject: 'enemy-buff', derivable: false }), ctx())).toBe(1);
        expect(evaluateCondition(cond({ subject: 'enemy-buff', derivable: false, manualCount: 3 }), ctx())).toBe(3);
        expect(evaluateCondition(cond({ subject: 'enemy-buff', derivable: false, manualCount: 0 }), ctx())).toBe(0);
    });
});

describe('conditionsMet (AND of OR-groups)', () => {
    it('empty conditions → always met', () => {
        expect(conditionsMet([], ctx())).toBe(true);
    });

    it('AND: all groups must have count > 0', () => {
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender' }),
            cond({ subject: 'self-crit' }),
        ];
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender', effectiveCritRate: 100 }))).toBe(true);
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender', effectiveCritRate: 0 }))).toBe(false);
    });

    it('OR-group (anyOf): any member > 0 satisfies the group', () => {
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender', anyOf: true }),
            cond({ subject: 'enemy-buff', derivable: false, manualCount: 0, anyOf: true, buffName: 'Stealth' }),
        ];
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender' }))).toBe(true); // first OR member true
        expect(conditionsMet(conds, ctx({ enemyType: 'Attacker' }))).toBe(false); // both false
    });
});

describe('scaledBonus', () => {
    const dmg = (conditions: Condition[], scaling: Ability['scaling']): Ability => ({
        id: 'x', type: 'damage', target: 'enemy', trigger: 'on-cast', conditions, scaling,
        config: { type: 'damage', multiplier: 200 },
    });

    it('per-unit × count, capped', () => {
        const a = dmg([cond({ subject: 'enemy-debuff', derivable: true })], { conditionIndex: 0, perUnit: 10, cap: 30 });
        expect(scaledBonus(a, ctx({ enemyDebuffCount: 2 }))).toBe(20);
        expect(scaledBonus(a, ctx({ enemyDebuffCount: 5 }))).toBe(30); // capped
    });

    it('returns 0 when no scaling rule', () => {
        expect(scaledBonus(dmg([], undefined), ctx())).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: FAIL — module `../evaluateConditions` does not exist.

- [ ] **Step 3: Implement**

Create `src/utils/abilities/evaluateConditions.ts`:

```ts
import { Ability, Condition } from '../../types/abilities';
import { EnemyBaseClass } from '../../types/calculator';

export interface ConditionContext {
    selfBuffNames: string[];
    selfDebuffNames: string[];
    enemyBuffNames: string[];
    enemyDebuffCount: number;
    enemyType?: EnemyBaseClass;
    effectiveCritRate: number; // 0..100
    adjacentAllyCount: number;
    enemyAdjacentCount: number;
    enemyDestroyedCount: number;
    selfHpPct: number; // 0..100
    enemyHpPct: number; // 0..100
}

/** Resolve one condition to a count (>= 0). 0 means "not met". */
export function evaluateCondition(cond: Condition, ctx: ConditionContext): number {
    if (!cond.derivable) return Math.max(0, cond.manualCount ?? 1);

    switch (cond.subject) {
        case 'always':
            return 1;
        case 'self-buff':
            return countNames(ctx.selfBuffNames, cond.buffName);
        case 'self-debuff':
            return countNames(ctx.selfDebuffNames, cond.buffName);
        case 'enemy-buff':
            return countNames(ctx.enemyBuffNames, cond.buffName);
        case 'enemy-debuff':
            return ctx.enemyDebuffCount;
        case 'enemy-type':
            return ctx.enemyType && ctx.enemyType === cond.requiredEnemyType ? 1 : 0;
        case 'self-crit':
            return ctx.effectiveCritRate / 100;
        case 'adjacent-ally':
            return ctx.adjacentAllyCount;
        case 'enemy-adjacent':
            return ctx.enemyAdjacentCount;
        case 'enemy-destroyed':
            return ctx.enemyDestroyedCount;
        case 'hp-threshold':
            return evalHpThreshold(cond, ctx) ? 1 : 0;
        default:
            return 0;
    }
}

function countNames(names: string[], filter?: string): number {
    if (!filter) return names.length;
    return names.filter((n) => n === filter).length;
}

// HP-threshold basis: enemy HP for offensive scaling. Under DPS assumptions both are 100.
// (Self-HP-threshold ships are survivability passives; revisit if a self-HP DPS scaler appears.)
function evalHpThreshold(cond: Condition, ctx: ConditionContext): boolean {
    const hp = ctx.enemyHpPct;
    const t = cond.hpPercent ?? 0;
    return cond.hpComparator === 'above' ? hp > t : hp < t;
}

/** AND across OR-groups. Consecutive `anyOf` conditions form one OR-group. Empty → true. */
export function conditionsMet(conditions: Condition[], ctx: ConditionContext): boolean {
    if (conditions.length === 0) return true;
    const groups = groupConditions(conditions);
    return groups.every((group) => group.some((c) => evaluateCondition(c, ctx) > 0));
}

/** Group runs of `anyOf` together; non-anyOf conditions are their own singleton groups. */
function groupConditions(conditions: Condition[]): Condition[][] {
    const groups: Condition[][] = [];
    let run: Condition[] = [];
    for (const c of conditions) {
        if (c.anyOf) {
            run.push(c);
        } else {
            if (run.length) { groups.push(run); run = []; }
            groups.push([c]);
        }
    }
    if (run.length) groups.push(run);
    return groups;
}

/** Per-count scaling bonus for an ability, capped. 0 if no scaling rule. */
export function scaledBonus(ability: Ability, ctx: ConditionContext): number {
    if (!ability.scaling) return 0;
    const c = ability.conditions[ability.scaling.conditionIndex];
    if (!c) return 0;
    const count = evaluateCondition(c, ctx);
    const bonus = count * ability.scaling.perUnit;
    return ability.scaling.cap != null ? Math.min(bonus, ability.scaling.cap) : bonus;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/abilities/evaluateConditions.ts src/utils/abilities/__tests__/evaluateConditions.test.ts
git commit -m "feat: add ability condition-evaluation engine"
```

---

## Task 3: Parser assembler — `buildShipAbilities`

**Files:**
- Create: `src/utils/abilities/buildShipAbilities.ts`
- Create: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`
- Reference (do not modify): `src/utils/skillTextParser.ts`, `src/utils/ship/skillRows.ts`, `src/types/ship.ts`

This reuses existing detectors. **Do not rewrite the regexes.** Reuse: `parseSkillDamage(text)`, `parseSecondaryDamage(text)`, `parseConditionalDamage(text)`, `parseChargeGain(text)`, `parseSkillEffects(text, source)`. Resolve which skills exist via `getShipSkillRows(ship)`.

Split into two sub-tasks so each commits independently.

> **Scope revision (during execution):** Task 3a is narrowed to the four clean **per-skill scalar detectors** — `damage`, `additional-damage`, `conditional`-scaling, and `charge`. **DoT abilities moved to Task 3b** (reuse `buildDoTAutoFill` + `DOT_TIER_MAP` from `skillBuffAutoFill.ts` — clean name→tier mapping). **Buff/debuff ability mapping is deferred to Phase 3** (the editor): the existing `buildSkillBuffAutoFill` produces `SelectedGameBuff` whose `parsedEffects` carry *multiple* stat channels, which does not map 1:1 to a single `buff` ability `{stat,value}` — that mapping needs a dedicated decision, and Phase 2's simulator keeps consuming the existing `SelectedGameBuff` auto-fill regardless. So Task 3a's `abilitiesFromText` does NOT emit buff/debuff/dot abilities.

### Task 3a: Map per-skill scalar detectors → abilities (damage, additional, conditional, charge)

- [ ] **Step 1: Write failing tests** against real CSV ships.

Create `src/utils/abilities/__tests__/buildShipAbilities.test.ts`. Build a minimal `Ship` literal from CSV text (only skill fields + refits matter):

```ts
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';

// Minimal ship factory — only fields buildShipAbilities reads.
function ship(over: Partial<Ship>): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}], // 4 refits → Passive R4 (third passive)
        ...over,
    } as Ship;
}

describe('buildShipAbilities — core detectors', () => {
    it('Selenite active: damage 200 + additional 10% HP + self charge gated on Stealth', () => {
        const s = ship({
            activeSkillText:
                "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
            chargeSkillCharge: 4,
        });
        const result = buildShipAbilities(s);
        const active = result.slots.find((sl) => sl.slot === 'active')!;
        const types = active.abilities.map((a) => a.type);
        expect(types).toContain('damage');
        expect(types).toContain('additional-damage');
        expect(types).toContain('charge');
        const charge = active.abilities.find((a) => a.type === 'charge')!;
        expect(charge.target).toBe('self');
        expect(charge.conditions[0].subject).toBe('enemy-buff'); // Stealth → enemy-buff
        expect(charge.autoFilled).toBe(true);
    });

    it('a charge cost populates the charged skill slot', () => {
        const s = ship({ activeSkillText: 'deals <unit-damage>100% damage</unit-damage>', chargeSkillText: 'deals <unit-damage>300% damage</unit-damage>', chargeSkillCharge: 3 });
        const charged = buildShipAbilities(s).slots.find((sl) => sl.slot === 'charged');
        expect(charged?.abilities.find((a) => a.type === 'damage')?.config).toMatchObject({ multiplier: 300 });
    });
});
```

Add 3–4 more cases covering: conditional scaling → a `damage` with `scaling` (e.g. a "for every enemy debuff" ship), a DoT ship (corrosion), and a buff/debuff ship. Pick exact ships from `docs/ship-skills.csv` and paste their real text.

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the assembler.**

Create `src/utils/abilities/buildShipAbilities.ts`. Structure (fill in detector wiring):

```ts
import { Ship } from '../../types/ship';
import { getShipSkillRows } from '../ship/skillRows';
import {
    parseSkillDamage,
    parseSecondaryDamage,
    parseConditionalDamage,
    parseChargeGain,
    parseSkillEffects,
    SkillSource,
} from '../skillTextParser';
import { Ability, ShipSkills, Skill, SkillSlot, Condition } from '../../types/abilities';

let counter = 0;
const nextId = () => `ab${counter++}`;

// Map skillRows label → model slot + parser source.
function slotFor(label: string): { slot: SkillSlot; source: SkillSource } | null {
    if (label === 'Active') return { slot: 'active', source: 'active' };
    if (label === 'Charge') return { slot: 'charged', source: 'charge' };
    if (label.startsWith('Passive')) return { slot: 'passive', source: 'passive1' };
    return null;
}

// Map the existing ConditionalCondition / ChargeGain condition into a model Condition.
function toCondition(/* parsed condition fields */): Condition { /* … */ }

function abilitiesFromText(text: string, slot: SkillSlot): Ability[] {
    const out: Ability[] = [];
    // 1. base damage
    const mult = parseSkillDamage(text);
    if (mult > 0) out.push({ id: nextId(), type: 'damage', target: 'enemy', trigger: 'on-cast', conditions: [], config: { type: 'damage', multiplier: mult }, autoFilled: true });
    // 2. additional / secondary damage
    const sec = parseSecondaryDamage(text);
    if (sec) out.push({ id: nextId(), type: 'additional-damage', target: 'enemy', trigger: 'on-cast', conditions: [], config: { type: 'additional-damage', stat: sec.stat, pct: sec.pct }, autoFilled: true });
    // 3. conditional scaling → attach to the base damage ability as a scaling rule
    const cond = parseConditionalDamage(text);
    if (cond && out[0]?.type === 'damage') {
        out[0].conditions = [toCondition(/* cond */)];
        out[0].scaling = { conditionIndex: 0, perUnit: cond.pct, cap: cond.cap };
    }
    // 4. charge gain
    const charge = parseChargeGain(text);
    if (charge) out.push({ id: nextId(), type: 'charge', target: 'self', trigger: 'on-cast', conditions: [toCondition(/* charge.condition */)], config: { type: 'charge', amount: charge.amount }, autoFilled: true });
    // NOTE: buff/debuff/dot abilities are NOT emitted here (see scope revision above).
    //   dot → Task 3b (reuse buildDoTAutoFill); buff/debuff → deferred to Phase 3.
    return out;
}

export function buildShipAbilities(ship: Ship): ShipSkills {
    counter = 0;
    const slots: Skill[] = [];
    for (const row of getShipSkillRows(ship)) {
        const mapped = slotFor(row.label);
        if (!mapped) continue;
        const abilities = abilitiesFromText(row.text, mapped.slot);
        if (abilities.length) slots.push({ slot: mapped.slot, abilities });
    }
    return { slots };
}
```

The `toCondition` mapping translates the existing condition subjects (`self-buff`/`enemy-debuff`/`enemy-buff`/`enemy-type`/`self-crit`/`always`/etc. from `ConditionalCondition` and `ChargeGain.condition`) into the model `Condition` (carry `derivable`, `manualCount`, `requiredEnemyType`). Note: neither `ChargeGain` nor `ConditionalDamage` carries a `buffName` field — so `toCondition` must take the **raw skill text** as a parameter (e.g. `toCondition(condition, derivable, manualCount, rawText)`) and derive `buffName: 'Stealth'` by scanning the text for the keyword. Thread the text through; do not try to read a nonexistent field. Keep it a small pure helper and unit-test it directly if it gets non-trivial.

**Scope note:** `parseConditionalDamage` returns a single `condition`, so auto-fill produces single-condition scaling (`conditions = [toCondition(...)]`, `conditionIndex: 0`). The parser does **not** auto-detect OR-groups — the multi-member `anyOf` group in the `LODOLITE` hand-built fixture is something the user builds in the editor later. Do not over-engineer the regex to produce OR-groups.

- [ ] **Step 4: Run to verify it passes.** Iterate the regex wiring until the Task 3a tests pass. Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts` → PASS.

- [ ] **Step 5: Lint and commit.**

```bash
npm run lint
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat: assemble core abilities from skill text (damage/additional/conditional/charge/buff/debuff/dot)"
```

### Task 3b: New detectors — modifier, multi-hit + DoT abilities

> **Scope revision (during execution):** Task 3b emits **modifier**, **multi-hit (`hits`)**, and **DoT** abilities — the three the Phase 2 simulator actually consumes. **`trigger` and `hp-threshold` auto-detection are deferred to Phase 3**: in the data, triggers (on-crit, start-of-round) and hp-thresholds decorate buff/heal/grant abilities, which are themselves deferred to Phase 3 — so there is nothing in the Phase-1 ability set for a detected trigger/hp-threshold to attach to that the sim consumes. The model fields (`Ability.trigger`, `hp-threshold` condition) already exist from Task 1; only their *parser detection* is deferred.

- **DoT abilities:** reuse `buildDoTAutoFill(ship)` from `skillBuffAutoFill.ts` → active/charged `DoTApplicationEntry[]`; convert each to a `dot` ability (`{ type:'dot', dotType, tier, stacks, duration }`, target `enemy`, `autoFilled:true`) on the matching slot. The name→tier mapping lives in `DOT_TIER_MAP` there — do not reinvent it.
- **multi-hit:** detect "attacks N times … each … M% damage" (Enforcer) → the `damage` ability gets `{ multiplier: M, hits: N }`.
- **modifier:** detect "X% more direct damage" / "increases … by X%" passive auras → a `modifier` ability (`channel` e.g. `outgoingDamage`, `value`, `isMultiplicative:true`, `target` self/all-allies, optional Stealth condition).

- [ ] **Step 1: Write failing tests** for the new dimensions. Use these verified ships/text (pasted exactly from `docs/ship-skills.csv`):
  - **Modifier:** Panguan, passive: "Friendly <unit-aid>Stealthed</unit-aid> units deal 40% more direct damage" → a `modifier` ability, `channel: 'outgoingDamage'`, `value: 40`, `isMultiplicative: true`, `target: 'all-allies'`, gated on ally `Stealth`. (Use Panguan as the primary modifier fixture — it's the clearest "% more output" case. Do NOT derive an HP-aura modifier from Lionheart: its real text is a start-of-combat HP *grant* to adjacent allies, better modeled as a buff/grant; HP-aura detection is deferred.)
  - **Trigger:** Wusheng, passive: "This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging" → a self `buff` ability with `trigger: 'on-crit'`. Chakara ("At the start of the round…") → `trigger: 'start-of-round'`.
  - **HP-threshold:** Makoli, passive: "When directly damaged while below 40% HP, this Unit repairs 20%…" → assert the detected condition `{ subject: 'hp-threshold', hpComparator: 'below', hpPercent: 40 }`. (This sits on a heal/reactive ability that DPS won't simulate — assert only the condition detection, not a damage effect.)
  - **Multi-hit:** Enforcer, active: "This Unit attacks three times with each attack dealing <unit-damage>50% damage</unit-damage>" → a `damage` config `{ multiplier: 50, hits: 3 }`. (Do not use Sansi — it is single-hit; the word "twice" appears in no ship.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Add the new detectors** to `buildShipAbilities.ts` (small focused regex helpers — `detectModifier`, `detectTrigger`, `detectHpThreshold`, `detectHits`). Keep each helper pure and named; wire results into `abilitiesFromText`. Modifiers and triggers are the priority (most ships); hp-threshold and multi-hit are smaller.

- [ ] **Step 4: Run to verify it passes.** Run the full file → PASS.

- [ ] **Step 5: Lint and commit.**

```bash
npm run lint
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat: detect modifier/trigger/hp-threshold/multi-hit abilities from skill text"
```

---

## Task 4: Coverage sanity check (no production code)

**Files:**
- Create: `src/utils/abilities/__tests__/buildShipAbilities.coverage.test.ts`

A guard test that loads a handful of representative ships and asserts the assembler produces non-empty `slots` with no thrown errors — catches regex crashes on odd text. NOT a correctness test (those are Task 3); just a smoke net over breadth.

- [ ] **Step 1: Write the test** — iterate ~8 pasted ship texts (mix of all mechanic types), call `buildShipAbilities`, assert each returns ≥1 slot and every ability has a valid `type`/`target`/`config.type === type`.
- [ ] **Step 2: Run → PASS** (implementation already exists from Task 3).
- [ ] **Step 3: Commit.**

```bash
git add src/utils/abilities/__tests__/buildShipAbilities.coverage.test.ts
git commit -m "test: smoke-coverage for buildShipAbilities across mechanic types"
```

---

## Done criteria (Phase 1)

- `npm test` green; `npm run lint` clean.
- `src/types/abilities.ts`, `evaluateConditions.ts`, `buildShipAbilities.ts` exist with tests.
- No imports from the sim, the DPS page, or any component — Phase 1 changes zero user-facing behavior.
- Fixtures (`abilityFixtures.ts`) ready for Phase 2/3 reuse.

**Next:** Phase 2 plan (`…-phase2-simulator.md`) — refactor `runSinglePass` to walk abilities, with a flat→abilities adapter so the existing `dpsSimulator.test.ts` suite proves identical numbers.
