# Direct Damage Derived Stat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `directDamage` derived autogear stat (attack × crit × crit power × def pen), make derived stats usable as stat *bonuses* rather than priorities only, and show the user what a bonus actually contributes to their ship's score.

**Architecture:** Follows the `effectiveHp` precedent exactly (PR #75). `directDamage` is a computed value resolved on the fly by `resolveLimitStatValue`, never a real gear stat — `StatName` stays untouched so gear rolls, imports and stat display are unaffected. The two stat-bonus readers in `priorityScore.ts` move from a raw `stats[bonus.stat]` index to `resolveLimitStatValue`, which is what makes any derived stat work as a bonus (and brings `effectiveHp` to parity). A pure `previewStatBonus` helper computes the marginal score effect so the form can display it without doing any scoring itself.

**Tech Stack:** TypeScript, React 18, Vitest, Zod, TailwindCSS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-direct-damage-derived-stat-design.md`.
- Branch `feat/direct-damage-derived-stat`, worktree `.claude/worktrees/direct-damage-stat`.
- **Fleet buffs stay real-stats-only.** `fleetBuffSchema` and the fleet-buff legacy normalizer must NOT be widened. A fleet buff models an actual in-game buff on an actual stat.
- **Role base scores are NOT rescaled or normalized.** Additive mode means "this stat contributes X% of its raw value to the score" and that is deliberate. No role formula changes at all — #481 closed no-change and that stands.
- `STAT_NORMALIZERS` and `MULTIPLIER_NORMALIZERS` must stay keyed `Partial<Record<LimitableStat, number>>`. Never `Record<string, number>` — that drops the compile-time key check.
- Stat name is `directDamage`, label `Direct Damage`. (The combat engine uses `directDamage` for non-DoT damage; autogear and the combat simulator are separate systems and this name was chosen deliberately.)
- Use existing components from `src/components/ui/`. Never raw `<button>`; the `card` class is the boxed-content primitive.
- Changelog entries are an area prefix plus 8–12 words. One entry per user-visible change.
- Run a single test file with `npx vitest run <path>`; a single test with `npx vitest run <path> -t "<name>"`. **Never** pass `-u` / `--update`.
- The worktree needs `.env`, `docs/*.json`, `docs/*.csv`, `node_modules` and `.husky/_/husky.sh` to run the suite. These are already in place.

---

### Task 1: The `directDamage` derived stat

**Files:**
- Modify: `src/types/stats.ts:26`
- Modify: `src/utils/autogear/priorityScore.ts:30-35` (`resolveLimitStatValue`), `:53` (`calculateDPS`)
- Modify: `src/constants/stats.ts:130-146`
- Test: `src/utils/autogear/__tests__/directDamageStat.test.ts` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `calculateDirectDamage(stats: BaseStats): number` exported from `src/utils/autogear/priorityScore.ts`; `'directDamage'` as a member of `DerivedStatName`; `STAT_NORMALIZERS.directDamage = 3000`; `DERIVED_STAT_LABELS.directDamage`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/autogear/__tests__/directDamageStat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateDirectDamage, resolveLimitStatValue } from '../priorityScore';
import { STAT_NORMALIZERS, DERIVED_STAT_LABELS, getLimitStatLabel } from '../../../constants/stats';
import type { BaseStats } from '../../../types/stats';

const stats = (over: Partial<BaseStats> = {}): BaseStats => ({
    hp: 100000,
    attack: 8000,
    defence: 5000,
    hacking: 200,
    security: 150,
    crit: 50,
    critDamage: 150,
    speed: 100,
    hpRegen: 0,
    shield: 0,
    healModifier: 0,
    damageReduction: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    ...over,
});

describe('directDamage derived stat', () => {
    it('resolves through resolveLimitStatValue to calculateDirectDamage', () => {
        const s = stats();
        expect(resolveLimitStatValue(s, 'directDamage')).toBe(calculateDirectDamage(s));
    });

    it('is positive for a normal build', () => {
        expect(calculateDirectDamage(stats())).toBeGreaterThan(0);
    });

    // The four ingredients the stat exists to combine.
    it('increases with attack', () => {
        expect(calculateDirectDamage(stats({ attack: 16000 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ attack: 8000 }))
        );
    });

    it('increases with crit rate below the cap', () => {
        expect(calculateDirectDamage(stats({ crit: 90 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ crit: 50 }))
        );
    });

    it('increases with crit power', () => {
        expect(calculateDirectDamage(stats({ critDamage: 200 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ critDamage: 150 }))
        );
    });

    it('increases with defense penetration', () => {
        expect(calculateDirectDamage(stats({ defensePenetration: 41 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ defensePenetration: 0 }))
        );
    });

    // This clamp is the whole reason the stat exists: a raw `crit` bonus keeps paying
    // past 100, where calculateCritMultiplier stops crediting it.
    it('does NOT increase for crit above 100', () => {
        expect(calculateDirectDamage(stats({ crit: 150 }))).toBe(
            calculateDirectDamage(stats({ crit: 100 }))
        );
    });

    it('has a normalizer and a label', () => {
        expect(STAT_NORMALIZERS.directDamage).toBe(3000);
        expect(DERIVED_STAT_LABELS.directDamage.label).toBe('Direct Damage');
        expect(getLimitStatLabel('directDamage')).toBe('Direct Damage');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/autogear/__tests__/directDamageStat.test.ts`
Expected: FAIL — `calculateDirectDamage` is not exported, and TypeScript rejects `'directDamage'` as a `LimitableStat`.

- [ ] **Step 3: Add `directDamage` to the derived stat union**

In `src/types/stats.ts`, replace the `DerivedStatName` declaration:

```ts
// Derived (computed) stats that can be used as autogear *limits* and *bonuses* but are
// not real gear/base stats. Kept out of StatName so gear rolls, imports, and stat
// display are unaffected.
export type DerivedStatName = 'effectiveHp' | 'directDamage';
```

- [ ] **Step 4: Export the composite and resolve it**

In `src/utils/autogear/priorityScore.ts`, add this immediately after `calculateDPS` (which ends at line 77) — `calculateDPS` itself stays private and unchanged:

```ts
/**
 * The offensive twin of `calculateEffectiveHP`: one number combining attack, crit rate,
 * crit power and defense penetration, for use as the `directDamage` derived stat.
 *
 * Deliberately omits `arcaneSiegeMultiplier`. That is gear-set dependent, and a derived
 * stat is resolved from a stat block alone — the same reason `calculateRoleScore` takes no
 * set params.
 */
export function calculateDirectDamage(stats: BaseStats): number {
    return calculateDPS(stats);
}
```

Then extend `resolveLimitStatValue` (currently lines 30-35) to:

```ts
export function resolveLimitStatValue(stats: BaseStats, stat: LimitableStat): number {
    if (stat === 'effectiveHp') {
        return calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0);
    }
    if (stat === 'directDamage') {
        return calculateDirectDamage(stats);
    }
    return stats[stat] || 0;
}
```

`resolveLimitStatValue` is declared above `calculateDPS` in the file; that is fine — these are
function declarations, which hoist.

- [ ] **Step 5: Add the normalizer and label**

In `src/constants/stats.ts`, add to `STAT_NORMALIZERS` (after the `effectiveHp` line):

```ts
    directDamage: 3000, // attack x crit multiplier x def-pen factor; ~the ATTACKER scoring baseline
```

And to `DERIVED_STAT_LABELS`:

```ts
    directDamage: { label: 'Direct Damage', shortLabel: 'DMG' },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/utils/autogear/__tests__/directDamageStat.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. `DERIVED_STAT_LABELS` is a total `Record<DerivedStatName, …>`, so omitting the new key in step 5 would fail here.

- [ ] **Step 8: Commit**

```bash
git add src/types/stats.ts src/utils/autogear/priorityScore.ts src/constants/stats.ts src/utils/autogear/__tests__/directDamageStat.test.ts
git commit -m "feat(autogear): add a directDamage derived stat combining attack, crit and def pen"
```

---

### Task 2: Derived stats work as stat bonuses

**Files:**
- Modify: `src/types/autogear.ts:25-29` (`StatBonus`)
- Modify: `src/utils/autogear/priorityScore.ts:88-95` (`applyAdditiveBonuses`), `:97-110` (`MULTIPLIER_NORMALIZERS` — note it lives HERE, not in `constants/stats.ts`), `:120-125` (`calculateMultiplierFactor` body)
- Test: `src/utils/autogear/__tests__/derivedStatBonuses.test.ts` (create)

**Interfaces:**
- Consumes: `calculateDirectDamage`, `'directDamage'` in `DerivedStatName`, `resolveLimitStatValue` (Task 1).
- Produces: `StatBonus.stat` typed `LimitableStat`; `applyAdditiveBonuses` and `calculateMultiplierFactor` resolving derived stats; `MULTIPLIER_NORMALIZERS` entries for `effectiveHp` (120000) and `directDamage` (6000).

- [ ] **Step 1: Write the failing test**

Create `src/utils/autogear/__tests__/derivedStatBonuses.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculatePriorityScore,
    calculateDirectDamage,
    calculateEffectiveHP,
} from '../priorityScore';
import type { BaseStats } from '../../../types/stats';
import type { StatBonus } from '../../../types/autogear';

const stats = (over: Partial<BaseStats> = {}): BaseStats => ({
    hp: 100000,
    attack: 8000,
    defence: 5000,
    hacking: 200,
    security: 150,
    crit: 50,
    critDamage: 150,
    speed: 100,
    hpRegen: 0,
    shield: 0,
    healModifier: 0,
    damageReduction: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    ...over,
});

const score = (s: BaseStats, bonuses: StatBonus[] = []) =>
    calculatePriorityScore(s, [], 'DEBUFFER_BOMBER', undefined, undefined, bonuses);

describe('derived stats as stat bonuses', () => {
    it('additive mode resolves effectiveHp instead of reading undefined', () => {
        const s = stats();
        const bonus: StatBonus = { stat: 'effectiveHp', percentage: 50, mode: 'additive' };
        const expected = calculateEffectiveHP(s.hp, s.defence, 0) * 0.5;
        expect(applyAdditiveBonuses(s, [bonus])).toBeCloseTo(expected, 6);
        expect(applyAdditiveBonuses(s, [bonus])).toBeGreaterThan(0);
    });

    it('additive mode resolves directDamage', () => {
        const s = stats();
        const bonus: StatBonus = { stat: 'directDamage', percentage: 50, mode: 'additive' };
        expect(applyAdditiveBonuses(s, [bonus])).toBeCloseTo(calculateDirectDamage(s) * 0.5, 6);
    });

    it('multiplier mode resolves derived stats', () => {
        const s = stats();
        expect(
            calculateMultiplierFactor(s, [
                { stat: 'directDamage', percentage: 100, mode: 'multiplier' },
            ])
        ).toBeCloseTo(calculateDirectDamage(s) / 6000, 6);
        expect(
            calculateMultiplierFactor(s, [
                { stat: 'effectiveHp', percentage: 100, mode: 'multiplier' },
            ])
        ).toBeCloseTo(calculateEffectiveHP(s.hp, s.defence, 0) / 120000, 6);
    });

    // THE NON-VACUITY WITNESS for this whole feature. The bomber role formula is
    // hacking x attack and reads no crit at all (#481, closed no-change). Without a
    // directDamage bonus, crit cannot move a bomber's score; with one, it can. If the
    // first assertion ever fails, the role formula changed and this feature's premise
    // is gone — read #481 before "fixing" this test.
    it('lets crit move a DEBUFFER_BOMBER score, which it cannot do unaided', () => {
        const lowCrit = stats({ crit: 10, critDamage: 20 });
        const highCrit = stats({ crit: 100, critDamage: 200 });

        expect(score(highCrit)).toBe(score(lowCrit));

        const bonus: StatBonus[] = [{ stat: 'directDamage', percentage: 100, mode: 'multiplier' }];
        expect(score(highCrit, bonus)).toBeGreaterThan(score(lowCrit, bonus));
    });

    it('leaves a real-stat bonus byte-identical', () => {
        const s = stats();
        expect(applyAdditiveBonuses(s, [{ stat: 'attack', percentage: 20, mode: 'additive' }])).toBe(
            8000 * 0.2
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/autogear/__tests__/derivedStatBonuses.test.ts`
Expected: FAIL — the `effectiveHp`/`directDamage` additive and multiplier cases return 0 (the raw index yields `undefined`), and TypeScript rejects the derived keys on `StatBonus.stat` only after step 3 narrows it.

- [ ] **Step 3: Widen `StatBonus.stat`**

In `src/types/autogear.ts`, replace the `StatBonus` interface:

```ts
export interface StatBonus {
    /** A real `StatName` or a derived stat (`effectiveHp`, `directDamage`) — resolved
     *  through `resolveLimitStatValue`, so a derived stat weighs correctly here. */
    stat: LimitableStat;
    percentage: number;
    mode?: 'additive' | 'multiplier';
}
```

`LimitableStat` is already imported at the top of this file.

- [ ] **Step 4: Route both bonus readers through the resolver**

In `src/utils/autogear/priorityScore.ts`, replace `applyAdditiveBonuses` (lines 88-95):

```ts
export function applyAdditiveBonuses(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 0;
    return statBonuses.reduce((total, bonus) => {
        if (bonus.mode === 'multiplier') return total;
        const statValue = resolveLimitStatValue(stats, bonus.stat);
        return total + statValue * (bonus.percentage / 100);
    }, 0);
}
```

Replace the `MULTIPLIER_NORMALIZERS` declaration and its comment (lines 97-110):

```ts
// Normalizers for multiplier mode so that 50% means roughly
// "this stat weighs about as much as the base role score"
// regardless of the stat's raw value range.
//
// Each entry sits at roughly the stat's GEARED value, not its bare-chassis value
// (attack 10,000 against a bare 6,250; hp 50,000 against a bare 22,000). The two derived
// entries follow the same reading — `statNormalizerReferences.test.ts` pins them.
//
// Keyed `LimitableStat`, not `keyof BaseStats`, so derived stats are expressible. It must
// stay a `Partial<Record<LimitableStat, …>>` — a `Record<string, number>` would drop the
// compile-time key check.
const MULTIPLIER_NORMALIZERS: Partial<Record<LimitableStat, number>> = {
    hp: 50000,
    attack: 10000,
    defence: 7000,
    hacking: 200,
    security: 75,
    crit: 80,
    critDamage: 130,
    speed: 130,
    effectiveHp: 120000,
    directDamage: 6000,
};
```

Replace the body of `calculateMultiplierFactor` (lines 120-125) so the stat read and the
normalizer lookup both accept derived keys:

```ts
    return multiplierBonuses.reduce((total, bonus) => {
        const statValue = resolveLimitStatValue(stats, bonus.stat);
        const normalizer = MULTIPLIER_NORMALIZERS[bonus.stat] || 1;
        return total + (statValue / normalizer) * (bonus.percentage / 100);
    }, 0);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/autogear/__tests__/derivedStatBonuses.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the normalizer tripwire**

Create `src/constants/__tests__/statNormalizerReferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STAT_NORMALIZERS } from '../stats';
import { getScoringBaselineStats, ROLE_BASE_STATS } from '../roleBaseStats';
import { calculateDirectDamage, calculateEffectiveHP } from '../../utils/autogear/priorityScore';

// A normalizer decides how heavily a stat bonus weighs, and stat bonuses ride along in
// SHARED community builds — so a silent change to the crit targets or the defense curve
// would re-weigh every shared build that uses one. These bounds are wide (they are not
// asserting an exact formula) but they fail if a reference moves by more than ~2x, which
// is the point at which a chosen normalizer stops meaning what it was chosen to mean.
describe('derived-stat normalizer references', () => {
    it('directDamage at the ATTACKER scoring baseline stays near its limit normalizer', () => {
        const baseline = getScoringBaselineStats('ATTACKER');
        const value = calculateDirectDamage(baseline);
        // Measured 3,215 on 2026-09-07 against STAT_NORMALIZERS.directDamage = 3000.
        expect(value).toBeGreaterThan(1500);
        expect(value).toBeLessThan(6000);
        expect(STAT_NORMALIZERS.directDamage).toBe(3000);
    });

    it('effectiveHp at the ATTACKER bare chassis stays near its limit normalizer', () => {
        const base = ROLE_BASE_STATS.ATTACKER;
        const value = calculateEffectiveHP(base.hp, base.defence, 0);
        // Measured 52,814 on 2026-09-07 against STAT_NORMALIZERS.effectiveHp = 30000.
        expect(value).toBeGreaterThan(25000);
        expect(value).toBeLessThan(110000);
        expect(STAT_NORMALIZERS.effectiveHp).toBe(30000);
    });
});
```

- [ ] **Step 7: Run the tripwire**

Run: `npx vitest run src/constants/__tests__/statNormalizerReferences.test.ts`
Expected: PASS, 2 tests. If `getScoringBaselineStats` is not exported from
`src/constants/roleBaseStats.ts`, export it — it is already used by `roleSlotCoverage`.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` silent; suite green. Widening `StatBonus.stat` from `string` to `LimitableStat` can surface call sites that passed an arbitrary string — fix any by narrowing the value, never by widening the type back.

- [ ] **Step 9: Commit**

```bash
git add src/types/autogear.ts src/utils/autogear/priorityScore.ts src/utils/autogear/__tests__/derivedStatBonuses.test.ts src/constants/__tests__/statNormalizerReferences.test.ts
git commit -m "feat(autogear): let derived stats be used as stat bonuses, not just requirements"
```

---

### Task 3: Sharing and validation accept derived bonus stats

**Files:**
- Modify: `src/schemas/sharedAutogearBuild.ts:95-99` (`statBonusSchema`)
- Modify: `src/utils/communityBuild.ts:96-97` (index doc), `:150-165` (`normalizeLegacyStatBonuses`)
- Test: `src/utils/__tests__/derivedStatBonusSharing.test.ts` (create)

**Interfaces:**
- Consumes: `'directDamage'` in `DerivedStatName` (Task 1); `StatBonus.stat: LimitableStat` (Task 2).
- Produces: shared builds that round-trip a derived-stat bonus. No new exports.

- [ ] **Step 1: Write the failing test**

`validateSharedAutogearBuild` returns `SharedAutogearBuild | null` — NOT a
`{ success }` result object. Create `src/utils/__tests__/derivedStatBonusSharing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSharedAutogearBuild } from '../../schemas/sharedAutogearBuild';

const build = (over: Record<string, unknown> = {}) => ({
    shipRole: 'DEBUFFER_BOMBER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    ...over,
});

describe('derived stats in shared builds', () => {
    it('accepts a directDamage stat BONUS', () => {
        expect(
            validateSharedAutogearBuild(
                build({
                    statBonuses: [{ stat: 'directDamage', percentage: 60, mode: 'multiplier' }],
                })
            )
        ).not.toBeNull();
    });

    it('accepts an effectiveHp stat BONUS', () => {
        expect(
            validateSharedAutogearBuild(
                build({ statBonuses: [{ stat: 'effectiveHp', percentage: 40, mode: 'additive' }] })
            )
        ).not.toBeNull();
    });

    // Fleet buffs model a real in-game buff on a real stat. There is no fleet buff of
    // "direct damage", and widening them was explicitly out of scope.
    it('REJECTS a directDamage FLEET BUFF', () => {
        expect(
            validateSharedAutogearBuild(
                build({ fleetBuffs: [{ stat: 'directDamage', percentage: 30 }] })
            )
        ).toBeNull();
    });

    it('still rejects a nonsense bonus stat', () => {
        expect(
            validateSharedAutogearBuild(
                build({ statBonuses: [{ stat: 'notAStat', percentage: 10 }] })
            )
        ).toBeNull();
    });
});
```

Run the full build shape past the schema first if the accept cases fail for an unrelated
missing field: `grep -n "sharedAutogearBuildSchema" -A 20 src/schemas/sharedAutogearBuild.ts`
lists every required key, and `build()` above must satisfy all of them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/derivedStatBonusSharing.test.ts`
Expected: FAIL on the two accept cases (they return `null` — `statBonusSchema` still uses
`statNameSchema`, which rejects derived keys). The two reject cases should already pass.

- [ ] **Step 3: Write the legacy-label test**

`normalizeLegacyStatBonuses` is module-private and reached through `toCommunityBuild(row)`,
which takes a `CommunityRecommendation` database row. Follow the fixture pattern in
`src/utils/__tests__/communityBuildLegacyShapes.test.ts` — read its `makeRow` helper and copy
it, since it reproduces shapes verified against real production rows.

Append to `src/utils/__tests__/derivedStatBonusSharing.test.ts`:

```ts
import { toCommunityBuild } from '../communityBuild';
import type { CommunityRecommendation } from '../../types/communityRecommendation';

// Copy makeRow from communityBuildLegacyShapes.test.ts verbatim, then override per test.
const makeRow = (over: Partial<CommunityRecommendation> = {}): CommunityRecommendation => ({
    id: 'r1',
    ship_name: 'Demolisher',
    ship_refit_level: 3,
    title: 'DEBUFFER (Bomber) Build',
    is_implant_specific: false,
    ship_role: 'DEBUFFER_BOMBER',
    stat_priorities: [{ stat: 'hacking', minLimit: 100 }],
    stat_bonuses: [{ stat: 'attack', percentage: 30 }],
    set_priorities: [{ setName: 'CRITICAL', count: 4 }],
    upvotes: 0,
    downvotes: 0,
    total_votes: 0,
    score: 0,
    ...over,
});

describe('legacy label recovery for derived bonus stats', () => {
    it("resolves a bonus recorded as the display label 'Direct Damage'", () => {
        const built = toCommunityBuild(
            makeRow({
                stat_bonuses: [{ stat: 'Direct Damage', percentage: 60, mode: 'multiplier' }],
            } as Partial<CommunityRecommendation>)
        );
        expect(built).not.toBeNull();
        expect(built!.statBonuses[0].stat).toBe('directDamage');
    });

    it('still resolves a legacy real-stat label', () => {
        const built = toCommunityBuild(
            makeRow({ stat_bonuses: [{ stat: 'crit rate', percentage: 20 }] } as Partial<CommunityRecommendation>)
        );
        expect(built).not.toBeNull();
        expect(built!.statBonuses[0].stat).toBe('crit');
    });
});
```

If `makeRow` above is missing a required `CommunityRecommendation` field, copy the helper from
`communityBuildLegacyShapes.test.ts` exactly rather than inventing fields.

Run: `npx vitest run src/utils/__tests__/derivedStatBonusSharing.test.ts`
Expected: the `'Direct Damage'` case FAILS (the bonus normalizer still uses the real-stat-only
index, so the label does not resolve and the row is dropped or the raw string survives). The
`'crit rate'` case should already pass.

- [ ] **Step 4: Widen only the bonus schema**

In `src/schemas/sharedAutogearBuild.ts`, change the doc comments and `statBonusSchema`. Leave
`fleetBuffSchema` exactly as it is:

```ts
/** Real gear/base stats — valid for fleet buffs, which model an actual in-game buff on an
 *  actual stat. NOT used for stat bonuses; those accept derived stats too. */
const statNameSchema = z.string().refine((v) => isKeyOf(STATS, v), { message: 'Unknown stat' });

/** Base stats plus derived stats (effectiveHp, directDamage) — valid for stat priorities
 *  AND stat bonuses. A strict superset of statNameSchema, so widening a field to this
 *  never invalidates previously-stored data. */
const limitableStatSchema = z
    .string()
    .refine((v) => isKeyOf(STATS, v) || isKeyOf(DERIVED_STAT_LABELS, v), {
        message: 'Unknown limit stat',
    });
```

```ts
const statBonusSchema = z.object({
    stat: limitableStatSchema,
    percentage: boundedNumberSchema,
    mode: z.enum(['additive', 'multiplier']).optional(),
});
```

- [ ] **Step 5: Route the legacy bonus normalizer to the derived index**

In `src/utils/communityBuild.ts`, update the two index doc comments (lines ~96-97):

```ts
/** Valid for fleet buffs — real `StatName`s only. */
const STAT_NAME_INDEX = buildReverseStatIndex(STAT_NAME_ENTRIES);
/** Valid for stat priorities and stat bonuses — `StatName`s plus derived stats. */
const LIMITABLE_STAT_INDEX = buildReverseStatIndex([...STAT_NAME_ENTRIES, ...DERIVED_STAT_ENTRIES]);
```

Then in `normalizeLegacyStatBonuses`, change the final return so a bonus recorded with a
display label (`'Direct Damage'`) resolves to the key:

```ts
        return { ...rest, stat: resolveLegacyStat(stat, LIMITABLE_STAT_INDEX, isLimitableStatKey) };
```

Leave the fleet-buff normalizer on `STAT_NAME_INDEX` / `isStatNameKey`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/derivedStatBonusSharing.test.ts src/utils/__tests__/communityBuild.test.ts src/utils/__tests__/communityBuildLegacyShapes.test.ts`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/sharedAutogearBuild.ts src/utils/communityBuild.ts src/utils/__tests__/derivedStatBonusSharing.test.ts
git commit -m "feat(autogear): accept derived stats in shared build stat bonuses"
```

---

### Task 4: `calculateRoleScore` accepts bonuses, and `previewStatBonus`

**Files:**
- Modify: `src/utils/autogear/priorityScore.ts:507` (`calculateRoleScore`)
- Modify: `src/utils/autogear/scoring.ts:12-35` (barrel import + export blocks)
- Test: `src/utils/autogear/__tests__/previewStatBonus.test.ts` (create)

**Interfaces:**
- Consumes: `resolveLimitStatValue`, derived stats (Tasks 1-2).
- Produces:
  - `calculateRoleScore(role: ShipTypeName, stats: BaseStats, statBonuses?: StatBonus[]): number`
  - `interface StatBonusPreview { statValue: number; baseScore: number; newScore: number; applies: boolean }`
  - `previewStatBonus(stats: BaseStats, role: ShipTypeName | null, bonus: StatBonus, otherBonuses?: StatBonus[]): StatBonusPreview`
  - Both re-exported from `src/utils/autogear/scoring.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/autogear/__tests__/previewStatBonus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateRoleScore, previewStatBonus } from '../priorityScore';
import { SHIP_TYPES } from '../../../constants';
import type { ShipTypeName } from '../../../constants';
import type { BaseStats } from '../../../types/stats';
import type { StatBonus } from '../../../types/autogear';

const stats: BaseStats = {
    hp: 100000,
    attack: 8000,
    defence: 5000,
    hacking: 200,
    security: 150,
    crit: 50,
    critDamage: 150,
    speed: 100,
    hpRegen: 0,
    shield: 0,
    healModifier: 0,
    damageReduction: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
};

const roles = Object.keys(SHIP_TYPES) as ShipTypeName[];

describe('calculateRoleScore bonus passthrough', () => {
    // The widening must be additive: every existing two-argument caller keeps its number.
    it('is unchanged for every role when no bonuses are passed', () => {
        for (const role of roles) {
            expect(calculateRoleScore(role, stats, [])).toBe(calculateRoleScore(role, stats));
            expect(calculateRoleScore(role, stats, undefined)).toBe(
                calculateRoleScore(role, stats)
            );
        }
    });

    it('applies a bonus for every role that scores at all', () => {
        const bonus: StatBonus[] = [{ stat: 'directDamage', percentage: 100, mode: 'multiplier' }];
        for (const role of roles) {
            const bare = calculateRoleScore(role, stats);
            if (bare <= 0) continue;
            expect(calculateRoleScore(role, stats, bonus)).toBeGreaterThan(bare);
        }
    });
});

describe('previewStatBonus', () => {
    const bonus: StatBonus = { stat: 'directDamage', percentage: 100, mode: 'multiplier' };

    it('reports the resolved value of a derived stat', () => {
        const preview = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus);
        expect(preview.statValue).toBeGreaterThan(0);
    });

    it('newScore exceeds baseScore for a bonus that does something', () => {
        const preview = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus);
        expect(preview.applies).toBe(true);
        expect(preview.newScore).toBeGreaterThan(preview.baseScore);
    });

    it('reports the MARGINAL effect — baseScore already includes the other bonuses', () => {
        const other: StatBonus[] = [{ stat: 'hp', percentage: 30, mode: 'multiplier' }];
        const alone = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus, []);
        const withOther = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus, other);

        expect(withOther.baseScore).toBeGreaterThan(alone.baseScore);
        expect(withOther.baseScore).toBe(calculateRoleScore('DEBUFFER_BOMBER', stats, other));
        expect(withOther.newScore).toBe(
            calculateRoleScore('DEBUFFER_BOMBER', stats, [...other, bonus])
        );
    });

    it('works for additive mode too', () => {
        const additive: StatBonus = { stat: 'attack', percentage: 50, mode: 'additive' };
        const preview = previewStatBonus(stats, 'ATTACKER', additive);
        expect(preview.statValue).toBe(8000);
        expect(preview.newScore - preview.baseScore).toBeCloseTo(8000 * 0.5, 6);
    });

    // calculatePriorityScore only applies stat bonuses inside the ROLE formulas; with no
    // role it falls through to calculateDefaultScore, which takes no bonuses at all. So a
    // bonus is genuinely inert in manual mode and the UI must not imply otherwise.
    it('reports applies=false when no role is selected', () => {
        const preview = previewStatBonus(stats, null, bonus);
        expect(preview.applies).toBe(false);
        expect(preview.statValue).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/autogear/__tests__/previewStatBonus.test.ts`
Expected: FAIL — `previewStatBonus` is not exported and `calculateRoleScore` takes two arguments.

- [ ] **Step 3: Widen `calculateRoleScore`**

In `src/utils/autogear/priorityScore.ts`, replace `calculateRoleScore` entirely. Note the
three different parameter orders among the role helpers — the `setCount`-taking ones need an
explicit `undefined` in the middle:

```ts
export function calculateRoleScore(
    role: ShipTypeName,
    stats: BaseStats,
    statBonuses?: StatBonus[]
): number {
    switch (role) {
        case 'ATTACKER':
            return calculateAttackerScore(stats, statBonuses);
        case 'DEFENDER':
            return calculateDefenderScore(stats, statBonuses);
        case 'DEFENDER_SECURITY':
            return calculateDefenderSecurityScore(stats, statBonuses);
        case 'DEBUFFER':
            return calculateDebufferScore(stats, statBonuses);
        case 'DEBUFFER_DEFENSIVE':
            return calculateDefensiveDebufferScore(stats, statBonuses);
        case 'DEBUFFER_DEFENSIVE_SECURITY':
            return calculateDefensiveSecurityDebufferScore(stats, statBonuses);
        case 'DEBUFFER_BOMBER':
            return calculateBomberDebufferScore(stats, statBonuses);
        case 'DEBUFFER_CORROSION':
            return calculateCorrosionDebufferScore(stats, undefined, statBonuses);
        case 'SUPPORTER':
            return calculateHealerScore(stats, statBonuses);
        case 'SUPPORTER_BUFFER':
            return calculateBufferScore(stats, undefined, statBonuses);
        case 'SUPPORTER_OFFENSIVE':
            return calculateOffensiveSupporterScore(stats, undefined, statBonuses);
        case 'SUPPORTER_SHIELD':
            return calculateShieldSupporterScore(stats, undefined, statBonuses);
        default:
            return 0;
    }
}
```

Keep the existing docstring above it, and add one line to it:

```
 * `statBonuses` pass through to the role formula. Set-bonus params (setCount,
 * arcaneSiegeMultiplier) stay omitted — those are gear-set composition, which is out of
 * scope here; stat bonuses are not set-dependent.
```

- [ ] **Step 4: Add `previewStatBonus`**

Append to `src/utils/autogear/priorityScore.ts`:

```ts
export interface StatBonusPreview {
    /** The bonus stat's value on these stats — derived stats resolved, not indexed. */
    statValue: number;
    /** Role score with `otherBonuses` applied and this bonus absent. */
    baseScore: number;
    /** Role score with `otherBonuses` AND this bonus applied. */
    newScore: number;
    /** False when no role is selected. `calculatePriorityScore` applies stat bonuses only
     *  inside the role formulas — with no role it uses `calculateDefaultScore`, which takes
     *  none — so a bonus really does nothing in manual mode. */
    applies: boolean;
}

/**
 * What one stat bonus contributes to a ship's score, for display beside the bonus form.
 *
 * The figures are MARGINAL: `baseScore` already includes `otherBonuses`, so the delta is
 * the effect of the bonus being edited rather than of the whole set. Role base scores span
 * orders of magnitude (an attacker's is ~3,000 while a bomber's is ~1,250,000), which is why
 * the same percentage behaves so differently and why this is worth showing rather than
 * normalizing away.
 */
export function previewStatBonus(
    stats: BaseStats,
    role: ShipTypeName | null,
    bonus: StatBonus,
    otherBonuses: StatBonus[] = []
): StatBonusPreview {
    const statValue = resolveLimitStatValue(stats, bonus.stat);
    if (!role) {
        return { statValue, baseScore: 0, newScore: 0, applies: false };
    }
    return {
        statValue,
        baseScore: calculateRoleScore(role, stats, otherBonuses),
        newScore: calculateRoleScore(role, stats, [...otherBonuses, bonus]),
        applies: true,
    };
}
```

- [ ] **Step 5: Re-export from the barrel**

In `src/utils/autogear/scoring.ts`, add `calculateRoleScore` and `previewStatBonus` to BOTH
the import block (lines 12-22) and the export block (lines 25-35). `GeneticStrategy` imports
scoring helpers from this barrel, not from `priorityScore` directly, so a helper missing here
is unreachable for the strategies.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/autogear/__tests__/previewStatBonus.test.ts src/utils/autogear/__tests__/calculateRoleScore.test.ts`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/priorityScore.ts src/utils/autogear/scoring.ts src/utils/autogear/__tests__/previewStatBonus.test.ts
git commit -m "feat(autogear): add previewStatBonus and let calculateRoleScore take bonuses"
```

---

### Task 5: The bonus form offers derived stats

**Files:**
- Modify: `src/components/autogear/StatBonusForm.tsx:20` (state type), `:62-70` (`Select`)
- Modify: `src/components/autogear/StatBonusRow.tsx:63`
- Test: `src/components/autogear/__tests__/StatBonusForm.test.tsx` (create)

**Interfaces:**
- Consumes: `'directDamage'` in `DerivedStatName` (Task 1); `StatBonus.stat: LimitableStat` (Task 2); `getLimitStatLabel` (existing).
- Produces: a form whose stat `Select` lists derived stats; rows that label them.

- [ ] **Step 1: Write the failing test**

Create `src/components/autogear/__tests__/StatBonusForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatBonusForm } from '../StatBonusForm';

describe('StatBonusForm', () => {
    it('offers the derived stats alongside real ones', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        const select = screen.getByLabelText('Stat') as HTMLSelectElement;
        const values = Array.from(select.options).map((o) => o.value);
        expect(values).toContain('attack');
        expect(values).toContain('directDamage');
        expect(values).toContain('effectiveHp');
    });

    it('labels the derived stats', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        const select = screen.getByLabelText('Stat') as HTMLSelectElement;
        const labels = Array.from(select.options).map((o) => o.textContent);
        expect(labels).toContain('Direct Damage');
        expect(labels).toContain('Effective HP');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/StatBonusForm.test.tsx`
Expected: FAIL — `directDamage` and `effectiveHp` are absent from the options.

If `getByLabelText('Stat')` does not resolve, inspect how `src/components/ui` `Select`
associates its label and match the query used in
`src/components/autogear/__tests__/AutogearQuickSettings.test.tsx`.

- [ ] **Step 3: Offer derived stats in the form**

In `src/components/autogear/StatBonusForm.tsx`:

Replace the stats import and add the derived list:

```tsx
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { DERIVED_STAT_LABELS, getLimitStatLabel } from '../../constants/stats';
import { LimitableStat } from '../../types/stats';

/** Real stats first, then the derived composites. Same list the stat-priority form offers,
 *  so the two surfaces stay consistent. */
const BONUS_STATS: LimitableStat[] = [
    ...ALL_STAT_NAMES,
    ...(Object.keys(DERIVED_STAT_LABELS) as Array<keyof typeof DERIVED_STAT_LABELS>),
];
```

Change the state declaration (line 20) from `StatName | ''` to:

```tsx
    const [selectedStat, setSelectedStat] = useState<LimitableStat | ''>('');
```

And the `editingValue` effect's cast, from `editingValue.stat as StatName` to
`editingValue.stat`.

Replace the `Select` options and `onChange`:

```tsx
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    options={BONUS_STATS.map((key) => ({
                        value: key,
                        label: getLimitStatLabel(key),
                    }))}
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as LimitableStat)}
                    noDefaultSelection
                />
```

`STATS` may now be unused in this file — if so remove it from the import, since lint runs
with `--max-warnings 0`.

- [ ] **Step 4: Label derived stats in the row**

In `src/components/autogear/StatBonusRow.tsx`, replace the `STATS` import with
`getLimitStatLabel` and drop the now-unused `StatName` import:

```tsx
import { getLimitStatLabel } from '../../constants/stats';
```

Replace line 63:

```tsx
                {getLimitStatLabel(bonus.stat)} ({' '}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/autogear/__tests__/StatBonusForm.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: both silent.

- [ ] **Step 7: Commit**

```bash
git add src/components/autogear/StatBonusForm.tsx src/components/autogear/StatBonusRow.tsx src/components/autogear/__tests__/StatBonusForm.test.tsx
git commit -m "feat(autogear): offer Direct Damage and Effective HP in the stat bonus form"
```

---

### Task 6: The contribution preview

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx` (add a `useMemo` for the selected ship's stats; pass it to `AutogearSettingsModal`)
- Modify: `src/components/autogear/AutogearSettingsModal.tsx:13-14` (props) — it spreads `settingsProps` into `AutogearSettings`
- Modify: `src/components/autogear/AutogearSettings.tsx:59-61` (props), `:964` (`StatBonusForm` usage)
- Modify: `src/components/autogear/StatBonusForm.tsx` (accept and render the preview)
- Test: `src/components/autogear/__tests__/StatBonusForm.test.tsx` (extend)

**Interfaces:**
- Consumes: `previewStatBonus`, `StatBonusPreview` (Task 4); the form from Task 5.
- Produces: `StatBonusForm` prop `previewFor?: (bonus: StatBonus) => StatBonusPreview`.

The form receives a **function**, not numbers: the preview must update as the user types, and
only the form knows the in-progress stat/percentage/mode. The scoring still happens outside
the component, in `previewStatBonus`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/autogear/__tests__/StatBonusForm.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';
import type { StatBonusPreview } from '../../../utils/autogear/priorityScore';

describe('StatBonusForm contribution preview', () => {
    const previewFor = (): StatBonusPreview => ({
        statValue: 22000,
        baseScore: 3215,
        newScore: 7615,
        applies: true,
    });

    it('shows nothing before a stat is chosen', () => {
        render(<StatBonusForm onAdd={vi.fn()} previewFor={previewFor} />);
        expect(screen.queryByTestId('stat-bonus-preview')).toBeNull();
    });

    it('shows the base score and the resulting score once a stat is chosen', () => {
        render(<StatBonusForm onAdd={vi.fn()} previewFor={previewFor} />);
        fireEvent.change(screen.getByLabelText('Stat'), { target: { value: 'hp' } });

        const preview = screen.getByTestId('stat-bonus-preview');
        expect(preview.textContent).toContain('3,215');
        expect(preview.textContent).toContain('7,615');
    });

    it('warns instead of showing numbers when the bonus cannot apply', () => {
        const inert = (): StatBonusPreview => ({
            statValue: 22000,
            baseScore: 0,
            newScore: 0,
            applies: false,
        });
        render(<StatBonusForm onAdd={vi.fn()} previewFor={inert} />);
        fireEvent.change(screen.getByLabelText('Stat'), { target: { value: 'hp' } });

        const preview = screen.getByTestId('stat-bonus-preview');
        expect(preview.textContent).toMatch(/role/i);
    });

    it('renders no preview block when no previewFor is supplied', () => {
        render(<StatBonusForm onAdd={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Stat'), { target: { value: 'hp' } });
        expect(screen.queryByTestId('stat-bonus-preview')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/StatBonusForm.test.tsx`
Expected: FAIL — `previewFor` is not a prop and no `stat-bonus-preview` element exists.

- [ ] **Step 3: Render the preview in the form**

In `src/components/autogear/StatBonusForm.tsx`, add to `StatBonusFormProps`:

```tsx
    /** Computes what the in-progress bonus contributes. Omitted when no ship is selected,
     *  in which case no preview renders. */
    previewFor?: (bonus: StatBonus) => StatBonusPreview;
```

Import the type:

```tsx
import type { StatBonusPreview } from '../../utils/autogear/priorityScore';
```

Compute it inside the component, after the existing state declarations:

```tsx
    // Capture the narrowed stat alongside the preview. Inside the JSX guard below,
    // TypeScript cannot re-narrow `selectedStat` away from `LimitableStat | ''` from the
    // `preview` check alone, so the label render needs this instead of the state value.
    const previewStat: LimitableStat | null = selectedStat || null;
    const preview =
        previewFor && previewStat
            ? previewFor({ stat: previewStat, percentage: percentage || 0, mode })
            : null;
```

Render it directly after the Mode block's closing `</div>`, before the submit buttons:

```tsx
            {preview && (
                <div className="card text-xs space-y-1" data-testid="stat-bonus-preview">
                    {preview.applies ? (
                        <>
                            <div className="flex justify-between gap-4">
                                <span className="text-theme-text-secondary">
                                    This ship&apos;s score
                                </span>
                                <span>{Math.round(preview.baseScore).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-theme-text-secondary">
                                    {previewStat && getLimitStatLabel(previewStat)}{' '}
                                    {Math.round(preview.statValue).toLocaleString()} ×{' '}
                                    {percentage || 0}%
                                </span>
                                <span>
                                    {preview.newScore >= preview.baseScore ? '+' : ''}
                                    {Math.round(
                                        preview.newScore - preview.baseScore
                                    ).toLocaleString()}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-dark-border pt-1">
                                <span className="text-theme-text-secondary">Resulting score</span>
                                <span>{Math.round(preview.newScore).toLocaleString()}</span>
                            </div>
                        </>
                    ) : (
                        <p className="text-theme-text-secondary">
                            Stat bonuses only apply when a role is selected — without one, scoring
                            uses your stat priorities and ignores bonuses.
                        </p>
                    )}
                </div>
            )}
```

`card` is a CSS class, not a component — it is the project's boxed-content primitive.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/autogear/__tests__/StatBonusForm.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit the form half**

```bash
git add src/components/autogear/StatBonusForm.tsx src/components/autogear/__tests__/StatBonusForm.test.tsx
git commit -m "feat(autogear): preview what a stat bonus adds to a ship's score"
```

- [ ] **Step 6: Thread the preview through the page**

In `src/pages/manager/AutogearPage.tsx`, add near the other derived values (after
`getGearPiece` at line 120 and `getEngineeringStatsForShipType` at line 132 are in scope):

```tsx
    const selectedShipStats = useMemo(() => {
        if (!selectedShip) return null;
        return calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type),
            selectedShip.id
        ).final;
    }, [selectedShip, getGearPiece, getEngineeringStatsForShipType]);
```

Confirm the local variable holding the selected ship — `grep -n "selectedShip" src/pages/manager/AutogearPage.tsx | head` — and use that name. Ensure `useMemo` is imported from
`react`.

Pass it to the modal alongside the existing settings props:

```tsx
                    selectedShipStats={selectedShipStats}
```

- [ ] **Step 7: Accept it in the modal and settings**

In `src/components/autogear/AutogearSettingsModal.tsx`, add to the props interface (beside
`selectedShip` / `selectedShipRole` at lines 13-14):

```tsx
    selectedShipStats: BaseStats | null;
```

Import `BaseStats` from `../../types/stats`. It already spreads `{...settingsProps}` into
`AutogearSettings`, so no other change is needed there.

In `src/components/autogear/AutogearSettings.tsx`, add the same prop to
`AutogearSettingsProps`, then build the callback and pass it to the form at line 964:

```tsx
                                <StatBonusForm
                                    previewFor={
                                        selectedShipStats
                                            ? (bonus) =>
                                                  previewStatBonus(
                                                      selectedShipStats,
                                                      selectedShipRole,
                                                      bonus,
                                                      statBonuses.filter(
                                                          (_, i) => i !== tweakView.editIndex
                                                      )
                                                  )
                                            : undefined
                                    }
                                    onAdd={(b) => {
```

The `filter` excludes the bonus being edited from `otherBonuses`, which is what makes the
delta marginal rather than double-counting an edit. Import `previewStatBonus` from
`../../utils/autogear/scoring`.

- [ ] **Step 8: Verify in the app**

Run: `npm start` (dev server on port 3000 — `npm start`, not `run dev`)
Open the Autogear page, select a ship, give it a role, open Settings → Tweaks → add a stat
bonus. Confirm: choosing a stat shows the three-row preview; the delta changes as the
percentage changes; switching Additive/Multiplier changes the delta. Compare an ATTACKER
against a DEBUFFER_BOMBER — the same percentage should read as decisive on one and negligible
on the other. That contrast is the feature.

**The `applies: false` warning cannot be reached from this screen** and must not be listed as
something to verify here: the whole Tweaks panel is gated on a role being selected
(`AutogearSettings.tsx`), so clearing the role unmounts the form rather than showing the
warning. The branch stays as a correct contract for the form as a reusable component —
`previewStatBonus` accepts `role: null` and returns zeros, so a future caller without the
branch would render "score 0 → 0", which is wrong rather than merely absent. It is covered by
a unit test, not by this manual pass.

- [ ] **Step 9: Lint, typecheck, full suite**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx src/components/autogear/AutogearSettingsModal.tsx src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): wire the stat bonus preview to the selected ship"
```

---

### Task 7: Documentation and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

**Interfaces:**
- Consumes: everything above. Produces nothing consumed by later tasks.

- [ ] **Step 1: Find the autogear docs section**

Run: `grep -n "stat bonus\|Stat Bonus\|Effective HP" src/pages/DocumentationPage.tsx`
Read the surrounding section and match its existing prose style and components.

- [ ] **Step 2: Document the new stat**

Add to that section, in the page's existing voice and markup:

- **Direct Damage** — one figure combining attack, crit rate, crit power and defense
  penetration. Use it when a ship's damage genuinely depends on crit but its role formula
  does not read crit; bombers are the motivating case, and which bombers want crit varies by
  kit.
- Derived stats (Direct Damage, Effective HP) can be used as stat **bonuses** as well as
  requirements.
- Stat bonuses need a **role** selected; without one, scoring uses stat priorities only.
- Role scores differ hugely in magnitude, so the form previews what a bonus actually adds.

- [ ] **Step 3: Add the changelog entries**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` — 8-12 words each, no mechanism,
no before-state:

```ts
    'Autogear: new Direct Damage stat weighs attack, crit, crit power and defense penetration together.',
    'Autogear: Effective HP can now be used as a stat bonus, not just a requirement.',
    "Autogear: stat bonuses now preview what they add to a ship's score.",
```

Note the third entry uses DOUBLE quotes because it contains an apostrophe — that is the
existing convention in this array (see the neighbouring `"Upgrade analysis: excess crit rate
no longer inflates a piece's value."`). Never an HTML entity: this is a TS string, not JSX.

- [ ] **Step 4: Verify the docs page renders**

Run: `npx vitest run src/pages/__tests__ -t "Documentation"`
If no such test exists, run `npm run lint && npx tsc --noEmit` instead and check the page in
the dev server.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs(autogear): document Direct Damage and derived stat bonuses"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| `directDamage` stat, resolver, label, limit normalizer | 1 |
| Derived stats on the bonus surface; `MULTIPLIER_NORMALIZERS` widening + both entries | 2 |
| Normalizer values pinned by a tripwire | 2 (steps 6-7) |
| Fleet buffs stay real-stats-only | 3 (asserted by a rejection test) |
| Sharing/validation widening, legacy label recovery | 3 |
| `calculateRoleScore` widening; `previewStatBonus` | 4 |
| Form offers derived stats; row labels them | 5 |
| Live marginal contribution preview | 6 |
| Docs + changelog | 7 |
| Fast-scoring path needs no change | none needed — `fastScore` delegates to `calculatePriorityScore`; Task 2 step 8 runs the full suite, which covers the fast-path equivalence tests |
| Role base scores NOT rescaled | Global Constraints; no task touches a role formula |

**Deviation from the spec, deliberate:** the spec proposed passing computed numbers to the
form. The plan passes a `previewFor` callback instead, because the preview must track the
in-progress stat/percentage/mode which only the form holds. The scoring still lives in
`previewStatBonus`, outside the component, so the spec's testability goal is preserved.

**Addition not in the spec:** `StatBonusPreview.applies`. While planning it turned out that
`calculatePriorityScore` applies stat bonuses only inside the role formulas — with no role it
uses `calculateDefaultScore`, which takes no bonuses — so a bonus is genuinely inert in manual
mode. The preview reports this rather than showing a misleading zero.
