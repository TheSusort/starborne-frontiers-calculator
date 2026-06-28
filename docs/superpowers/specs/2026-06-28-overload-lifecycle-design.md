# Overload Lifecycle — Design

**Date:** 2026-06-28
**Epic:** Combat realism ([[project_combat_realism_epic]]) — the deferred follow-up to the control-classification unification (PR #174).
**Status:** Approved (brainstorm), ready for implementation plan.

> **Source of truth = `docs/ship-skills.csv`.** The skill parser (`skillTextParser.ts` /
> `buildShipAbilities`) and the `audit:skills` coverage gate run against the CSV, NOT
> `src/constants/ships.ts` (whose skill text is untagged and worded differently — do not use it to
> derive parser patterns). All ship phrasings below are quoted from the CSV. `audit:skills`
> processes **every** passive variant (p1/p2/p3) as a separate row, so the parser must handle all
> wordings. `resolveBuffClause` strips `<unit-skill>`/`<unit-aid>` tags and converts `<br/>` to a
> sentence break before trigger matching, so `detectReactiveTrigger` sees plain text; the
> buff/removal parsers see the tagged text.

## 1. Problem & Goal

`Overload` is a stackable self-buff (`+10% Outgoing Direct Damage, -10% Defense`, cap 10) carried by
five Marauder-family ships. Its defining mechanic — **you keep stacking it until you kill an enemy,
at which point you lose all of it** — is not modeled. Today:

- **"gains 1 stack of Overload every turn"** already works: parsed as an accumulating self-buff
  (`stackTrigger:'per-round'`), climbing to the cap. ✅
- **Lose-on-kill** ("loses/removes Overload on kill / upon killing an enemy", or passive "Overload
  is lost") is **not** modeled. The buff persists forever.
- **Marauder Rage** grants (on kill / on inflicting a debuff / at start-of-round) — the named buffs
  exist in `buffs.ts` with stats, but their reactive triggers are not detected, so they fall
  through to `on-cast`.
- **`type:'control' effect:'overload'`** is never produced by any real parse — a misclassification
  (Overload is a buff, not crowd-control) keeping the synthetic "Not simulated" badge alive.

**Goal:** model the full Overload lifecycle in the combat simulator so Overload is honestly
*simulated*, and drop `overload` from the last "not-simulated" framing. Single PR, all five ships.

### Scope — the 5 Marauder-family ships (CSV phrasings)

| Ship | Overload gain | Lose-on-kill phrasing | Marauder Rage |
|---|---|---|---|
| **Mangler** | every turn | "loses Overload **on kill**" | "gains Marauder Rage I/II … **upon killing an opponent**" |
| **Ravager** | every turn | "**upon killing an enemy**, loses Overload" | coupled with the kill clause (Rage III) |
| **Butcher** | every turn | R1 "**upon killing an enemy**"; R2 "**On kill, Overload is lost**" (passive voice) | R2 "**On inflicting a debuff**, gains Marauder Rage II" |
| **Asphyxiator** | start-of-round, "if there are any enemies with 3 or more debuffs" | "**Upon killing an enemy**, loses Overload" | with the SoR grant (Rage II) |
| **Ruiner** | "gains 1 stack of Overload **when an enemy performs a repair**" | "upon killing an enemy, this Unit **removes** Overload" | none |

**Distinct phrasings the parser must cover:**
- **Removal verbs:** `loses` / `removes` (active) AND `<buff> is lost` (passive).
- **Kill triggers:** `on kill` / `killing an enemy` / `killing an opponent` / `when an enemy dies`.
- **Debuff-inflict trigger:** `on inflicting a debuff` / `upon inflicting a debuff` (also accept
  `after`/`when` + `applying`).
- **Repair trigger:** `when an enemy performs a repair` (already matched by `ENEMY_REPAIRS_RE`).

**Explicitly NOT in scope:**
- **No Ruiner cap-5 / no `oncePerRoundPerSource`.** The CSV shows Ruiner's Overload gain has no
  per-Overload limit; "once per round per enemy" belongs to Ruiner's separate **Bomb II inflict**
  (a debuff ability), which is outside the Overload lifecycle. Ruiner's Overload simply uses the
  global cap (10) and is lost on kill. (Earlier draft modeled a cap-5 from the stale `ships.ts`
  text; dropped.)
- Refit-only extras unrelated to Overload: Ravager-R2 def-bypass + on-resist Hacking Module
  Overdrive; Asphyxiator-R2 crit debuff-duration extension. (Already-modeled / other effects.)

## 2. Architecture

The only genuinely-new combat mechanic is **lose-on-kill (remove-self-buff)**. Everything else is
parser/trigger wiring over existing machinery.

### 2.1 Lose-on-kill primitive — `type: 'remove-self-buff'` (new ability)

No ability removes a self-buff today (only grants). Add a general ability mirroring the buff-grant:

- **`AbilityType`** (abilities.ts:6-29): add `'remove-self-buff'` (separate union from
  `AbilityConfig`).
- **AbilityConfig variant:**
  ```ts
  | { type: 'remove-self-buff'; buffName: string; scope: 'all' }
  ```
  Ability: `target:'self'`, `trigger:` the resolved kill trigger.
- **statusEngine method** `removeSelfBuffByName(actorId, buffName)`: clears the named family from
  **all** self stores — `accumSelfMaps` (where "gains every turn" Overload lives), `persistentSelfMaps`,
  and the timed `selfMaps`. Mirrors `removeTimedEnemyStatus` (statusEngine.ts:940) but self-side and
  store-spanning. (`removeNewestFirst` can't be reused: it's count-based/not-name-targeted and skips
  the persistent maps — statusEngine.ts:959-960.) Lazy-empty / unknown id / unknown name → no-op.
- **Reactive executor branch** (`executeIntent`, triggers.ts): add `cfg.type === 'remove-self-buff'`
  → `ctx.statusEngine.removeSelfBuffByName(intent.ownerId, cfg.buffName)`. No event emitted (no
  consumer). Add `'remove-self-buff'` to `ReactiveAbilityType` (triggers.ts:53-64) and
  `REACTIVE_ABILITY_TYPES` (67-79) so it partitions into the reactive path.
- **Parser** `parseSelfBuffRemovals(text)`: scan the tagged text for self-buff loss in three forms,
  each scoped to a self subject + a known buff name (`resolveBuffName`):
  - `(loses|removes) <unit-skill>BUFF</unit-skill>`
  - `<unit-skill>BUFF</unit-skill> is lost`

  Resolve the trigger via `detectReactiveTrigger(text, BUFF)` (→ the kill trigger). Do **not** touch
  `parseSkillEffects` (its `SKIP_VERBS` 'loses' behavior stays so the buff path is byte-identical).
  Scope to self-buff names so enemy-side "removes a buff" (purge) never matches.

### 2.2 Trigger-detection additions (`detectReactiveTrigger`)

`detectReactiveTrigger` (skillTextParser.ts:852-875) operates on the tag-stripped clause. Add:

- **Kill → `on-enemy-destroyed`.** A **new** `KILL_TRIGGER_RE`, e.g.
  `/\bon\s+(?:a\s+)?kill\b|killing\s+an\s+(?:enemy|opponent)|when\s+an\s+enemy\s+dies/i`.
  **Define a NEW const — do NOT broaden the existing `ENEMY_DEATH_PHRASING_RE`** (skillTextParser.ts:1961),
  which `parseExtraAction` reuses; broadening it would change extra-action detection corpus-wide.
- **Repair → `on-enemy-repaired`.** Reuse `ENEMY_REPAIRS_RE` (skillTextParser.ts:441).
- **Debuff-inflict → `on-debuff-inflicted`.** A new `APPLYING_DEBUFF_RE`, e.g.
  `/\b(?:upon|on|after|when)\s+(?:inflicting|applying)\s+(?:a\s+)?debuff/i`
  (`ENEMY_DEBUFFED_RE` at skillTextParser.ts:1003 matches passive "enemy is debuffed", not this).

The buff-grant path resolves its trigger via `detectReactiveTrigger(rowText, buff.buffName)`
(buildShipAbilities.ts:1602), so Marauder Rage grants auto-route to the right trigger once these
patterns exist — no new grant code.

### 2.3 Marauder Rage grants (reuse existing reactive buff executor)

`Marauder Rage I/II/III` exist in `buffs.ts` with stats (`+10/20/30% Attack`, `+10/20% Crit Power`).
The reactive buff-grant executor (`cfg.type === 'buff'`, triggers.ts:1340) already grants timed
self-buffs on a trigger. So Marauder Rage is just the parsed self-buff + the correct trigger from
§2.2.

### 2.4 Asphyxiator conditional grant (verify, no new code expected)

"At the start of the round, if there are any enemies with 3 or more debuffs, this Unit gains 1 stack
of Overload and gains Marauder Rage II for 3 turns." `start-of-round` is already detected by
`detectReactiveTrigger`; "3 or more debuffs" parses to an enemy-debuff-count condition
(skillTextParser.ts:545). End-to-end verification item.

### 2.5 simCoverage / ControlEffect cleanup

`type:'control' effect:'overload'` is never produced by any real parse. Remove `'overload'` from
`ControlEffect` (abilities.ts), `CONTROL_EFFECT_LABEL` (debuffImmunity.ts), and the synthetic tests.
`SIMULATED_CONTROL_EFFECTS` then equals the full enum → `isAbilityNotSimulated` is always false and
`NOT_SIMULATED_TYPES` stays empty — honestly closing the last "not-simulated" effect.

## 3. Team symmetry (locked rule)

Per [[feedback_engine_team_symmetry]]: a ship acts identically on either side. Every new path rides
team-agnostic triggers (`on-enemy-destroyed` → `ship-destroyed` where `isOpposing`;
`on-debuff-inflicted`; `on-enemy-repaired`). An enemy-side Marauder that kills a player ship loses
Overload and gains Marauder Rage identically — proven by a symmetric fixture.

## 4. Golden impact (deliberate — verify, never auto-refresh)

The **DPS-calc dummy is indestructible** → lose-on-kill never fires there. Consequences:
- **Mangler / Ravager:** Marauder Rage was (wrongly) on-cast; it now requires a kill → **Rage
  disappears** from their DPS-calc output. Goldens move.
- **Butcher:** Rage moves on-cast → `on-debuff-inflicted`. Goldens move.
- **Overload's every-turn accumulation** is **unchanged** in the DPS calc (lose-on-kill never
  fires). If an Overload-accumulation golden moves, STOP — something is wrong.

Every moved golden is a deliberate correctness fix — inspect each; do **not** `vitest -u`.

## 5. Testing (TDD)

- **Parser** (`skillTextParser.test.ts`): `detectReactiveTrigger` returns the right trigger for
  "on kill", "killing an opponent", "killing an enemy", "when an enemy performs a repair", "on/upon
  inflicting a debuff"; `parseSelfBuffRemovals` emits remove descriptors for "loses Overload",
  "removes Overload", "Overload is lost", and `[]` for unknown buffs / no-loss text. **Use the real
  CSV strings** (tag-stripped where appropriate) as fixtures, not invented phrasings.
- **statusEngine** (`statusEngine.test.ts`): `removeSelfBuffByName` clears Overload from the accum,
  persistent, and timed self stores; safe no-ops.
- **Reactive executor** (`triggers.test.ts`): remove-self-buff branch calls the removal.
- **buildShipAbilities** (`buildShipAbilities.test.ts`): drive the **real CSV passive rows** for all
  5 ships; assert each produces a `remove-self-buff` Overload ability with the right trigger, and the
  Marauder Rage buff abilities with their triggers (on-enemy-destroyed / on-debuff-inflicted /
  start-of-round).
- **Engine** (combat fixtures): kill → Overload cleared + Marauder Rage granted (Mangler/Ravager);
  Butcher Rage on debuff-inflict; Ruiner Overload on enemy self-repair, lost on kill; Asphyxiator
  SoR conditional; **team-symmetric** enemy-side Marauder. Each removal test asserts against the
  ship's actual store.
- **simCoverage / AbilityCard**: overload no longer a `ControlEffect`; nothing flagged not-simulated
  for it.
- `audit:skills` clean (runs the CSV — the real coverage gate); `tsc` exhaustiveness; lint
  max-warnings 0.

## 6. Risks / open notes

- **Text source:** ALL parser patterns must be derived from and tested against the CSV. `ships.ts`
  text is untagged and differently worded — never use it for parser logic.
- **`KILL_TRIGGER_RE` corpus safety:** it's a NEW const used only in `detectReactiveTrigger` (the
  shared `ENEMY_DEATH_PHRASING_RE` stays untouched). Still run `audit:skills` + the full suite to
  confirm no other ship's buff grant newly routes to `on-enemy-destroyed` unexpectedly. "on kill"
  is common corpus-wide (~23 occurrences) — confirm each newly-detected case is a buff/remove grant
  that SHOULD be kill-triggered.
- **`removes` verb scoping:** `parseSelfBuffRemovals` must require a self subject + a known self-buff
  name so enemy-side purge ("removes a buff from the enemy") never matches.
- **Which store holds Overload:** "gains every turn" → accumulating store (verified); Asphyxiator
  (SoR) / Ruiner (reactive) may land in the persistent map. `removeSelfBuffByName` spans all three;
  per-ship tests assert the ship's actual store.
- **Marauder Rage in buffs.ts** uses roman numerals (I/II/III) matching the CSV — `resolveBuffName`
  handles arabic/roman normalization regardless.
- **Changelog / DocumentationPage:** add a user-facing changelog entry and refresh the now-false
  `persistentStackingBuffs.ts:15-16` comment ("per-kill removal is a Phase 4 concern").
