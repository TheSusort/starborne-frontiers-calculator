# D-PR — Cloaking gear set (first Stealth source)

**Date:** 2026-06-23
**Sub-project:** D (implants + gear-set abilities), combat-realism epic
**Status:** Design — approved, pre-spec-review

## Summary

Adds the **Cloaking** gear set (`gearSets.ts:118`, `description: '2 turns stealth'`, no stats) as a combat ability: at the start of combat — before any ship on either team acts — the equipped ship gains the `'Stealth'` buff for 2 turns, once per battle.

This is the **first source of the `'Stealth'` buff in the combat engine**. The entire *consumer* side of Stealth is already built and currently dormant (no source granted it until now). Granting it lights up, all keyed on the buff name `'Stealth'`:

- **Positional targeting filter** (`positionalBinding.ts`) — a stealthed actor is untargetable unless every opposing actor is also stealthed.
- **D-PR3 `self-stealth` incoming-reduction** condition (e.g. Voidshade) — engages while the carrier is stealthed.
- **`incoming-crit-by-stealthed`** condition (D-PR3).
- **D-PR8 Ambush implant** — gates on `self-buff` `buffName: 'Stealth'`; its proc now becomes reachable.

The change is a single registry entry plus tests. No new trigger, no new primitive, no engine surgery.

## Decisions (locked with the user)

- **Grant timing:** once at the **start of combat, before any ship on either team has taken any action** (not on the owner's own — possibly slow — turn).
- **Stealth persists through attacks:** the cloaked ship attacking does **not** break its own stealth. Stealth is a plain 2-turn timed buff that expires by duration.
- **Wusheng's break-on-damage passive is OUT OF SCOPE.** The only in-game exception to "stealth persists" is Wusheng's passive skill, which breaks stealth when the unit is damaged. That is a *ship-skill* mechanic requiring a break-on-damage primitive that does not exist today — a separate follow-up, not part of the Cloaking gear set.
- **Scope = the Cloaking gear set only.** Any other stealth granting (ship skills, implants) is out of scope; no other source exists today.
- **DPS page not wired** — Stealth is a defensive/targeting effect with no stat fold, so it does not affect the DPS calculator.

## Design

### Trigger choice: `start-of-round` + `oncePerCombat`

The engine emits `round-started` once per round and immediately runs **drain point (a)** — `drainIntents()` / `drainEnemyIntents()` — **before the first `turn-started` of that round** (`engine.ts:3551-3560`):

```
bus.emit({ type: 'round-started', round: r });
// Drain point (a): start-of-round intents execute before the first turn.
drainIntents();
drainEnemyIntents();
```

So a `start-of-round` buff grant resolved in round 1 lands the Stealth buff **before any actor on either team acts** — exactly the required semantics. `oncePerCombat: true` prevents re-granting in rounds 2+.

This reuses the path the **D-PR8 Ambush** implant already proves: a passive-slot `start-of-round` buff grant flowing through the reactive buff executor. `start-of-round` ∈ `LIVE_TRIGGERS`; equipment abilities are merged into the passive slot by the existing `buildShipAbilitiesWithEquipment` wrapper; `registerReactiveListeners` runs both sides, so it is team-agnostic by construction.

A dedicated `start-of-combat` trigger / pre-round-loop setup pass was considered and rejected (YAGNI): round-1 `start-of-round` already lands before any action, so a new seam would add machinery for no behavioral gain.

### Registry entry

Add to `GEAR_SET_ABILITIES` (`src/utils/abilities/buildEquipmentAbilities.ts`), alongside `LEECH` / `HARDENED`:

```js
CLOAKING: () => ({
    type: 'buff',
    target: 'self',
    trigger: 'start-of-round',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        duration: 2,
        oncePerCombat: true,
        parsedEffects: <resolved from BUFFS['Stealth'] via parseBuffEffects>,
        isStackable: <derived from the buff, as mkNamedBuffGrant does>,
    },
    autoFilled: true,
}),
```

The buff executor honors `oncePerCombat` for `type: 'buff'` grants (`triggers.ts:1175`, keyed `${ownerId}:${ability.id}`). If `mkNamedBuffGrant`'s `opts` doesn't yet carry `oncePerCombat`, the implementation may either extend that helper's `opts` (mirroring how it already accepts `conditions`/`procChance`) or build the ability inline — an implementation choice for the plan.

Set-count gating is already generic: `buildEquipmentAbilities` only emits a set ability when the equipped piece count ≥ `GEAR_SETS[setName].minPieces` (`buildEquipmentAbilities.ts:870-878`). No per-set count logic is added.

### The `'Stealth'` buff

`'Stealth'` already exists in `buffs.ts:157` (`description: 'Remains untargetable unless no targets without stealth are available.'`). It carries **no stat effects** — it is a targeting/condition buff. `isStealthed` (`engine.ts:2216`) and the targeting filter read it purely by **name** (`selfBuffNamesForOwners(...).includes('Stealth')`). Granting it therefore produces no stat-fold change — only the targeting filter, the `self-stealth`/`incoming-crit-by-stealthed` conditions, and the Ambush gate respond.

## Engine fix: drain-gate self-buff visibility (scope addition, 2026-06-23)

**Discovered during implementation; user chose to fix it in this PR.**

The three dormant consumers split into two visibility classes:

- **Targeting filter + D-PR3 `self-stealth` / `incoming-crit-by-stealthed`** read self-buff names via `selfBuffNamesForOwners` / `isStealthed`, which aggregate **both** the snapshot channel *and* ability-sourced timed statuses. These see Cloaking's Stealth and work with no further change.
- **D-PR8 Ambush's `self-buff` gate** is evaluated at drain time via `buildDrainContext` → `buildActorConditionContext`, whose `selfBuffNames` come from `snapshot().activeSelfBuffs` **only** unless `includeAbilitySelfNames` is true — and `buildDrainContext` deliberately passes it `false`. Cloaking grants Stealth as an ability-sourced (payload-carrying) timed status, which the snapshot excludes. So Ambush's gate never sees it.

`start-of-round` abilities (both Ambush and Cloaking) enqueue intents (`triggers.ts:374`) that are drained through `executeIntent`, whose single gate check is `buildDrainContext` (`triggers.ts:1156`) — so flipping the flag there is the correct and sufficient lever.

**Fix:** set `includeAbilitySelfNames: true` in `buildDrainContext`. The `self-buff` ConditionSubject is the *only* subject reading `selfBuffNames`, and `'Stealth'` (via Cloaking) is the only buff name that is exclusively ability-sourced today — so the flip is semantically a no-op for every existing fixture. **Empirically verified zero churn:** with the flip, the full suite (3122 tests / 222 files) passes with **no `.snap` drift**. The "golden-locked" doc comments at `triggers.ts:~724-730` / `~808-811` describe a latent gap, not a depended-upon invariant; they will be corrected.

**Scope boundary:** only the self-buff side is touched. The symmetric `landedEnemyDebuffCount` undercount (`triggers.ts:~732-740`, no `includeAbilityEnemyNames` analogue) is **explicitly left untouched** — it is genuinely golden-sensitive and out of scope.

**Intra-drain ordering note:** at round-1 drain, Cloaking's grant intent must execute before Ambush's gate check for Ambush to fire in round 1 (player-side Stealth expires by round 2). The merge order puts the gear-set (Cloaking) ability before the implant (Ambush) ability, so this holds — but the integration test confirms it empirically (fails without the flip, passes with it) rather than relying on the ordering assumption.

## Golden safety

Expect **ZERO golden / `.snap` drift**, consistent with every prior D PR:

- No combat fixture equips the Cloaking set, so the new `start-of-round` branch is unreachable by existing fixtures (verify during implementation).
- The `'Stealth'` buff has no stat effects → no fold change even if a fixture did carry it.
- The DPS/aggregate path is unaffected by targeting; the dormant `self-stealth` conditions and Ambush only engage when those abilities are also present, which no fixture has.

## Testing

- **Unit:** `buildEquipmentAbilities` produces the Cloaking ability with `type: 'buff'`, `buffName: 'Stealth'`, `trigger: 'start-of-round'`, `duration: 2`, `oncePerCombat: true`, and resolved `parsedEffects`; gated correctly on `minPieces`.
- **Integration (real `runCombat`, positional, via the registry — not a hand-rolled ability):**
  - A Cloaking ship is **untargetable while Stealth is active** (incoming attacks redirect to a non-stealthed ally) and **targetable once Stealth expires**. Note: pin the exact expiry round to the engine's *actual* buff-duration decrement behavior — the known `project_buff_duration_decrement_timing` quirk means a duration-N buff may not expire on the naive round N+1, so the plan should assert against observed decrement timing rather than hard-coding a round number.
  - The grant fires **once** — Stealth is not re-applied / re-extended at the start of round 2.
  - **Cloaking + Ambush synergy:** a ship carrying both the Cloaking set and the Ambush implant procs Ambush (its `self-buff: 'Stealth'` gate is now satisfied) — guarding against the gate being unreachable.
  - **Enemy-side mirror:** an enemy ship with Cloaking is untargetable to the player team (team-agnostic).
- **Coverage tracker:** add `CLOAKING` to the implemented gear-set set in `equipmentCoverage.test.ts` (decl-order array + Set + the `it(...)` exact-set assertion, per the established three-spot pattern).

## Follow-ups (explicitly deferred)

- **Wusheng break-on-damage passive** — breaks stealth when the unit is damaged; needs a new break-on-action primitive. Separate ship-skill PR.
- **Other stealth sources** (ship skills / implants, if any) — out of scope; none exist today.
