# Combat Engine Phase 4b — Death & Revive Modeling — Design

**Date:** 2026-06-09
**Status:** Approved (user-validated section by section)
**Baseline:** PR #92 (Phase 4a — enemy as a full offensive actor) MERGED (merge `0835cd32`).
**Branch target:** `feat/combat-engine-phase4b-death-revive`
**Handoff:** `docs/superpowers/handoffs/2026-06-08-phase4b-handoff.md` (Phase 4 decomposition
map row 4b).
**Coverage rule source:** `docs/skill-model-coverage.md` §5 (Phase 4a block) + §6 (items 9, 11, 12).

## Goal

Model **death and revive** on the shared `runPlayerTurn` pipeline. Concretely:

1. Promote `ship-destroyed` to a **general, all-actor** event and wire three death triggers
   (`on-destroyed`, `on-ally-destroyed`, `on-enemy-destroyed`) into the live reactive machinery.
2. Model **Cheat Death** as a recognized named buff that intercepts a lethal hit (survive at
   **1 HP**, consume, wipe removable statuses), with a `cheat-death-activated` follow-on trigger.
3. Introduce an explicit **removability** concept (unremovable flag + name-set + StatusEngine
   clear-removable method) — used by the Cheat Death wipe now, reused by 4e cleanse/purge later.
4. Build a **reactive extra-action bridge** so death-triggered extra actions reach the engine's
   per-round turn queue, closing Sokol / Liberator / Harvester.

The work is engine + parser, with the DPS calc and Healing Calculator as proving grounds. It is
additive to public result types, zero-RNG deterministic, and leaves the **22 DPS + healing
golden snapshots byte-identical** (any churn gets a documented KNOWN-DIFF review; never
`vitest -u`).

## Game model the user is encoding (canonical for this increment)

- **Cheat Death** is a *granted named buff*. When the carrier would be destroyed, it instead
  **survives at exactly 1 HP** (base effect, before any follow-on repair). It is **one-shot,
  until-triggered, consumed on use, once per combat**; a later re-grant refreshes it (each
  instance fires once).
- **On Cheat Death activation, all of the unit's OTHER buffs and debuffs are removed, unless
  they are unremovable.** (New rule this increment.)
- Follow-on reactions fire *when Cheat Death activates* (a distinct moment from destruction):
  Yazid — *"once per battle, when Cheat Death activates, repairs 60% of Max HP and gains
  Barrier"*; Tycho — Barrier on activation. **Barrier's shield effect is NOT simulated** this
  increment — only the named buff-grant fires (consistent with control/named buffs being
  emitted-not-simulated today).
- **on-destroyed** ally-heal: Salvation — *"when this Unit is destroyed it repairs 80% of its
  max HP to all allies."* The unit actually dies; the heal goes to surviving allies.
- **on-ally-destroyed:** Harvester gains an extra end-of-round action (R4 also Speed Up) when
  an allied unit is destroyed.
- **on-enemy-destroyed** ("when an enemy dies" / "upon a kill"): Sokol gains 1 extra action
  upon a kill (once per round); Liberator grants all allies 1 charge when an enemy dies (R4
  also: once per round this unit gains 1 extra action).

### What stays deferred (NOT this increment)

- **Targeting / multi-enemy / death-fallback re-targeting** → 4d. Consequence: in healing mode
  the enemy single-target focus-fires the tank and **team allies never take damage**, so
  `on-ally-destroyed` (Harvester) is **wired-but-dormant** until 4d. The enemy dies only in
  DPS mode (`on-enemy-destroyed` fires there).
- **Cleanse/purge consumption, control effects, damage-reduction/reflect** → 4e. The
  removability flag introduced here is the only 4e-adjacent piece pulled forward.
- **Barrier shield simulation, Everliving Regeneration HoT simulation** — named buff-grants
  fire; their numeric effects stay unmodeled (existing convention).
- **Tithonus purge-count extra action** (§6 item 9c) → 4e (needs purge consumption).

## User decisions (2026-06-09, do not re-litigate)

1. **Scope = full infra + value pieces.** Build the general all-actor death events + all three
   death triggers (incl. the dormant Harvester path), AND implement Cheat Death + Salvation
   on-destroyed heal + Sokol/Liberator end-to-end.
2. **Cheat Death survives at 1 HP**, one-shot, consumed on use, once per combat, re-grantable.
3. **Cheat Death modeled as a recognized named buff** (`CHEAT_DEATH_BUFFS` name-set), NOT a new
   `revive` ability type. The granting ability parses as a normal no-payload `buff`.
4. **Model the cheat-death-activated follow-ons** (Yazid repair + Barrier, Tycho Barrier) via a
   new `cheat-death-activated` event + `on-cheat-death-activated` LIVE_TRIGGER.
5. **Build the full reactive extra-action path now** — incl. the third trigger
   `on-enemy-destroyed` and the reactive→turn-queue bridge.
6. **Add an explicit removability flag now** — `unremovable` status flag + `UNREMOVABLE_STATUSES`
   name-set, sourced from game data. The Cheat Death wipe clears removable statuses, preserves
   unremovable ones.

## Architecture

### Component 1 — General death events + the three triggers

**Event generalization (`engine.ts`).** Today `ship-destroyed{actorId, round}` is emitted only
for the heal target (`applyIncomingToTarget`, ~engine.ts:1509) and the enemy
(`destroyedEmitted` guard, ~engine.ts:2342). Generalize: **any actor whose HP first reaches 0
emits `ship-destroyed` exactly once**, carrying its own `actorId`. A per-actor `destroyedRound`
moves onto the `PlayerActorRuntime` struct (mirrors the heal-target field). Dead-is-dead
semantics (skip turns, receive no heals, HP floored at 0) extend from the heal target to all
actors. The existing healing-mode `destroyedRound` reporting path is preserved.

**Trigger union + LIVE_TRIGGERS (`src/types/abilities.ts`).** `on-destroyed` and
`on-ally-destroyed` already exist in `AbilityTrigger` (annotation-only). Add `on-enemy-destroyed`.
Add all three to `LIVE_TRIGGERS`.

**Listeners (`triggers.ts`, `registerReactiveListeners`).** Add three `case`s, each listening on
`ship-destroyed`, keyed off the event `actorId` + the existing `isEnemySide` predicate:
- `on-destroyed` → fires when `e.actorId === ownerId` (the owner itself died). One enqueue.
- `on-ally-destroyed` → fires when `e.actorId !== ownerId && !isEnemySide(e.actorId)` (another
  same-side player actor died).
- `on-enemy-destroyed` → fires when `isEnemySide(e.actorId)` (an enemy-side actor died).

Listeners stay PURE (enqueue-only). Registration order unchanged (focus owner first, then team
in input order) → deterministic enqueue order.

**Death-vs-reaction ordering** at the lethal moment, in `applyIncomingToTarget` and the
generalized actor-death path:
1. Damage would bring HP ≤ 0.
2. **Cheat Death intercept** (Component 2): if carried & not spent → survive, stop here.
3. Else → set HP = 0, record `destroyedRound`, emit `ship-destroyed` → listeners drain
   `on-destroyed` / `on-ally-destroyed` / `on-enemy-destroyed`.

### Component 2 — Cheat Death intercept

**Recognition (`CHEAT_DEATH_BUFFS`).** A new name-set (new constants module, e.g.
`src/utils/combat/cheatDeathBuffs.ts` or alongside the persistent-stacking model) listing the
buff names that grant a death-intercept (initially `Cheat Death`; extensible).

**Parser (`skillTextParser.ts` / `buildShipAbilities.ts`).** "grants Cheat Death [to all
allies]" parses as a `buff` ability: `buffName: 'Cheat Death'`, **no stat payload**, target
self / ally / all-allies. Covers:
- Active grant (Hayyan: "grants Cheat Death to all allies").
- Conditional grant (Hermes charged: "if the target has less than 40% HP, it grants Cheat Death")
  — emitted with the existing conditional machinery.
- Start-of-combat passive grant (Yazid/Tycho) — parsed as an assume-active `on-cast` passive buff
  (consistent with existing passive handling), so the carrier holds Cheat Death from round 1.
  The buff is persistent / until-triggered (no turn duration → modeled with a non-decrementing
  duration so it does not expire on its own).

**Intercept logic (`engine.ts`).** In `applyIncomingToTarget` (tank path) and the generalized
actor-death path, *before* flooring HP / recording destroyed: if the dying actor's active buff
names intersect `CHEAT_DEATH_BUFFS` →
1. set HP = **1**,
2. **consume** the Cheat Death buff (remove it from the actor's StatusEngine store),
3. **wipe removable buffs/debuffs** on the actor (Component 3 clear-removable),
4. emit `cheat-death-activated{actorId, round}`,
5. do **not** record destroyed / emit `ship-destroyed`.

Re-grant (a later `buff` application of a `CHEAT_DEATH_BUFFS` name) restores the intercept.
Consumption is the only per-combat limit on the intercept itself.

### Component 3 — Removability concept

**Flag + name-set.** Add an `unremovable` notion to StatusEngine entries (computed at
application time from an `UNREMOVABLE_STATUSES` name-set + the existing `'permanent'` /
persistent-stack classification). `UNREMOVABLE_STATUSES` is a new name-set seeded from game
data; the persistent-stacking debuffs (Defense Shred/Blast/Overload/Titanite) are unremovable by
construction. The set is the single source of truth and is extensible.

**StatusEngine clear-removable method.** A new method that, for a given actor/owner id, removes
all **removable** buffs and debuffs (timed + recurring) while preserving unremovable ones. Used
by the Cheat Death wipe now; designed to be reused by 4e cleanse/purge (which will remove
*selected* removable statuses rather than all).

### Component 4 — Cheat-Death-activated follow-ons

**Event + trigger.** Add `cheat-death-activated{actorId, round}` to `CombatEvent`. Add
`on-cheat-death-activated` to `AbilityTrigger` + `LIVE_TRIGGERS`. Listener (`triggers.ts`):
fires when `e.actorId === ownerId` (own Cheat Death fired).

**Parser.** "once per battle, when Cheat Death activates, repairs X% … and gains Barrier" /
"… gains Barrier" parse as reactive abilities on `on-cheat-death-activated`:
- Yazid repair → `heal` ability (self, % of Max HP), with a **once-per-combat** cap.
- Barrier grant → `buff` ability, `buffName: 'Barrier'`, no simulated effect.

**Executor.** `heal` and `buff` are already `ReactiveAbilityType`s — they ride the existing
reactive executor. The wipe (Component 2 step 3) runs **before** these follow-ons fire, so
Yazid's Barrier survives the wipe (it is a fresh post-activation grant).

**Once-per-combat cap.** A per-actor flag for the activated-repair reactive (distinct from the
Cheat Death buff's own consume-on-use). After it fires once, subsequent `cheat-death-activated`
events for that owner do not re-fire the capped reactive.

### Component 5 — Reactive extra-action bridge

**Problem.** `extra-action` is not a `ReactiveAbilityType`, and extra actions are **engine-owned**
(inserted into the per-round turn queue, `engine.ts:1539), not drain-time intents. Death-triggered
extra actions must reach that queue.

**Bridge.** Make `extra-action` routable from a death listener: the listener enqueues an
extra-action intent; the executor, instead of mutating combat state, **registers a pending
extra-action grant with the engine's per-round extra-action bookkeeping** (respecting
`oncePerRound`). The engine's existing pathological-loop backstop (`engine.ts:50`,
`engine.ts:1561`) continues to bound insertions.

**Parser (`skillTextParser.ts`).** Remove `upon a kill` and `allied unit is destroyed` (and the
"when an enemy dies" / "killing an enemy" phrasings) from `EXTRA_ACTION_DISQUALIFY_RE`. Parse
them as `extra-action` abilities with the right trigger:
- Sokol "grants one extra end of round action upon a kill, once per round" → `on-enemy-destroyed`,
  `oncePerRound: true`.
- Liberator R4 "once per round, this unit gains 1 extra action" (within the "when an enemy dies"
  clause) → `on-enemy-destroyed`, `oncePerRound: true`. Liberator's "all allies add 1 charge"
  → `charge` ability (all-allies) on `on-enemy-destroyed` (rides the existing charge reactive
  executor — no bridge needed for the charge part).
- Harvester "when an allied Unit is destroyed … gains 1 extra end of round action" →
  `on-ally-destroyed`, `oncePerRound` per text. **Wired-but-dormant** in healing mode (allies
  don't take damage until 4d); covered by a synthetic unit-test fixture.

**Where it fires.** `on-enemy-destroyed` fires in DPS mode the round the enemy dummy floors to 0
(one `ship-destroyed` event), so Sokol/Liberator gain one extra action that round (once-per-round
naturally bounds it).

## Data flow

```
enemy attack / damage tick
  └─ applyIncomingToTarget(dmg)            (engine.ts:1498)
       ├─ HP would reach 0?
       │    ├─ carrier ∈ CHEAT_DEATH_BUFFS & not spent?
       │    │    ├─ HP = 1
       │    │    ├─ consume Cheat Death buff
       │    │    ├─ StatusEngine.clearRemovable(actorId)   (Component 3)
       │    │    ├─ emit cheat-death-activated             → on-cheat-death-activated
       │    │    │                                            (Yazid heal+Barrier, Tycho Barrier)
       │    │    └─ STOP (no death)
       │    └─ else: HP = 0, record destroyedRound, emit ship-destroyed
       │              → on-destroyed (Salvation heal allies)
       │              → on-ally-destroyed (Harvester extra-action ⇒ bridge)   [dormant]
       │              → on-enemy-destroyed (Sokol/Liberator extra-action ⇒ bridge;
       │                                    Liberator charge-to-allies ⇒ charge executor)
```

## Testing

Vitest unit tests (new files under `src/utils/combat/__tests__/` + parser tests):

- **Cheat Death intercept:** lethal hit → survive at 1 HP; buff consumed (second lethal hit
  kills); re-grant restores the intercept; absent/spent → normal death + `ship-destroyed`.
- **Cheat Death wipe:** removable buffs/debuffs (timed DoTs, timed self-buffs) cleared on
  activation; unremovable (persistent-stack / `UNREMOVABLE_STATUSES`) preserved.
- **cheat-death-activated follow-ons:** Yazid 60% repair fires once-per-combat (not again on a
  second activation); Barrier buff-name granted post-wipe.
- **Three death triggers:** `on-destroyed` (Salvation heals allies), `on-ally-destroyed`
  (Harvester — synthetic fixture seeding a team actor to lethal damage), `on-enemy-destroyed`
  (Liberator charge-to-allies + Sokol/Liberator extra-action) in DPS mode.
- **Reactive extra-action bridge:** once-per-round cap; loop backstop respected; turn inserted
  into the queue (not executed drain-time).
- **Removability:** StatusEngine clear-removable preserves unremovable; flag computed from the
  name-set + persistent-stack classification.
- **Parser:** Cheat Death grants (active / all-allies / Hermes conditional / Yazid-Tycho
  start-of-combat); Salvation on-destroyed heal; Yazid activated repair+Barrier;
  Sokol/Liberator/Harvester extra-action triggers; the `EXTRA_ACTION_DISQUALIFY_RE` phrasings
  now parse.

**Goldens:** 22 DPS + healing snapshots must stay byte-identical. The new triggers consume events
that previously had no consumer (enemy `ship-destroyed` already emitted in DPS, but Liberator/Sokol
weren't parsed). Any churn → delete-and-regenerate the specific golden under a documented
KNOWN-DIFF review; never `vitest -u`.

## Hard constraints (unchanged)

- Zero-RNG determinism; listeners PURE (enqueue only).
- Engine core NEVER compares the literal `'attacker'`.
- No RegExp lookbehind in `src/` (iOS Safari 15).
- Pre-commit runs the full suite; no `--no-verify`. ESLint zero warnings.
- `docs/` gitignored — `git add -f` for spec/plan/handoff/coverage.
- Changelog: one evolving entry per calculator; no per-task appends.
- UI (editor Trigger select note): existing `src/components/ui/` primitives; the three new
  triggers appear in the editor's trigger options with the appropriate live/annotation note.

## Files touched (anticipated)

- `src/types/abilities.ts` — `on-enemy-destroyed`, `on-cheat-death-activated` added to
  `AbilityTrigger` + `LIVE_TRIGGERS` (`on-destroyed`/`on-ally-destroyed` promoted).
- `src/utils/combat/events.ts` — generalize `ship-destroyed`; add `cheat-death-activated`.
- `src/utils/combat/engine.ts` — general all-actor death emission; Cheat Death intercept;
  per-round extra-action bridge hook.
- `src/utils/combat/state.ts` — per-actor `destroyedRound` on `PlayerActorRuntime`.
- `src/utils/combat/triggers.ts` — three death-trigger listeners + `on-cheat-death-activated`;
  `extra-action` reactive routing into the engine queue.
- `src/utils/combat/statusEngine.ts` — `unremovable` flag; clear-removable method.
- `src/utils/combat/cheatDeathBuffs.ts` (new) — `CHEAT_DEATH_BUFFS`, `UNREMOVABLE_STATUSES`
  (or alongside the persistent-stacking model).
- `src/utils/skillTextParser.ts` — Cheat Death grant; Salvation on-destroyed heal; Yazid
  activated follow-on; `EXTRA_ACTION_DISQUALIFY_RE` + extra-action trigger parsing.
- `src/utils/abilities/buildShipAbilities.ts` — emit the above with correct triggers.
- Editor trigger-select note (wherever the Trigger options + live/annotation note live).
- `docs/skill-model-coverage.md` §5/§6 — close items 9a/9b seams; note dormant Harvester,
  unmodeled Barrier, removability concept.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` healing/combat entry.

## Phase sequence after 4b

Unchanged from the handoff: 4c (enemy-action reactions + generic damage triggers, incl.
Makoli/Guardian below-X%-HP reactive heals) → 4d (targeting + multi-enemy + death-fallback
re-targeting; activates dormant Harvester) → 4e (consumption & mitigation; full cleanse/purge
reuses the removability flag) → 4f (defense-calc adoption) → 5 (simulator page).
