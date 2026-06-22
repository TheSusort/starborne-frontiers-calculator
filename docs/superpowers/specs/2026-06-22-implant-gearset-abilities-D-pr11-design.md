# D-PR11 — Fortifying Shroud (per-turn adjacency buff grant)

**Date:** 2026-06-22
**Sub-project:** D (implant + gear-set abilities), combat-realism epic
**Stacks on:** D-PR10 (`feat/combat-d-pr10-flat-attack-buff`, tip `3138f1fa`, PR #138)
**Branch:** `feat/combat-d-pr11-fortifying-shroud`

## 1. Motivation

Fortifying Shroud is the next slice of the "reactive self/ally buff" bucket and the
**first effect that grants a buff to a positionally-defined recipient set** ("all
adjacent allies"). It introduces two reusable engine primitives — a `start-of-turn`
trigger and an `adjacent-allies` recipient scope — that future positional buff/heal
implants can reuse.

## 2. Effect data (source of truth)

`src/constants/implants.ts` → `IMPLANTS.FORTIFYING_SHROUD` (a `major` implant), four
rarity variants, identical text modulo the proc percentage:

> "Every turn, there is a **X%** chance to grant **all adjacent allies** Defense Up 1
> for 1 turn"

| rarity     | proc chance |
|------------|-------------|
| uncommon   | 18%         |
| rare       | 21%         |
| epic       | 26%         |
| legendary  | 32%         |

(No common variant.) The flat-defence / %-HP stat lines on each variant are ordinary
gear stats already folded into combat stats — out of scope; this PR adds only the
special-effect ability. The `description` string is used solely as a presence gate
(the D-PR1 convention); the magnitudes are baked into the registry from constants.

The granted buff is **Defense Up I** (`src/constants/buffs.ts:659`, `+15% Defense`), which folds through
the existing `defence` buff channel — no new fold work. The implant text says "Defense
Up 1" (numeral); the registry hard-codes the corpus name `'Defense Up I'`.

## 3. Design overview

Three pieces, smallest-blast-radius first:

1. **`start-of-turn` trigger** — a new reactive `AbilityTrigger` that rides the
   **already-emitted `turn-started` event**, self-scoped to the owner.
2. **`adjacent-allies` recipient scope** — a new `AbilityTarget` resolved at drain time
   via a new per-side engine delegate `adjacentAllyIdsFor(ownerId)`.
3. **Registry entry** — one `IMPLANT_ABILITIES.FORTIFYING_SHROUD` builder using the
   existing `mkNamedBuffGrant` helper (widened to accept the new target).

### 3.1 `start-of-turn` trigger

"Every turn" means **at the start of the ship's own turn** (user-confirmed). The engine
already emits exactly this signal:

```
engine.ts:3562  bus.emit({ type: 'turn-started', actorId: actor.id, round: r });
```

emitted once per actor at the top of that actor's turn body, in the unified turn loop
(both player and enemy actors). It is currently consumed by nothing as a trigger —
`start-of-round` was deliberately mapped to `round-started` instead precisely because
`turn-started` fires per-actor (`events.ts:11-14`, `types/abilities.ts:33-37`). That
per-actor cadence is exactly what we want.

Wiring (mirrors `on-charged-cast`, which rides `skill-fired` self-scoped, triggers.ts:265):

```ts
case 'start-of-turn':
    bus.on('turn-started', (e) => {
        if (e.actorId === ownerId) enqueue(intent);
    });
    break;
```

- Add `'start-of-turn'` to the `AbilityTrigger` union (`types/abilities.ts`) **and** to
  `LIVE_TRIGGERS` (consumed by a listener).
- The intent is drained by the per-turn `drainIntents` / `drainEnemyIntents` that follow
  the turn body — **team-agnostic by construction** (the enemy mirror works with zero
  extra code, like every prior reactive trigger; an enemy-side integration test proves
  it with no production change).
- Timing: the grant fires at the owner's turn-start, *before* the owner acts. Defense Up
  then protects adjacent allies against incoming damage they take later in the round (and
  is subject to the engine's existing buff-duration-decrement timing — a pre-existing,
  out-of-scope behaviour we inherit, not change).

### 3.2 `adjacent-allies` recipient scope

Add `'adjacent-allies'` to the `AbilityTarget` union (`types/abilities.ts:29`).

Resolved in the **buff branch** recipient list (triggers.ts:1069-1076) by prepending a
branch:

```ts
const recipients: string[] =
    intent.ability.target === 'adjacent-allies'
        ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
        : intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
          ? intent.eventCtx.repairedAllyIds
          : /* …existing branches unchanged… */;
```

`ctx.playerIds` is the same-side recipient id list (`sideCtx.recipientIds`), so the
`?? ctx.playerIds` fallback is side-correct (it's the all-allies set for whichever side
is draining).

**New delegate** `IntentExecContext.adjacentAllyIdsFor?(ownerId): string[]`
(triggers.ts, next to `isLowestSpeedAllyFor` / `wasHitThisRoundFor`), plumbed through
`sideCtx` exactly like `isLowestSpeedAllyFor` (triggers.ts:607, engine.ts:3364).

**Engine computation** (per side, mirroring the `lowestSpeedIds` side closures at
engine.ts:1733-1758), over the side's roster (`allPlayerActors` for player,
`enemyAttackerActors` for enemy):

```
adjacentAllyIdsFor(ownerId):
    owner = roster.find(id === ownerId)
    if owner has a board position AND ≥1 OTHER roster actor has a position:
        nbrs = neighbors(owner.position)                       // board.ts:56
        return living same-side actors whose position ∈ nbrs   // excludes owner
    else:
        return all OTHER living same-side actor ids            // non-positional fallback (§3.3)
```

- `neighbors()` (`src/utils/targeting/board.ts:56`, **not** under `combat/`) already
  encodes the game's 6-direction hex adjacency (board geometry resolver, PR #106,
  user-verified cell-by-cell).
- "Living" = not destroyed. The engine's canonical destroyed signal is
  `destroyedRound !== undefined` (engine.ts:3528-3546), **not** `currentHp <= 0` — use
  that accessor.
- The owner is **excluded** from its own grant ("adjacent allies", not "self + adjacent").

### 3.3 Non-positional fallback → all-allies (user decision)

DPS calc and healing calc pass **no board positions**. In that mode `adjacentAllyIdsFor`
returns **all same-side allies** (the user's chosen fallback), so the implant still has a
meaningful effect off-board. This is side-correct (computed per-side) and degrades the
positional "adjacent" set to the whole team when adjacency is undefined.

**Current reality:** no production caller wires board `position` onto team actors yet —
`position` is set-at-construction plumbing only; DPS, healing, *and* the simulator all
pass no positions today. So in every current production path the **all-allies fallback is
what runs**, and the true positional `neighbors()` branch is exercised **only by the new
unit/integration tests** in this PR until a future PR wires real board positions from
loadouts. The branch is built now so it's ready when positions arrive.

**Golden safety:** no existing DPS or healing golden fixture equips Fortifying Shroud
(true for every D-PR to date — effect-bearing gear is never present in goldens), so
neither the positional branch nor the all-allies fallback fires in any golden → **zero
golden / `.snap` churn**.

### 3.4 Registry entry

`mkNamedBuffGrant`'s `target` parameter widens from
`'self' | 'ally' | 'all-allies'` to additionally allow `'adjacent-allies'`
(buildEquipmentAbilities.ts:319). Then:

```ts
FORTIFYING_SHROUD: (rarity) => {
    const procChance = FORTIFYING_SHROUD_PROC_CHANCE[rarity]; // 0.18/0.21/0.26/0.32
    return mkNamedBuffGrant('Defense Up I', 'adjacent-allies', 'start-of-turn', 1, {
        procChance,
    });
},
```

`mkNamedBuffGrant` returns `undefined` for an unknown rarity (no common variant) or a
missing buff — graceful skip, never throws (existing contract). `procChance` rides the
D-PR8 buff-branch proc gate (`passesProcChanceGate`, defined triggers.ts:953, called in
the buff branch triggers.ts:1058) keyed `${ownerId}:${ability.id}`. The implant ability id
is `equip-implant-${implantName}-${gearId}` (per-piece suffix, buildEquipmentAbilities.ts:734),
so each equipped copy of the implant gets a distinct ability id and therefore its own
proc-chance stream — keyed per (owner, gear piece) — consistent with the "one effect = one
probability stream per (owner, ability)" fidelity model.

A new `FORTIFYING_SHROUD_PROC_CHANCE` per-rarity constant lives beside the other implant
constant tables (buildEquipmentAbilities.ts), values from `implants.ts`.

## 4. Editor exhaustiveness stubs

Adding a union member forces a few editor switch/Record updates (the pattern every prior
D-PR followed):

- **Trigger picker** — surface `'start-of-turn'` as a trigger option (AbilityCard /
  TRIGGER_OPTIONS), label e.g. "Start of own turn".
- **Target picker** — surface `'adjacent-allies'` as a target option wherever
  `AbilityTarget` is enumerated for the editor.

These are UI completeness only; they do not change combat behaviour. The exact set is
discovered by `tsc` (exhaustive `Record`/`switch` errors) during implementation.

## 5. Coverage tracker

`src/utils/abilities/__tests__/equipmentCoverage.test.ts`: add `'FORTIFYING_SHROUD'` to
**both** the `implementedImplants` array (`.toEqual`, in `IMPLANTS` declaration order)
**and** the `implementedImplants` `Set` (the known two-place pitfall from D-PR7).

## 6. Testing

1. **Pure delegate unit test** (`adjacentAllyIdsFor` math): on a board with the owner +
   adjacent allies + a non-adjacent ally + a dead adjacent ally → returns exactly the
   living adjacent allies, owner excluded; owner with no position → all living same-side
   allies (non-positional fallback); empty same-side → `[]`.
2. **Registry test**: `buildEquipmentAbilities` for a ship carrying Fortifying Shroud
   emits a `buff` / `adjacent-allies` / `start-of-turn` ability with the right proc
   chance and `Defense Up I` parsed effects; absent for a ship without it.
3. **Engine integration (positional)**: owner with 2 adjacent + 1 non-adjacent living
   ally, deterministic proc (force the gate) → only the 2 adjacent allies receive Defense
   Up I; the non-adjacent ally does not; assert the buff lands on a `turn-started` of the
   owner's turn.
4. **Proc-gate determinism**: with proc < 1 and a seeded/zeroed gate, no grant; with the
   accumulator crossing 1, exactly one grant for that owner+ability.
5. **Enemy-side mirror**: an enemy carrying Fortifying Shroud grants its enemy-side
   adjacent allies Defense Up — proving team-agnosticism with **zero** production change.
6. **Golden gate**: full DPS + healing golden suites byte-identical (no fixture equips the
   implant).

## 7. Scope / out of scope

**In scope:** Fortifying Shroud only. Builds the reusable `start-of-turn` trigger and
`adjacent-allies` recipient scope.

**Out of scope / deferred:**

- The "**when an adjacent ally is directly damaged → apply Provoke**" implant
  (`implants.ts:1446`, the Sentinel's-Vigil-style effect) is a *different* mechanism: an
  adjacency-gated **trigger** (`on-adjacent-ally-attacked`) plus **Provoke** forced-target
  control, which the engine does not yet simulate. It belongs to the CF/Provoke-appliers
  bucket, not this PR.
- The pre-existing `adjacentAllyCount` / `enemyAdjacentCount` condition subjects
  (evaluateConditions.ts:15-16, defaulted to 0 / inert) are a scaling-count concept, not a
  recipient set; this PR does not wire them to real positions. (Could be revisited later
  using the same `neighbors()` machinery.)

## 8. Files touched (anticipated)

- `src/types/abilities.ts` — `AbilityTrigger` += `start-of-turn` (+ `LIVE_TRIGGERS`);
  `AbilityTarget` += `adjacent-allies`.
- `src/utils/combat/triggers.ts` — `start-of-turn` listener; `adjacent-allies` recipient
  branch in the buff executor; `adjacentAllyIdsFor` on `IntentExecContext` + `sideCtx`.
- `src/utils/combat/engine.ts` — per-side `adjacentAllyIdsFor` closure (mirror
  `lowestSpeedIds`), wired into both `sideCtx` literals.
- `src/utils/abilities/buildEquipmentAbilities.ts` — `FORTIFYING_SHROUD` registry entry,
  proc-chance constant, `mkNamedBuffGrant` target widening.
- Editor: trigger/target picker stubs (exact files via `tsc`).
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — coverage entry (two places).
- New/updated tests per §6.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- `src/pages/DocumentationPage.tsx` — if the implant/combat docs enumerate modelled
  effects, add Fortifying Shroud.

## 9. Risks / known limitations

- **Buff-duration timing:** "1 turn" granted at the owner's turn-start inherits the
  engine's existing buff-decrement timing (memory: `buff_duration_decrement_timing`). Not
  changed here; matches every other 1-turn reactive grant.
- **Liveness accessor:** use `destroyedRound !== undefined` (engine.ts:3528-3546) so dead
  adjacent allies are excluded consistently.
- **All-allies fallback fidelity:** off-board the effect over-grants (whole team rather
  than true neighbours). Accepted (user decision). Note this is the *only* path that runs
  in production today (no caller wires positions yet) — the positional branch is test-only
  until a future PR supplies board positions.
- **`start-of-turn` drain ordering:** confirm the per-turn drain that follows
  `turn-started` executes the enqueued intent within the same turn (the
  `on-charged-cast` precedent rides a later same-turn event and is drained, so this is
  expected, but verify in the integration test).
```
