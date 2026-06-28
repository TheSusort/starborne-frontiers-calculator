# Overload Lifecycle — Design

**Date:** 2026-06-28
**Epic:** Combat realism ([[project_combat_realism_epic]]) — the deferred follow-up to the control-classification unification (PR #174).
**Status:** Approved (brainstorm), ready for implementation plan.

## 1. Problem & Goal

`Overload` is a stackable self-buff (`+10% Outgoing Direct Damage, -10% Defense`, cap 10; Ruiner cap 5)
carried by the five Marauder-family ships. Its defining mechanic — **you keep stacking it until you
kill an enemy, at which point you lose all of it** — is not modeled. Today:

- **"gains Overload every turn"** already works: parsed as a `recurring` self-buff with
  `stackTrigger: 'per-round'`, climbing to the cap. ✅
- **"Upon killing an enemy, this Unit loses Overload"** is **not** modeled. `parseSkillEffects`
  explicitly *skips* tags preceded by `loses` (returns `[]`). The buff persists forever.
- **"gains Marauder Rage X for Y turns"** (the on-kill / on-debuff payoff) — the named buffs exist
  in `buffs.ts` with stats, but their reactive triggers are not detected, so they fall through to
  `on-cast` and are granted unconditionally (a latent bug).
- **`type:'control' effect:'overload'`** is never produced by any real parse — a misclassification
  (Overload is a buff, not crowd-control) and the lone synthetic entry keeping the "Not simulated"
  badge alive.

**Goal:** model the full Overload lifecycle in the combat simulator so Overload is honestly
*simulated*, and drop `overload` from the last "not-simulated" framing. Single PR, all five ships.

### Scope summary (the 5 Marauder-family ships)

| Ship | Overload gained | Lose-on-kill | Marauder Rage | New work |
|---|---|---|---|---|
| Mangler | every turn (≤10) | yes | on kill (Rage 1→2) | kill-trigger detection + remove-self-buff |
| Ravager | every turn (≤10) | yes | on kill (Rage 3) | same |
| Butcher | every turn (≤10) | yes | on applying a debuff | on-debuff-inflicted detection + remove-self-buff |
| Asphyxiator | start-of-round if enemy has 3+ debuffs (≤10) | yes | with the SoR grant | verify (SoR + enemy-debuff-count already parse) + remove-self-buff |
| Ruiner | when an enemy self-repairs (≤5, 1×/rd/enemy) | yes | none | on-enemy-repaired detection + oncePerRoundPerSource + remove-self-buff |

**Out of scope** (not Overload mechanics; separate already-modeled/other effects):
Ravager-refit def-bypass + on-resist Hacking Module Overdrive; Asphyxiator-refit crit
debuff-duration extension.

## 2. Architecture

Five pieces. The only genuinely-new combat mechanic is **lose-on-kill (remove-self-buff)**;
everything else reuses existing reactive machinery.

### 2.1 Lose-on-kill primitive — `type: 'remove-self-buff'` (new ability)

Every ability today *grants*; none *removes a self-buff*. Add a general ability that mirrors the
buff-grant ability:

- **AbilityConfig variant** (`src/types/abilities.ts`):
  ```ts
  | {
        type: 'remove-self-buff';
        /** The named buff family to clear from the owner's own stores. */
        buffName: string;
        /** 'all' clears the whole family (only mode needed today — "loses Overload"). */
        scope: 'all';
    }
  ```
  Ability: `target: 'self'`, `trigger: 'on-enemy-destroyed'` (for Overload).

- **statusEngine method** `removeSelfBuffByName(actorId, buffName)`
  (`src/utils/combat/statusEngine.ts`): clears the named family from **all** self-side stores —
  the **accumulating self store** (where "gains Overload every turn" actually lives), the
  **persistent-stacking self map**, and the **timed self store** — so it is robust to wherever
  Overload was applied. Mirrors the existing targeted `removeTimedEnemyStatus(targetId, buffName)`
  (statusEngine.ts:940) but self-side and store-spanning. Lazy-empty / unknown id / unknown name →
  safe no-op.

  > Implementation note: `removeNewestFirst` (cleanse/purge) deliberately **never visits** the
  > accumulating/persistent maps, so it cannot be reused here — Approach C from brainstorming is
  > ruled out. This is why a dedicated self-side, name-targeted removal is required.

- **Reactive executor branch** (`src/utils/combat/triggers.ts`): add a `cfg.type === 'remove-self-buff'`
  case alongside the `buff` / `charge` / `cleanse` branches → calls `removeSelfBuffByName(ownerId, buffName)`.

- **Parser** (`src/utils/skillTextParser.ts`): the current "skip tags preceded by `loses`" rule
  becomes an **emission** of a remove-self-buff descriptor instead of `[]`. `buildShipAbilities`
  turns that descriptor into the ability, resolving the trigger via `detectReactiveTrigger` (the
  "Overload" clause around "upon killing an enemy" → `on-enemy-destroyed`).

### 2.2 Trigger-detection additions (`detectReactiveTrigger`)

`detectReactiveTrigger` (skillTextParser.ts) currently covers start-of-round / on-crit /
on-ally-crit / on-bomb-detonated / on-cheat-death-activated / on-enemy-cleansed. Add three clause
patterns that currently fall through to `on-cast`:

- `on-enemy-destroyed` ← "upon killing an enemy" / "upon killing". Serves **both** the
  remove-self-buff (Overload) **and** the Marauder Rage grant (Mangler/Ravager), whose clauses sit
  together ("loses Overload **and gains** Marauder Rage").
- `on-debuff-inflicted` ← "upon/after applying/inflicting a debuff" (Butcher's Rage).
- `on-enemy-repaired` ← "when an enemy performs a repair on themselves" (Ruiner's Overload).

### 2.3 Marauder Rage grants (reuse existing reactive buff executor)

`Marauder Rage I/II/III` already exist in `buffs.ts` with stats (`+10/20/30% Attack`,
`+10/20% Crit Power`). The reactive buff-grant executor (`triggers.ts` `cfg.type === 'buff'`) already
grants timed self-buffs on a trigger — so this is **just** the parsed self-buff + the correct
trigger (from §2.2). No new grant machinery. Marauder Rage is a normal timed buff ("for N turns").

### 2.4 Ruiner "once per round per enemy" — `oncePerRoundPerSource`

Ruiner gains 1 Overload "when an enemy performs a repair on themselves, this effect is limited to
once per round per enemy." Model the literal rule (not a stack-cap approximation):

- **New ability flag** `oncePerRoundPerSource: boolean` (distinct from the existing `oncePerRound`).
- `passesOncePerRoundGate` (triggers.ts:1232) keys on
  `${ownerId}:${abilityId}:${eventSourceId}` when `oncePerRoundPerSource` is set (vs.
  `${ownerId}:${abilityId}` for plain `oncePerRound`), reusing the same per-round-reset
  `oncePerRoundConsumed` set (reset each round by the engine). Each distinct repairing enemy
  contributes once per round; all entries reset next round.
- The repairer id is already on the event context (`eventCtx`, on-enemy-repaired captures
  `heal-performed.casterId` — triggers.ts:133).
- **Parser:** "limited to once per round per enemy" → `oncePerRoundPerSource`; plain "once per
  round" → existing `oncePerRound`.
- Reusable for any future "once per round per enemy/ally" text.

### 2.5 Asphyxiator conditional grant (verify, no new code expected)

"At the start of the round, if an enemy has 3 or more debuffs, this Unit gains Overload … and
Marauder Rage 2 for 3 turns." `start-of-round` is already detected by `detectReactiveTrigger`, and
"3 or more debuffs" already parses to an enemy-debuff-count condition (skillTextParser.ts:545). This
is an **end-to-end verification** item (the remove-self-buff still applies via §2.1); add a fixture,
expect no new parsing code.

### 2.6 simCoverage / ControlEffect cleanup

`type:'control' effect:'overload'` is never produced by any real parse. Remove `'overload'`:

- from `ControlEffect` (`src/types/abilities.ts`),
- from `CONTROL_EFFECT_LABEL` (`src/utils/combat/debuffImmunity.ts`),
- from the synthetic tests (`AbilityCard.test.tsx`, `simCoverage.test.ts`).

`SIMULATED_CONTROL_EFFECTS` then equals the full `ControlEffect` enum, so `isAbilityNotSimulated`
returns false for every control effect and `NOT_SIMULATED_TYPES` stays empty — honestly closing the
last "not-simulated" effect. The badge machinery stays (documentation value); no effect currently
triggers it.

## 3. Team symmetry (locked rule)

Per [[feedback_engine_team_symmetry]], a ship must act identically on either side. Every new path
rides existing team-agnostic triggers (`on-enemy-destroyed` → `ship-destroyed` where
`isOpposing(actorId)`; `on-debuff-inflicted`; `on-enemy-repaired`). An **enemy-side** Marauder that
kills a player ship must lose its Overload and gain Marauder Rage exactly as a player-side Marauder
does — covered by a symmetric engine fixture.

## 4. Golden impact (deliberate — verify, never auto-refresh)

The **DPS calculator dummy enemy is indestructible**, so lose-on-kill never fires there. Consequences:

- **Mangler / Ravager:** Marauder Rage was wrongly granted on-cast; it now requires a kill (never
  happens vs. the dummy) → **Rage disappears** from their DPS-calc output. Goldens move.
- **Butcher:** Marauder Rage moves on-cast → `on-debuff-inflicted`. Goldens move.
- **Ruiner:** Overload moves on-cast → `on-enemy-repaired` (+ per-enemy gate). Goldens move.
- **Overload's every-turn accumulation** (climb to cap) is **unchanged** in the DPS calc
  (lose-on-kill never fires there).

Every moved DPS golden is a deliberate correctness fix and must be inspected, **not** blanket
`vitest -u`-refreshed. Combat-simulator behavior is **new** (lose-on-kill, Rage on kill) and covered
by new fixtures.

## 5. Testing (TDD)

- **Parser** (`skillTextParser.test.ts`): "loses Overload" emits a remove-self-buff descriptor (was
  `[]`); the three new trigger detections in `detectReactiveTrigger`; "once per round per enemy" →
  `oncePerRoundPerSource`.
- **statusEngine** (`statusEngine.test.ts`): `removeSelfBuffByName` clears Overload from the
  accumulating self store, the persistent-stacking self map, and the timed self store; safe no-ops.
- **Reactive executor** (`triggers.test.ts`): remove-self-buff branch calls the removal;
  `oncePerRoundPerSource` gate allows one fire per distinct source per round and resets next round.
- **Engine** (combat fixtures): on kill → Overload cleared + Marauder Rage granted (Mangler/Ravager);
  Butcher Rage on debuff-inflict; Ruiner Overload on enemy self-repair with per-enemy cap;
  Asphyxiator SoR conditional; **team-symmetric** enemy-side Marauder fixture.
- **simCoverage** (`simCoverage.test.ts`, `AbilityCard.test.tsx`): overload no longer in
  `ControlEffect`; no ability is flagged not-simulated for it.
- `audit:skills` clean; `tsc` exhaustiveness (the `ControlEffect` removal + new AbilityConfig
  variant are caught by the discriminated-union switches); lint max-warnings 0.

## 6. Risks / open notes

- **Which store holds Overload:** confirmed it lands in the accumulating self store for the
  every-turn ships; `removeSelfBuffByName` spans all self stores so the exact door doesn't matter,
  but tests must assert removal from the accumulating store specifically.
- **`oncePerRoundConsumed` reset:** confirmed reset each round by the engine (triggers.ts:822-823) —
  the per-source key relies on this. A fixture must cross a round boundary to prove the reset.
- **DocumentationPage / changelog:** add a user-facing changelog entry (combat sim now models the
  Overload kill-reset + Marauder Rage payoff) and update in-app docs if Overload/Marauder behavior
  is described there.
