# Burner + Decimation Gear-Set DoT Pair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two DoT-related special-effect gear sets — Burner (applies Inferno 1 / 2 turns on cast) and Decimation (+10% DoT damage per complete 2pc set) — to the equipment-ability registry, so the battle simulator and DPS calculator honor them.

**Architecture:** Burner rides the existing reactive DoT executor as an `on-cast` `dot` ability. Decimation is a standing passive `modifier` ability feeding a **new `dotDamage` modifier channel** that folds into `dmgStats.selfDotDamageModifier` (effectiveStats.ts) → `dotMult` (playerTurn.ts). Because `runPlayerTurn` is shared by both `simulateBattle` and the DPS calc's `runCombat`, and `modifierAbilities` already includes the passive slot, the single engine fold makes **both** paths honor Decimation — no separate DPS-wiring change. No combat fixture equips either set → byte-identical goldens.

**Tech Stack:** React 18 / TypeScript / Vitest. Registry pattern in `src/utils/abilities/buildEquipmentAbilities.ts` (`GEAR_SET_ABILITIES`). Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-24-gear-set-dot-pair-design.md`

**Worktree:** `.worktrees/gear-set-dot-pair`, branch `feat/combat-gear-set-dot-pair` (off main `93a02ad4`; rebase onto final main before PR).

---

## Pre-flight grounding (read before starting)

- **Reactive DoT executor:** `src/utils/combat/triggers.ts` ~1370-1431. A `dot` AbilityConfig
  pushes `{stacks,tier,remainingRounds,sourceId}` to `ctx.infernoEntries`/`corrosionEntries`
  (sourceId = owner) after a landing gate, and emits `dot-applied` to `ctx.enemy.id`.
- **Existing reactive `dot` ability shape:** `src/utils/abilities/buildShipAbilities.ts:1317-1334`
  (`dotAbility`) — copy this exact shape for Burner.
- **DoT tick:** `src/utils/combat/engine.ts:767-771` — inferno tick =
  `stacks × (tier/100) × ctx.effectiveAttack × ctx.dotMult × ctx.affinityMult`, ctx resolved
  per-entry by `sourceId` (the applier). `dotMult` is the applier's.
- **`dotMult`:** `src/utils/combat/playerTurn.ts:1207` =
  `1 + (selfDotModifier + enemyDotMod + dmgStats.selfDotDamageModifier) / 100`.
- **`dmgStats`:** `playerTurn.ts:1136` `effectiveDamageStatsOf({... modifierAbilities, modifierCtx})`;
  `modifierAbilities = [...firing, ...passive]` (playerTurn.ts:1129) — passive slot holds equipment abilities.
- **Fold point:** `src/utils/combat/effectiveStats.ts:214` `selfDotDamageModifier: dotPen.dotDamageModifier`.
- **Inferno tier scale:** `src/types/calculator.ts:84` — Inferno 1/2/3 = tier 15/30/45 → **Burner = tier 15**.
- **Gear-set activation loop:** `buildEquipmentAbilities.ts:825-834` — has `count` (pieces) and
  `minPieces` in scope; builder is currently `() => Omit<Ability,'id'>`.

---

## Task 1: Add `dotDamage` modifier channel (type + fold)

**Files:**
- Modify: `src/types/abilities.ts:291-300` (`ModifierChannel` union)
- Modify: `src/utils/abilities/applyAbilities.ts:6-14` (`ModifierTotals`), `:26-34` (init), `:50-73` (switch)
- Test: `src/utils/abilities/__tests__/applyAbilities.test.ts`

- [ ] **Step 1: Write the failing test** — add to `applyAbilities.test.ts`:

```typescript
import { Ability } from '../../../types/abilities';
// (reuse existing makeConditionContext / ctx fixture in this file)

describe('modifierTotalsFromAbilities — dotDamage channel', () => {
    it('sums a dotDamage modifier into ModifierTotals.dotDamage', () => {
        const ability: Ability = {
            id: 'decimation-x',
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'modifier', channel: 'dotDamage', value: 20, isMultiplicative: false },
        };
        const totals = modifierTotalsFromAbilities([ability], makeConditionContext({}));
        expect(totals.dotDamage).toBe(20);
        // other channels untouched
        expect(totals.outgoingDamage).toBe(0);
        expect(totals.attack).toBe(0);
    });
});
```

(Check the top of `applyAbilities.test.ts` for the existing `makeConditionContext`/ctx helper and
`modifierTotalsFromAbilities` import; reuse them. If a context fixture lives in
`src/utils/abilities/__tests__/conditionContextFixture.ts`, import from there.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/applyAbilities.test.ts -t "dotDamage channel"`
Expected: FAIL — `totals.dotDamage` is `undefined` (property doesn't exist) / TS error.

- [ ] **Step 3: Add the channel to the type.** In `src/types/abilities.ts`, add `| 'dotDamage'`
  to the `ModifierChannel` union (after `'outgoingDamage'`):

```typescript
export type ModifierChannel =
    | 'attack'
    | 'defense'
    | 'defensePenetration'
    | 'hp'
    | 'crit'
    | 'critDamage'
    | 'outgoingDamage'
    | 'dotDamage'
    | 'outgoingHeal'
    | 'incomingDamage';
```

- [ ] **Step 4: Add the bucket + case** in `src/utils/abilities/applyAbilities.ts`:
  - Add `dotDamage: number;` to the `ModifierTotals` interface (after `outgoingDamage`).
  - Add `dotDamage: 0,` to the `totals` initializer (after `outgoingDamage: 0,`).
  - Add a case in the `switch (channel)` (after the `'outgoingDamage'` case):

```typescript
            case 'dotDamage':
                totals.dotDamage += amount;
                break;
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/applyAbilities.test.ts -t "dotDamage channel"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/utils/abilities/applyAbilities.ts src/utils/abilities/__tests__/applyAbilities.test.ts
git commit -m "feat(combat): add dotDamage modifier channel"
```

---

## Task 2: Fold `mod.dotDamage` into `selfDotDamageModifier`

**Files:**
- Modify: `src/utils/combat/effectiveStats.ts:214`
- Test: `src/utils/combat/__tests__/effectiveStats.test.ts`

- [ ] **Step 1: Write the failing test** — add to `effectiveStats.test.ts` (mirror an existing
  `effectiveDamageStatsOf` test in that file for the args shape; the key assertion):

```typescript
it('includes a dotDamage modifier ability in selfDotDamageModifier', () => {
    const dotMod: Ability = {
        id: 'dec',
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'modifier', channel: 'dotDamage', value: 30, isMultiplicative: false },
    };
    const stats = effectiveDamageStatsOf({
        base: { attack: 100, defence: 50, crit: 0, critDamage: 50, hp: 1000, defensePenetration: 0, defensePenetrationBuff: 0 },
        scheduledTotals: /* zeroed calculateBuffTotals shape — copy from an existing test */ ZERO_TOTALS,
        abilitySelfEffects: [],
        modifierAbilities: [dotMod],
        modifierCtx: /* a context where conditions [] are met — copy existing helper */ EMPTY_CTX,
    });
    expect(stats.selfDotDamageModifier).toBe(30);
});
```

(Reuse whatever zeroed-totals/empty-ctx helpers the existing tests in this file already use;
do not invent new fixture shapes.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/effectiveStats.test.ts -t "dotDamage modifier"`
Expected: FAIL — `selfDotDamageModifier` is `0` (mod.dotDamage not folded yet).

- [ ] **Step 3: Implement the fold.** In `effectiveStats.ts`, change line 214 from:

```typescript
        selfDotDamageModifier: dotPen.dotDamageModifier,
```
to:
```typescript
        selfDotDamageModifier: dotPen.dotDamageModifier + mod.dotDamage,
```

(`mod = modifierTotalsFromAbilities(...)` is already in scope at line 184.)

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/effectiveStats.test.ts -t "dotDamage modifier"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/effectiveStats.ts src/utils/combat/__tests__/effectiveStats.test.ts
git commit -m "feat(combat): fold dotDamage modifier into selfDotDamageModifier (dotMult)"
```

---

## Task 3: Widen gear-set builder signature + Decimation registry entry

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`GEAR_SET_ABILITIES` type ~`:849`,
  the `DECIMATION` entry, and the call site `:832`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test** — add to `buildEquipmentAbilities.test.ts` (reuse its
  `makeShip`/`makePiece`/`getGearPiece` helpers; equip Decimation pieces):

```typescript
describe('Decimation gear set', () => {
    function shipWithDecimation(pieces: number) {
        const equipment: Record<string, string> = {};
        const map: Record<string, GearPiece> = {};
        const slots = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'];
        for (let i = 0; i < pieces; i++) {
            const id = `dec-${i}`;
            equipment[slots[i]] = id;
            map[id] = makePiece({ id, slot: slots[i] as GearPiece['slot'], setBonus: 'DECIMATION' });
        }
        return { ship: makeShip({ equipment }), getGearPiece: (id: string) => map[id] };
    }

    it('emits a dotDamage modifier scaling 10% per complete 2pc set', () => {
        for (const [pieces, expected] of [[2, 10], [4, 20], [6, 30]] as const) {
            const { ship, getGearPiece } = shipWithDecimation(pieces);
            const abilities = buildEquipmentAbilities(ship, getGearPiece);
            const dec = abilities.find((a) => a.id === 'equip-set-DECIMATION');
            expect(dec?.type).toBe('modifier');
            expect(dec?.config).toMatchObject({ type: 'modifier', channel: 'dotDamage', value: expected });
        }
    });

    it('emits nothing below minPieces (1 piece)', () => {
        const { ship, getGearPiece } = shipWithDecimation(1);
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities.find((a) => a.id === 'equip-set-DECIMATION')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Decimation"`
Expected: FAIL — no `equip-set-DECIMATION` ability emitted.

- [ ] **Step 3: Widen the builder type + call site.** In `buildEquipmentAbilities.ts`:
  - Change the registry type from
    `Partial<Record<string, () => Omit<Ability, 'id'>>>` to
    `Partial<Record<string, (count: number) => Omit<Ability, 'id'>>>`.
  - At the call site (line ~832), pass `count`:
    ```typescript
        const partial = builder(count);
        abilities.push({ id: `equip-set-${setName}`, ...partial });
    ```
  - (Existing `LEECH`/`HARDENED` builders take no param — JS ignores the extra arg, byte-identical.
    Optionally give them `(_count)` signatures for lint cleanliness if ESLint flags arity.)

- [ ] **Step 4: Add the DECIMATION entry** to `GEAR_SET_ABILITIES` (after `HARDENED`):

```typescript
    // Decimation (2pc set): +10% DoT damage per complete set, max 3 sets (6 pieces) = +30%.
    // Standing passive → modeled as a dotDamage modifier that folds into dotMult via
    // effectiveDamageStatsOf.selfDotDamageModifier (engine + DPS calc both honor it).
    DECIMATION: (count) => {
        const minPieces = GEAR_SETS.DECIMATION?.minPieces ?? 2;
        const sets = Math.floor(count / minPieces); // 1/2/3 at 2/4/6 pieces
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'modifier', channel: 'dotDamage', value: sets * 10, isMultiplicative: false },
            autoFilled: true,
        };
    },
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Decimation"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): Decimation gear set — +10%/set DoT damage modifier"
```

---

## Task 4: Burner registry entry

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`BURNER` entry in `GEAR_SET_ABILITIES`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test:**

```typescript
describe('Burner gear set', () => {
    it('emits an on-cast inferno DoT (tier 15, 1 stack, 2 turns) at 4 pieces', () => {
        const equipment: Record<string, string> = {};
        const map: Record<string, GearPiece> = {};
        const slots = ['weapon', 'hull', 'generator', 'sensor'];
        slots.forEach((slot, i) => {
            const id = `burn-${i}`;
            equipment[slot] = id;
            map[id] = makePiece({ id, slot: slot as GearPiece['slot'], setBonus: 'BURNER' });
        });
        const abilities = buildEquipmentAbilities(makeShip({ equipment }), (id) => map[id]);
        const burner = abilities.find((a) => a.id === 'equip-set-BURNER');
        expect(burner?.type).toBe('dot');
        expect(burner?.trigger).toBe('on-cast');
        expect(burner?.target).toBe('enemy');
        expect(burner?.config).toMatchObject({
            type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2,
        });
    });

    it('emits nothing below minPieces (3 pieces, needs 4)', () => {
        const equipment: Record<string, string> = {};
        const map: Record<string, GearPiece> = {};
        ['weapon', 'hull', 'generator'].forEach((slot, i) => {
            const id = `burn-${i}`;
            equipment[slot] = id;
            map[id] = makePiece({ id, slot: slot as GearPiece['slot'], setBonus: 'BURNER' });
        });
        const abilities = buildEquipmentAbilities(makeShip({ equipment }), (id) => map[id]);
        expect(abilities.find((a) => a.id === 'equip-set-BURNER')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Burner"`
Expected: FAIL — no `equip-set-BURNER` ability.

- [ ] **Step 3: Add the BURNER entry** to `GEAR_SET_ABILITIES`:

```typescript
    // Burner (4pc set): applies Inferno 1 (tier 15) for 2 turns on cast. Reactive on-cast
    // dot ability — rides the existing reactive DoT executor (triggers.ts), pushing an
    // inferno entry to the cast target with sourceId = owner.
    BURNER: () => ({
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
        autoFilled: true,
    }),
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Burner"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): Burner gear set — applies Inferno 1 for 2 turns on cast"
```

---

## Task 5: Coverage tracker update

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

The `Object.keys(GEAR_SETS)` declaration order puts BURNER and DECIMATION **before** LEECH
(gearSets.ts: BURNER `:64`, DECIMATION `:72`, LEECH `:85`, CLOAKING `:118`, HARDENED `:210`).

- [ ] **Step 1: Update the three coverage spots:**
  - The `exactly {...}` `toEqual` array (line ~127): change `['LEECH', 'CLOAKING', 'HARDENED']`
    to `['BURNER', 'DECIMATION', 'LEECH', 'CLOAKING', 'HARDENED']`.
  - The `IMPLEMENTED_SETS` Set (line ~177): add `'BURNER'`, `'DECIMATION'`.
  - The `it('exactly { ... }')` **title string** (line ~122): add `BURNER + DECIMATION` to the
    gear-sets list in the description text.
  - Add a doc-comment line at the top noting this PR (mirror the `D-PRn added …` lines):
    `* Gear-set DoT pair added BURNER + DECIMATION (gear sets).`

- [ ] **Step 2: Add per-set count assertions** in the `equipmentCoverage — gear sets` describe block:

```typescript
    it('BURNER produces exactly 1 ability (the on-cast inferno)', () => {
        expect(gearSetAbilityCount('BURNER')).toBe(1);
    });
    it('DECIMATION produces exactly 1 ability (the dotDamage modifier)', () => {
        expect(gearSetAbilityCount('DECIMATION')).toBe(1);
    });
```

- [ ] **Step 3: Run the coverage test, verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS. (If the `toEqual` array order is wrong, the failure message prints the actual
order — match it exactly.)

- [ ] **Step 4: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): coverage tracker += Burner, Decimation"
```

---

## Task 6: Engine integration tests (mutation-resistant, real registry)

**Files:**
- Create: `src/utils/combat/__tests__/gearSetDotPair.integration.test.ts`

Route through the **real** registry (`buildShipAbilitiesWithEquipment` + a `getGearPiece`
returning `setBonus:'BURNER'`/`'DECIMATION'`) — NOT hand-rolled abilities — so mutations bite.
Mirror the setup of an existing equipment integration test
(e.g. `equipmentAbilities.integration.test.ts` or the D-PR16 Last Stand integration test) for
how to build a ship, equip gear, and run `simulateBattle`/`runCombat`.

- [ ] **Step 1: Write the tests:**
  - **Burner applies a 2-turn inferno on cast:** equip a ship with 4 Burner pieces, give it a
    plain attack skill, run combat against an enemy; assert the enemy takes inferno-tick damage
    for 2 turns after the cast and none on the 3rd (entry expired). Assert via the `dot-applied`
    event or the per-round inferno-tick damage in the result.
  - **Decimation scales DoT ticks by sets×10%:** a ship that applies a known DoT (e.g. via its
    skill or via Burner), run once with 2 Decimation pieces and once without; assert the
    Decimation run's DoT-tick damage is exactly `×1.10` the control (within rounding). Use a
    deterministic setup (fixed attack, no crit variance on DoT) so the ratio is exact.
  - **Composition:** Burner + Decimation on the same ship → Burner's inferno tick is
    Decimation-boosted (assert the boosted tick vs a Burner-only control).

- [ ] **Step 2: Run, verify PASS**

Run: `npx vitest run src/utils/combat/__tests__/gearSetDotPair.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Mutation sanity check (manual, do not commit the mutation):** temporarily set
  Decimation `value` to `0` and confirm the scaling test fails; revert. Confirms the test bites.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/gearSetDotPair.integration.test.ts
git commit -m "test(combat): Burner + Decimation engine integration (real registry)"
```

---

## Task 7: DPS-calculator verification test

The engine fold (Task 2) should make the DPS calc honor Decimation for free (shared
`runPlayerTurn`). This task **proves** it — and is the fallback trigger if it doesn't.

**Files:**
- Create or extend: a DPS-calc test (mirror an existing `dpsSimulator`/DPS-page calc test that
  builds `shipSkills` via `buildShipAbilitiesWithEquipment` and runs `simulateDPS`/`runCombat`).

- [ ] **Step 1: Write the test** — a ship that applies a DoT, run the DPS sim with vs without 2
  Decimation pieces (built through `buildShipAbilitiesWithEquipment` so the modifier lands in the
  passive slot); assert the Decimation run's DoT contribution to DPS is ~10% higher.

- [ ] **Step 2: Run, verify PASS**

Run: `npx vitest run <new test path>`
Expected: PASS (engine fold flows into DPS).

- [ ] **Step 3 (only if Step 2 FAILS): explicit DPS wiring fallback.** In `dpsSimulator.ts`
  (~241), the top-level `selfDotModifier` is derived from `selfBuffs` only. If the per-round
  fold doesn't reach the DPS DoT output, extract the `dotDamage` channel from the passive
  abilities via `modifierTotalsFromAbilities` and add it into `selfDotModifier`. Add a focused
  test. (Expectation: NOT needed — documented here only as the contingency the spec flagged.)

- [ ] **Step 4: Commit**

```bash
git add <test path>
git commit -m "test(combat): DPS calc honors Decimation via shared engine fold"
```

---

## Task 8: Editor option, changelog, docs

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx:73-83` (`MODIFIER_CHANNEL_OPTIONS`)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (gear-set / DoT section)

- [ ] **Step 1: Editor channel option.** Add to `MODIFIER_CHANNEL_OPTIONS` (after `outgoingDamage`):

```typescript
    { value: 'dotDamage', label: 'DoT Damage' },
```

- [ ] **Step 2: Changelog.** Add to `UNRELEASED_CHANGES` (plain English, user-facing):

```
'Combat sim now models the Burner gear set (applies Inferno 1 for 2 turns on attack) and the Decimation gear set (+10% DoT damage per set).',
```

- [ ] **Step 3: Docs.** In `DocumentationPage.tsx`, find the gear-set / DoT-damage section and
  note that Burner and Decimation special effects are now simulated. Keep it brief, match
  surrounding prose. (Search for "Decimation" — there's an existing mention at ~:1243.)

- [ ] **Step 4: Run lint + tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean (0 warnings — `max-warnings: 0`).

- [ ] **Step 5: Commit**

```bash
git add src/components/skills/AbilityCard.tsx src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "feat(combat): editor channel + changelog + docs for Burner/Decimation"
```

---

## Task 9: Full verification gates

- [ ] **Step 1: Confirm zero combat-fixture usage.** Grep fixtures for the set names:

Run: `grep -rn "BURNER\|DECIMATION" src/utils/combat/__tests__/ src/test/ 2>/dev/null`
Expected: only the NEW integration test (Task 6) and DPS test (Task 7). Any **pre-existing**
combat golden/fixture equipping these → the byte-identical premise breaks; STOP and re-derive
goldens deliberately (never `vitest -u`). Note: `fastScoring`/`fastPotential` autogear scoring
fixtures may mention the names — those are scoring-only, not combat goldens; ignore them.

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: all pass; **zero golden/`.snap` drift** (no fixture equips these sets). Pre-existing
env-failing files (missing Supabase URL, gitignored `docs/*.csv`) are NOT ours — confirm the
failing set is unchanged from a clean baseline.

- [ ] **Step 3: Lint, types, skills audit**

Run: `npm run lint && npx tsc --noEmit && npm run audit:skills`
Expected: lint clean, tsc clean, `audit:skills` 0 failures (unchanged count).

- [ ] **Step 4: Final commit (if any cleanup) + push**

```bash
git push -u origin feat/combat-gear-set-dot-pair
```

(Rebase onto the latest `main` first if the charge stack has merged and advanced it — resolve
in this worktree, do not touch the main checkout.)

---

## Review & PR

- [ ] Run `superpowers:requesting-code-review` (or the `/code-review` skill) on the full diff.
- [ ] Address findings; re-verify suite green + zero golden drift.
- [ ] Open PR with `gh pr create` (run `gh auth switch --user TheSusort` first if needed),
  base `main`, summarizing: Burner (on-cast inferno) + Decimation (dotDamage modifier channel,
  +10%/set), shared engine fold covers both battle-sim and DPS calc, byte-identical goldens.
