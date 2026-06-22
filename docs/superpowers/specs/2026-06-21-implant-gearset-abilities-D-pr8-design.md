# D-PR8 — Reactive self-buff grants (Ambush / Synaptic Resonance / Alacrity)

**Date:** 2026-06-21
**Sub-project:** D (implants + gear-set abilities), combat-realism epic.
**Bucket:** Reactive self/ally buff grants — first sub-PR ("reactive **self**-buff grants").
**Stack:** `feat/combat-d-pr8-reactive-self-buffs` on D-PR7 tip `1e163c82`; own worktree `.worktrees/d-pr8-reactive-self-buffs`. Retarget to main as the lower stack merges.

## 1. Goal

Model three implants that **grant a timed self-buff on a trigger**, all riding the existing
reactive-buff executor. This is the first slice of the "reactive self/ally buff grant" bucket;
ally-wide grants (Spearhead all-allies, Fortifying Shroud adjacency) and shield/repair-triggered
grants (Resonating Fury, Font of Power) are later sub-PRs.

| Implant | Trigger | Gate condition | Buff granted | Duration | Proc chance (by rarity) |
|---|---|---|---|---|---|
| **AMBUSH** (major) | `start-of-round` | `self-buff` Stealth | Crit Power Up III | 1 turn | 0.05 / 0.07 / 0.09 / 0.12 / 0.16 (common→legendary) |
| **SYNAPTIC_RESONANCE** (ultimate) | `on-enemy-repaired` | none | Speed Up III | 1 turn | — (deterministic, no proc) |
| **ALACRITY** (major) | `end-of-round` | `not-hit-this-round` | Speed Up III | 2 turns | 0.12 / 0.14 / 0.16 / 0.20 (uncommon→legendary; no common) |

Source data: `src/constants/implants.ts` variant `description` strings (quoted in §6).

## 2. What already exists (grounding, verified in the D-PR7 worktree)

- **Reactive buff executor** — `triggers.ts:~1000` (`cfg.type === 'buff'`): resolves recipients
  (`self` → `[ownerId]`; `ally`/`all-allies` → `ctx.playerIds`), applies a `kind:'timed'` status
  via `applyTimedAbilityStatus`, emits `buff-applied`. Gated by `gateConditions` at drain time via
  `conditionsMet`. D-PR7's Battlecry (`buff`/`all-allies`/`on-destroyed`) is the precedent; its
  `mkNamedBuffGrant` resolves `parsedEffects` from `BUFFS` and derives `isStackable`.
- **Triggers** — `start-of-round`, `end-of-round`, `on-enemy-repaired` are all in `AbilityTrigger`
  and `LIVE_TRIGGERS` (`types/abilities.ts`). `on-enemy-repaired` already fires in the sim because
  E5 gave the enemy real healing (`heal-performed` for enemy actors). `end-of-round` is live
  (Rhodium C2b-2 purge rides it). `start-of-round` is live (Chakara PR6).
- **`self-buff` + `buffName` gate** — `self-buff` is a live `ConditionSubject`
  (`types/abilities.ts`, in `LIVE_SUBJECTS`); `evaluateCondition` matches it via
  `countNames(ctx.selfBuffNames, cond.buffName)` (`evaluateConditions.ts:41`), and `buildDrainContext`
  → `buildActorConditionContext` populates `selfBuffNames` from the owner's live status snapshot
  (`triggers.ts:643`). The `'Stealth'` buff name exists in `buffs.ts:142`. **NOTE:** `self-stealth`
  is NOT a `ConditionSubject` — it is a member of the `IncomingCondition` union (the per-incoming-hit
  victim seam used by D-PR3 Voidshade/Shadowguard). AMBUSH's "if in stealth" gate therefore uses
  `{ subject: 'self-buff', buffName: 'Stealth', derivable: true }`, the standard self-buff path, NOT
  `self-stealth`.
- **`procChance` machinery** — `procChanceGates` Map on `IntentExecContext` + `passesProcChanceGate`
  (`triggers.ts:908`), the deterministic rate-gate accumulator. Currently consumed by the
  **heal/shield** branch (`triggers.ts:1160`) and the **damage** branch (`triggers.ts:1264`) only.
- **Buff names** — `Crit Power Up III`, `Speed Up III` exist in `src/constants/buffs.ts`.
- **Condition delegate threading precedent** — Chakara's `isLowestSpeedAllyFor`:
  `IntentExecContext.isLowestSpeedAllyFor?(ownerId)` (`engine.ts:1027`) → `buildDrainContext`
  (`triggers.ts:696` `isLowestSpeedAlly: ctx.isLowestSpeedAllyFor?.(ownerId) ?? true`) →
  `buildRoundContext`. Engine populates it per-side (`engine.ts:3385/3406`). `not-hit-this-round`
  mirrors this exactly.

## 3. Two new engine primitives

### 3.1 `procChance` in the reactive buff branch

Add to the top of the `cfg.type === 'buff'` executor (after the `oncePerCombat` cap, before
recipient resolution):

```ts
if (!passesProcChanceGate(intent, ctx)) return;
```

This is the identical extension D-PR4 made to the `damage` branch. `passesProcChanceGate` is a
De-Morgan pass-through: it returns `true` whenever `procChance` is `undefined`/`≤0`/`≥1`, so **every
existing buff grant (none carry `procChance`) is byte-identical**. The gate keys on
`${ownerId}:${ability.id}` in `procChanceGates`, consistent with all other proc sites.

Needed by AMBUSH + ALACRITY. SYNAPTIC_RESONANCE carries no `procChance` → unaffected.

### 3.2 `not-hit-this-round` condition

New `ConditionSubject` `'not-hit-this-round'`. Semantics: **true when the owner received zero
direct hits during the current round.**

- **"Hit" rule (locked):** any **direct** attack that lands damage on the ship's shield **or** HP
  counts as a hit. A direct attack does not have to reach HP — touching the shield is enough.
  **DoT ticks do NOT count** as being hit (not a direct attack).
- **TO VERIFY (not locked):** a direct attack **fully absorbed by Barrier** (touches neither shield
  nor HP). Default for this PR: **not a hit** (nothing is touched). Flagged in code as a
  to-verify-in-game item; revisit if the in-game behavior says a blocked attack still counts.

**Engine state:** a per-round `Set<string>` of actor ids hit this round — mirrors the existing
`repairedThisRound` Set (cleared at `engine.ts:~2373` right after `beginRound`; that Set is the
direct precedent for clear-timing and shape).
- Cleared at round start (right after `beginRound`, alongside `repairedThisRound`).
- Populated inside the **shared `applyVictimDamage` core closure** (`engine.ts:~2534`), NOT in a
  named wrapper. There are two wrappers over this core — `applyIncomingToTarget` (enemy→player
  victim, `~2729`) and `applyOutgoingToEnemy` (player→enemy victim, `~2760`) — so recording in the
  core is what makes the hit set **team-agnostic** (an enemy Alacrity must see its own hits too).
  The core takes a `cause?: { killerId?; byDirectDamage? }` (`~2542`); the wrappers default
  `byDirectDamage: true`, the DoT-tick batch overrides `byDirectDamage: false`
  (`applyIncomingToTarget(..., { byDirectDamage: false })`, `~3610`).
- **Exact predicate (locked):** record the victim as hit when
  `cause?.byDirectDamage === true && !barriered && (shieldBefore > 0 || hpDamage > 0)`. The
  `byDirectDamage` guard subsumes the DoT exclusion in one flag — DoT ticks pass `false` and never
  record. `shieldBefore` is the pre-hit pool (the non-barriered branch always drains shield before
  HP, so `shieldBefore > 0` ⇒ shield was touched). A fully Barrier-blocked hit (`barriered === true`,
  early return `~2569`/`~2636`) records **nothing** → not a hit (the TO-VERIFY default above).

**Threading (three files change in lockstep, same triad `self-shield` touched):**
1. `ConditionContext` + `RoundContextInput` gain `wasHitThisRound?: boolean` (`roundContext.ts`),
   defaulting `?? false` in `buildRoundContext` (mirrors `selfShielded`).
2. `evaluateCondition` adds the `'not-hit-this-round'` case returning `ctx.wasHitThisRound ? 0 : 1`
   (met ⇔ NOT hit) (`evaluateConditions.ts`).
3. `'not-hit-this-round'` is added to `LIVE_SUBJECTS` (`abilityStatusGating.ts`) — otherwise
   `liveGateConditions` neutralizes it to always-true and ALACRITY would grant even when hit.

**Delegate:** new optional `wasHitThisRoundFor?(ownerId: string): boolean` on `IntentExecContext`
(next to `isLowestSpeedAllyFor`/`selfHpPctFor`); `buildDrainContext` forwards
`wasHitThisRound: ctx.wasHitThisRoundFor?.(ownerId) ?? false`. The engine binds it on **both** side
contexts (player `drainIntents` ~`engine.ts:3385`/`3381`, enemy `drainEnemyIntents` ~`3406`/`3398`)
from the per-round hit set — team-agnostic, so an enemy Alacrity behaves identically.

ALACRITY fires at `end-of-round`, by which point all direct attacks for the round have landed, so
the hit set is complete when the gate evaluates.

Needed by ALACRITY only.

## 4. Three registry entries

In `buildEquipmentAbilities.ts` `IMPLANT_ABILITIES`, add a small `mkSelfBuffGrant` helper (mirrors
D-PR7 `mkNamedBuffGrant`: resolve `parsedEffects` via `parseBuffEffects` from `BUFFS`, derive
`isStackable`, guard buff-not-found → `undefined`). Each entry is `type:'buff'`, `target:'self'`.

```text
AMBUSH(rarity):              trigger 'start-of-round',
                             conditions [{subject:'self-buff', buffName:'Stealth', derivable:true}],
                             buffName 'Crit Power Up III', duration 1,
                             procChance AMBUSH_PROC[rarity]            (5 rarities)
SYNAPTIC_RESONANCE(rarity):  trigger 'on-enemy-repaired', conditions [],
                             buffName 'Speed Up III', duration 1       (no procChance; all 5 rarities)
ALACRITY(rarity):            trigger 'end-of-round',     conditions [not-hit-this-round],
                             buffName 'Speed Up III', duration 2,
                             procChance ALACRITY_PROC[rarity]          (4 rarities; common → undefined)
```

Per-rarity tables baked from §6. Builders return `undefined` for unsupported rarities (e.g.
ALACRITY common) → graceful skip, consistent with the registry contract.

The implant ability id follows the current registry convention `equip-implant-${implantName}`
(no per-piece suffix — the gearId suffix from D-PR1 was dropped in the PR3–7 registry refactor).
The proc-rate gate keys on `${ownerId}:${ability.id}`, so two copies of the *same* implant on one
ship would share a gate; this is academic (real loadouts equip one of each implant) and out of
scope — if per-piece proc independence is ever needed it's a separate change.

## 5. Liveness & known limits (accepted)

- **AMBUSH is dormant today** — nothing grants the Stealth buff in the sim yet, so the `self-buff`
  Stealth gate is always unmet → the buff never fires. Accepted, same pattern as D-PR2's Arcane
  Siege (dormant until shields). Lights up when Cloaking / a stealth-grant lands (a later D PR). The
  registry entry + gate are correct now; only the Stealth source is missing. **Intra-drain ordering
  TODO (for when a stealth source ships):** at round start the engine emits `round-started` then
  calls `drainIntents()`; AMBUSH reads the owner's live `selfBuffNames` at drain time, so if a
  *different* start-of-round ability is what grants Stealth, queue drain order decides whether
  AMBUSH sees it that round. Not a blocker now (dormant); flag in code so it isn't forgotten.
- **Timed-buff expiry:** AMBUSH/ALACRITY's granted self-buffs ride the same reactive-self-buff
  duration-decrement timing as every other timed self-buff (the documented "1-turn self-buff
  expires one turn early" engine behavior). Not solved here — shared with all reactive grants.
- **SYNAPTIC_RESONANCE is live** — `on-enemy-repaired` fires whenever an enemy actor is repaired
  (E5 symmetric healing). The **"+X% next-crit critDamage" half is DEFERRED** — it is a stacking,
  single-consume next-crit modifier with no existing seam; out of scope. Only the Speed Up III
  grant is modeled this PR. Documented in the registry comment.
- **ALACRITY is live** — the granted Speed Up III folds into turn order via the A effective-stats
  backbone (speed is dynamic).

## 6. Source descriptions (verbatim, for value derivation)

**AMBUSH** (proc % scales with rarity; buff + duration constant):
- common 5% / uncommon 7% / rare 9% / epic 12% / legendary 16%
- "At the start of the round, if in stealth, there is a N% chance to gain Crit Power Up 3 for 1 turn."

**SYNAPTIC_RESONANCE** (deterministic; the trailing critDamage clause is the deferred half):
- "Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases the critDamage of
  the next crit by {2/4/6/8/10}%" (common→legendary)

**ALACRITY** (proc % scales with rarity; no common variant):
- uncommon 12% / rare 14% / epic 16% / legendary 20%
- "At the end of the round, if not hit, there is a N% chance to gain Speed Up 3 for 2 turns"

("Speed Up 3" / "Crit Power Up 3" map to the roman-numeral buff tiers Speed Up III / Crit Power Up III.)

## 7. Testing

- **Registry unit tests** (`buildEquipmentAbilities.test.ts` or coverage): each of the 3 implants
  produces exactly 1 ability per supported rarity, with the right trigger/target/buffName/duration
  and (for AMBUSH/ALACRITY) the right `procChance`; ALACRITY common → 0 abilities.
- **Coverage tracker** (`equipmentCoverage.test.ts`): add `AMBUSH`, `ALACRITY`,
  `SYNAPTIC_RESONANCE` to BOTH the `.toEqual` decl-order array AND the `implementedImplants` Set
  (known pitfall — both must move together).
- **Pure evaluator test** for `not-hit-this-round`: `evaluateCondition` returns met when
  `wasHitThisRound` is false/undefined, not-met when true.
- **AMBUSH gate test** — assert AMBUSH's gate is `self-buff` Stealth and evaluates met only when the
  owner carries the Stealth buff (proves the gate uses the correct ConditionSubject, not the broken
  `self-stealth` IncomingCondition). Since no sim source grants Stealth, an engine-level
  "fires when Stealth present" test seeds the buff directly onto the owner.
- **Engine integration tests:**
  - SYNAPTIC_RESONANCE: an enemy actor is repaired → the equipped owner gains Speed Up III for 1
    turn (assert via `buff-applied` / the owner's active statuses).
  - ALACRITY: round where the owner takes no direct hit → Speed Up III granted (proc forced via a
    procChance that the rate-gate accumulates to fire); round where the owner is hit → withheld.
  - Hit-recording: a direct attack that only drains shield records the victim as hit (so ALACRITY
    withholds); a DoT-only round does not record a hit (ALACRITY may still grant).
- **Goldens byte-identical** — no DPS/healing golden fixture equips these implants; the
  procChance-in-buff extension is De-Morgan pass-through; the new condition defaults to `false`
  (not-hit ⇒ met) only when the delegate is present (engine populates it), and no fixture carries
  an `end-of-round` self-buff implant. Confirm zero `.snap` movement; if a golden moves, the gate
  leaked — fix the gate, never `vitest -u`.

## 8. Out of scope (later sub-PRs of this bucket)

- **SPEARHEAD** (all-allies Attack Up I, after-charged-skill) — needs a charged-cast trigger +
  all-allies fan-out. D-PR9.
- **FORTIFYING_SHROUD** (adjacent-allies Defense Up I, every turn) — needs per-turn trigger +
  adjacency (positional). D-PR10.
- **RESONATING_FURY** (self Crit Power Up III, on-shield-applied) — needs shields (sub-project H).
- **FONT_OF_POWER** (self Power Infused Nanobots, on-own-repair-to-ally) — needs an on-own-repair
  trigger; may fold into D-PR9.
- SYNAPTIC_RESONANCE's next-crit critDamage half (stacking consumable).
