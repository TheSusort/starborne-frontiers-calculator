# Boost Gear Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the Boost gear set (4-piece) so that every buff the wearer applies — its own self-buffs and buffs it grants allies — lasts +1 turn, in both the combat simulator and the DPS calculator.

**Architecture:** Boost is caster-side and lives at the buff-duration write seams in `statusEngine.ts`, NOT in the ability damage/heal fold. A new no-op `AbilityConfig` variant `buff-duration-extension` (mirrors REFLECT's `damage-reflection`) is emitted by the gear-set registry; the engine scans every actor's passive slots into a per-owner extension map BEFORE constructing the status engine, and threads a `buffDurationExtensionFor(casterId)` lookup into `StatusEngineInput`. The status engine adds the extension at the two `turnsRemaining` writes, gated to finite-duration self-side buffs.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. All combat code is pure TypeScript under `src/utils/combat/` and `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-26-boost-gear-set-design.md`

**Branch / worktree:** `feat/combat-d-pr-boost-set` in `.worktrees/boost-set` (off main `bd2b6aa8`).

---

## Background an implementer needs

- **The effect:** `GEAR_SETS.BOOST` (`src/constants/gearSets.ts`) is `{ name:'Boost', stats:[], minPieces:4, description:'All buffs last an extra turn' }`. Wearing **≥4 Boost pieces** → every buff the wearer **applies** lasts **+1 turn**, wherever it lands (its own self-buffs + buffs it grants allies). Caster-side: the determinant is the *applying* ship's set, not whose buff it sits on. Binary bonus (+1 at ≥4 pieces; 6 pieces is still +1).
- **Excluded (by design):** debuffs the wearer inflicts on enemies (those land enemy-side); permanent / recurring / persistent-stacking buffs (no finite duration). These fall out for free — see the two seams below.
- **The two buff-duration write seams** in `src/utils/combat/statusEngine.ts`:
  1. `upsertBuff(buff, side)` (~633) — scheduled ship-skill buffs. The self-side write is `turnsRemaining: buff.skillDuration` (~649), guarded by `familyApplicationWins(existing, tier, buff.skillDuration)` (~646). Called ONLY from `sourceFired(sourceId, slot, round)`: self at ~711 (`upsertBuff(buff, 'self')`), enemy at ~735. `sourceId` is the caster and is in scope at both calls. Scheduled self-buffs are stored under the `'attacker'` carrier owner regardless of `sourceId` — the +1 must gate on the firing `sourceId`, not the carrier.
  2. `applyTimedAbilityStatus(round, status, recipientId?, enemyTargetId?)` (~1083) — ability-granted buffs (self + ally targets + reactive grants). The write is `turnsRemaining: status.duration` (~1138), guarded by `familyApplicationWins(existing, tier, status.duration)` (~1135). `status.casterId` is the applying ship (stamped at registration); may be undefined only in unit-test fixtures → default to `'attacker'`.
  - Both writes sit AFTER the `PERSISTENT_STACKING_BUFFS.has(...)` early-returns (~639 / ~1114) and the numeric-duration guards, so persistent/permanent/recurring buffs never reach them — no extra guard needed.
  - **Dual-write footgun:** each seam references the duration TWICE (the family-rule check AND the store). Compute the extended duration once and use it in BOTH, or a Boost re-cast of an N-turn buff fails the `> N` family win-check and silently drops the +1.
- **REFLECT precedent (copy this shape):** `GEAR_SET_ABILITIES.REFLECT` (`src/utils/abilities/buildEquipmentAbilities.ts` ~116) emits `{ type:'modifier' (placeholder), target:'self', trigger:'on-cast', conditions:[], config:{ type:'damage-reflection', pct:10 }, autoFilled:true }`. The engine keys on `config.type`, never the placeholder top-level `type`. The modifier fold ignores it (`applyAbilities.ts:38` skips any ability whose `config.type !== 'modifier'`), so it is inert in damage math. BOOST mirrors this exactly.
- **Engine collection ordering:** `createStatusEngine(...)` is constructed at `engine.ts:1422`, but the existing per-owner ability maps (`incomingAbilitiesById` etc.) are built ~2257+ from runtimes that don't exist at 1422. So the Boost map MUST be built from the raw `ShipSkills` (which already contain the BOOST passive — merged at the page level by `buildShipAbilitiesWithEquipment`) BEFORE line 1422. Available at that point: `input.shipSkills` (attacker, id `'attacker'`), `teamActors` (normalized at 1204, each `{ id, shipSkills }`), `input.enemyAttackers` (each `{ id, shipSkills? }`).
- **DPS path:** `simulateDPS` (`dpsSimulator.ts` ~274) calls `runCombat`; it does NOT build its own `StatusEngineInput`. Threading the lookup once into the single `createStatusEngine` covers DPS automatically.
- **Golden safety:** no combat/DPS fixture equips a 4-piece BOOST set, so `buffDurationExtensionFor` returns 0 everywhere in the existing suite → byte-identical goldens/`.snap`. (The only BOOST test references are autogear fast-scoring equivalence fixtures, which don't run the engine.)

### Commands

- Single test file: `npm test -- src/path/to/file.test.ts`
- Single test by name: `npm test -- src/path/to/file.test.ts -t "name fragment"`
- Full suite: `npm test`  ·  Types: `npx tsc --noEmit`  ·  Lint: `npm run lint`  ·  Skill audit: `npm run audit:skills`
- **Commit:** the husky pre-commit hook runs the full vitest suite. For code commits let it run. The worktree already has `.env` copied in (needed or ~14 `.tsx` test files fail to collect).

---

## File Structure

- **Create** `src/utils/combat/buffDurationExtension.ts` — pure helper: scan a `ShipSkills`' passive slots for `buff-duration-extension` configs → max turns; build a per-owner `Map`.
- **Create** `src/utils/combat/__tests__/buffDurationExtension.test.ts` — unit tests for the helper.
- **Create** `src/utils/combat/__tests__/boostGearSet.integration.test.ts` — engine + DPS integration via the real registry.
- **Modify** `src/types/abilities.ts` — add the `buff-duration-extension` `AbilityConfig` variant.
- **Modify** `src/utils/abilities/buildEquipmentAbilities.ts` — `GEAR_SET_ABILITIES.BOOST` entry.
- **Modify** `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` — BOOST registry test.
- **Modify** `src/utils/combat/statusEngine.ts` — `StatusEngineInput.buffDurationExtensionFor?`; apply +1 at the two seams (`upsertBuff` gains a caster param).
- **Modify** `src/utils/combat/__tests__/statusEngine.test.ts` — pure-seam unit tests.
- **Modify** `src/utils/combat/engine.ts` — build the per-owner map before 1422; pass the lookup into `createStatusEngine`.
- **Modify** `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — add BOOST to the implemented gear-set sets (2 spots).
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- **Modify** `src/pages/DocumentationPage.tsx` — note Boost is modeled.

---

## Task 1: AbilityConfig variant + BOOST registry entry

**Files:**
- Modify: `src/types/abilities.ts:326-510` (the `AbilityConfig` union — add a variant at the end, next to `damage-reflection`)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (add `BOOST` to `GEAR_SET_ABILITIES`, ~after the SHIELD entry ~146)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `buildEquipmentAbilities.test.ts` (follow the existing REFLECT test block ~ near other gear-set tests; reuse the file's existing `makePiece` / ship-builder helpers — match how REFLECT/SHIELD tests construct a ship with N set pieces):

```typescript
describe('buildEquipmentAbilities — Boost set', () => {
    it('emits a buff-duration-extension ability (turns 1) when ≥4 BOOST pieces are equipped', () => {
        // Build a ship with 4 BOOST gear pieces (copy the REFLECT test's piece-construction).
        const { ship, getGearPiece } = buildShipWithSet('BOOST', 4); // use the file's existing helper pattern
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const boost = abilities.find((a) => a.id === 'equip-set-BOOST');
        expect(boost).toBeDefined();
        expect(boost!.config).toEqual({ type: 'buff-duration-extension', turns: 1 });
        expect(boost!.type).toBe('modifier'); // placeholder, like REFLECT
    });

    it('emits nothing when only 3 BOOST pieces are equipped (minPieces 4)', () => {
        const { ship, getGearPiece } = buildShipWithSet('BOOST', 3);
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities.find((a) => a.id === 'equip-set-BOOST')).toBeUndefined();
    });
});
```

> NOTE: there is no `buildShipWithSet` helper in the file — replicate exactly how the REFLECT/SHIELD `it(...)` blocks build a ship (they loop `minPieces` slots calling `makePiece({ id, slot, setBonus })` into an `equipment` map + a `getGearPiece` lookup). Use 4 pieces for the pass case, 3 for the fail case.

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Boost set"`
Expected: FAIL — `equip-set-BOOST` not found / config type does not exist.

- [ ] **Step 3: Add the AbilityConfig variant**

In `src/types/abilities.ts`, append to the `AbilityConfig` union (after the `damage-reflection` variant ~510, before the closing `;`):

```typescript
    // Boost gear set: caster-side +1-turn extension on every buff the wearer applies.
    // No-op marker config (mirrors damage-reflection) — read by the engine when building
    // the per-owner extension map, NEVER executed by the ability fold.
    | {
          type: 'buff-duration-extension';
          /** Extra turns added to buffs this wearer applies (Boost = 1). */
          turns: number;
      };
```

- [ ] **Step 4: Add the registry entry**

In `src/utils/abilities/buildEquipmentAbilities.ts`, add to `GEAR_SET_ABILITIES` (after the `SHIELD` entry ~146):

```typescript
    // Boost (4pc set): every buff the wearer APPLIES lasts +1 turn (caster-side). Modeled NOT
    // as a damage/heal fold but as a marker the engine collects into a per-owner extension map,
    // applied at the status-engine buff-duration write seams. Top-level type:'modifier' is a
    // placeholder (engine keys on config.type:'buff-duration-extension', like REFLECT). The
    // modifier fold ignores it (applyAbilities.ts skips config.type !== 'modifier').
    BOOST: () => ({
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'buff-duration-extension', turns: 1 },
        autoFilled: true,
    }),
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test -- src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Boost set"`
Expected: PASS (both cases). Also `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): Boost gear set — buff-duration-extension config + registry entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure per-owner extension helper

**Files:**
- Create: `src/utils/combat/buffDurationExtension.ts`
- Test: `src/utils/combat/__tests__/buffDurationExtension.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
    buffDurationExtensionTurns,
    buildBuffDurationExtensionByOwner,
} from '../buffDurationExtension';
import type { ShipSkills } from '../../../types/abilities';

// Minimal ShipSkills with one passive slot carrying the given ability configs.
const skillsWithPassiveConfigs = (configs: Array<{ type: string; turns?: number }>): ShipSkills =>
    ({
        slots: [
            {
                slot: 'passive',
                abilities: configs.map((config, i) => ({
                    id: `a${i}`,
                    type: 'modifier',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config,
                })),
            },
        ],
    }) as unknown as ShipSkills;

describe('buffDurationExtensionTurns', () => {
    it('returns the turns of a passive buff-duration-extension config', () => {
        expect(
            buffDurationExtensionTurns(
                skillsWithPassiveConfigs([{ type: 'buff-duration-extension', turns: 1 }])
            )
        ).toBe(1);
    });

    it('returns 0 when no buff-duration-extension config is present', () => {
        expect(
            buffDurationExtensionTurns(
                skillsWithPassiveConfigs([{ type: 'damage-reflection' } as never])
            )
        ).toBe(0);
    });

    it('returns 0 for undefined skills', () => {
        expect(buffDurationExtensionTurns(undefined)).toBe(0);
    });

    it('takes the max when multiple extension configs are present', () => {
        expect(
            buffDurationExtensionTurns(
                skillsWithPassiveConfigs([
                    { type: 'buff-duration-extension', turns: 1 },
                    { type: 'buff-duration-extension', turns: 2 },
                ])
            )
        ).toBe(2);
    });
});

describe('buildBuffDurationExtensionByOwner', () => {
    it('maps only owners that carry an extension; lookup of others returns 0', () => {
        const map = buildBuffDurationExtensionByOwner([
            { id: 'attacker', shipSkills: skillsWithPassiveConfigs([{ type: 'buff-duration-extension', turns: 1 }]) },
            { id: 'ally-1', shipSkills: skillsWithPassiveConfigs([{ type: 'damage-reflection' } as never]) },
        ]);
        expect(map.get('attacker')).toBe(1);
        expect(map.has('ally-1')).toBe(false);
    });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- src/utils/combat/__tests__/buffDurationExtension.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

```typescript
import type { ShipSkills } from '../../types/abilities';

/**
 * Boost gear set support. Scans a ship's PASSIVE abilities for `buff-duration-extension`
 * configs (emitted by GEAR_SET_ABILITIES.BOOST) and returns the max extra turns (0 if none).
 * Pure; never throws.
 */
export function buffDurationExtensionTurns(skills: ShipSkills | undefined): number {
    if (!skills?.slots) return 0;
    let max = 0;
    for (const slot of skills.slots) {
        if (slot.slot !== 'passive') continue;
        for (const ability of slot.abilities) {
            if (ability.config.type === 'buff-duration-extension') {
                max = Math.max(max, ability.config.turns);
            }
        }
    }
    return max;
}

/**
 * Build a per-owner extension map from a list of actors. Owners with no extension are
 * ABSENT (callers default a miss to 0). Used by the engine to back the
 * StatusEngineInput.buffDurationExtensionFor lookup.
 */
export function buildBuffDurationExtensionByOwner(
    actors: Array<{ id: string; shipSkills: ShipSkills | undefined }>
): Map<string, number> {
    const map = new Map<string, number>();
    for (const { id, shipSkills } of actors) {
        const turns = buffDurationExtensionTurns(shipSkills);
        if (turns > 0) map.set(id, turns);
    }
    return map;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- src/utils/combat/__tests__/buffDurationExtension.test.ts`
Expected: PASS (all cases). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/buffDurationExtension.ts src/utils/combat/__tests__/buffDurationExtension.test.ts
git commit -m "feat(combat): pure per-owner buff-duration-extension helper (Boost)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Status-engine seam — apply +1 to caster-in-set buffs

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` — `StatusEngineInput` (~17-37), `createStatusEngine` destructure (~339), `upsertBuff` (~633), `sourceFired` self call (~711), `applyTimedAbilityStatus` (~1135-1143)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe('buffDurationExtensionFor (Boost)')` block to `statusEngine.test.ts`. Match the file's existing setup style for constructing an engine + applying a timed ability status (find an existing `applyTimedAbilityStatus` test and copy its scaffolding: `beginRound`, a `timed` `RegisteredAbilityStatus`, then read state via the engine's snapshot/active-status accessors). Cases:

```typescript
// 1. A self-side timed ability buff applied by a caster in the Boost set gets +1 turn.
//    With buffDurationExtensionFor = (id) => id === 'booster' ? 1 : 0, a status with
//    casterId 'booster', side 'self', duration 2 → turnsRemaining 3.
// 2. The same buff applied by casterId 'plain' (not in set) → turnsRemaining 2 (unchanged).
// 3. An enemy-side (side 'enemy') status applied by 'booster' → turnsRemaining unchanged
//    (debuffs the wearer inflicts are NOT extended).
// 4. Family rule: re-applying the SAME family at base duration 2 from 'booster' against an
//    existing turnsRemaining 2 still wins (because the extended 3 > 2) and lands at 3.
// 5. A scheduled self-buff via sourceFired('booster', slot, round) with skillDuration 2 →
//    stored turnsRemaining 3; via sourceFired('plain', ...) → 2.
```

For case 5, seed `teamSources: [{ sourceId: 'booster', selfBuffs: [<a timed buff, skillDuration 2, skillSource matching the fired slot>], enemyDebuffs: [] }]` (and a `'plain'` source), then call `sourceFired(sourceId, slot, round)` and read the `'attacker'` carrier's self map (scheduled self-buffs store under `'attacker'`). Confirm the helper text in the spec: the gate keys on the firing `sourceId`, not the carrier.

Construct the engine with the new input field:
```typescript
const engine = createStatusEngine({
    selfBuffs: [],
    enemyDebuffs: [],
    teamSources: [...],
    buffDurationExtensionFor: (id) => (id === 'booster' ? 1 : 0),
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/utils/combat/__tests__/statusEngine.test.ts -t "Boost"`
Expected: FAIL — `buffDurationExtensionFor` not honored (durations not extended) / type error on the new field.

- [ ] **Step 3: Add the input field + default**

In `StatusEngineInput` (~37, after `landsTimedEnemyApplication?`):

```typescript
    /** Boost gear set: extra turns to add to a TIMED SELF-SIDE buff applied by `casterId`
     *  (the firing source for scheduled buffs, `status.casterId` for ability buffs). Returns 0
     *  for non-wearers. Default → always 0 (byte-identical: no wearer, no change). */
    buffDurationExtensionFor?: (casterId: string) => number;
```

In `createStatusEngine` destructure (~339-340) add:

```typescript
    const buffDurationExtensionFor = input.buffDurationExtensionFor ?? (() => 0);
```

- [ ] **Step 4: Extend `upsertBuff` (seam 1)**

Change the `upsertBuff` signature (~633) to accept the firing caster id, and apply the extension to the self-side numeric write — computed ONCE, used in BOTH the family-rule check and the store:

```typescript
    const upsertBuff = (buff: SelectedGameBuff, side: 'self' | 'enemy', casterId?: string) => {
        // ... PERSISTENT_STACKING_BUFFS early-return unchanged ...
        if (typeof buff.skillDuration !== 'number') return;
        const { familyKey, tier } = deriveFamilyKey(buff.buffName);
        // Boost: +N turns on a buff the caster APPLIES, self-side only (debuffs land enemy-side).
        const extension = side === 'self' && casterId ? buffDurationExtensionFor(casterId) : 0;
        const duration = buff.skillDuration + extension;
        const existing = map.get(familyKey);
        if (!familyApplicationWins(existing, tier, duration)) return;
        map.set(familyKey, {
            buffName: buff.buffName,
            turnsRemaining: duration,
            tier,
            appliedSeq: nextAppliedSeq(),
        });
    };
```

Update the two `sourceFired` call sites: self (~711) → `upsertBuff(buff, 'self', sourceId)`; enemy (~735) → leave as `upsertBuff(buff, 'enemy')` (or pass `sourceId` — it is ignored for the enemy side).

- [ ] **Step 5: Extend `applyTimedAbilityStatus` (seam 2)**

At the write region (~1135-1143), compute the extended duration once (self-side only, caster fail-safe to `'attacker'`) and use it in BOTH the family check and the store:

```typescript
        const extension =
            status.side === 'self' ? buffDurationExtensionFor(status.casterId ?? 'attacker') : 0;
        const duration = status.duration + extension;
        const { familyKey, tier } = deriveFamilyKey(status.payload.buffName);
        const existing = map.get(familyKey);
        if (!familyApplicationWins(existing, tier, duration)) return;
        map.set(familyKey, {
            buffName: status.payload.buffName,
            turnsRemaining: duration,
            tier,
            payload: status.payload,
            casterId: status.casterId,
            appliedSeq: nextAppliedSeq(),
        });
```

(Persistent-stacking is already handled by the early-return above this block — no change there.)

- [ ] **Step 6: Run, verify pass**

Run: `npm test -- src/utils/combat/__tests__/statusEngine.test.ts`
Expected: PASS (new Boost cases + all existing statusEngine tests unchanged).

- [ ] **Step 7: Confirm no other `upsertBuff` callers**

Run: `grep -n "upsertBuff" src/utils/combat/statusEngine.ts`
Expected: definition (~633) + the two `sourceFired` calls only. If any other caller exists, verify the caster id passed there is correct (or pass nothing → ext 0).

- [ ] **Step 8: Commit**

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat(combat): Boost — +1 turn on caster-in-set buffs at status-engine seams

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Engine wiring — build the per-owner map, thread the lookup

**Files:**
- Modify: `src/utils/combat/engine.ts` — build the map before `createStatusEngine` (~1422); pass `buffDurationExtensionFor`
- Test: `src/utils/combat/__tests__/boostGearSet.integration.test.ts` (created in Task 5; this task is verified by the full suite staying byte-identical)

- [ ] **Step 1: Build the map before construction**

Immediately before `const statusEngine = createStatusEngine({` (~1422), insert:

```typescript
    // Boost gear set: per-owner buff-duration extension. Built from the RAW ShipSkills (which
    // already carry the BOOST passive merged by buildShipAbilitiesWithEquipment at the page
    // level) BEFORE the status engine is constructed — the runtime-derived ability maps
    // (incomingAbilitiesById etc.) aren't built until much later (~2257). Covers all actors
    // team-agnostically: attacker + walked team allies + enemy attackers.
    const buffDurationExtensionByOwner = buildBuffDurationExtensionByOwner([
        { id: 'attacker', shipSkills: input.shipSkills },
        ...teamActors.map((t) => ({ id: t.id, shipSkills: t.shipSkills })),
        ...(input.enemyAttackers ?? []).map((e) => ({ id: e.id, shipSkills: e.shipSkills })),
    ]);
```

Add the import at the top of `engine.ts` (near the other `src/utils/combat` imports):

```typescript
import { buildBuffDurationExtensionByOwner } from './buffDurationExtension';
```

> VERIFY while implementing: `input.shipSkills` is the RAW attacker skills (the local `shipSkills` binding is rebound to the partitioned cast-only subset at ~1227, but `input.shipSkills` still holds the full skills with the passive slot). `teamActors` (normalized ~1204) and `input.enemyAttackers` each expose `{ id, shipSkills }`. Confirm the `shipSkills` field names on the team/enemy actor types (`t.shipSkills`, `e.shipSkills`); adjust if the walked-actor type names it differently.

- [ ] **Step 2: Pass the lookup into `createStatusEngine`**

In the `createStatusEngine({ ... })` literal (~1422-1432), add a field:

```typescript
        buffDurationExtensionFor: (casterId) => buffDurationExtensionByOwner.get(casterId) ?? 0,
```

- [ ] **Step 3: Verify the full suite is byte-identical**

Run: `npm test`
Expected: ALL existing tests pass with ZERO golden/`.snap` movement (no fixture equips Boost → lookup returns 0 everywhere). If any golden moves, STOP — a fixture unexpectedly equips Boost or the gate leaked; do not update goldens.

Run: `npx tsc --noEmit` and `npm run lint` — both clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): Boost — collect per-owner extension, thread into status engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Integration tests — combat sim + DPS via the real registry

**Files:**
- Create: `src/utils/combat/__tests__/boostGearSet.integration.test.ts`

Use the **real** registry path (`buildShipAbilitiesWithEquipment(ship, getGearPiece)` with `setBonus:'BOOST'` on 4 pieces), NOT a hand-rolled ability — this is the D-PR16 mutation-resistance lesson (a hand-rolled ability lets a broken wiring still pass). Find a sibling integration test (`reflectGearSet.integration.test.ts` / `revengeGearSet.integration.test.ts`) and copy its harness: how it builds a ship with a gear set, supplies `getGearPiece`, runs `simulateBattle`/`runCombat`, and asserts on `RoundData`/status state.

- [ ] **Step 1: Write the integration tests**

```typescript
// Harness mirrors revengeGearSet.integration.test.ts. Build a ship whose skill grants itself a
// timed self-buff (e.g. Attack Up for 2 turns) and equip it with 4 BOOST pieces via getGearPiece.

// Test A — self-buff extended: run the sim with BOOST equipped vs without; the wearer's
//   self-buff is active for one more round with BOOST (assert via the status snapshot / a
//   round where the buffed stat is still elevated that is bare without BOOST).
// Test B — ally-buff extended: a buffer ship granting an ally a timed buff, with the buffer
//   wearing BOOST → the ally's buff lasts +1 turn. (If no convenient ally-buff fixture exists,
//   cover this at the engine level by asserting buildBuffDurationExtensionByOwner maps the
//   buffer id AND that an applyTimedAbilityStatus with that casterId extends — i.e. lean on the
//   Task 3 unit test for the seam and keep this integration case to the self-buff path.)
// Test C — enemy debuff NOT extended: the BOOST wearer inflicts a timed debuff on an enemy;
//   the debuff duration is unchanged vs. without BOOST.
// Test D — registry shape: buildShipAbilitiesWithEquipment(ship, getGearPiece) yields a passive
//   ability with config { type:'buff-duration-extension', turns:1 } (proves the wiring routes
//   through the real registry, not a stub).
```

- [ ] **Step 2: Write a DPS integration assertion**

```typescript
// Test E (DPS) — simulateDPS for a self-buffing attacker yields >= DPS with BOOST equipped vs
//   without (extended self-buff uptime). Copy the simulateDPS setup from an existing dps test
//   (e.g. decimationDps.test.ts). Assert dpsWithBoost > dpsWithoutBoost (strictly greater if the
//   buff is damage-relevant and its base duration is shorter than the modeled horizon).
```

- [ ] **Step 3: Run, verify pass**

Run: `npm test -- src/utils/combat/__tests__/boostGearSet.integration.test.ts`
Expected: PASS. If Test E is not strictly greater, inspect the buff/horizon and adjust the fixture so the extra turn falls within the modeled rounds (document the choice in a comment).

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/boostGearSet.integration.test.ts
git commit -m "test(combat): Boost integration — self-buff/DPS extended, enemy debuff unchanged

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Coverage tracker + changelog + docs

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (2 spots: the `it('exactly {...}')` title + `.toEqual([...])` array ~130, and `IMPLEMENTED_SETS` ~195)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Update the coverage tracker test**

In `equipmentCoverage.test.ts`: add `'BOOST'` to the `implementedSets` `.toEqual([...])` array (~130, keep alphabetical/decl order consistent with the file) and to the `IMPLEMENTED_SETS` `new Set([...])` (~195). Update the long `it('exactly { ... } are currently implemented')` title string to include BOOST.

- [ ] **Step 2: Run the coverage test**

Run: `npm test -- src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS.

- [ ] **Step 3: Changelog**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (plain English, match the existing entry voice):

```
'The combat and DPS simulators now model the Boost gear set: while a ship wears 4+ Boost pieces, every buff it applies — to itself or its allies — lasts one extra turn.'
```

- [ ] **Step 4: Docs**

In `src/pages/DocumentationPage.tsx`, find where the other special-effect gear sets (Reflect/Revenge/Burner/Decimation) are described and add a Boost line: "Boost (4-piece): buffs the wearer applies last +1 turn (modeled in the combat + DPS simulators)." Match the surrounding markup/components.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): Boost gear set — coverage tracker, changelog, in-app docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: ALL pass; ZERO golden/`.snap` movement vs main. (Pre-existing env-failing `.tsx` files needing Supabase URL or gitignored `docs/*.csv` are NOT ours — confirm the count matches main's baseline, not new failures.)

- [ ] **Step 2: Types, lint, skill audit**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → clean (max-warnings 0).
Run: `npm run audit:skills` → unchanged (e.g. 141/0).

- [ ] **Step 3: Confirm byte-identical goldens explicitly**

Run: `git status --porcelain` and `git diff --stat` — ensure NO `__snapshots__/*.snap` or golden fixture files are modified. If any are, investigate (do NOT `vitest -u`).

- [ ] **Step 4: Requesting code review**

Use superpowers:requesting-code-review for a holistic review against this plan + the spec before opening the PR.

---

## Notes / pitfalls

- **Never run `vitest -u`** — golden movement here means a real regression, not a stale snapshot.
- **Caster vs carrier:** scheduled self-buffs are stored under the `'attacker'` carrier but the +1 gates on the firing `sourceId`. Keep these distinct.
- **Compute-once:** at both seams the extended duration must feed the `familyApplicationWins` check AND the `turnsRemaining` store.
- **`'attacker'` fail-safe:** only unit-test fixtures omit `status.casterId`; `?? 'attacker'` returns 0 in every byte-identical suite.
- **DPS needs no separate file** — it routes through the single `createStatusEngine`.
- **Pre-existing `BoostSetStatus.tsx`** is a cosmetic presence indicator (reads `activeSets`); unrelated, no change, no double-count.
