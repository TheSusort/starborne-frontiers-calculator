# Autogear Off-Formula Scaling Stats Implementation Plan (#544)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For the 47 ships whose kit produces damage, repairs or shields from a stat their role's
formula ignores, derive the ship's real scoring equation from its parsed kit, show it, and let the
player apply and edit it.

**Architecture:** A core formula row gains an optional `basis` — the weighted list of stats feeding
the derived stat's primary factor, in the game's own multiplier units. A pure derivation module
reads that basis off `buildShipAbilities`, weighting the active and charged slots by cast
frequency. The existing detection notice gains the derived basis and an Apply control; the existing
custom-formula editor gains basis editing. No simulation runs at scoring time.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest. Branch `feat/autogear-sim-rerank`
(PR #541, draft) — this work builds on top of it and the combined branch merges together.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-18-autogear-role-objective-tuning-design.md`. Read it
  before Task 3; it holds the measured evidence behind every number in this plan.
- **Execution PAUSES at the Stage 2 checkpoint** for the repo owner to test in a browser as a real
  user. Do not begin Stage 3 until they report back.
- Use existing UI components from `src/components/ui/` — never raw `<button>`, never a hand-rolled
  card (use the `card` class), never a custom modal.
- No emojis in UI text; plain text plus colour classes.
- Changelog entries go in `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, area prefix plus
  8-12 words, one entry per user-visible change.
- `npm start` runs the dev server on port 3000. Never `npm run dev`. Never `vitest -u`.
- **Spelling trap:** `additional-damage.stat` and `heal`/`shield`.`basis` use American `'defense'`,
  while `BaseStats` and `StatPriority.stat` use British `'defence'`. Every comparison must
  normalise. `types/abilities.ts:722-726` documents this. `offFormulaStats.ts` already holds the
  `normalise` idiom — reuse it, do not re-derive it.
- **Weights are in multiplier units divided by 100.** A 200% attack skill is `weight: 2.0`. A 25%
  of max HP clause is `weight: 0.25`. These are the game's own numbers, and the whole point is that
  they are transcribed rather than tuned.
- **A basis is a property of a formula ROW, not of a stat.** `resolveLimitStatValue` as used by
  `StatPriority` limits and `StatBonus` must NOT gain a basis parameter. `directDamage` as a limit
  stat stays attack-only.
- Never `git add -A` or `git add .`. `docs/` is gitignored — plan and spec need `git add -f`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types/autogear.ts` | `CustomFormulaRow.basis` — the shape. |
| `src/utils/autogear/statResolution.ts` | `calculateDirectDamage` / `calculateEffectiveHP` accept an optional basis for their primary factor. |
| `src/utils/autogear/customFormula.ts` | Passes a row's basis to the resolver; validates a persisted basis. |
| `src/utils/autogear/simRerank/basisDerivation.ts` | **New.** Charge period, slot weighting, shield chain, passive exclusion. Pure. |
| `src/utils/autogear/simRerank/offFormulaStats.ts` | Detector. Gains the shield-chain coefficient alongside the lever stat. |
| `src/components/autogear/OffFormulaNotice.tsx` | Shows the derived basis, names excluded carriers, carries Apply. |
| `src/components/autogear/CustomFormulaRow.tsx` | Renders a core row's basis terms. |
| `src/components/autogear/CustomFormulaForm.tsx` | Edits basis terms. |
| `src/types/communityRecommendation.ts` | `SharedAutogearBuild` gains `customFormula` + nullable role. |

---

# STAGE 1 — Detection only — SHIPPED

`offFormulaStats.ts` (detector, three carriers, aggregate-term rule) and `OffFormulaNotice.tsx`
(mounted in `AutogearSettings` above `SimRerankSection`) are on the branch and were verified in a
browser by the repo owner. **Do not re-implement them.** Task 5 modifies the notice; Task 4
extends the detector's shield chain. Everything else in Stage 1 stands.

Corpus result as shipped: 47 of 150 ships flagged, all ten owner-named known positives found, zero
build failures, instrument proven by observing 29 distinct ability config types.

---

# STAGE 2 — Derive, show, apply

**Deliverable the owner tests:** open Autogear, select Prophet, Makoli or Cobalt, read the derived
equation in the notice, apply it, and see the resulting gear differ from what autogear picks today.

---

### Task 3: A basis on a core formula row

**Files:**
- Modify: `src/types/autogear.ts` (the `CustomFormulaRow` interface)
- Modify: `src/utils/autogear/statResolution.ts:28-36, 82-87`
- Modify: `src/utils/autogear/customFormula.ts:18-21, 86-95`
- Test: `src/utils/autogear/__tests__/formulaBasis.test.ts` (new)

**Interfaces:**
- Produces: `BasisTerm = { stat: LimitableStat; weight: number }`;
  `CustomFormulaRow.basis?: BasisTerm[]`; `resolveBasisValue(stats, basis, fallbackStat): number`
  exported from `statResolution.ts`; `usableBasis(row): BasisTerm[] | undefined` exported from
  `customFormula.ts`.
- Consumes: nothing. This is the foundation task.

- [ ] **Step 1: Write the failing tests**

`src/utils/autogear/__tests__/formulaBasis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BaseStats } from '../../../types/stats';
import type { CustomFormulaRow } from '../../../types/autogear';
import { calculateDirectDamage, calculateEffectiveHP } from '../statResolution';
import { formulaRowTerm, usableBasis } from '../customFormula';

const stats: BaseStats = {
    attack: 10000, hp: 50000, defence: 7000, hacking: 200, security: 75,
    crit: 60, critDamage: 130, speed: 130,
} as BaseStats;

describe('an absent basis is the old behaviour', () => {
    it('resolves directDamage identically', () => {
        expect(calculateDirectDamage(stats, undefined)).toBe(calculateDirectDamage(stats));
    });

    it('resolves effectiveHp identically', () => {
        expect(calculateEffectiveHP(stats.hp, stats.defence, 0, undefined)).toBe(
            calculateEffectiveHP(stats.hp, stats.defence, 0)
        );
    });

    it('an explicit attack-only basis equals the default', () => {
        expect(calculateDirectDamage(stats, [{ stat: 'attack', weight: 1 }])).toBeCloseTo(
            calculateDirectDamage(stats), 6
        );
    });
});

describe('a blended basis', () => {
    it('adds the second term into the primary factor, before crit and mitigation', () => {
        // Cobalt: attack x2.100 + hp x0.267 -> primary factor 10000*2.1 + 50000*0.267 = 34350
        const blended = calculateDirectDamage(stats, [
            { stat: 'attack', weight: 2.1 },
            { stat: 'hp', weight: 0.267 },
        ]);
        const attackOnly = calculateDirectDamage(stats, [{ stat: 'attack', weight: 2.1 }]);
        expect(blended / attackOnly).toBeCloseTo(34350 / 21000, 6);
    });

    it('supports a zero-attack basis (Prophet deals no attack-scaled damage)', () => {
        const prophet = calculateDirectDamage(stats, [{ stat: 'security', weight: 57.778 }]);
        expect(prophet).toBeGreaterThan(0);
        // Changing attack must not move it at all.
        expect(calculateDirectDamage({ ...stats, attack: 99999 },
            [{ stat: 'security', weight: 57.778 }])).toBe(prophet);
    });

    it('blends only the HP factor of effectiveHp, leaving mitigation on real defence', () => {
        const tilted = calculateEffectiveHP(stats.hp, stats.defence, 0,
            [{ stat: 'hp', weight: 1 }, { stat: 'defence', weight: 2 }], stats);
        const plain = calculateEffectiveHP(stats.hp, stats.defence, 0);
        expect(tilted / plain).toBeCloseTo((50000 + 14000) / 50000, 6);
    });

    it('honours a basis on a PLAIN-stat core row, not only a derived one', () => {
        // SUPPORTER's core is `core('hp')`. Howler's fix is a basis on that row, and Makoli's is
        // [hp x1, defence x18.8] on it. Routing only directDamage/effectiveHp makes Apply a
        // silent no-op for both.
        const makoli: CustomFormulaRow = {
            stat: 'hp', kind: 'core', direction: 'max',
            basis: [{ stat: 'hp', weight: 1 }, { stat: 'defence', weight: 18.8 }],
        };
        const plainHp: CustomFormulaRow = { stat: 'hp', kind: 'core', direction: 'max' };
        // 50000 + 7000*18.8 = 181600, against 50000.
        expect(formulaRowTerm(stats, makoli) / formulaRowTerm(stats, plainHp))
            .toBeCloseTo(181600 / 50000, 6);
    });

    it('a plain core row with NO basis is unchanged', () => {
        expect(formulaRowTerm(stats, { stat: 'speed', kind: 'core', direction: 'max' }))
            .toBe(stats.speed / 130);
    });
});

describe('usableBasis rejects what the scorer cannot honour', () => {
    const core = (basis: unknown): CustomFormulaRow =>
        ({ stat: 'directDamage', kind: 'core', direction: 'max', basis }) as CustomFormulaRow;

    it('drops an entry naming a stat with no normalizer', () => {
        expect(usableBasis(core([{ stat: 'attack', weight: 1 }, { stat: 'nonsense', weight: 1 }])))
            .toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('drops a DERIVED stat used as a basis term', () => {
        // directDamage and effectiveHp both have MULTIPLIER_NORMALIZERS entries, so a
        // "has a normalizer" check admits them — and resolveBasisValue would then read
        // stats['directDamage'] as undefined and contribute 0, silently deleting the term.
        expect(usableBasis(core([
            { stat: 'attack', weight: 1 },
            { stat: 'directDamage', weight: 1 },
            { stat: 'effectiveHp', weight: 1 },
        ]))).toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('drops a non-finite or negative weight', () => {
        expect(usableBasis(core([
            { stat: 'attack', weight: 1 },
            { stat: 'hp', weight: Number.NaN },
            { stat: 'defence', weight: -3 },
        ]))).toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('returns undefined when every entry is dropped, so the default factor applies', () => {
        expect(usableBasis(core([{ stat: 'hp', weight: Number.POSITIVE_INFINITY }]))).toBeUndefined();
    });

    it('ignores a basis on a bonus row', () => {
        expect(usableBasis({ stat: 'directDamage', kind: 'bonus', direction: 'max',
            basis: [{ stat: 'hp', weight: 1 }] } as CustomFormulaRow)).toBeUndefined();
    });

    it('ignores a basis on a minimised row, which is not scale-invariant', () => {
        expect(usableBasis({ stat: 'directDamage', kind: 'core', direction: 'min',
            basis: [{ stat: 'hp', weight: 1 }] } as CustomFormulaRow)).toBeUndefined();
    });

    it('is reflected in formulaRowTerm, not only in the helper', () => {
        const withBad = formulaRowTerm(stats, core([{ stat: 'hp', weight: Number.NaN }]));
        const plain = formulaRowTerm(stats, { stat: 'directDamage', kind: 'core', direction: 'max' });
        expect(withBad).toBe(plain);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/autogear/__tests__/formulaBasis.test.ts`
Expected: FAIL — `calculateDirectDamage` takes one argument, `usableBasis` is not exported.

- [ ] **Step 3: Add the type**

In `src/types/autogear.ts`, above `CustomFormulaRow`:

```ts
/** One stat feeding a derived stat's primary factor, weighted in the game's own multiplier
 *  units divided by 100: a 200% attack skill is `{ stat: 'attack', weight: 2.0 }` and a clause
 *  dealing 25% of max HP is `{ stat: 'hp', weight: 0.25 }`. */
export interface BasisTerm {
    stat: LimitableStat;
    weight: number;
}
```

and add to `CustomFormulaRow`:

```ts
    /** Replaces the primary factor of a DERIVED stat with a weighted sum. `directDamage`'s
     *  primary factor is attack; `effectiveHp`'s is HP. Honoured only on a `kind: 'core'`,
     *  `direction: 'max'` row — a minimised term is `1/(1+n)` and so is not scale-invariant.
     *  Absent means the derived stat's own default factor, which is byte-identical to the
     *  behaviour before bases existed. */
    basis?: BasisTerm[];
```

- [ ] **Step 4: Resolve a basis**

In `src/utils/autogear/statResolution.ts`, add above `resolveLimitStatValue`:

```ts
/**
 * The primary factor a derived stat is built on: the weighted sum of `basis`, or the raw value
 * of `fallbackStat` when no basis is given. A basis of `[{ attack, 1 }]` therefore reproduces
 * the no-basis result exactly.
 */
export function resolveBasisValue(
    stats: BaseStats,
    basis: BasisTerm[] | undefined,
    fallbackStat: keyof BaseStats
): number {
    if (!basis || basis.length === 0) return stats[fallbackStat] || 0;
    return basis.reduce(
        (sum, term) => sum + (stats[term.stat as keyof BaseStats] || 0) * term.weight,
        0
    );
}
```

Thread it through both derived stats. `calculateDPS` takes the resolved factor instead of reading
`stats.attack`:

```ts
export function calculateDPS(
    stats: BaseStats,
    arcaneSiegeMultiplier: number = 0,
    basis?: BasisTerm[]
): number {
    const attack = resolveBasisValue(stats, basis, 'attack');
    // ...unchanged from here: critMultiplier, defensePenetration, damageReduction, baseDPS
}

export function calculateDirectDamage(stats: BaseStats, basis?: BasisTerm[]): number {
    return calculateDPS(stats, 0, basis);
}

export function calculateEffectiveHP(
    hp: number,
    defense: number,
    damageReductionPercent: number = 0,
    basis?: BasisTerm[],
    stats?: BaseStats
): number {
    // A basis blends the HP FACTOR only. `defense` still drives the mitigation curve on its own
    // real value, so a defence term here is a deliberate tilt toward defence, NOT a transcription
    // of a skill equation the way a directDamage basis is.
    const primary = basis && stats ? resolveBasisValue(stats, basis, 'hp') : hp;
    const defenseReduction = calculateDamageReduction(defense);
    const effectiveHpFromDefense = primary * (100 / (100 - defenseReduction));
    return effectiveHpFromDefense * (1 + damageReductionPercent / 100);
}
```

and in `resolveLimitStatValue`, **leave both derived branches calling the no-basis form.** Add:

```ts
/** A row's basis never reaches here. This resolves a stat for a StatPriority limit or a
 *  StatBonus, where there is no row — `directDamage` as a LIMIT stays attack-only. */
export function resolveLimitStatValue(stats: BaseStats, stat: LimitableStat): number {
```

- [ ] **Step 5: Validate a persisted basis and use it**

In `src/utils/autogear/customFormula.ts`:

```ts
/**
 * A row's basis, filtered to entries the scorer can honour. A stored row is untyped JSON and
 * reaches the scorer without passing through any form, so each entry is checked rather than
 * trusted — an unrecognised stat would resolve to 0 and silently delete a term, and a negative
 * weight would subtract one. Returns undefined when nothing survives, so the row falls back to
 * its own stat rather than scoring 0 for every candidate and tying the search.
 *
 * A basis TERM must name a raw `BaseStats` key. "Has a MULTIPLIER_NORMALIZERS entry" is the
 * WRONG predicate: that table also keys `directDamage` and `effectiveHp`, which `resolveBasisValue`
 * would read off the stat block as `undefined` and contribute as 0 — a term that silently
 * disappears. See `reference_total_record_is_compile_time_only`.
 */
const DERIVED_STATS: Record<DerivedStatName, true> = {
    // Total on purpose: a third derived stat must fail the build here rather than slip into a
    // basis and score as 0.
    effectiveHp: true,
    directDamage: true,
};

const isBasisStat = (stat: LimitableStat): boolean =>
    MULTIPLIER_NORMALIZERS[stat] !== undefined && !(stat in DERIVED_STATS);

export function usableBasis(row: CustomFormulaRow): BasisTerm[] | undefined {
    if (row.kind !== 'core' || row.direction !== 'max') return undefined;
    if (!Array.isArray(row.basis)) return undefined;
    const kept = row.basis.filter(
        (t) => t && isBasisStat(t.stat) && Number.isFinite(t.weight) && t.weight >= 0
    );
    return kept.length > 0 ? kept : undefined;
}
```

and in `formulaRowTerm`:

```ts
export function formulaRowTerm(stats: BaseStats, row: CustomFormulaRow): number {
    const normalizer = MULTIPLIER_NORMALIZERS[row.stat] || 1;
    const basis = usableBasis(row);
    // A basis is honoured on ANY max core row, not only a derived one. SUPPORTER's core is
    // `core('hp')` — a plain stat — and Howler's and Makoli's whole fix is a basis on that row,
    // so routing only the two derived stats would make Apply a silent no-op for them.
    const raw =
        row.stat === 'directDamage'
            ? calculateDirectDamage(stats, basis)
            : row.stat === 'effectiveHp'
              ? calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0, basis, stats)
              : resolveBasisValue(stats, basis, row.stat as keyof BaseStats);
    const n = raw / normalizer;
    return row.direction === 'min' ? 1 / (1 + n) : n;
}
```

`resolveBasisValue` already falls back to the named stat when `basis` is undefined, so a plain
core row with no basis is unchanged.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/utils/autogear/__tests__/formulaBasis.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Run the full guard**

Run: `npx tsc --noEmit && npx vitest run src/utils/autogear`
Expected: no type errors; every existing autogear test still passes. **The pre-existing
`derivedStatBonuses.test.ts` and `customFormulaSeeds.test.ts` are the regression signal that
absent-basis behaviour did not move** — if either fails, the fallback path is wrong.

- [ ] **Step 8: Commit**

```bash
git add src/types/autogear.ts src/utils/autogear/statResolution.ts \
        src/utils/autogear/customFormula.ts \
        src/utils/autogear/__tests__/formulaBasis.test.ts
git commit -m "feat(autogear): let a core formula row carry a stat basis"
```

---

### Task 4: Derive a ship's basis from its parsed kit

**Files:**
- Create: `src/utils/autogear/simRerank/basisDerivation.ts`
- Modify: `src/utils/autogear/simRerank/offFormulaStats.ts` (shield-chain coefficient)
- Test: `src/utils/autogear/simRerank/__tests__/basisDerivation.test.ts` (new)
- Test: `src/utils/autogear/simRerank/__tests__/chargeCadence.integration.test.ts` (new)

**Interfaces:**
- Consumes: `BasisTerm` from Task 3.
- Produces:
  ```ts
  export interface ExcludedCarrier {
      stat: OffFormulaStat;
      produces: 'damage' | 'repair' | 'shield';
      /** The clause's own percentage, for the notice copy. */
      pct: number;
      trigger: string;
  }
  export interface DerivedBasis {
      terms: BasisTerm[];
      excluded: ExcludedCarrier[];
      /** Turns per charged cast. 0 when the ship has no charged skill. */
      period: number;
  }
  export function chargePeriod(ship: Ship): number;
  export function deriveBasis(ship: Ship, produces: 'damage' | 'repair' | 'shield'): DerivedBasis;
  ```

- [ ] **Step 1: Write the failing derivation tests**

`src/utils/autogear/simRerank/__tests__/basisDerivation.test.ts` — build ships from the real
corpus exactly as `offFormulaStats.test.ts` already does (4 refits, so the highest-unlocked passive
resolves), then:

```ts
describe('chargePeriod', () => {
    // N and g measured 2026-09-20. g sums own-targeted charge abilities in the ACTIVE and PASSIVE
    // slots only: charges accrue on active rounds (playerTurn.ts:3475), so Sefuba's charged-slot
    // `enemy+2` must contribute nothing.
    it.each([
        ['Chakara', 2],   // N=2 g=1
        ['Obsidian', 2],  // N=3 g=2
        ['Cobalt', 3],    // N=3 g=1 (passive aura)
        ['Nuqtu', 3],     // N=4 g=2
        ['Lodolite', 4],  // N=3 g=0
        ['Prophet', 9],   // N=8 g=0
        ['Sefuba', 3],    // N=2, charged-slot enemy charge ability contributes nothing
    ])('%s has period %i', (name, expected) => {
        expect(chargePeriod(shipNamed(name))).toBe(expected);
    });

    it('is 0 for a ship with no charged skill, and that ship weights active at 1', () => {
        expect(deriveBasis(shipWithNoChargedSkill, 'damage').period).toBe(0);
    });
});

describe('deriveBasis — damage', () => {
    it('blends a two-term basis, weighted (p-1) active to 1 charged', () => {
        // Cobalt: active mult 200 + hp 25%, charged mult 230 + hp 30%, p=3
        expect(deriveBasis(shipNamed('Cobalt'), 'damage').terms).toEqual([
            { stat: 'attack', weight: closeTo(2.1) },
            { stat: 'hp', weight: closeTo(0.267) },
        ]);
    });

    it('emits NO attack term for a ship whose damage multiplier is 0', () => {
        const terms = deriveBasis(shipNamed('Prophet'), 'damage').terms;
        expect(terms).toEqual([{ stat: 'security', weight: closeTo(57.778) }]);
        expect(terms.some((t) => t.stat === 'attack')).toBe(false);
    });

    it('resolves a shield chain as the PRODUCT of both percentages', () => {
        // FrontLine: damage from shield x0.750, shield from hp 25% -> hp x0.188.
        // Both factors obey the slot rule, and his only hp-shield source is a pre-combat
        // PASSIVE, so with passives excluded the hp term is absent and the clause is reported
        // as excluded instead.
        const basis = deriveBasis(shipNamed('FrontLine'), 'damage');
        expect(basis.terms.some((t) => t.stat === 'hp')).toBe(false);
        expect(basis.excluded).toContainEqual(
            expect.objectContaining({ stat: 'hp', produces: 'shield', trigger: 'pre-combat' })
        );
    });

    it('reports no lever when the shield has no stat basis anywhere', () => {
        // Quixilver's shield comes from damage dealt and damage taken.
        const basis = deriveBasis(shipNamed('Quixilver'), 'damage');
        expect(basis.terms.filter((t) => t.stat !== 'attack')).toEqual([]);
    });
});

describe('deriveBasis — repair', () => {
    it('substitutes the basis entirely when no HP clause exists', () => {
        // Howler repairs off attack only.
        expect(deriveBasis(shipNamed('Howler'), 'repair').terms).toEqual([
            { stat: 'attack', weight: closeTo(1.067) },
        ]);
    });

    it('keeps both terms and their real ratio', () => {
        // Makoli: hp 5%/7%, defence 100%/120%, p=3 -> defence outweighs hp ~19:1.
        const terms = deriveBasis(shipNamed('Makoli'), 'repair').terms;
        const hp = terms.find((t) => t.stat === 'hp')!.weight;
        const def = terms.find((t) => t.stat === 'defence')!.weight;
        expect(def / hp).toBeCloseTo(18.8, 1);
    });
});

describe('passive exclusion', () => {
    it.each(['APEX', 'Crocus', 'Crucialis', 'FrontLine', 'Hemlock',
             'IonScorp', 'LUXX', 'Rikra', 'Sefuba', 'Xcellence'])(
        '%s derives no off-stat term and reports its carrier as excluded', (name) => {
            const basis = deriveBasis(shipNamed(name), 'damage');
            expect(basis.terms.filter((t) => t.stat !== 'attack')).toEqual([]);
            expect(basis.excluded.length).toBeGreaterThan(0);
        }
    );
});

describe('tripwires', () => {
    it('no flagged ship carries hits > 1 on a slot that also has additional-damage', () => {
        // Whether an additional-damage clause repeats per hit has never arisen and is a GAME
        // question, not an inference. This fails on the data refresh that introduces one.
        expect(multiHitFlaggedShips()).toEqual([]);
    });

    it('flags exactly the corpus count, so a data refresh surfaces here', () => {
        expect(flaggedShipCount()).toBe(47);
    });
});
```

- [ ] **Step 2: Write the failing cadence tripwire**

`chargeCadence.integration.test.ts` — the derivation duplicates engine behaviour, so it is pinned
against the engine rather than trusted.

```ts
// `chargePeriod` re-implements advanceChargeCadence (combat/state.ts) plus the active-round
// manip block (playerTurn.ts:3475). This asserts the re-implementation against the engine's
// real cast sequence. Subscribe to the engine's bus DIRECTLY — battleSimulator's subscription
// carries an allowlist that can silently make a handler dead code.
it.each([['Chakara', 2], ['Nuqtu', 3], ['Hemlock', 4], ['Prophet', 9]])(
    '%s fires its charged skill every %i rounds in a real fight',
    (name, expected) => {
        const resets = roundsWithChargeReset(runLongFight(shipNamed(name)));
        // NON-VACUITY GATE, not decoration: `[].every(...)` is `true`, so with no bus wired
        // (advanceChargeCadence emits only when `bus && round !== undefined`) this whole test
        // passes while observing nothing. Assert the instrument saw casts BEFORE reading them.
        expect(resets.length).toBeGreaterThanOrEqual(2);
        expect(gapsBetween(resets).every((g) => g === expected)).toBe(true);
        expect(chargePeriod(shipNamed(name))).toBe(expected);
    }
);
```

The fight must be long enough for Prophet (at least 20 rounds) and must not end early — use a board
where neither side can kill, the same construction `practiceBoard.ts` already provides.

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/basisDerivation.test.ts src/utils/autogear/simRerank/__tests__/chargeCadence.integration.test.ts`
Expected: FAIL — `basisDerivation` does not exist.

- [ ] **Step 4: Implement the derivation**

`src/utils/autogear/simRerank/basisDerivation.ts`. The rules, each of which a test above pins:

```ts
/** Charge abilities targeted at somebody else do not bank toward this ship's charged skill. */
const OWN_TARGETED = (target: string): boolean =>
    !['ally', 'all-allies', 'lowest-hp-ally', 'enemy', 'all-enemies'].includes(target);

/** Own-targeted `type: 'charge'` amounts summed over the named slots. */
function ownChargeGain(ship: Ship, slots: readonly string[]): number {
    let total = 0;
    for (const slot of buildShipAbilities(ship).slots ?? []) {
        if (!slots.includes(slot.slot)) continue;
        for (const ability of slot.abilities ?? []) {
            const config = ability.config as { type?: string; amount?: number };
            if (config?.type !== 'charge') continue;
            if (!OWN_TARGETED(ability.target as string)) continue;
            total += config.amount ?? 0;
        }
    }
    return total;
}

/**
 * Turns per charged cast, simulating the engine: `advanceChargeCadence` (combat/state.ts) resets
 * to 0 at the cap and otherwise adds 1 per own turn, and `playerTurn.ts` adds bonus charges on
 * ACTIVE rounds only, capped at chargeCount. Pinned against the engine by
 * `chargeCadence.integration.test.ts`.
 *
 * Returns 0 when the ship has no charged skill, which weights the active slot at 1.
 */
export function chargePeriod(ship: Ship): number {
    const n = ship.chargeSkillCharge ?? 0;
    if (n <= 0) return 0;
    // Own-targeted charge gain from the ACTIVE and PASSIVE slots. The charged slot is excluded
    // because charges accrue on active rounds only.
    const g = ownChargeGain(ship, ['active', 'passive']);
    let c = 0;
    for (let t = 1; t <= 50; t++) {
        if (c >= n) return t;
        c = Math.min(c + 1 + g, n);
    }
    return 0;
}
```

Then, for `deriveBasis(ship, produces)`:

1. Collect per-slot weights from the **active and charged slots only**:
   - `attack` from the sum of `damage.multiplier * (damage.hits ?? 1)`, skipping configs carrying
     `hpBasisPct` or `shieldBasisPct` (those are the reactive path, not an attack-scaled cast)
   - each other stat from the sum of `additional-damage.pct` for that stat, plus
     `heal`/`shield`.`pct` where `basis` is a caster stat (`hp`, `attack`, `defense`), filtered to
     the requested `produces`
2. Weight the two slots `wActive = (p-1)/p`, `wCharged = 1/p`, or `1` / `0` when `p === 0`
3. Resolve any `shield` term to its producing stat: find a `heal`/`shield` ability with a caster
   `basis`, and multiply the two percentages. **Apply the slot rule to the producing clause too** —
   if it lives in a passive, the term is dropped and recorded in `excluded`
4. Divide every weight by 100
5. Record every carrier found in a **passive** slot in `excluded`, never in `terms`

**The excluded-carrier prose** is a fixed map, not free composition — a test asserts it verbatim.
These are the only triggers that carry an excluded clause in the current corpus; an unmapped
trigger falls back to its raw name rather than inventing English:

```ts
const TRIGGER_PROSE: Record<string, string> = {
    'pre-combat': 'at the start of the fight',
    'start-of-turn': 'at the start of its turn',
    'on-enemy-destroyed': 'when an enemy is destroyed',
    'on-enemy-purged': 'when it purges an enemy buff',
    'on-debuff-inflicted': 'when it lands a debuff',
    'on-ally-crit-dot': 'when an ally crits a damaged-over-time enemy',
    'on-corrosion-spread': 'when Corrosion spreads',
    'on-enemy-debuff-resisted': 'when an enemy resists a debuff',
};
```

A note reads `{PRODUCES_LABEL[produces]} {pct}% of {STAT_LABEL[stat]} {TRIGGER_PROSE[trigger]}` —
Rikra's is `repairs 60% of max HP when an enemy is destroyed`. `OffFormulaNotice` already owns
`PRODUCES_LABEL` and `STAT_LABEL`; export them rather than restating the verb-agreement rule.

Reuse `normalise` from `offFormulaStats.ts` for the `defense`/`defence` split.

- [ ] **Step 5: Carry the shield coefficient in the detector**

In `offFormulaStats.ts`, `withGearableLevers` currently chains a non-gearable stat to a producing
stat and keeps only the name. Add the producing percentage to the finding so the notice and the
derivation read one number rather than each recomputing it:

```ts
    /** For a chained finding, the producing clause's percentage — the second factor of the
     *  coefficient product. FrontLine's damage is 75% of his shield and his shield is 25% of max
     *  HP, so the lever weight is 0.75 x 0.25. Absent when `stat` is its own lever. */
    leverPct?: number;
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/`
Expected: PASS. The 47-ship detector table test must still pass unchanged.

- [ ] **Step 7: Run the guard**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/utils/autogear/simRerank/basisDerivation.ts \
        src/utils/autogear/simRerank/offFormulaStats.ts \
        src/utils/autogear/simRerank/__tests__/basisDerivation.test.ts \
        src/utils/autogear/simRerank/__tests__/chargeCadence.integration.test.ts
git commit -m "feat(autogear): derive a ship's scoring basis from its parsed kit"
```

---

### Task 5: Show the derived equation, and name what was left out

**Files:**
- Modify: `src/components/autogear/OffFormulaNotice.tsx`
- Test: `src/components/autogear/__tests__/OffFormulaNotice.test.tsx`

**Interfaces:**
- Consumes: `deriveBasis`, `DerivedBasis`, `ExcludedCarrier` from Task 4.
- Produces: nothing downstream. Task 6 adds the Apply control to this same component.

- [ ] **Step 1: Write the failing tests**

```tsx
it('states the derived equation in the ship own numbers', () => {
    render(<OffFormulaNotice ship={prophet} configuredRole="ATTACKER" />);
    expect(screen.getByText(/Security x57\.778/)).toBeInTheDocument();
    expect(screen.getByText(/nothing from Attack/i)).toBeInTheDocument();
});

it('names the excluded carrier verbatim rather than a general caveat', () => {
    render(<OffFormulaNotice ship={rikra} configuredRole="ATTACKER" />);
    // A basis equal to today's behaviour is indistinguishable from one that needed no change,
    // so the notice must say WHICH clause was left out and why.
    expect(screen.getByText(/repairs 60% of max HP when an enemy is destroyed/i)).toBeInTheDocument();
    expect(screen.getByText(/a passive's frequency depends on the fight/i)).toBeInTheDocument();
});

it('shows the notice for a substitution finding, not only a severe one', () => {
    // Narrowing to `severe` would silence Panon and Vindicator, both owner-named known
    // positives. Both severities keep their notice — all 47 ships.
    render(<OffFormulaNotice ship={panon} configuredRole="DEFENDER" />);
    expect(screen.getByText(/Panon/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
Expected: FAIL — the notice renders no equation.

- [ ] **Step 3: Render the basis**

Format each term as `{StatLabel} x{weight.toFixed(3)}`, joined with ` + `. A basis with no term
other than attack renders as prose saying the role formula already covers it. Remove the
`OffFormulaTuningPanel` import and the `Measure it` control — Task 6 replaces them with Apply.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/OffFormulaNotice.tsx \
        src/components/autogear/__tests__/OffFormulaNotice.test.tsx
git commit -m "feat(autogear): show a flagged ship's derived scoring equation"
```

---

### Task 6: Apply the derived formula, and retire the band panel

**Files:**
- Modify: `src/components/autogear/OffFormulaNotice.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx` (drop the tuning deps it injects)
- Modify: `src/constants/changelog.ts`
- Test: `src/components/autogear/__tests__/OffFormulaNotice.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('applies a formula seeded from the role, with the basis on its core row', () => {
    const onApply = vi.fn();
    render(<OffFormulaNotice ship={cobalt} configuredRole="ATTACKER" onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    expect(onApply).toHaveBeenCalledWith({
        shipRole: null,
        customFormula: {
            seededFrom: 'ATTACKER',
            rows: [expect.objectContaining({
                stat: 'directDamage', kind: 'core',
                basis: [{ stat: 'attack', weight: closeTo(2.1) },
                        { stat: 'hp', weight: closeTo(0.267) }],
            })],
        },
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
Expected: FAIL — no Apply control.

- [ ] **Step 3: Implement Apply**

Build the formula with `seedFormulaFromRole(configuredRole)` and attach the derived basis to the
core row naming the derived stat. Set `shipRole: null`.

**Note in the component why the notice then disappears:**

```tsx
// Applying sets shipRole to null (Custom mode), and detectOffFormulaStats returns [] when
// configuredRole is null — so the notice clears through that existing short-circuit rather
// than by re-reading the basis. That is deliberate: Custom mode means the player wrote the
// scoring function, so there is no declared role left to diverge from.
```

**Carry the excluded carriers onto the row.** Because the notice unmounts on Apply, the sentence
naming the excluded passive dies with it — and for the ten passive-only ships that sentence is the
only instruction the player has. The derived row carries them so the editor can keep showing them:

```ts
    /** Kit clauses the derivation deliberately skipped, in the ship's own words ("repairs 60%
     *  of max HP when an enemy is destroyed"). Passive frequency is not derivable, so these are
     *  not in `basis` — but they are what the player is being invited to add by hand, and the
     *  notice that named them unmounts as soon as the formula is applied. Display only; the
     *  scorer never reads it. */
    excludedNote?: string[];
```

- [ ] **Step 3b: Test that the instruction survives Apply**

```tsx
it('keeps naming the excluded carrier after the notice has gone', () => {
    const onApply = vi.fn();
    render(<OffFormulaNotice ship={rikra} configuredRole="ATTACKER" onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    const row = onApply.mock.calls[0][0].customFormula.rows[0];
    expect(row.excludedNote).toContain(
        'repairs 60% of max HP when an enemy is destroyed'
    );
});
```

- [ ] **Step 4: Unmount the band machinery**

Remove `OffFormulaTuningPanel` from `AutogearSettings` and the `runOptimizer` / `statBounds` /
`deps` wiring from `AutogearPage`. **Delete nothing under `simRerank/`.** Add to
`simRerank/statBands.ts`:

```ts
// Not mounted in the UI. Retained as the owner-side tool for locating the threshold on the two
// GATED ships (Xcellence, Vindicator), whose off-stat channel switches on at a boundary against
// the opponent's security/hacking and so cannot be expressed as a weighted basis. #544.
```

- [ ] **Step 5: Changelog**

In `UNRELEASED_CHANGES`, one entry per user-visible change:

```
'Autogear: ships scoring off an ignored stat now show their real damage equation.',
"Autogear: apply a ship's derived scoring formula in one click.",
```

- [ ] **Step 6: Run the tests and the guard**

Run: `npx vitest run src/components/autogear src/pages/manager && npx tsc --noEmit`
Expected: PASS and clean. `AutogearPage.simRerankApply.test.tsx` may need its mock updated.

- [ ] **Step 7: Commit**

```bash
git add src/components/autogear/OffFormulaNotice.tsx \
        src/components/autogear/AutogearSettings.tsx \
        src/pages/manager/AutogearPage.tsx \
        src/utils/autogear/simRerank/statBands.ts \
        src/constants/changelog.ts \
        src/components/autogear/__tests__/OffFormulaNotice.test.tsx
git commit -m "feat(autogear): apply a derived scoring formula from the notice"
```

---

### Task 7: Edit a basis in the formula editor

**Files:**
- Modify: `src/components/autogear/CustomFormulaRow.tsx`
- Modify: `src/components/autogear/CustomFormulaForm.tsx`
- Test: `src/components/autogear/__tests__/CustomFormulaBasis.test.tsx` (new)

**Why this is not optional polish:** passive carriers are excluded from derivation, so for ten
ships the derived basis equals today's behaviour and the fix IS the edit. Without this task the
notice tells those players about a problem and hands them no way to act on it.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows each basis term on a core row naming a derived stat', () => {
    render(<CustomFormulaRow row={cobaltRow} {...noop} />);
    expect(screen.getByText(/Attack x2\.100/)).toBeInTheDocument();
    expect(screen.getByText(/HP x0\.267/)).toBeInTheDocument();
});

it('shows no basis controls on a plain-stat row', () => {
    render(<CustomFormulaRow row={{ stat: 'speed', kind: 'core', direction: 'max' }} {...noop} />);
    expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
});

it('adds a term, which is how an excluded passive is put back', () => {
    render(<CustomFormulaForm editingValue={rikraRow} onSubmit={onSubmit} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /add stat/i }));
    fireEvent.change(screen.getByLabelText(/basis stat/i), { target: { value: 'hp' } });
    fireEvent.change(screen.getByLabelText(/basis weight/i), { target: { value: '0.4' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        basis: expect.arrayContaining([{ stat: 'hp', weight: 0.4 }]),
    }));
});

it('refuses a negative weight rather than saving one the scorer will drop', () => {
    // usableBasis drops it silently at score time; the form must not create that state.
    render(<CustomFormulaForm editingValue={cobaltRow} onSubmit={onSubmit} {...noop} />);
    fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/autogear/__tests__/CustomFormulaBasis.test.tsx`
Expected: FAIL — no basis controls.

- [ ] **Step 3: Implement**

Basis controls render on any `kind === 'core' && direction === 'max'` row, matching `usableBasis`
exactly — SUPPORTER's core is the plain stat `hp`, and that is the row Howler's and Makoli's fix
sits on. Render `excludedNote` above the terms, so the clause the notice named is still in front of
the player after Apply removed the notice. Each term is an `Input` for the weight
plus a `Select` over `FORMULA_STATS` for the stat, with a `Button` to add and remove. The form
refuses to save a negative or non-finite weight, the same way it already refuses a negative bonus
percentage.

Label `effectiveHp` bases differently from `directDamage` ones — a `directDamage` basis is a
transcription of the ship's equation, while an `effectiveHp` basis is a tilt, because defence
already drives the mitigation curve. The UI must not present them as the same thing.

- [ ] **Step 4: Run the tests and the guard**

Run: `npx vitest run src/components/autogear && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/CustomFormulaRow.tsx \
        src/components/autogear/CustomFormulaForm.tsx \
        src/components/autogear/__tests__/CustomFormulaBasis.test.tsx
git commit -m "feat(autogear): edit a formula row's stat basis"
```

---

## STAGE 2 CHECKPOINT — STOP HERE

Report to the repo owner:
- the derived basis for Prophet, Cobalt, Makoli and Chakara, and the gear each now produces versus
  what autogear picked before
- which of the ten passive-only ships they want to spot-check
- the dev server URL

**Do not start Stage 3 until they have tested and replied.** The questions their testing answers:
is the derived equation legible to a player, does applying it produce gear that is actually better
in game, is the excluded-carrier copy enough to act on, and is the basis editor usable without
knowing what a skill multiplier is.

---

# STAGE 3 — Share and finish

---

### Task 8: Carry a custom formula in a shared build

**Files:**
- Modify: `src/types/communityRecommendation.ts`
- Modify: `src/schemas/sharedAutogearBuild.ts`
- Modify: `src/utils/communityBuild.ts`
- Test: `src/schemas/sharedAutogearBuild.test.ts`
- Test: `src/utils/__tests__/communityBuildLegacyShapes.test.ts`

**Why:** a derived formula is the thing worth sharing — it generalises across inventories, which a
stat limit does not. `SharedAutogearBuild` currently types `shipRole: ShipTypeName` as non-nullable
and carries no `customFormula`, so an applied basis cannot be shared at all.

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips a custom formula with a basis', () => {
    const build = { version: 2, shipRole: null, customFormula: cobaltFormula, /* ... */ };
    expect(parseSharedAutogearBuild(JSON.stringify(build))).toEqual(build);
});

it('reads a version 1 row, which has no customFormula and a non-null role', () => {
    // Rows written before this migration must keep working — `version` exists for exactly this.
    expect(parseSharedAutogearBuild(JSON.stringify(legacyV1))).toMatchObject({ shipRole: 'ATTACKER' });
});

it('rejects a shared build with neither a role nor a usable formula', () => {
    // partitionScoreableShips would classify the importing user's ship as unscoreable and the
    // optimizer would hand back arbitrary gear.
    expect(() => parseSharedAutogearBuild(
        JSON.stringify({ ...v2, shipRole: null, customFormula: { rows: [] } })
    )).toThrow();
});

it('validates a corrupt basis on import, not only at score time', () => {
    expect(() => parseSharedAutogearBuild(
        JSON.stringify(buildWithBasis([{ stat: 'nonsense', weight: 1 }]))
    )).toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/schemas/sharedAutogearBuild.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Bump `version` to `2`, make `shipRole` nullable, add `customFormula?: CustomFormula`, and extend
the Zod schema to validate basis entries on the way in. Migrate a `version: 1` row on read by
treating it as `customFormula: undefined`.

- [ ] **Step 4: Run the tests and the guard**

Run: `npx vitest run src/schemas src/utils/__tests__/communityBuild* && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/types/communityRecommendation.ts src/schemas/sharedAutogearBuild.ts \
        src/utils/communityBuild.ts src/schemas/sharedAutogearBuild.test.ts \
        src/utils/__tests__/communityBuildLegacyShapes.test.ts
git commit -m "feat(autogear): share a custom formula in a community build"
```

---

### Task 9: Documentation, and the #541 debts

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/components/autogear/SimRerankSection.tsx` (the stale-results fix — after Task 6
  unmounts `OffFormulaTuningPanel`, this is the panel that survives)
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Fix #541's stale-results defect**

Results survive a change of role, fight source, seed, run count or equipped gear while the modal
stays open, and `Apply` then forwards a stale loadout. `OffFormulaTuningPanel` already carries the
correct pattern — a `useEffect` that resets on every input the run reads, with no omission to
silence a lint warning. Apply the same shape to `SimRerankSection`. **This must land before
merge**; it is a shipped defect on the draft PR, not new work.

- [ ] **Step 2: Write the failing test**

```ts
it('clears results when the selected role changes', () => {
    // A completed table must never survive a context change: Apply would forward a loadout
    // computed for a different configuration.
    const { rerender } = render(<Panel shipRole="ATTACKER" />);
    // ...complete a run...
    rerender(<Panel shipRole="DEBUFFER" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure, then fix, then re-run**

Run: `npx vitest run src/components/autogear`
Expected: FAIL, then PASS.

- [ ] **Step 4: Documentation**

Add a section to `DocumentationPage.tsx` covering what the notice means, what the derived equation
is, that passive skills are not counted and why, and how to edit a basis. Keep it player-facing —
no mention of `CustomFormulaRow` or `buildShipAbilities`.

- [ ] **Step 5: Changelog**

```
"Autogear: share a ship's custom scoring formula with the community.",
'Autogear: candidate results now clear when you change role, seed or gear.',
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: green. A timeout on the kit-fingerprint file alone is contention, not your diff — retry
that file rather than hunting it.

- [ ] **Step 7: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts src/components/autogear
git commit -m "docs(autogear): document derived scoring formulas, fix stale results"
```

---

## Notes carried from the spec

- **Out of scope, deliberately:** Quixilver has no stat basis anywhere in his kit — he keeps a
  notice with no lever. Xcellence and Vindicator are GATED: their off-stat channel switches on at a
  threshold against the opponent's security or hacking, so a linear basis cannot express it, and
  tougher enemies let the ship afford *more* hacking. The retained band modules are the tool for
  locating those thresholds, owner-side, in later work.
- **Both severities keep their notice — all 47 ships.** Narrowing to `severe` would silence Panon
  and Vindicator, both owner-named known positives.
- **PR #541 remains a draft and does not merge on its own.** This work merges with it.
