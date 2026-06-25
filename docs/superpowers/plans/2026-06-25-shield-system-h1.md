# Shield System H1 — Foundation + Penetration + DoT Bypass + Sim Surfacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shields a faithful, first-class combat mechanic — consume `shieldPenetration` on direct hits, make Inferno/Corrosion bypass the shield, keep bombs full-drain, grant shields to all actors in the battle sim, and surface per-ship/per-round shield granted / absorbed / current-pool in the simulator.

**Architecture:** The shield pool stays the existing untimed scalar `CombatActor.shieldPool` (capped at max HP). All shield interaction funnels through the single `applyVictimDamage` absorb step (engine.ts ~2730). H1 makes that step damage-kind aware via two new optional `cause` fields (`shieldPenetrationPct`, `bombPortion`); the apply wrappers resolve the acting attacker's penetration. Surfacing adds a per-round per-actor shield map to the engine's `RoundData` and threads it into `ShipRoundState`.

**Tech Stack:** TypeScript, Vitest, React (simulator UI). Combat engine in `src/utils/combat/`, battle-sim adapter in `src/utils/calculators/battleSimulator.ts`, simulator UI in `src/components/simulator/`.

**Spec:** `docs/superpowers/specs/2026-06-25-shield-system-design.md`

---

## Locked rules (from spec)

| Damage kind | Shield interaction |
| --- | --- |
| Direct hit | `shieldEligible = D × (1 − pen/100)`; `absorbed = min(shieldPool, shieldEligible)`; `hpDamage = D − absorbed` |
| Bomb (detonation) | `absorbed = min(shieldPool, D)`; `hpDamage = D − absorbed` (pen = 0) |
| DoT (Inferno/Corrosion) | `absorbed = 0`; `hpDamage = D` (bypass) |

Untimed single pool, capped at max HP, persists until drained. Pen is STATIC (no buff-fold — out of scope). Penetration applies in BOTH healing calc and battle sim → **audited healing-golden churn** (Task 7). Barrier full-immunity and Cheat-Death stay strictly in front of the shield step.

## Key code anchors (verified 2026-06-25)

- Absorb step + `applyVictimDamage(rawDamage, victim, sink, cause?)`: `engine.ts:2626-2812`; drain at `2730-2735`. `cause` = `{ killerId?: string; byDirectDamage?: boolean }` (signature `~2634`; default in `applyIncomingToTarget` `~2836`).
- `applyIncomingToTarget(damage, victim=healTarget, cause={killerId:actingActorId, byDirectDamage:true})`: `engine.ts:2830-2840`.
- `applyOutgoingToEnemy(damage, enemyVictim)`: `engine.ts:2861-2869` (player→enemy, used by positional).
- Enemy-aggregate damage assembly: `damage = enemyTurn.directDamage + enemyTurn.detonationDamage` (`engine.ts:4368`); applied at `4528-4532` via `applyIncomingToTarget(damage, tgt)`.
- DoT batch apply: `applyIncomingToTarget(tankDotDamage, healTarget, { byDirectDamage: false })` (`engine.ts:3818`).
- `grantShieldToTarget`: `engine.ts:2041-2049` (inside `healingCtx`, `engine.ts:2008-2054`). Caps at `recipientMaxHp(victim.id)`.
- Sink: `DamageAccountingSink` (`engine.ts:1117-1124`); `intakeFor` → `perActorIncoming` (`engine.ts:2563-2568`); intake shape `{ incoming, shieldAbsorbed, barrierAbsorbed }`.
- `ActorStats` (NO shieldPenetration today): `state.ts:79-91`; `CombatActor.shieldPool`: `state.ts:105`.
- `EffectiveStats` / `effectiveStatsOf`: `effectiveStats.ts:30-46`, `88-105` (defensePenetration is base-only here).
- Positional per-hit driver: `positionalApply.ts:89-186`; `applyToVictim` callback = `applyOutgoingToEnemy`.
- Battle-sim: `ShipRoundState` (`battleSimulator.ts:50-90`, `shieldsAbsorbed` hardcoded `0` at `:260`); assembly loop `:245-269`; `runCombat` call `:680-725`; per-round per-victim extraction `:727-732`.
- UI: `ShipRoundCard.tsx:39-58` (StatCards); `boardOverlays.ts:20-63`; `BattleBoard.tsx:80-95`.
- Healing-calc parallel: `healingEngineAdapter.ts` `HealingRoundData` shield fields (`71-106`) + population (`259-327`).
- Arcane Siege gate (lights up free): `buildEquipmentAbilities.ts:559`; `self-shield` eval `evaluateConditions.ts:93-94`; `selfShielded: actor.shieldPool > 0` set in `playerTurn.ts:1157`.

---

## Task 1: Add `shieldPenetration` to the combat actor stat block

**Files:**
- Modify: `src/utils/combat/state.ts` (`ActorStats` ~79-91; `createActor` ~init)
- Test: `src/utils/combat/__tests__/state.test.ts` (or co-located; create if absent)

- [ ] **Step 1: Write the failing test** — a created actor exposes `shieldPenetration` (defaults 0 when not supplied).

```typescript
import { createActor } from '../state';

test('createActor carries shieldPenetration, default 0', () => {
    const a = createActor({ id: 'x', side: 'player', kind: 'attacker', stats: { attack: 100, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1000, speed: 100 } });
    expect(a.stats.shieldPenetration).toBe(0);
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -- state` → FAIL (`shieldPenetration` missing / `undefined`).

- [ ] **Step 3: Implement.** In `ActorStats` (state.ts ~83, next to `defensePenetration`) add:

```typescript
    defensePenetration: number;
    shieldPenetration: number;
```

In `createActor` where `stats` is normalized, ensure `shieldPenetration` defaults to `0` when the partial omits it (mirror how `defensePenetration` is defaulted; if `createActor` spreads a partial `stats`, add `shieldPenetration: partial.stats?.shieldPenetration ?? 0`). Update any inline `ActorStats` literals in the file/tests the compiler flags.

- [ ] **Step 4: Run it, verify PASS** — `npm test -- state`. Then `npx tsc --noEmit` to surface every `ActorStats` literal needing the new field; fix each with `shieldPenetration: <ship pen> ?? 0`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(combat): add shieldPenetration to ActorStats (H1)"`

---

## Task 2: Thread `shieldPenetration` from engine inputs onto actors

**Files:**
- Modify: `src/utils/combat/engine.ts` (input types `CombatEngineInput`, `TeamActorEngineInput`, inline `enemyAttackers` input ~768, `EnemyActorInput` ~304; the actor-construction sites: focus actor build, `buildEnemyPlayerActorRuntime` ~394, team actor build)
- Modify adapters that call `runCombat`: `src/utils/calculators/battleSimulator.ts` (~680-725), `src/utils/calculators/healingEngineAdapter.ts`, `src/utils/calculators/dpsSimulator.ts`
- Test: `src/utils/combat/__tests__/shieldPenetration.test.ts` (new)

**Context:** pen is static; we read it off `actor.stats.shieldPenetration` at the apply site (Task 4). This task just gets the value onto the actors from the ship inputs. Default `0` everywhere keeps callers that omit it inert.

- [ ] **Step 1: Write the failing test** — a focus actor and an enemy actor built by `runCombat` carry their input `shieldPenetration`. (Drive via a minimal `runCombat` call asserting through a test tap, OR — simpler — a unit test on the actor-build helper if extractable. If no seam, assert via the Task 4 behavior test instead and mark this step as a typecheck-only task.)

- [ ] **Step 2: Run / verify fails.**

- [ ] **Step 3: Implement.** Add optional `shieldPenetration?: number` to `CombatEngineInput`, `TeamActorEngineInput`, the inline enemy-attacker input type (~768), and `EnemyActorInput` (~304). At each actor-construction site, set `stats.shieldPenetration: <input>.shieldPenetration ?? 0`. In the three adapters, pass the ship's `shieldPenetration` (from resolved ship stats; `ShipData.shieldPenetration`, `types/ship.ts:73`) — focus, each team actor, each enemy attacker. In `battleSimulator.ts` `runCombat` call (~684 area, alongside `defensePenetration: focus.stats.defensePenetration`) add `shieldPenetration: focus.stats.shieldPenetration`, and likewise for `teamActors`/`enemyAttackers` mapping.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm test -- shieldPenetration`.

- [ ] **Step 5: Commit** — `git commit -am "feat(combat): thread shieldPenetration from inputs onto actors (H1)"`

---

## Task 3: Make the absorb step damage-kind aware (DoT bypass, pen split, bomb full-drain)

**Files:**
- Modify: `src/utils/combat/engine.ts` — `applyVictimDamage` absorb block (`~2730-2735`) + `cause` type (`~2634`)
- Test: `src/utils/combat/__tests__/shieldAbsorption.test.ts` (new) — drive `applyVictimDamage` via a thin runCombat scenario OR, preferred, extract the absorb math into a pure helper and unit-test it directly (see Step 3).

**This is the load-bearing change.** Extend `cause`:

```typescript
cause?: {
    killerId?: string;
    byDirectDamage?: boolean;
    /** Acting attacker's effective shield penetration % (direct portion only). Default 0. */
    shieldPenetrationPct?: number;
    /** Portion of `rawDamage` that is bomb/detonation damage — drains shield in FULL, no pen. Default 0. */
    bombPortion?: number;
};
```

- [ ] **Step 1: Write failing tests** — create a pure helper `shieldAbsorb` and test the three rules:

```typescript
// src/utils/combat/shieldAbsorb.ts  (new pure module)
export function shieldAbsorb(args: {
    damage: number;          // post-block total
    shieldPool: number;
    isDot: boolean;          // cause.byDirectDamage === false
    penPct: number;          // 0..100, direct portion only
    bombPortion: number;     // <= damage
}): { absorbed: number; hpDamage: number } {
    const { damage, shieldPool, isDot, penPct, bombPortion } = args;
    if (isDot) return { absorbed: 0, hpDamage: damage }; // bypass
    const bomb = Math.max(0, Math.min(bombPortion, damage));
    const directPortion = damage - bomb;
    const shieldEligible = directPortion * (1 - penPct / 100) + bomb;
    const absorbed = Math.min(shieldPool, shieldEligible);
    return { absorbed, hpDamage: damage - absorbed };
}
```

```typescript
// src/utils/combat/__tests__/shieldAbsorb.test.ts
import { shieldAbsorb } from '../shieldAbsorb';

test('DoT bypasses shield entirely', () => {
    expect(shieldAbsorb({ damage: 500, shieldPool: 1000, isDot: true, penPct: 50, bombPortion: 0 }))
        .toEqual({ absorbed: 0, hpDamage: 500 });
});
test('direct hit with 20% pen: 80% eligible to drain', () => {
    // 1000 dmg, pen 20 → eligible 800, shield 1000 absorbs 800, hp = 200
    expect(shieldAbsorb({ damage: 1000, shieldPool: 1000, isDot: false, penPct: 20, bombPortion: 0 }))
        .toEqual({ absorbed: 800, hpDamage: 200 });
});
test('direct hit, shield smaller than eligible: full drain + overflow', () => {
    // 1000 dmg, pen 20 → eligible 800; shield 300 absorbs 300; hp = 700
    expect(shieldAbsorb({ damage: 1000, shieldPool: 300, isDot: false, penPct: 20, bombPortion: 0 }))
        .toEqual({ absorbed: 300, hpDamage: 700 });
});
test('bomb portion ignores pen (full drain eligible)', () => {
    // 1000 dmg all-bomb, pen 50 → eligible 1000; shield 1000 absorbs 1000; hp 0
    expect(shieldAbsorb({ damage: 1000, shieldPool: 1000, isDot: false, penPct: 50, bombPortion: 1000 }))
        .toEqual({ absorbed: 1000, hpDamage: 0 });
});
test('mixed direct+bomb: pen only on direct portion', () => {
    // damage 1000 = 600 direct + 400 bomb, pen 50 → eligible = 600*0.5 + 400 = 700
    expect(shieldAbsorb({ damage: 1000, shieldPool: 10000, isDot: false, penPct: 50, bombPortion: 400 }))
        .toEqual({ absorbed: 700, hpDamage: 300 });
});
test('no pen, no bomb = legacy behavior (full eligible)', () => {
    expect(shieldAbsorb({ damage: 500, shieldPool: 300, isDot: false, penPct: 0, bombPortion: 0 }))
        .toEqual({ absorbed: 300, hpDamage: 200 });
});
```

- [ ] **Step 2: Run, verify fails** — `npm test -- shieldAbsorb` → FAIL (module missing).

- [ ] **Step 3: Implement** the pure module above, then wire it into `applyVictimDamage`. Replace the drain block at `engine.ts:2730-2735`:

```typescript
    const shieldBefore = victim.shieldPool;
    const { absorbed, hpDamage } = shieldAbsorb({
        damage,
        shieldPool: victim.shieldPool,
        isDot: cause?.byDirectDamage === false,
        penPct: cause?.shieldPenetrationPct ?? 0,
        bombPortion: cause?.bombPortion ?? 0,
    });
    victim.shieldPool -= absorbed;
    sink.addShieldAbsorbed(absorbed, victim.id);
    victim.currentHp = Math.max(0, victim.currentHp - hpDamage);
```

(Leave the Barrier guard, proc-block, Cheat-Death, hp-changed, and `hitThisRound` logic exactly as-is — they sit around this block. **Critical:** the `victim.currentHp = Math.max(0, victim.currentHp - hpDamage)` line shown above MUST keep using the helper's `hpDamage`, because the Cheat-Death check immediately below it reads `victim.currentHp <= 0`, and the `hitThisRound` gate at the bottom reads both `absorbed` and `hpDamage`. Since `hpDamage`/`absorbed` are now destructured from the helper *before* that line, the downstream `<= 0` save logic and `hitThisRound` gate stay correct unchanged. `hitThisRound` already gates on `cause?.byDirectDamage && (absorbed>0||hpDamage>0)`.)

- [ ] **Step 4: Verify** — `npm test -- shieldAbsorb` PASS; `npx tsc --noEmit` clean. Do NOT run the full golden suite yet — the wiring (Task 4) plus golden rebaseline is Task 7.

- [ ] **Step 5: Commit** — `git commit -am "feat(combat): damage-kind aware shield absorption — DoT bypass + pen split + bomb full-drain (H1)"`

---

## Task 4: Wire penetration + bomb portion at the apply wrappers

**Files:**
- Modify: `src/utils/combat/engine.ts` — `applyIncomingToTarget` (~2830), `applyOutgoingToEnemy` (~2861), the enemy-aggregate call site (~4528), DoT batch call (~3818, no change needed but verify).
- Test: `src/utils/combat/__tests__/shieldAbsorption.test.ts` (engine-level integration)

**Resolution:** pen comes from the ACTING attacker's `actor.stats.shieldPenetration`. Both wrappers have `actingActorId` in closure and an `allActorsById` map. Add a helper near the wrappers:

```typescript
const attackerShieldPenOf = (id?: string): number =>
    (id ? allActorsById.get(id)?.stats.shieldPenetration : undefined) ?? 0;
```

- [ ] **Step 1: Write failing engine tests.** Scenario A: an enemy with `shieldPenetration: 25` attacks a shielded tank (give the heal target a shield via a shield ability or a pre-seeded pool); assert HP drops by ~25% of the hit even though the shield could fully cover it, and shield drains by the other ~75%. Scenario B (positional, battle-sim style): a player ship with pen attacks a shielded positioned enemy → same split. Scenario C: a DoT tick on a shielded tank leaves the shield untouched and reduces HP by the full tick. Use deterministic stats (no crit) and small integers.

- [ ] **Step 2: Run, verify fails** (pen ignored today → shield fully absorbs, DoT drains shield).

- [ ] **Step 3: Implement.**
  - `applyIncomingToTarget`: widen its `cause` default/param to forward `shieldPenetrationPct` and `bombPortion`. Default `shieldPenetrationPct` to `attackerShieldPenOf(cause.killerId ?? actingActorId)`. Pass `cause.bombPortion` through (default 0).

    ```typescript
    const applyIncomingToTarget = (
        damage: number,
        victim: CombatActor = healTarget!,
        cause: { killerId?: string; byDirectDamage?: boolean; bombPortion?: number } = {
            killerId: actingActorId,
            byDirectDamage: true,
        }
    ): VictimDamageOutcome =>
        applyVictimDamage(damage, victim, playerSink, {
            ...cause,
            shieldPenetrationPct:
                cause.byDirectDamage === false ? 0 : attackerShieldPenOf(cause.killerId ?? actingActorId),
            bombPortion: cause.bombPortion ?? 0,
        });
    ```

  - Enemy-aggregate call site (~4528): pass the detonation portion:

    ```typescript
    ({ shieldBefore, hpDamage, barriered } = applyIncomingToTarget(damage, tgt, {
        killerId: actingActorId,
        byDirectDamage: true,
        bombPortion: enemyTurn.detonationDamage,
    }));
    ```

    (`damage = enemyTurn.directDamage + enemyTurn.detonationDamage` at 4368, so `bombPortion` is exactly the non-pen portion.)

  - `applyOutgoingToEnemy` (~2861): add the pen for player→enemy positional hits (these are all-direct; bombPortion 0):

    ```typescript
    const applyOutgoingToEnemy = (damage: number, enemyVictim: CombatActor): VictimDamageOutcome =>
        applyVictimDamage(damage, enemyVictim, enemySink, {
            killerId: actingActorId,
            byDirectDamage: true,
            shieldPenetrationPct: attackerShieldPenOf(actingActorId),
        });
    ```

  - DoT batch (~3818): already passes `{ byDirectDamage: false }` → `applyIncomingToTarget` forces `shieldPenetrationPct: 0` and bypass happens in the absorb step. No change. Verify by reading.

- [ ] **Step 4: Verify** — `npm test -- shieldAbsorption` PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(combat): wire shield penetration + bomb portion at apply wrappers (H1)"`

---

## Task 5: Verify (and if needed wire) all-actor shield grant in the battle sim

**Files:**
- Read first: `src/utils/calculators/battleSimulator.ts` (`runCombat` call ~680), `src/utils/combat/engine.ts` (`healingCtx` ~2008, `grantShieldToTarget` ~2041), the cast-path shield grant in `playerTurn.ts`/`engine.ts` (recipient routing for shield abilities).
- Test: `src/utils/combat/__tests__/shieldGrantBattleSim.test.ts` (new)

**Scope is contingent (per spec):** `healingCtx` is constructed whenever `healTarget` exists, and battle sim sets `healTargetId: focus.id` — so the ctx is present. Confirm a shield ability cast in a battle-sim run actually grants a pool to the intended ally (not only the heal target). If grants already reach all actors via `recipientsFor`/`grantShieldToTarget(raw, recipientActor)`, this is a confirming test only. If not, wire the recipient routing for the shield branch (mirror the heal branch). **Flag the finding before adding scope.**

- [ ] **Step 1:** Write a battle-sim integration test: a player ship whose skill grants "shield equal to X% of max HP" to an ally; run `simulateBattle`/`runCombat`; assert the ally's `shieldPool > 0` (via a test tap or by observing later absorption).
- [ ] **Step 2:** Run; observe pass (already works) or fail (needs wiring).
- [ ] **Step 3:** If failing, wire the shield recipient routing to all targeted allies in the cast path.
- [ ] **Step 4:** Verify PASS; `tsc` clean.
- [ ] **Step 5:** Commit — `git commit -am "test(combat): all-actor shield grant in battle sim (H1)"` (or `feat` if wiring was needed).

---

## Task 6: Expose per-actor per-round shield data on the engine round result

**Files:**
- Modify: `src/utils/combat/engine.ts` — add per-round shield accounting; extend `RoundData` (the per-round result object battle sim reads via `rd.perTargetDamage`).
- Modify: `grantShieldToTarget` (~2041) to record granted-by-actor.
- Test: `src/utils/combat/__tests__/perActorShield.test.ts` (new)

**Add** a per-round accumulator `perActorShieldGranted: Map<string, number>` (reset each round, mirror `currentRoundHealing`'s lifecycle). In `grantShieldToTarget`, after the pool mutation, record `perActorShieldGranted.set(victim.id, (…?? 0) + actualGranted)` where `actualGranted = victim.shieldPool - before` (the post-cap delta, so a capped grant records the real increase). At round assembly, build a `perActorShield` record for the round:

```typescript
perActorShield: Record<string, { granted: number; absorbed: number; pool: number }>
```

- `granted` from `perActorShieldGranted`.
- `absorbed` from `perActorIncoming.get(id)?.shieldAbsorbed` (the sink already tracks this per victim).
- `pool` = the actor's `shieldPool` snapshot at end-of-round assembly (current shield).

Attach `perActorShield` to the `RoundData` pushed for that round (the same object that carries `perTargetDamage`).

- [ ] **Step 1:** Write a test driving `runCombat` with a shield grant + an incoming hit, asserting the round result's `perActorShield[id]` carries non-zero `granted`, `absorbed`, and a `pool` reflecting the post-absorb remainder.
- [ ] **Step 2:** Run, verify fails (field absent).
- [ ] **Step 3:** Implement the accumulator + `grantShieldToTarget` recording + `RoundData.perActorShield` assembly. Add `perActorShield?` to the `RoundData` type.
- [ ] **Step 4:** Verify PASS; `tsc` clean. Healing goldens may move here only if `granted` recording changes existing surfaces — it shouldn't (additive field). Run `npm test -- healingGoldenParity` and confirm byte-identical; if a snapshot adds the new optional field, that's additive — audit it in Task 7.
- [ ] **Step 5:** Commit — `git commit -am "feat(combat): expose per-actor per-round shield (granted/absorbed/pool) on RoundData (H1)"`

---

## Task 7: Audited healing-golden rebaseline (pen + DoT bypass)

**Files:**
- Modify (regenerate, then AUDIT): `src/utils/calculators/__tests__/healingGoldenParity.test.ts` snapshots and any healing `.snap`.
- Reference: the snapshot diff itself.

**Why goldens move:** enemy attackers now have pen 20 (default) → ~20% of each hit bypasses the tank's shield to HP; and Inferno/Corrosion no longer drain the shield. Both raise HP damage / change `shieldAbsorbed` in scenarios where the heal target carries a shield and takes damage.

- [ ] **Step 1:** Run `npm test -- healingGoldenParity` and capture the FULL diff WITHOUT updating.
- [ ] **Step 2:** For EACH changed scenario, hand-verify the new numbers against the formula (pen split / DoT bypass). Write the justification into the PR description / a comment. Confirm every delta is explained by exactly these two rule changes — no unrelated trajectory drift.
- [ ] **Step 3:** Only after every delta is explained, regenerate: `npm test -- healingGoldenParity -u` (this is the ONE sanctioned `-u`, scoped to the audited file). NEVER blanket `vitest -u`.
- [ ] **Step 4:** Re-run the full suite `npm test` → green. Diff the snapshot once more to confirm only the explained scenarios changed.
- [ ] **Step 5:** Commit — `git commit -am "test(combat): rebaseline healing goldens for shield pen + DoT bypass (audited) (H1)"`

---

## Task 8: Battle-sim surfacing — populate ShipRoundState shield fields

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts` (`ShipRoundState` ~50-90; per-round extraction ~727-732; assembly loop ~245-269)
- Test: `src/utils/calculators/__tests__/battleSimulator.test.ts` (extend)

- [ ] **Step 1: Write failing test** — a `simulateBattle` run where a ship is shielded and takes a hit: assert the round's `ships[i]` has `shieldGranted > 0`, `shieldsAbsorbed > 0`, and `currentShieldPool` reflecting the remainder.

- [ ] **Step 2:** Run, verify fails (`shieldsAbsorbed` is 0; new fields absent).

- [ ] **Step 3:** Implement.
  - Add to `ShipRoundState`: `shieldGranted: number;` and `currentShieldPool: number;` (and remove the stale "always 0 for PR1" comment on `shieldsAbsorbed`).
  - Mirror the `perRoundPerTarget` extraction (~727-732) with a `perRoundPerShield: Record<number, Record<string, {granted,absorbed,pool}>>` built from `rd.perActorShield ?? {}`.
  - In the assembly loop (~253-268), populate from `perRoundPerShield[round][entry.actorId]`:

    ```typescript
    const shield = perRoundPerShield[round]?.[entry.actorId];
    // ...
    shieldsAbsorbed: shield?.absorbed ?? 0,
    shieldGranted: shield?.granted ?? 0,
    currentShieldPool: shield?.pool ?? 0,
    ```

- [ ] **Step 4:** Verify PASS; `tsc` clean.

- [ ] **Step 5:** Commit — `git commit -am "feat(simulator): surface per-ship/round shield granted/absorbed/pool (H1)"`

---

## Task 9: Simulator UI — shield StatCards + board cue

**Files:**
- Modify: `src/components/simulator/ShipRoundCard.tsx` (~53-56)
- Modify: `src/utils/simulator/boardOverlays.ts` (`CellOverlay` ~20-29, `overlaysForRound` ~48-49)
- Modify: `src/components/simulator/BattleBoard.tsx` (~80-95)
- Test: existing component/overlay tests if present; otherwise a small overlay unit test.

- [ ] **Step 1:** (If an overlay test exists) write a failing test asserting `effect: 'shield'` when `shieldsAbsorbed > 0` and no damage. Add `'shield'` to `CellOverlay['effect']` union.
- [ ] **Step 2:** Run, verify fails.
- [ ] **Step 3:** Implement.
  - `ShipRoundCard.tsx`: add two StatCards after "Shields absorbed":

    ```tsx
    <StatCard title="Shield granted" value={fmt(state.shieldGranted)} color="blue" />
    <StatCard title="Current shield" value={fmt(state.currentShieldPool)} color="blue" />
    ```

  - `boardOverlays.ts`: extend the union to `'damage' | 'heal' | 'shield'` and the effect logic to fall through to `state.shieldsAbsorbed > 0 ? 'shield'` (after damage, before/after heal — put shield AFTER heal so damage/heal cues win when both occur):

    ```typescript
    const effect: CellOverlay['effect'] =
        state.damageTaken > 0 ? 'damage'
        : state.healingReceived > 0 ? 'heal'
        : state.shieldsAbsorbed > 0 ? 'shield'
        : undefined;
    ```

  - `BattleBoard.tsx`: add the shield badge block (use a UI color class; no inline styles), mirroring the damage/heal spans:

    ```tsx
    {overlay.effect === 'shield' && (
        <span className="text-[10px] text-blue-400 shrink-0" aria-label="shield absorbed">
            shield
        </span>
    )}
    ```

- [ ] **Step 4:** Verify — `npm test` green; `npm run lint` (max-warnings 0); `tsc` clean. Manually confirm the simulator renders the new cards (optional `npm start`).
- [ ] **Step 5:** Commit — `git commit -am "feat(simulator): shield StatCards + board cue (H1)"`

---

## Task 10: Arcane Siege goes-live integration test (free win)

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (extend)

Arcane Siege (`buildEquipmentAbilities.ts:559`) grants `outgoingDamage` while the `self-shield` gate is true (`selfShielded: actor.shieldPool > 0`). With shields now reachable, prove it activates.

- [ ] **Step 1:** Write a mutation-resistant integration test via the real registry: equip Arcane Siege (set `setBonus`/implant resolution) on a ship that ALSO has a self-shield source (a skill granting itself a shield, or a pre-seeded pool); run combat; assert its outgoing damage is higher than the identical run WITHOUT a shield (gate inactive → no bonus). Use `procChance`-free determinism where applicable.
- [ ] **Step 2:** Run; it should PASS already (gate + grant both exist; H1 made the shield reachable). If it fails, the shield isn't reaching the actor → revisit Task 5.
- [ ] **Step 3:** (No prod code expected.) If a wiring gap surfaces, fix minimally.
- [ ] **Step 4:** Verify PASS.
- [ ] **Step 5:** Commit — `git commit -am "test(combat): Arcane Siege activates with a live shield (H1)"`

---

## Task 11: Coverage, docs, changelog, final verification

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (combat/simulator docs — shield mechanic + penetration + DoT bypass)
- Editor stubs if any new ability-config field surfaced (none expected in H1).

- [ ] **Step 1:** Add a plain-English `UNRELEASED_CHANGES` entry: shields now consume penetration, DoTs bypass shields, bombs drain in full, and the battle simulator shows per-ship shield granted/absorbed/current.
- [ ] **Step 2:** Update `DocumentationPage.tsx` shield/combat section to match.
- [ ] **Step 3:** Run the full gate:
  - `npm test` → all green
  - `npm run lint` → 0 warnings
  - `npx tsc --noEmit` → clean
  - `npm run audit:skills` → unchanged (0 findings / 141 ships)
- [ ] **Step 4:** Confirm the only golden movement is the audited Task 7 healing rebaseline (+ additive `perActorShield`); DPS goldens byte-identical.
- [ ] **Step 5:** Commit — `git commit -am "docs(combat): shield system H1 changelog + documentation"`

---

## Definition of done (H1)

- Direct hits respect `shieldPenetration`; Inferno/Corrosion bypass the shield; bombs full-drain — all verified by unit + engine integration tests.
- Shields grant to all actors in the battle sim; Arcane Siege activates with a live shield.
- Battle simulator shows per-ship/round shield granted, absorbed, and current pool.
- Healing goldens rebaselined with a documented, audited justification; DPS goldens byte-identical; `audit:skills` unchanged; lint/tsc clean.
- No timed-shield / buff-folded-pen scope crept in (out of scope per spec).

## Notes for the implementer

- Pre-commit hook runs the FULL vitest suite. For docs-only commits use `git commit --no-verify`. `docs/` is gitignored → `git add -f` for the spec/plan if you touch them.
- NEVER blanket `vitest -u`. The only sanctioned update is Task 7's scoped `healingGoldenParity -u` after a hand-audit.
- `actingActorId` is the engine's current-acting-actor closure var; confirm it points to the enemy at the enemy-aggregate apply site (it backs the existing `killerId` default, which is already used for kill attribution there, so it is reliable).
- If `createActor`/input plumbing surfaces many `ActorStats` literals in tests, batch-fix them with `shieldPenetration: 0` — they are inert fixtures.
