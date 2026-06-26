# Lifeline Shield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Lifeline implant — a once-per-battle pre-hit shield grant that fires when a pure direct hit would cross the carrier's HP below 30% of max HP, granting `flatAmount + 100%·attack` (capped at max HP) before the triggering hit's shield-absorb step.

**Architecture:** A victim-side intercept in `applyVictimDamage` (engine.ts), mirroring the D-PR3 `incoming-block`/`incoming-reduction` pattern that already modifies a hit before `shieldAbsorb`. A new `incoming-shield-grant` ability config carries the parameters; a pure helper (`thresholdShield.ts`) decides whether/how much to grant; the engine applies it to `victim.shieldPool` before running the existing `shieldAbsorb` against the boosted pool, then the rest of the hit eats shield→HP per the H1 penetration rules. Once-per-battle via a combat-lifetime Set. Dormant (byte-identical) for any actor without the ability.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-26-lifeline-shield-design.md`

**Branch:** Work on `feat/combat-shield-system-h2-h3` (stacks on the open H2/H3 PR #157, same as H3 stacked on H1). Retarget to `main` once the H stack merges. Subagents MUST NOT run `git checkout` / `git switch` (a prior session left a detached HEAD this way).

---

## File Structure

- **Modify** `src/types/abilities.ts` — add `'incoming-shield-grant'` to the `AbilityType` union (~line 23) and a new variant to the `AbilityConfig` union (~line 440, beside `incoming-block`).
- **Modify** `src/components/skills/AbilityTypePicker.tsx`, `src/components/skills/AbilityCard.tsx`, `src/components/skills/abilityDefaults.ts` — editor exhaustiveness stubs (only where tsc forces them).
- **Create** `src/utils/combat/thresholdShield.ts` — pure `thresholdShieldForHit()` helper.
- **Create** `src/utils/combat/__tests__/thresholdShield.test.ts` — helper unit tests.
- **Modify** `src/utils/combat/engine.ts` — combat-lifetime `thresholdShieldFired` Set (~line 1935 beside `cheatDeathConsumed`); extend the `incomingAbilitiesById` filter (~line 2251); the intercept block in `applyVictimDamage` after `shieldBefore` (~line 2775).
- **Modify** `src/utils/abilities/buildEquipmentAbilities.ts` — `LIFELINE` value table + `IMPLANT_ABILITIES.LIFELINE` builder.
- **Modify** `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — add `LIFELINE` to the three coverage spots + a shape test.
- **Modify** `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` — end-to-end runCombat scenarios.
- **Modify** `src/constants/changelog.ts` + `src/pages/DocumentationPage.tsx` — user-facing docs.

---

## Task 1: Add the `incoming-shield-grant` ability config type

**Files:**
- Modify: `src/types/abilities.ts`
- Modify: `src/components/skills/AbilityTypePicker.tsx`, `src/components/skills/AbilityCard.tsx`, `src/components/skills/abilityDefaults.ts`

- [ ] **Step 1: Add to the `AbilityType` union**

In `src/types/abilities.ts`, in the `AbilityType` union (the one ending `… | 'incoming-block' | 'outgoing-amplification' | …`), add a new member after `'incoming-block'`:

```ts
    | 'incoming-shield-grant'
```

- [ ] **Step 2: Add the `AbilityConfig` variant**

In the `AbilityConfig` union (beside the `incoming-block` variant ~line 451), add:

```ts
    | {
          /** Lifeline: a PRE-hit threshold shield. When a pure direct hit would cross the
           *  carrier's HP below `hpThresholdPct`% of max HP, grant `flatAmount` + `attackPct`%
           *  of the carrier's own effective attack to the shield pool (capped at max HP) BEFORE
           *  the hit's absorb step — so the rest of the same hit drains shield→HP per the H1 pen
           *  rules (the unit can still die). Victim-side / self-scoped; consumed in
           *  applyVictimDamage, NOT via the reactive executor. Once per battle. */
          type: 'incoming-shield-grant';
          hpThresholdPct: number;
          flatAmount: number;
          attackPct: number;
          oncePerCombat: boolean;
      }
```

- [ ] **Step 3: Run tsc to find the exhaustiveness gaps**

Run: `npx tsc --noEmit`
Expected: errors in `AbilityTypePicker.tsx`, `AbilityCard.tsx`, `abilityDefaults.ts` (and possibly others) for the now-missing `'incoming-shield-grant'` case. Note each file/line.

- [ ] **Step 4: Add minimal editor stubs**

For each file tsc flags, add a minimal stub mirroring the existing `incoming-block` entry (a label/option in `AbilityTypePicker`, a render fallback in `AbilityCard`, a default config object in `abilityDefaults`). Use the existing `incoming-block` entry in each file as the template; keep it minimal — these are not user-authored (Lifeline comes from the implant registry). Example default config for `abilityDefaults.ts`:

```ts
case 'incoming-shield-grant':
    return { type: 'incoming-shield-grant', hpThresholdPct: 30, flatAmount: 0, attackPct: 100, oncePerCombat: true };
```

- [ ] **Step 5: Verify tsc clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/components/skills/AbilityTypePicker.tsx src/components/skills/AbilityCard.tsx src/components/skills/abilityDefaults.ts
git commit -m "feat(combat): add incoming-shield-grant ability config (Lifeline)"
```

---

## Task 2: Pure helper `thresholdShieldForHit()`

**Files:**
- Create: `src/utils/combat/thresholdShield.ts`
- Test: `src/utils/combat/__tests__/thresholdShield.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/combat/__tests__/thresholdShield.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { thresholdShieldForHit } from '../thresholdShield';
import type { Ability } from '../../../types/abilities';

const ability = (overrides: Partial<{ flatAmount: number; attackPct: number; hpThresholdPct: number }> = {}): Ability => ({
    id: 'lifeline-1',
    type: 'incoming-shield-grant',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-shield-grant',
        hpThresholdPct: overrides.hpThresholdPct ?? 30,
        flatAmount: overrides.flatAmount ?? 8000,
        attackPct: overrides.attackPct ?? 100,
        oncePerCombat: true,
    },
});

const base = {
    abilities: [ability()],
    maxHp: 10000,
    effectiveAttack: 2000,
    isDirect: true,
    alreadyFired: () => false,
};

describe('thresholdShieldForHit', () => {
    it('fires on a downward crossing below the threshold', () => {
        // currentHp 4000 (40% >= 30%), hit deals 2000 to HP -> 2000 (20% < 30%) => crossing
        const r = thresholdShieldForHit({ ...base, currentHp: 4000, provisionalHpDamage: 2000 });
        expect(r).not.toBeNull();
        expect(r!.grant).toBe(8000 + 2000); // flat + 100% attack
        expect(r!.abilityId).toBe('lifeline-1');
    });

    it('does not fire when already below the threshold pre-hit', () => {
        // currentHp 2500 (25% < 30%) -> not a downward crossing
        const r = thresholdShieldForHit({ ...base, currentHp: 2500, provisionalHpDamage: 1000 });
        expect(r).toBeNull();
    });

    it('does not fire when the hit does not cross the threshold', () => {
        // currentHp 8000 -> 6000 (60% >= 30%)
        const r = thresholdShieldForHit({ ...base, currentHp: 8000, provisionalHpDamage: 2000 });
        expect(r).toBeNull();
    });

    it('does not fire for non-direct damage (DoT / bomb)', () => {
        const r = thresholdShieldForHit({ ...base, currentHp: 4000, provisionalHpDamage: 2000, isDirect: false });
        expect(r).toBeNull();
    });

    it('does not fire when already fired this battle', () => {
        const r = thresholdShieldForHit({ ...base, currentHp: 4000, provisionalHpDamage: 2000, alreadyFired: () => true });
        expect(r).toBeNull();
    });

    it('returns the raw (uncapped) grant — the engine applies the maxHP cap', () => {
        const r = thresholdShieldForHit({ ...base, currentHp: 4000, provisionalHpDamage: 2000, effectiveAttack: 50000 });
        expect(r!.grant).toBe(8000 + 50000); // uncapped; cap is applied at the engine seam
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/combat/__tests__/thresholdShield.test.ts`
Expected: FAIL — module not found / `thresholdShieldForHit` not defined.

- [ ] **Step 3: Implement the helper**

Create `src/utils/combat/thresholdShield.ts`:

```ts
import type { Ability } from '../../types/abilities';

/**
 * Lifeline (incoming-shield-grant) — pre-hit threshold shield decision.
 *
 * Returns the FIRST `incoming-shield-grant` ability that should fire on this hit and the raw
 * (uncapped) shield amount to grant, or null if none fires. Pure — no engine state. The caller
 * applies the max-HP pool cap and records the once-per-battle fired flag.
 *
 * Fires when ALL hold:
 *   (a) the hit is a pure direct hit (no DoT, no bomb portion) — `isDirect`;
 *   (b) the ability has not yet fired this battle — `!alreadyFired(ability.id)`;
 *   (c) a downward crossing of the threshold: pre-hit HP >= T AND would-be HP < T,
 *       where T = hpThresholdPct/100 * maxHp and would-be HP = currentHp - provisionalHpDamage.
 *
 * `provisionalHpDamage` is the HP damage the hit would deal computed against the CURRENT shield
 * pool (a shieldAbsorb run before any Lifeline grant). The grant = flatAmount + effectiveAttack
 * * attackPct/100.
 */
export function thresholdShieldForHit(args: {
    abilities: Ability[];
    currentHp: number;
    maxHp: number;
    provisionalHpDamage: number;
    effectiveAttack: number;
    isDirect: boolean;
    alreadyFired: (abilityId: string) => boolean;
}): { abilityId: string; grant: number } | null {
    const { abilities, currentHp, maxHp, provisionalHpDamage, effectiveAttack, isDirect, alreadyFired } = args;
    if (!isDirect) return null;
    for (const ability of abilities) {
        const cfg = ability.config;
        if (cfg.type !== 'incoming-shield-grant') continue;
        if (alreadyFired(ability.id)) continue;
        const threshold = (cfg.hpThresholdPct / 100) * maxHp;
        const wouldBeHp = currentHp - provisionalHpDamage;
        if (currentHp >= threshold && wouldBeHp < threshold) {
            return {
                abilityId: ability.id,
                grant: cfg.flatAmount + effectiveAttack * (cfg.attackPct / 100),
            };
        }
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/thresholdShield.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/thresholdShield.ts src/utils/combat/__tests__/thresholdShield.test.ts
git commit -m "feat(combat): pure thresholdShieldForHit helper (Lifeline)"
```

---

## Task 3: Engine intercept in `applyVictimDamage`

**Files:**
- Modify: `src/utils/combat/engine.ts`

This task wires the helper into the damage path. There is no isolated unit test for the wiring — correctness is locked by the helper's unit tests (Task 2) plus the end-to-end integration tests (Task 5). The verification gate for this task is: full suite green + production goldens/snapshots **byte-identical** (no `-u`).

- [ ] **Step 1: Add the import**

At the top of `engine.ts`, beside the `shieldAbsorb` import, add:

```ts
import { thresholdShieldForHit } from './thresholdShield';
```

- [ ] **Step 2: Declare the combat-lifetime fired Set**

Next to `const cheatDeathConsumed = new Set<string>();` (~line 1935), add:

```ts
// Lifeline (incoming-shield-grant): once-per-BATTLE fired flags, keyed `${victimId}:${abilityId}`.
// Combat-lifetime (NOT reset per round) — the shield grant occurs at most once per combat.
const thresholdShieldFired = new Set<string>();
```

- [ ] **Step 3: Extend the `incomingAbilitiesById` filter**

In the loop that builds `incomingAbilitiesById` (~line 2251), extend the condition:

```ts
if (
    a.config.type === 'incoming-reduction' ||
    a.config.type === 'incoming-block' ||
    a.config.type === 'incoming-shield-grant'
) {
    incoming.push(a);
}
```

(Confirmed: implant abilities are appended to the `passive` slot by `buildShipAbilitiesWithEquipment`, and this loop only scans `slot.slot === 'passive'` — so Lifeline is collected.)

- [ ] **Step 4: Add the intercept block in `applyVictimDamage`**

Immediately after `const shieldBefore = victim.shieldPool;` (~line 2775) and BEFORE the existing `const { absorbed, hpDamage } = shieldAbsorb({ … });` call, insert:

```ts
// Lifeline (incoming-shield-grant): a PRE-hit threshold shield. When a PURE direct hit
// (no DoT, no bomb portion) would cross this victim's HP below the configured % of max HP,
// grant flat + %-of-attack to the pool BEFORE absorbing, so the rest of THIS hit drains
// shield→HP per the H1 pen rules (the unit can still die). Once per battle. Fully inert
// (no provisional absorb, no helper call) when the victim carries no such ability →
// byte-identical for every existing fixture.
const thresholdShieldAbilities = incomingAbilitiesOf(victim.id).filter(
    (a) => a.config.type === 'incoming-shield-grant'
);
if (thresholdShieldAbilities.length > 0) {
    // Provisional absorb against the CURRENT pool → the HP damage the hit would deal pre-Lifeline.
    const provisional = shieldAbsorb({
        damage,
        shieldPool: victim.shieldPool,
        isDot: cause?.byDirectDamage === false,
        penPct: cause?.shieldPenetrationPct ?? 0,
        bombPortion: cause?.bombPortion ?? 0,
    });
    const grant = thresholdShieldForHit({
        abilities: thresholdShieldAbilities,
        currentHp: victim.currentHp,
        maxHp,
        provisionalHpDamage: provisional.hpDamage,
        effectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack,
        isDirect: cause?.byDirectDamage === true && (cause?.bombPortion ?? 0) === 0,
        alreadyFired: (abilityId) => thresholdShieldFired.has(`${victim.id}:${abilityId}`),
    });
    if (grant) {
        const newPool = Math.min(maxHp, shieldBefore + grant.grant);
        const granted = newPool - shieldBefore;
        victim.shieldPool = newPool;
        thresholdShieldFired.add(`${victim.id}:${grant.abilityId}`);
        // Surface the real pool growth on the H1 granted accumulator (StatCard).
        perActorShieldGranted.set(victim.id, (perActorShieldGranted.get(victim.id) ?? 0) + granted);
    }
}
```

NOTE: verify `effectiveStatsOf`, `statusEngine`, `selfBuffLookup`, and `perActorShieldGranted` are all in lexical scope at this point (they are declared in `runCombat`, which encloses `applyVictimDamage`). If the `effectiveStatsOf(statusEngine, selfBuffLookup, victim)` call signature differs, match the existing call site used by `highestAttackInRoster` / the tank-side effective-stat reads in this file.

- [ ] **Step 5: Run the full suite — expect byte-identical goldens**

Run: `npm test`
Expected: all tests pass with NO golden/snapshot changes (no actor carries `incoming-shield-grant` yet → the block is never entered). If any `.snap` or golden moves, STOP — the intercept is not inert; do not run `vitest -u`.

- [ ] **Step 6: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): Lifeline pre-hit threshold shield intercept in applyVictimDamage"
```

---

## Task 4: Registry entry + coverage tracker

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Add the value table**

In `buildEquipmentAbilities.ts`, beside the other implant value tables (e.g. after `ABUNDANT_RENEWAL_PCT`), add:

```ts
// Lifeline: once-per-battle, when a direct hit would drop HP below 30%, gain a shield equal to
// FLAT + 100% of this unit's attack (capped at max HP). Per-rarity = the flat component only.
const LIFELINE_FLAT: Record<string, number> = {
    common: 4000,
    uncommon: 6000,
    rare: 8000,
    epic: 10000,
    legendary: 12000,
};
```

- [ ] **Step 2: Add the builder**

In the `IMPLANT_ABILITIES` object (after `ADAPTIVE_PLATING`), add:

```ts
// Lifeline: PRE-hit threshold shield (incoming-shield-grant). Consumed victim-side in
// applyVictimDamage, NOT via the reactive executor — the trigger/target wrapper is nominal
// (mirrors SHADOWGUARD's incoming-block). All five rarities present.
LIFELINE: (rarity) => {
    const flatAmount = LIFELINE_FLAT[rarity];
    if (flatAmount === undefined) return undefined;
    return {
        type: 'incoming-shield-grant',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'incoming-shield-grant',
            hpThresholdPct: 30,
            flatAmount,
            attackPct: 100,
            oncePerCombat: true,
        },
        autoFilled: true,
    };
},
```

- [ ] **Step 3: Add a shape test**

In `equipmentCoverage.test.ts`, add (near the ADAPTIVE_PLATING/ABUNDANT_RENEWAL shape tests):

```ts
it('LIFELINE produces 1 ability per rarity (incoming-shield-grant, flat by rarity, 100% attack, threshold 30, once per battle)', () => {
    const flat: Record<string, number> = { common: 4000, uncommon: 6000, rare: 8000, epic: 10000, legendary: 12000 };
    for (const v of IMPLANTS['LIFELINE'].variants) {
        expect(implantAbilityCount('LIFELINE', v.rarity)).toBe(1);
        const abs = implantAbilities('LIFELINE', v.rarity);
        expect(abs[0].config).toMatchObject({
            type: 'incoming-shield-grant',
            hpThresholdPct: 30,
            flatAmount: flat[v.rarity],
            attackPct: 100,
            oncePerCombat: true,
        });
    }
});
```

- [ ] **Step 4: Add `LIFELINE` to the three coverage spots**

In `equipmentCoverage.test.ts`:
1. The `it('exactly { … } are currently implemented', …)` prose string — add `LIFELINE` to the implants list.
2. The `implementedImplants` array passed to `.toEqual([...])` (~line 143) — insert `'LIFELINE'` in IMPLANTS declaration order (LIFELINE is declared at implants.ts:215, near the top — place it accordingly relative to the existing entries).
3. The `implementedImplants` `new Set([...])` (~line 314) — add `'LIFELINE'`.

Determine LIFELINE's position in `Object.keys(IMPLANTS)` order by checking `src/constants/implants.ts` and place it consistently in both the array and (order-independent) Set.

- [ ] **Step 5: Run the coverage + shape tests**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "feat(combat): register Lifeline implant (incoming-shield-grant) + coverage"
```

---

## Task 5: End-to-end integration tests

**Files:**
- Modify: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

Build the ship through the REAL registry (`buildShipAbilitiesWithEquipment` with a gear piece whose `setBonus`/implant name resolves to `LIFELINE`) so a mutation that breaks the trigger/config actually fails the test — do NOT hand-roll the ability. Use the existing ADAPTIVE_PLATING / Cloaking integration tests in this file as the template for wiring `getGearPiece` and running `runCombat`.

- [ ] **Step 1: Write the failing integration tests**

Add a `describe('Lifeline (incoming-shield-grant)', …)` block with three cases:

1. **Crossing grants a shield that soaks the remainder.** A carrier at >30% HP takes a direct hit that would cross below 30%. Assert: after the hit the unit is alive, its shield pool reflects the granted amount minus what the hit drained (i.e. `flatAmount + attack` was added and the hit was partially/fully absorbed), and HP did not fall as far as it would have without Lifeline. Compare against a control run (same setup, no Lifeline implant) to prove the divergence.
2. **Lifeline does not prevent death from an overwhelming hit.** A direct hit large enough to exceed `shield grant + remaining HP` still destroys the unit (assert destroyed). This locks "not a death-save".
3. **Once per battle.** Two qualifying direct hits across the battle → the shield is granted only once (the second qualifying hit adds nothing; assert via shield-granted surfacing or a second-hit HP/shield delta consistent with no new grant).

Pick concrete numbers so the threshold math is unambiguous (e.g. maxHp 10000, attack 2000, legendary flat 12000 → grant 14000 capped to 10000; start HP 4000; hit 3000 direct → crosses 30%, grants, pool 10000 absorbs 3000 → HP stays 4000).

- [ ] **Step 2: Run to verify they fail (or pass) appropriately**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`
Expected: the new cases pass (the implementation from Tasks 1–4 is complete). If a case fails, debug the wiring — do NOT weaken the assertion.

- [ ] **Step 3: Sanity-check the assertions bite**

Temporarily comment out the intercept block (Task 3 Step 4) and re-run: the crossing/once-per-battle cases MUST fail. Restore the block. (This is the mutation check — confirm the tests are non-vacuous.)

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): Lifeline end-to-end via real registry + runCombat"
```

---

## Task 6: Changelog, docs, final verification, PR

**Files:**
- Modify: `src/constants/changelog.ts`
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Changelog entry**

Add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, e.g.:

> Combat sim now models the Lifeline implant: when a direct hit would drop a ship below 30% HP, it gains a shield (a flat amount plus 100% of its attack, capped at max HP) before the hit lands — once per battle.

- [ ] **Step 2: Documentation**

If the simulator/implant docs in `DocumentationPage.tsx` enumerate modeled implants or shield sources, add Lifeline there to keep in-app docs in sync.

- [ ] **Step 3: Full verification gate**

Run each and confirm output:
- `npm test` → all green, NO golden/snapshot drift (no `-u`).
- `npx tsc --noEmit` → clean.
- `npm run lint` → clean (max-warnings 0).
- `npm run audit:skills` → 141 ships, 0 findings (unchanged).

- [ ] **Step 4: Commit docs**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): changelog + docs for Lifeline shield implant"
```

- [ ] **Step 5: Push + open the PR**

Run `gh auth switch --user TheSusort` first (required before `gh` in this repo). Push the branch and open a PR with base `feat/combat-shield-system-h2-h3` (the H stack); note in the body that it should be retargeted to `main` after the H stack merges. End the PR body with the Claude Code attribution footer.

---

## Verification Summary (definition of done)

- [ ] `thresholdShieldForHit` unit tests pass (Task 2).
- [ ] Engine intercept added; full suite green with byte-identical production goldens (Task 3).
- [ ] `LIFELINE` registered; coverage tracker + shape test pass (Task 4).
- [ ] Integration tests pass and bite under mutation (Task 5).
- [ ] Changelog + docs updated; tsc / lint / audit:skills clean (Task 6).
