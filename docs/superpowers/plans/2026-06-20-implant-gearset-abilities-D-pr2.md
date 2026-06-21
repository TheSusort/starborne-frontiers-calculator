# D-PR2: Conditional Outgoing-Damage Implants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up three conditional outgoing-damage implants (Intrusion, Arcane Siege, Warpstrike) in the combat engine by modeling them as passive `modifier` abilities on channel `outgoingDamage`, and wire the DPS calculator page to consume equipment abilities.

**Architecture:** These effects ride the *existing* modifier fold — `modifierTotalsFromAbilities` already iterates the passive slot, gates by `conditionsMet`, and sums flat `value` + per-count `scaling` into the multiplicative `outgoingDamage` factor. No `conditionalBonusPct`/`playerTurn` damage-fold surgery. The single new engine primitive is a `self-shield` condition subject for Arcane Siege. Effects are added to the D-PR1 `IMPLANT_ABILITIES` registry (values baked per-rarity; `description` used only as a presence gate).

**Tech Stack:** React 18, TypeScript, Vite, Vitest. Combat engine under `src/utils/combat/` + `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-pr2-design.md`
**Branch:** `feat/combat-d-pr2-conditional-damage` (stacked on D-PR1 tip `cfbafb76`).

---

## Workflow gotchas (read before starting)

- **Test runner:** bare `npm test` runs Vitest in WATCH mode and hangs. Always use `npx vitest run <path-or-name>`. Full suite: `npx vitest run`.
- **Never** run `vitest -u` (would silently rewrite golden `.snap` files). Goldens must stay byte-identical here.
- **Lint:** `npm run lint` enforces `--max-warnings 0`. Run it in EVERY task gate, not just the last (a stray `as any` fails the build).
- **Type check:** `npx tsc --noEmit`.
- **Skill audit (unchanged-guard):** `npm run audit:skills` should stay 141 ships / 0 findings (this PR doesn't touch the skill-text parser).
- **`docs/` is gitignored** but `docs/superpowers/**` is force-tracked — commit plan/spec edits with `git add -f`.
- Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Fixture audit — confirm the byte-identical invariant is empty

**Goal:** Before any wiring, prove no existing DPS / battle-sim / healing fixture builds a ship carrying Intrusion / Arcane Siege / Warpstrike. If none do, the goldens are guaranteed byte-identical after Task 4 wires the DPS page. No code change — this is a verification gate.

**Files:** none modified.

- [ ] **Step 1: Grep the test corpus for the three implants**

Run:
```bash
grep -rniE "intrusion|arcane[_ ]?siege|warpstrike" src/ --include=*.test.ts --include=*.test.tsx
grep -rniE "INTRUSION|ARCANE_SIEGE|WARPSTRIKE" src/ --include=*.ts --include=*.tsx | grep -iE "fixture|setBonus|implant" | grep -v "buildEquipmentAbilities\|implants.ts\|equipmentCoverage\|arcaneSiegeUtils"
```
Expected: no hits that wire one of these implants onto a ship used by a DPS/battle/healing golden. (Hits in `implants.ts`, `arcaneSiegeUtils.ts` (autogear), and the equipment-ability test files are expected and fine.)

- [ ] **Step 2: Record the result**

If clean (expected): note in the Task 4 commit body that the fixture audit was empty. If a fixture DOES carry one of these, STOP and surface it — either neutralize the fixture's equipment or deliberately audit the resulting churn (never `vitest -u`). Do not proceed to Task 4 with an un-audited fixture.

---

## Task 2: Add the `self-shield` condition primitive

**Goal:** A binary, derivable condition that is met when the acting unit currently has a shield (`shieldPool > 0`). Purely additive — no existing ability uses it, `selfShielded` defaults falsy.

**Files:**
- Modify: `src/types/abilities.ts` (ConditionSubject union)
- Modify: `src/utils/abilities/evaluateConditions.ts` (ConditionContext + evaluateCondition)
- Modify: `src/utils/abilities/roundContext.ts` (buildRoundContext input + output)
- Modify: `src/utils/combat/playerTurn.ts` (thread `actor.shieldPool > 0` into modifierCtx)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts` (create if absent — otherwise the nearest existing conditions test; confirm at impl time)

- [ ] **Step 1: Write the failing test**

Add to the conditions test file (verify the existing import/helper shape first — mirror a sibling `evaluateCondition` test):

```ts
import { evaluateCondition, ConditionContext } from '../evaluateConditions';

function baseCtx(over: Partial<ConditionContext> = {}): ConditionContext {
    return {
        selfBuffNames: [], selfDebuffNames: [], enemyBuffNames: [], enemyDebuffCount: 0,
        effectiveCritRate: 0, adjacentAllyCount: 0, enemyAdjacentCount: 0,
        enemyDestroyedCount: 0, selfHpPct: 100, enemyHpPct: 100, ...over,
    };
}

describe('self-shield condition', () => {
    it('evaluates to 1 when selfShielded is true', () => {
        expect(evaluateCondition({ subject: 'self-shield', derivable: true }, baseCtx({ selfShielded: true }))).toBe(1);
    });
    it('evaluates to 0 when selfShielded is false/absent', () => {
        expect(evaluateCondition({ subject: 'self-shield', derivable: true }, baseCtx())).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: FAIL — `'self-shield'` not assignable to `ConditionSubject` (tsc) / case not handled.

- [ ] **Step 3: Add `'self-shield'` to the ConditionSubject union**

In `src/types/abilities.ts`, add to the `ConditionSubject` union (place near the other self-* subjects with a short comment):

```ts
    // Binary gate: the condition owner currently has a shield (CombatActor.shieldPool > 0).
    // Live-derived (ConditionContext.selfShielded); defaults false (no shield / DPS mode).
    // Dormant until sub-project H grants shields in the sim. Used by the Arcane Siege implant.
    | 'self-shield';
```
(If `self-shield` is added mid-union, keep the trailing `;` on the final member intact.)

- [ ] **Step 4: Extend ConditionContext + evaluateCondition**

In `src/utils/abilities/evaluateConditions.ts`:

Add to the `ConditionContext` interface (near `targetRepairedThisRound`):
```ts
    /** True when the condition owner currently has a shield (shieldPool > 0). Live-derived
     *  by the engine; defaults false (no shield / DPS mode). Used by the Arcane Siege implant. */
    selfShielded?: boolean;
```

Add a case in the `evaluateCondition` switch (near `self-debuff`):
```ts
        case 'self-shield':
            return ctx.selfShielded ? 1 : 0;
```

- [ ] **Step 5: Thread through buildRoundContext**

In `src/utils/abilities/roundContext.ts`, add to the `state` input type (near `targetRepairedThisRound`):
```ts
    /** True when the acting unit has a shield (shieldPool > 0). Default false. */
    selfShielded?: boolean;
```
And to the returned object (near `targetRepairedThisRound: state.targetRepairedThisRound ?? false,`):
```ts
        selfShielded: state.selfShielded ?? false,
```

- [ ] **Step 6: Run the unit test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: PASS.

- [ ] **Step 7: Thread the live shield state in playerTurn (modifierCtx site only)**

In `src/utils/combat/playerTurn.ts`, the `buildRoundContext({...})` call that builds `modifierCtx` (~line 1078): add the field, reading the acting actor's live shield:
```ts
        selfDebuffNames: selfDebuffNamesArg,
        selfShielded: actor.shieldPool > 0,
```
Verify `actor` is the acting `CombatActor` in scope at that site and `shieldPool` is live there (it is — `state.ts:108`, used elsewhere in the engine). Do NOT thread into other `buildRoundContext` calls — only the modifier fold needs it (spec §4 / open question #2); they default falsy.

- [ ] **Step 8: Verify byte-identical — full suite + lint + tsc**

Run:
```bash
npx vitest run
npm run lint
npx tsc --noEmit
```
Expected: all green; ZERO `.snap` changes in `git status` (additive change — no ability uses `self-shield` yet, `selfShielded` defaults falsy).

- [ ] **Step 9: Commit**

```bash
git add src/types/abilities.ts src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/combat/playerTurn.ts src/utils/abilities/__tests__/evaluateConditions.test.ts
git commit -m "feat(combat): D-PR2 — self-shield condition primitive (Arcane Siege gate)"
```

---

## Task 3: Add Intrusion / Arcane Siege / Warpstrike to the registry

**Goal:** Three `IMPLANT_ABILITIES` entries emitting passive `modifier`/`outgoingDamage` abilities with the per-rarity values from `implants.ts`.

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

Per-rarity values (common / uncommon / rare / epic / legendary), verified against `implants.ts`:
- **Intrusion** (per enemy debuff): 1 / 2 / 3 / 4 / 5
- **Arcane Siege** (while shielded): 3 / 6 / 10 / 15 / 20
- **Warpstrike** (while self-debuffed): 1 / 2 / 3 / 4 / 5

- [ ] **Step 1: Write the failing tests**

Add to `buildEquipmentAbilities.test.ts` (mirror the existing Bloodthirst test helpers — reuse the file's `makeShip`/`makePiece` style):

```ts
describe('Intrusion implant', () => {
    it('emits a passive outgoingDamage modifier scaling per enemy debuff (legendary = 5/debuff)', () => {
        const abilities = buildForImplant('INTRUSION', 'legendary');
        expect(abilities).toHaveLength(1);
        const a = abilities[0];
        expect(a.type).toBe('modifier');
        expect(a.trigger).toBe('on-cast');
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 0 });
        expect(a.scaling).toEqual({ conditionIndex: 0, perUnit: 5 });
        expect(a.conditions).toEqual([{ subject: 'enemy-debuff', derivable: true }]);
    });
    it('bakes the uncommon per-debuff value (2)', () => {
        expect(buildForImplant('INTRUSION', 'uncommon')[0].scaling).toEqual({ conditionIndex: 0, perUnit: 2 });
    });
});

describe('Arcane Siege implant', () => {
    it('emits a flat outgoingDamage modifier gated on self-shield (epic = 15)', () => {
        const a = buildForImplant('ARCANE_SIEGE', 'epic')[0];
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 15 });
        expect(a.scaling).toBeUndefined();
        expect(a.conditions).toEqual([{ subject: 'self-shield', derivable: true }]);
    });
});

describe('Warpstrike implant', () => {
    it('emits a flat outgoingDamage modifier gated on >=1 self-debuff (legendary = 5)', () => {
        const a = buildForImplant('WARPSTRIKE', 'legendary')[0];
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 5 });
        expect(a.scaling).toBeUndefined();
        expect(a.conditions).toEqual([
            { subject: 'self-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
        ]);
    });
});
```

`buildForImplant(name, rarity)` = a small helper (add if not present) that builds a ship with one implant of that name+rarity and calls `buildEquipmentAbilities(ship, getGearPiece)` — mirror `implantAbilityCount` in `equipmentCoverage.test.ts`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`
Expected: FAIL — registry has no entries; `buildForImplant(...)` returns `[]`.

- [ ] **Step 3: Add the registry entries**

In `src/utils/abilities/buildEquipmentAbilities.ts`, add per-rarity value maps and three `IMPLANT_ABILITIES` entries. Follow the existing `BLOODTHIRST` builder shape (returns `Omit<Ability,'id'> | undefined`):

```ts
const INTRUSION_PER_DEBUFF: Record<string, number> = {
    common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5,
};
const ARCANE_SIEGE_PCT: Record<string, number> = {
    common: 3, uncommon: 6, rare: 10, epic: 15, legendary: 20,
};
const WARPSTRIKE_PCT: Record<string, number> = {
    common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5,
};
```

Add to `IMPLANT_ABILITIES`:
```ts
    // Intrusion: +N% outgoing direct damage per debuff on the target. Rides the
    // modifier fold as a pure scaling modifier (value 0 + scaling); the enemy-debuff
    // condition is a bare scaling source (no countComparator) so it scales, never gates.
    INTRUSION: (rarity) => {
        const perUnit = INTRUSION_PER_DEBUFF[rarity];
        if (perUnit === undefined) return undefined;
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'enemy-debuff', derivable: true }],
            scaling: { conditionIndex: 0, perUnit },
            config: { type: 'modifier', channel: 'outgoingDamage', value: 0, isMultiplicative: false },
            autoFilled: true,
        };
    },
    // Arcane Siege: +X% outgoing direct damage while shielded. Flat value gated on the
    // new self-shield condition; dormant until sub-project H grants shields in the sim.
    ARCANE_SIEGE: (rarity) => {
        const value = ARCANE_SIEGE_PCT[rarity];
        if (value === undefined) return undefined;
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'self-shield', derivable: true }],
            config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: false },
            autoFilled: true,
        };
    },
    // Warpstrike (damage half only): +X% outgoing direct damage while self-debuffed.
    // Flat value + a >=1 self-debuff gate (NOT scaling — scaledBonus uses the raw debuff
    // count and would over-apply for multiple debuffs). The "reduce a random debuff's
    // duration by 1 turn" half is DEFERRED (self-debuff-mitigation / cleanse-family).
    WARPSTRIKE: (rarity) => {
        const value = WARPSTRIKE_PCT[rarity];
        if (value === undefined) return undefined;
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [
                { subject: 'self-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
            ],
            config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: false },
            autoFilled: true,
        };
    },
```

(Note: `'passive'` is NOT a valid `AbilityTrigger`. Use `trigger: 'on-cast'` — the same value `buildShipAbilities` assigns to parser-emitted passive-slot `outgoingDamage` modifiers. The trigger is inert for these: `modifierTotalsFromAbilities` filters only on `type === 'modifier'`, never on trigger.)

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR2 — Intrusion/Arcane Siege/Warpstrike outgoingDamage modifiers"
```

---

## Task 4: Wire the DPS calculator page

**Goal:** Make the DPS page consume equipment abilities so Intrusion/Warpstrike actually affect a DPS run. (`battleSimulator` already routes them since D-PR1.)

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx` (3 sites: ~lines 73, 384, 440)

- [ ] **Step 1: Add the import**

In `DPSCalculatorPage.tsx`, add (mirror HealingCalculatorPage's import):
```ts
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
```

- [ ] **Step 2: Replace the three call sites**

Change each `shipSkills: buildShipAbilities(ship),` (lines ~73, 384, 440) to:
```ts
shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
```
`getGearPiece` is already in scope (`const { getGearPiece } = useInventory();`, line 39). Remove the now-unused `buildShipAbilities` import only if no other site uses it (grep first).

- [ ] **Step 3: Verify byte-identical — full suite + lint + tsc**

Run:
```bash
npx vitest run
npm run lint
npx tsc --noEmit
```
Expected: all green; ZERO `.snap` changes (fixture audit in Task 1 confirmed no golden ship carries these implants).

- [ ] **Step 4: Commit**

```bash
git add src/pages/calculators/DPSCalculatorPage.tsx
git commit -m "feat(combat): D-PR2 — wire DPS calculator page to equipment abilities

Fixture audit (Task 1) confirmed no DPS/battle/healing golden ship carries
Intrusion/Arcane Siege/Warpstrike, so goldens stay byte-identical."
```

---

## Task 5: Update the equipment coverage tracker

**Goal:** Reflect the three newly-implemented implants in the living coverage regression guard.

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Update the implemented-implants assertion**

Change the `implementedImplants` expectation (currently `['BLOODTHIRST']`) to the `IMPLANTS` declaration order of the implemented set:
```ts
expect(implementedImplants).toEqual(['ARCANE_SIEGE', 'INTRUSION', 'WARPSTRIKE', 'BLOODTHIRST']);
```
(Declaration order in `implants.ts`: ARCANE_SIEGE, INTRUSION, WARPSTRIKE, … BLOODTHIRST. `implementedImplants` is `Object.keys(IMPLANTS).filter(...)`, so order follows declaration.)

- [ ] **Step 2: Move the three implants out of the "produces 0 abilities" loop**

The `nonBloodthirstImplants` loop asserts every non-Bloodthirst implant produces 0 abilities — Intrusion/Arcane Siege/Warpstrike will now break it. Update the exclusion filter and add positive per-implant assertions:
```ts
const IMPLEMENTED = ['BLOODTHIRST', 'INTRUSION', 'ARCANE_SIEGE', 'WARPSTRIKE'];
const unimplementedImplants = Object.keys(IMPLANTS).filter((k) => !IMPLEMENTED.includes(k));
for (const implantKey of unimplementedImplants) { /* ...existing "produces 0" assertion... */ }

it('INTRUSION (legendary) produces 1 ability', () => {
    expect(implantAbilityCount('INTRUSION', 'legendary')).toBe(1);
});
it('ARCANE_SIEGE (epic) produces 1 ability', () => {
    expect(implantAbilityCount('ARCANE_SIEGE', 'epic')).toBe(1);
});
it('WARPSTRIKE (legendary) produces 1 ability', () => {
    expect(implantAbilityCount('WARPSTRIKE', 'legendary')).toBe(1);
});
```
Also update the header comment in the file ("when D-PR2 adds new effects …") to note the set now includes these three.

- [ ] **Step 3: Run the coverage test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR2 — coverage tracker includes Intrusion/Arcane Siege/Warpstrike"
```

---

## Task 6: Integration tests — the effects actually amplify direct damage

**Goal:** Prove the end-to-end fold: a passive Intrusion/Warpstrike/Arcane Siege modifier amplifies a unit's outgoing direct damage under its condition, via the real engine path (not just the registry shape).

**Files:**
- Test: `src/utils/abilities/__tests__/conditionalDamageImplants.integration.test.ts` (new), OR extend the D-PR1 end-to-end test file — confirm the existing harness at impl time (D-PR1 added an end-to-end Leech/Bloodthirst test; mirror it).

- [ ] **Step 1: Write a modifier-fold-level integration test**

Assert the fold directly (fast, deterministic), using the registry output + `modifierTotalsFromAbilities`:
```ts
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { modifierTotalsFromAbilities } from '../applyAbilities';
// ...build a ship with INTRUSION legendary, get the ability, then:
const [intrusion] = buildEquipmentAbilities(shipWithIntrusion, getGearPiece);
expect(modifierTotalsFromAbilities([intrusion], ctx({ enemyDebuffCount: 3 })).outgoingDamage).toBe(15); // 5 × 3
expect(modifierTotalsFromAbilities([intrusion], ctx({ enemyDebuffCount: 0 })).outgoingDamage).toBe(0);

const [warp] = buildEquipmentAbilities(shipWithWarpstrike, getGearPiece);
expect(modifierTotalsFromAbilities([warp], ctx({ selfDebuffNames: ['Burn'] })).outgoingDamage).toBe(5);
expect(modifierTotalsFromAbilities([warp], ctx({ selfDebuffNames: [] })).outgoingDamage).toBe(0);
expect(modifierTotalsFromAbilities([warp], ctx({ selfDebuffNames: ['A', 'B'] })).outgoingDamage).toBe(5); // flat, not 10

const [siege] = buildEquipmentAbilities(shipWithArcaneSiege, getGearPiece);
expect(modifierTotalsFromAbilities([siege], ctx({ selfShielded: true })).outgoingDamage).toBe(15);
expect(modifierTotalsFromAbilities([siege], ctx({ selfShielded: false })).outgoingDamage).toBe(0);
```
`ctx(over)` = a `ConditionContext` helper (reuse the Task 2 `baseCtx`).

- [ ] **Step 2: Write an engine-level integration test (Intrusion)**

Mirror the D-PR1 end-to-end harness: run a single attacker (equipped with Intrusion) through the engine against an enemy carrying N debuffs, and assert its direct damage is `× (1 + perUnit·N/100)` of the same attacker with no implant. Keep N and the debuff source deterministic. If the existing harness makes a full engine assertion heavy, the modifier-fold-level test in Step 1 + the registry tests in Task 3 are the load-bearing coverage; the engine-level test is a thin confirmation that the passive modifier reaches the fold. Confirm scope at impl time.

- [ ] **Step 3: Run the integration tests, verify they pass**

Run: `npx vitest run <new test path>`
Expected: PASS.

- [ ] **Step 4: Lint + tsc + commit**

```bash
npm run lint && npx tsc --noEmit
git add <new test path>
git commit -m "test(combat): D-PR2 — integration: conditional outgoing-damage implants amplify direct damage"
```

---

## Task 7: Changelog + in-app docs

**Goal:** User-facing entry + keep combat docs in sync.

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if it documents which implant/gear effects the sim models)

- [ ] **Step 1: Add an UNRELEASED_CHANGES entry**

Plain-English, e.g.:
```
The combat & DPS simulators now model the Intrusion, Arcane Siege, and Warpstrike implants — your outgoing damage scales with debuffs on the target, your own shield, and your own debuffs respectively. The DPS calculator now accounts for equipped implant and gear-set effects.
```

- [ ] **Step 2: Update DocumentationPage if it lists modeled equipment effects**

Grep `DocumentationPage.tsx` for the D-PR1 equipment-effects mention (Leech/Bloodthirst). If present, extend it with the three new implants. If no such section exists, skip.

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR2 — changelog + docs for conditional outgoing-damage implants"
```

---

## Task 8: Final verification gate

**Goal:** Whole-PR green + byte-identical confirmation before review/merge.

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all green; test count = D-PR1 baseline + the new tests; ZERO unexplained failures.

- [ ] **Step 2: Lint + type check + skill audit**

Run:
```bash
npm run lint
npx tsc --noEmit
npm run audit:skills
```
Expected: lint 0 warnings; tsc clean; audit 141 ships / 0 findings (unchanged).

- [ ] **Step 3: Confirm zero golden movement**

Run: `git status --porcelain && git diff --stat HEAD~7 -- '*.snap'`
Expected: no `.snap` files modified across the PR.

- [ ] **Step 4: Update project memory**

Append D-PR2 shipped facts to the combat-realism epic memory node (`project_combat_realism_epic.md`): effects, the modifier-fold approach (overriding the earlier conditionalBonusPct framing), the new `self-shield` condition, DPS-page wiring, and "what's next in D" (Giant Slayer/Menace/Insidiousness/Voidfire; Warpstrike duration-reduction half; incoming-reduction bucket).

---

## Done criteria

- Intrusion / Arcane Siege / Warpstrike emit passive `outgoingDamage` modifiers from the registry; the engine folds them (gated + scaled) into direct damage.
- `self-shield` condition added and unit-tested; threaded from `actor.shieldPool`.
- DPS calculator page consumes equipment abilities.
- Coverage tracker + integration tests green.
- All DPS / battle-sim / healing goldens byte-identical.
- Changelog + docs updated.
