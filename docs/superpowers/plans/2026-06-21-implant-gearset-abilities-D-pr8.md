# D-PR8 — Reactive self-buff grants (Ambush / Synaptic Resonance / Alacrity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model three implants that grant a timed self-buff on a trigger — Ambush (Crit Power Up III when stealthed at round start), Synaptic Resonance (Speed Up III when an enemy is repaired), Alacrity (Speed Up III at round end if not hit) — riding the existing reactive-buff executor.

**Architecture:** Two small, precedented engine primitives plus three registry entries. (1) Extend `passesProcChanceGate` into the reactive `buff` executor branch (De-Morgan pass-through → byte-identical for existing grants). (2) A new `not-hit-this-round` condition: a combat-wide `hitThisRound` Set (mirrors `repairedThisRound`) populated in the shared `applyVictimDamage` core, surfaced to gates via a `wasHitThisRoundFor` delegate (mirrors `isLowestSpeedAllyFor`). The three implants become `IMPLANT_ABILITIES` registry entries via the existing `mkNamedBuffGrant` helper (generalized to accept conditions + procChance).

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, ability model in `src/utils/abilities/` + `src/types/abilities.ts`, implant data in `src/constants/implants.ts`.

**Worktree:** `.worktrees/d-pr8-reactive-self-buffs` (branch `feat/combat-d-pr8-reactive-self-buffs`, stacked on D-PR7 tip `1e163c82`). Spec: `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr8-design.md`.

**Load-bearing invariant:** DPS + healing goldens must stay BYTE-IDENTICAL (no fixture equips these implants; both new primitives default to a no-op). If a `.snap` moves, the gate leaked — fix the gate, never `vitest -u`.

**Commands:** `npm test -- <path>` (Vitest), `npm run lint`, `npx tsc --noEmit`. Pre-commit hook runs the FULL suite; docs-only commits use `--no-verify` and `git add -f` (docs/ is gitignored).

---

## File map

| File | Change |
|---|---|
| `src/types/abilities.ts` | Add `'not-hit-this-round'` to the `ConditionSubject` union (with doc comment). |
| `src/utils/abilities/evaluateConditions.ts` | Add `wasHitThisRound?` to `ConditionContext`; add the `case 'not-hit-this-round'`. |
| `src/utils/abilities/roundContext.ts` | Add `wasHitThisRound?` param + `?? false` default to `buildRoundContext`. |
| `src/utils/combat/abilityStatusGating.ts` | Add `'not-hit-this-round'` to `LIVE_SUBJECTS`. |
| `src/utils/combat/triggers.ts` | (a) `passesProcChanceGate` in the `buff` branch; (b) `wasHitThisRoundFor?` on `IntentExecContext`; (c) thread `wasHitThisRound` through `buildDrainContext` + `buildActorConditionContext`. |
| `src/utils/combat/engine.ts` | `hitThisRound` Set (declare + clear); record hits in `applyVictimDamage`; bind `wasHitThisRoundFor` in the drain IntentExecContext literal. |
| `src/utils/abilities/buildEquipmentAbilities.ts` | Generalize `mkNamedBuffGrant` (optional conditions + procChance); add AMBUSH / SYNAPTIC_RESONANCE / ALACRITY entries + proc tables. |
| `src/utils/abilities/__tests__/equipmentCoverage.test.ts` | Add the 3 implants to BOTH the decl-order array and the `implementedImplants` Set. |
| `src/utils/abilities/__tests__/evaluateConditions.test.ts` | New unit tests for the condition (or co-located). |
| `src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts` | Engine integration tests (Synaptic / Alacrity / Ambush gate). |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` entry. |

---

## Task 1: `not-hit-this-round` condition primitive (pure layer)

**Files:**
- Modify: `src/types/abilities.ts` (ConditionSubject union)
- Modify: `src/utils/abilities/evaluateConditions.ts` (ConditionContext + evaluateCondition)
- Modify: `src/utils/abilities/roundContext.ts` (buildRoundContext)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts`

The precedent is `target-repaired-this-round` (a live binary gate present in ConditionContext + evaluateCondition + buildRoundContext default + LIVE_SUBJECTS). NOT `self-shield` — that one is modifier-path-only and is deliberately absent from LIVE_SUBJECTS.

- [ ] **Step 1: Write the failing test**

Add to `src/utils/abilities/__tests__/evaluateConditions.test.ts` (create the import block if the file is new; mirror existing tests in that dir):

```ts
import { describe, it, expect } from 'vitest';
import { evaluateCondition, ConditionContext } from '../evaluateConditions';
import { Condition } from '../../../types/abilities';

function ctx(over: Partial<ConditionContext> = {}): ConditionContext {
    return {
        selfBuffNames: [], selfDebuffNames: [], enemyBuffNames: [],
        enemyDebuffCount: 0, effectiveCritRate: 0,
        adjacentAllyCount: 0, enemyAdjacentCount: 0, enemyDestroyedCount: 0,
        selfHpPct: 100, enemyHpPct: 100,
        ...over,
    };
}

describe('not-hit-this-round condition', () => {
    const cond: Condition = { subject: 'not-hit-this-round', derivable: true };

    it('is met (1) when wasHitThisRound is false', () => {
        expect(evaluateCondition(cond, ctx({ wasHitThisRound: false }))).toBe(1);
    });
    it('is met (1) when wasHitThisRound is undefined (default)', () => {
        expect(evaluateCondition(cond, ctx())).toBe(1);
    });
    it('is NOT met (0) when wasHitThisRound is true', () => {
        expect(evaluateCondition(cond, ctx({ wasHitThisRound: true }))).toBe(0);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: FAIL — `'not-hit-this-round'` is not assignable to `ConditionSubject` (tsc) / `evaluateCondition` returns 0 (default case).

- [ ] **Step 3: Add the ConditionSubject member**

In `src/types/abilities.ts`, in the `ConditionSubject` union (right after `'self-shield'`), add:

```ts
    // Binary gate: the condition owner received ZERO direct hits this round (a "hit" =
    // a direct attack that landed damage on shield or HP; DoT ticks and fully-Barrier-blocked
    // attacks do not count). Live-derived (ConditionContext.wasHitThisRound); defaults false
    // (DPS / not-yet-hit → "not hit" ⇒ met). Used by the Alacrity implant.
    | 'not-hit-this-round';
```

- [ ] **Step 4: Add the ConditionContext field + evaluateCondition case**

In `src/utils/abilities/evaluateConditions.ts`, add to the `ConditionContext` interface (after `selfShielded?`):

```ts
    /** True when the condition owner was hit by a direct attack this round (damage landed
     *  on shield or HP). Live-derived by the engine; defaults false (DPS / not-yet-hit). */
    wasHitThisRound?: boolean;
```

And add the case in `evaluateCondition` (after `case 'self-shield':`):

```ts
        case 'not-hit-this-round':
            return ctx.wasHitThisRound ? 0 : 1;
```

- [ ] **Step 5: Add the buildRoundContext param + default**

In `src/utils/abilities/roundContext.ts`, add to the `state` param type (after `selfShielded?`):

```ts
    /** True when the acting unit was hit by a direct attack this round. Default false. */
    wasHitThisRound?: boolean;
```

And in the returned object (after `selfShielded: state.selfShielded ?? false,`):

```ts
        wasHitThisRound: state.wasHitThisRound ?? false,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Commit**

```bash
git add src/types/abilities.ts src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/abilities/__tests__/evaluateConditions.test.ts
git commit -m "feat(combat): D-PR8 — not-hit-this-round condition primitive"
```

---

## Task 2: `not-hit-this-round` in LIVE_SUBJECTS

**Files:**
- Modify: `src/utils/combat/abilityStatusGating.ts`
- Test: `src/utils/combat/__tests__/abilityStatusGating.test.ts` (if present; else co-locate)

Without this, `liveGateConditions` neutralizes a derivable `not-hit-this-round` gate to `always` and Alacrity would grant even when hit.

- [ ] **Step 1: Write the failing test**

Find the existing test for `liveGateConditions` (grep `liveGateConditions` under `src/utils/combat`). Add a case mirroring the `target-repaired-this-round` test:

```ts
it('keeps a derivable not-hit-this-round condition (live subject, not neutralized)', () => {
    const out = liveGateConditions([{ subject: 'not-hit-this-round', derivable: true }]);
    expect(out[0].subject).toBe('not-hit-this-round');
});
```

If no such test file exists, create `src/utils/combat/__tests__/abilityStatusGating.test.ts` with the import `import { liveGateConditions } from '../abilityStatusGating';`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- abilityStatusGating`
Expected: FAIL — subject neutralized to `'always'`.

- [ ] **Step 3: Add to LIVE_SUBJECTS**

In `src/utils/combat/abilityStatusGating.ts`, add `'not-hit-this-round',` to the `LIVE_SUBJECTS` set (after `'target-repaired-this-round',`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- abilityStatusGating`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/abilityStatusGating.ts src/utils/combat/__tests__/abilityStatusGating.test.ts
git commit -m "feat(combat): D-PR8 — not-hit-this-round is a live gate subject"
```

---

## Task 3: procChance in the reactive buff executor branch

**Files:**
- Modify: `src/utils/combat/triggers.ts` (the `cfg.type === 'buff'` branch, ~line 1000)
- Test: mirror the existing damage-branch procChance test (grep `passesProcChanceGate` / `procChance` under `src/utils/combat/__tests__`; D-PR4 Insidiousness added the damage-branch one).

The buff branch currently does NOT call `passesProcChanceGate` (only heal/shield ~1160 and damage ~1264 do). `passesProcChanceGate` returns `true` whenever `procChance` is `undefined`/`≤0`/`≥1`, so existing buff grants (none carry procChance) stay byte-identical.

- [ ] **Step 1: Write the failing test**

Locate the test harness used to exercise `executeIntent` / the buff executor directly (the damage-branch procChance test is the template). Add a test: a reactive `buff` intent carrying `procChance` low enough not to fire on the first gate roll does NOT apply the buff; the same intent with no `procChance` DOES apply it. (Use the same `procChanceGates` Map seeding the existing test uses.)

If a direct executor harness is awkward, defer this to the Task 6 Alacrity integration test and note it here — but prefer the focused test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- triggers` (or the chosen file)
Expected: FAIL — buff applied despite the unmet proc gate.

- [ ] **Step 3: Add the gate to the buff branch**

In `src/utils/combat/triggers.ts`, inside `if (cfg.type === 'buff') {`, immediately AFTER the `oncePerCombat` cap block and BEFORE `const duration = …`, add:

```ts
        // D-PR8: procChance gate for reactive buff grants (Ambush 5-16%, Alacrity 12-20%).
        // De-Morgan pass-through — true when procChance is undefined/≤0/≥1, so every existing
        // (procChance-less) buff grant stays byte-identical. Mirrors the heal/shield + damage
        // branches. Keys on `${ownerId}:${ability.id}` via ctx.procChanceGates.
        if (!passesProcChanceGate(intent, ctx)) return;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- triggers`
Expected: PASS.

- [ ] **Step 5: Run the full combat suite — confirm goldens byte-identical**

Run: `npm test -- src/utils/calculators/__tests__`
Expected: PASS, ZERO `.snap` changes (no existing buff grant carries procChance).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/
git commit -m "feat(combat): D-PR8 — honor procChance in the reactive buff executor"
```

---

## Task 4: Engine hit-tracking + `wasHitThisRoundFor` delegate

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` + `buildDrainContext` + `buildActorConditionContext`)
- Modify: `src/utils/combat/engine.ts` (`hitThisRound` Set + record site + delegate binding)
- Test: `src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts` (Alacrity end-to-end, hand-built ability to isolate the condition from proc timing)

- [ ] **Step 1: Write the failing integration test**

In `equipmentAbilities.integration.test.ts` (follow the existing engine-integration setup in that file — `runCombat`/board helpers used by D-PR3/D-PR7), add an Alacrity-style test using a HAND-BUILT reactive buff ability (NOT the registry — isolates the condition from proc-gate timing): `type:'buff'`, `target:'self'`, `trigger:'end-of-round'`, `conditions:[{subject:'not-hit-this-round', derivable:true}]`, NO `procChance`, buffName e.g. `'Speed Up III'`, duration 2. Place it on a passive-slot owner.
  - Assert: in a round where the owner takes NO direct hit, the buff is granted (`buff-applied` for the owner / appears in its active statuses).
  - Assert: in a round where the owner IS directly hit, the buff is NOT granted.
  - Assert: a round where the owner takes only a SHIELD-absorbed direct hit → counts as hit → withheld. (Seed a shield pool on the owner.)
  - Assert: a round where the owner takes only a DoT tick (no direct attack) → NOT a hit → granted.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- equipmentAbilities.integration`
Expected: FAIL — buff granted regardless of hit state (`hitThisRound` not populated; delegate undefined → `wasHitThisRound` defaults false → always "not hit" → always granted; the hit-case assertions fail).

- [ ] **Step 3: Add `wasHitThisRoundFor` to IntentExecContext**

In `src/utils/combat/triggers.ts`, in the `IntentExecContext` interface (after `isLowestSpeedAllyFor?`), add:

```ts
    /** Whether `ownerId` was hit by a direct attack this round, feeding the
     *  `not-hit-this-round` gate at drain time. Engine-populated from the combat-wide
     *  hitThisRound Set. Absent → buildDrainContext defaults the gate to false (DPS /
     *  not-yet-hit → "not hit" ⇒ met), keeping existing drain gating byte-identical. */
    wasHitThisRoundFor?: (ownerId: string) => boolean;
```

- [ ] **Step 4: Thread it through buildDrainContext + buildActorConditionContext**

In `buildActorConditionContext`'s `shared` param type (after `isLowestSpeedAlly?`), add:

```ts
        /** Owner was hit by a direct attack this round. Default false. Populated by
         *  buildDrainContext (D-PR8). */
        wasHitThisRound?: boolean;
```

In its `buildRoundContext({...})` call (after `isLowestSpeedAlly: shared.isLowestSpeedAlly,`), add:

```ts
        wasHitThisRound: shared.wasHitThisRound,
```

In `buildDrainContext`, in the object passed to `buildActorConditionContext` (after `isLowestSpeedAlly: ctx.isLowestSpeedAllyFor?.(ownerId) ?? true,`), add:

```ts
        // D-PR8: live not-hit-this-round gate (Alacrity). Default false → DPS / no-delegate
        // paths read "not hit" ⇒ met and stay byte-identical.
        wasHitThisRound: ctx.wasHitThisRoundFor?.(ownerId) ?? false,
```

- [ ] **Step 5: Add the `hitThisRound` Set to the engine (declare + clear)**

In `src/utils/combat/engine.ts`, next to `const repairedThisRound = new Set<string>();` (~line 1922):

```ts
    // D-PR8: actors hit by a direct attack this round (damage landed on shield or HP).
    // Mirrors repairedThisRound. Feeds the not-hit-this-round gate (Alacrity). Cleared each
    // round alongside repairedThisRound.
    const hitThisRound = new Set<string>();
```

Next to `repairedThisRound.clear();` (~line 2373):

```ts
        hitThisRound.clear();
```

- [ ] **Step 6: Record hits in `applyVictimDamage`**

In `src/utils/combat/engine.ts`, in `applyVictimDamage`, immediately BEFORE the final non-barriered `return { shieldBefore, hpDamage, barriered: false };` (~line 2710), add:

```ts
            // D-PR8: record a direct hit for the not-hit-this-round gate. A hit = a direct
            // attack that landed damage on shield or HP (absorbed > 0 || hpDamage > 0). The
            // byDirectDamage guard excludes DoT-tick batches (they pass byDirectDamage:false);
            // fully-Barrier-blocked hits return earlier (barriered:true) and are not recorded.
            if (cause?.byDirectDamage && (absorbed > 0 || hpDamage > 0)) {
                hitThisRound.add(victim.id);
            }
```

(`absorbed` and `hpDamage` are both in scope here, declared at ~2639/2642. `absorbed > 0 || hpDamage > 0` is equivalent to post-block `damage > 0`.)

- [ ] **Step 7: Bind the delegate in the drain IntentExecContext literal**

In `src/utils/combat/engine.ts`, in the IntentExecContext literal built for the drain (next to `selfHpPctFor: sideCtx.selfHpPctFor,` / `enemyWithMostBuffs: sideCtx.enemyWithMostBuffs,`, ~line 3356), add:

```ts
                        // D-PR8: live not-hit-this-round gate (Alacrity). hitThisRound is a single
                        // combat-wide Set, so the SAME closure serves both sides (team-agnostic) —
                        // no per-side sideCtx field needed (unlike isLowestSpeedAllyFor).
                        wasHitThisRoundFor: (ownerId) => hitThisRound.has(ownerId),
```

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `npm test -- equipmentAbilities.integration`
Expected: PASS (unhit → granted; hit → withheld; shield-only hit → withheld; DoT-only → granted).

- [ ] **Step 9: Run the full combat suite — confirm goldens byte-identical**

Run: `npm test -- src/utils/calculators/__tests__` then `npx tsc --noEmit`
Expected: PASS, ZERO `.snap` changes, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): D-PR8 — engine hit-tracking + wasHitThisRound gate delegate"
```

---

## Task 5: Registry entries + proc tables + coverage tracker

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Write the failing coverage + shape tests**

In `equipmentCoverage.test.ts`:
- Add `'AMBUSH'`, `'ALACRITY'`, `'SYNAPTIC_RESONANCE'` to BOTH the `.toEqual([...])` decl-order array (in `'exactly { … }'` test) AND the `implementedImplants` `new Set([...])` (known pitfall — both must move together). **Decl-order matters**: insert each at its position in `Object.keys(IMPLANTS)` order — verify by reading the IMPLANTS declaration order; do not guess.
- Add per-implant shape assertions (mirror the INTRUSION/WARPSTRIKE blocks):

```ts
it('SYNAPTIC_RESONANCE produces 1 self Speed Up III buff on-enemy-repaired per rarity (no procChance)', () => {
    for (const v of IMPLANTS['SYNAPTIC_RESONANCE'].variants) {
        expect(implantAbilityCount('SYNAPTIC_RESONANCE', v.rarity)).toBe(1);
    }
});
it('AMBUSH produces 1 self Crit Power Up III buff (start-of-round, self-buff Stealth gate, procChance) per rarity', () => {
    for (const v of IMPLANTS['AMBUSH'].variants) {
        expect(implantAbilityCount('AMBUSH', v.rarity)).toBe(1);
    }
});
it('ALACRITY produces 1 self Speed Up III buff (end-of-round, not-hit-this-round gate, procChance) per rarity', () => {
    for (const v of IMPLANTS['ALACRITY'].variants) {
        expect(implantAbilityCount('ALACRITY', v.rarity)).toBe(1);
    }
});
```

Also remove these three from the `unimplementedImplants` "produces 0" loop coverage automatically (they leave the `unimplementedImplants` filter once added to `implementedImplants`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- equipmentCoverage`
Expected: FAIL — implants not yet implemented (counts 0; `.toEqual` mismatch).

- [ ] **Step 3: Generalize `mkNamedBuffGrant` for conditions + procChance**

In `src/utils/abilities/buildEquipmentAbilities.ts`, change `mkNamedBuffGrant`'s signature to accept an optional opts object and apply it (Battlecry passes nothing → output byte-identical):

```ts
function mkNamedBuffGrant(
    buffName: string,
    target: 'self' | 'ally' | 'all-allies',
    trigger: AbilityTrigger,
    duration: number | undefined,
    opts?: { conditions?: Condition[]; procChance?: number }
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    if (!buff) return undefined;
    const { stackable, maxStacks } = isStackable(buff.description);
    return {
        type: 'buff',
        target,
        trigger,
        conditions: opts?.conditions ?? [],
        ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
        config: {
            type: 'buff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            duration,
        },
        autoFilled: true,
    };
}
```

Add `Condition` to the `import { Ability } from '../../types/abilities';` line → `import { Ability, Condition } from '../../types/abilities';` (verify exact current import).

- [ ] **Step 4: Add proc tables + registry entries**

Near the other per-rarity tables (e.g. by `WARPSTRIKE_PCT`):

```ts
const AMBUSH_PROC: Record<string, number> = {
    common: 0.05, uncommon: 0.07, rare: 0.09, epic: 0.12, legendary: 0.16,
};
const ALACRITY_PROC: Record<string, number> = {
    uncommon: 0.12, rare: 0.14, epic: 0.16, legendary: 0.2, // no common variant
};
```

In `IMPLANT_ABILITIES`, add (placement free; group with the other D-PR8 self-buff grants):

```ts
    // D-PR8: Ambush — start-of-round, if Stealthed, X% chance to gain Crit Power Up III for 1 turn.
    // Gate is self-buff/Stealth (NOT self-stealth — that's an IncomingCondition, not a
    // ConditionSubject). DORMANT until a stealth source exists in the sim (Cloaking / sub-project H);
    // entry + gate are correct now, only the Stealth source is missing.
    AMBUSH: (rarity) => {
        const procChance = AMBUSH_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Crit Power Up III', 'self', 'start-of-round', 1, {
            conditions: [{ subject: 'self-buff', buffName: 'Stealth', derivable: true }],
            procChance,
        });
    },
    // D-PR8: Synaptic Resonance — gain Speed Up III for 1 turn when an enemy is directly repaired.
    // DETERMINISTIC (no procChance). LIVE today (E5 gave enemies real healing → on-enemy-repaired
    // fires). The "+X% next-crit critDamage" half is DEFERRED (stacking next-crit consumable, no seam).
    SYNAPTIC_RESONANCE: () =>
        mkNamedBuffGrant('Speed Up III', 'self', 'on-enemy-repaired', 1),
    // D-PR8: Alacrity — at end of round, if not hit, X% chance to gain Speed Up III for 2 turns.
    ALACRITY: (rarity) => {
        const procChance = ALACRITY_PROC[rarity];
        if (procChance === undefined) return undefined; // no common variant
        return mkNamedBuffGrant('Speed Up III', 'self', 'end-of-round', 2, {
            conditions: [{ subject: 'not-hit-this-round', derivable: true }],
            procChance,
        });
    },
```

(`ImplantAbilityBuilder` is `(rarity: string) => Omit<Ability,'id'> | undefined`; SYNAPTIC_RESONANCE ignores `rarity` — the builder may declare `()` since the registry stores `ImplantAbilityBuilder`; if tsc complains about arity, use `(_rarity) =>`.)

- [ ] **Step 5: Run the coverage + shape tests to verify they pass**

Run: `npm test -- equipmentCoverage`
Expected: PASS. If the `.toEqual` decl-order array fails, fix the insertion order to match `Object.keys(IMPLANTS)`.

- [ ] **Step 6: Confirm the id-collision note holds**

The implant id is `equip-implant-${implantName}` (no per-piece suffix — academic, real loadouts equip one of each). No action; this step is a reminder not to "fix" it.

- [ ] **Step 7: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "feat(combat): D-PR8 — Ambush / Synaptic Resonance / Alacrity registry entries"
```

---

## Task 6: Engine integration — Synaptic Resonance (live) + Ambush gate

**Files:**
- Test: `src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the Synaptic Resonance integration test**

Equip SYNAPTIC_RESONANCE (via `buildShipAbilitiesWithEquipment` + `getGearPiece` stub, as D-PR1+ tests do) on an owner. Run a combat where an enemy actor gets directly repaired (mirror the E5 symmetric-healing test setup — an enemy with a heal). Assert the owner gains `Speed Up III` (via `buff-applied` for the owner or its active statuses). Deterministic — no procChance.

- [ ] **Step 2: Write the Ambush gate integration test**

AMBUSH is dormant (nothing grants Stealth), so seed a `Stealth` buff directly onto the owner before round start, and use a HAND-BUILT copy of the Ambush ability with `procChance` omitted (or `1`) to bypass proc timing — assert: with Stealth present → Crit Power Up III granted at start-of-round; with Stealth absent → not granted. This proves the gate uses `self-buff`/`Stealth` correctly (would silently fail with the broken `self-stealth` IncomingCondition).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm test -- equipmentAbilities.integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): D-PR8 — Synaptic Resonance live + Ambush gate integration"
```

---

## Task 7: Changelog, docs, final verification

**Files:**
- Modify: `src/constants/changelog.ts`
- Verify: full suite, lint, tsc, audit

- [ ] **Step 1: Add the changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` a plain-English combat-sim entry, e.g.: "Combat sim: modeled the Ambush, Synaptic Resonance, and Alacrity implants (self-buff grants — Crit Power, Speed)." Match the surrounding entry style.

- [ ] **Step 2: Full suite + lint + tsc**

Run:
```bash
npm test
npm run lint
npx tsc --noEmit
```
Expected: all green; goldens byte-identical (confirm no `.snap` in `git diff --stat`).

- [ ] **Step 3: Skill audit (no regression)**

Run: `npm run audit:skills`
Expected: 141 ships, 0 findings (unchanged — D adds equipment abilities, not ship-skill parses).

- [ ] **Step 4: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(combat): D-PR8 — changelog entry"
```

- [ ] **Step 5: Push + open PR (stacked on D-PR7)**

```bash
gh auth switch --user TheSusort
git push -u origin feat/combat-d-pr8-reactive-self-buffs 2>&1 | cat
gh pr create --base feat/combat-d-pr7-on-death --head feat/combat-d-pr8-reactive-self-buffs --title "feat(combat): D-PR8 — reactive self-buff grants (Ambush / Synaptic Resonance / Alacrity)" --body "..."
```

(Base = the D-PR7 branch per the stacking strategy; retarget to main as the lower stack merges. Commit the spec + plan docs with `git add -f` + `--no-verify` if not already committed.)

---

## Notes for the implementer

- **Never `vitest -u`** to "fix" a moved golden — a moved snapshot means a gate leaked; fix the gate.
- **Decl-order in the coverage `.toEqual`** must match `Object.keys(IMPLANTS)` exactly — read the IMPLANTS declaration order, don't guess.
- **`self-stealth` is a trap** — it's an `IncomingCondition`, not a `ConditionSubject`. AMBUSH gates on `self-buff` + `buffName:'Stealth'`.
- **The hit predicate** is `cause?.byDirectDamage && (absorbed > 0 || hpDamage > 0)` in `applyVictimDamage` — the `byDirectDamage` flag is what excludes DoT ticks (they call in with `byDirectDamage:false`); fully-Barrier-blocked hits return earlier and never reach the record site.
- **TO-VERIFY (in-game):** whether a fully-Barrier-blocked direct attack should count as "hit" for Alacrity. Current default: not a hit. Leave a `// TODO(verify):` near the record site.
- **Worktree env:** `.env` + `docs/*.csv` are symlinked from the main checkout; if tests fail on missing env/data, re-check the symlinks.
