# D-PR16 — Block/Protection appliers (Firewall, Last Stand, Lockdown, Tenacity)

**Date:** 2026-06-23
**Status:** Design (pre-plan)
**Branch:** `feat/combat-d-pr16-block-protection-appliers` (off D-PR15 tip `ee439ad1` + cherry-picked Last Stand data fix `d47c9980`; retargets to main after #147 merges)
**Epic:** combat-realism, sub-project D (implants + gear-set abilities). Follows D-PR15 (Block/Protection control PRIMITIVES, PR #147).

## 1. Context & purpose

D-PR15 shipped the two control **primitives** these appliers consume, both currently inert (no ship skill or fixture grants them):

- **Block Debuff** — a holder that carries it AUTO-RESISTS every incoming debuff (modeled as a landing concern in `debuffImmunity.ts`; the resist fires the existing `debuff-resisted` event).
- **Buff Protection** — purge-immunity (a holder's buffs cannot be purged; guarded inside `statusEngine.purge()`, `buffProtectionBuffs.ts`).

`Barrier` (full damage immunity for its duration) was modeled earlier (`barrierBuffs.ts`).

This PR adds the four implant **appliers** that grant those primitives reactively. The user explicitly chose "primitives first" in D-PR15; this is the unblocked follow-up.

**Corpus (verified against `src/constants/implants.ts`):**

| Implant | Trigger text | Effect | Target | Dur | procChance by rarity |
|---|---|---|---|---|---|
| **Firewall** | "When debuffed" | gain **Block Debuff** | self | 1t | unc 8% / rare 10% / epic 12% / leg 15% (no common) |
| **Last Stand** | "When this unit becomes the last one standing" | gain **Barrier + Block Debuff** | self | 1t | unc 18% / rare 21% / epic 26% / leg 32% (no common) |
| **Lockdown** | "When resisting a debuff" | grant **Buff Protection** | all allies | 1t | com 5% / unc 7% / rare 9% / epic 12% / leg 16% |
| **Tenacity** | "Upon directly receiving damage exceeding 25% of max HP" | grant **Buff Protection** | all allies | 2t | rare 10% / epic 12% / leg 16% (no common/uncommon) |

(Last Stand's epic variant was a copy-paste error in the data — corrected by the maintainer to the uniform "last one standing → Barrier + Block Debuff" form before this PR; the cherry-picked fix is on-branch. All four Last Stand rarities are now uniform → single builder, no per-rarity branching.)

## 2. Design principle

The **effects** all ride existing machinery: the reactive-buff executor (`triggers.ts` `cfg.type === 'buff'` branch, line ~1115), `mkNamedBuffGrant` (`buildEquipmentAbilities.ts`), the `procChance` gate (`passesProcChanceGate`, D-PR8), and all-allies recipient routing (`ctx.playerIds`, D-PR7 Battlecry / D-PR14 precedent). Block Debuff, Buff Protection, and Barrier are all real engine buffs now.

So the PR's real work is **trigger seams** — three new ones plus one new filter. Each is scoped to the smallest faithful primitive.

## 3. Per-applier design

### 3.1 Firewall — `on-debuffed` (NEW trigger)

- **Seam:** new `AbilityTrigger` value `on-debuffed`, registered in `triggers.ts` `registerReactiveListeners` to listen on the existing `debuff-applied` bus event, **self-scoped**: enqueue for owner where `e.targetId === ownerId`. Mirrors the `on-attacked` self-scoping pattern (`targetId === ownerId`).
- **Scope decision:** `debuff-applied` is emitted once per discrete timed-debuff infliction (NOT recurring/aura re-applications, NOT DoTs — DoTs use the separate `dot-applied` event). So Firewall fires on **timed debuffs received**, including control-as-named-debuff (Stasis/Disable land as named debuffs). It does NOT fire on DoT application. This matches the colloquial "when debuffed" and is the cleanest faithful read; documented as a known scope boundary.
- **Effect:** self-grant `Block Debuff`, duration 1, procChance per rarity. `mkNamedBuffGrant('Block Debuff', 'self', 'on-debuffed', 1, { procChance })`.
- **No loop risk:** Block Debuff is a *buff* (not a debuff), so granting it does not re-fire `on-debuffed`.

### 3.2 Lockdown — `on-debuff-resisted` (NEW trigger)

- **Seam:** new `AbilityTrigger` value `on-debuff-resisted`, listens on the existing `debuff-resisted` bus event, **self-scoped**: enqueue for owner where `e.targetId === ownerId` (the resister). The `debuff-resisted` event carries `{ targetId, round, buffName }`; `targetId` is the resisting unit on either side (cast-side emission `playerTurn.ts:724`, reactive-side `triggers.ts:1256`, plus the D-PR15 Block-Debuff resist path) — so a player implant fires when the carrier resists an enemy debuff, side-agnostically.
- **Effect:** all-allies grant `Buff Protection`, duration 1, procChance per rarity. `mkNamedBuffGrant('Buff Protection', 'all-allies', 'on-debuff-resisted', 1, { procChance })`.
- **Emergent synergy (intended, tested):** a unit carrying Firewall-granted (or otherwise) Block Debuff auto-resists incoming debuffs → emits `debuff-resisted` → a same-side Lockdown carrier grants the team Buff Protection. Chains across D-PR15's primitive. This is a feature, not a coincidence; one integration test pins it.

### 3.3 Tenacity — `on-attacked` + NEW damage-fraction filter

- **Seam:** rides the existing `on-attacked` trigger (self-scoped `attacked` event). Adds a NEW filter: the hit's damage must exceed 25% of the victim's max HP.
- **Damage granularity (forced by the engine model):** the `attacked` event is emitted per-hit but carries **no damage amount** — direct damage is applied per-attack as an aggregate (engine.ts ~4476/4510). So the threshold is modeled on the **per-attack aggregate** damage, not per individual hit. This is the same per-hit-vs-aggregate limitation Bloodthirst (D-PR1) documented and accepted. The `attacked` event already excludes DoT ticks and bomb detonations (only direct weapon hits emit it) — which matches "**directly** receiving damage".
- **Plumbing:** add an optional `damage?: number` field to the `attacked` event (the per-attack aggregate, identical across the turn's hits) so the listener can evaluate `damage / victimMaxHp > 0.25`. The listener resolves the victim's effective max HP (the carrier is the attacked unit = owner). A new `Ability`/config filter field expresses the threshold (e.g. `triggerIncomingDamageFracOfMaxHp?: number` = 0.25) — kept generic, defaulting absent → no filter (byte-identical for every existing on-attacked ability).
- **Effect:** all-allies grant `Buff Protection`, duration 2, procChance per rarity.

### 3.4 Last Stand — `on-ally-destroyed` + NEW `last-standing` condition subject

- **Seam (recommended over a dedicated trigger):** rides the existing `on-ally-destroyed` trigger (fires for each surviving same-side ally when an ally is destroyed) **gated by a NEW `last-standing` ConditionSubject** that is true iff the owner is the *sole living same-side actor*. The transition into "last standing" coincides exactly with the death of the last *other* same-side ally, so on-ally-destroyed + the gate fires precisely on becoming-last-standing. This reuses trigger machinery (lighter than a brand-new trigger and its event wiring).
  - Edge: if multiple allies die in one batch, `on-ally-destroyed` fires per death; the gate evaluates after each, so it fires only on the death that leaves exactly one survivor. Correct.
- **New condition subject** (follows the D-PR14 `first-activator` precedent, 6-hop thread):
  - `ConditionContext.isLastStanding?: boolean` + `evaluateCondition` case (`ctx.isLastStanding ? 1 : 0`).
  - Engine computes "is this owner the only living same-side actor" via a delegate `IntentExecContext.isLastStandingFor?(ownerId): boolean`, threaded through `buildDrainContext` → `buildActorConditionContext` → `buildRoundContext`. Liveness uses the same `destroyedRound === undefined` test used elsewhere; the same-side roster is the owner's side (player → `allPlayerActors`, enemy → `enemyAttackerActors`), side-bound at the drain seam exactly as D-PR14's `enemyWithHighestAttack`/`firstActivator` are.
  - **MUST add `last-standing` to `LIVE_SUBJECTS`** (`abilityStatusGating.ts`) — else `liveGateConditions` rewrites it to `always` (the D-PR14 lesson). Buff-grant abilities run through `liveGateConditions`.
- **Effect (dual buff, single proc roll):** self-grant `Barrier` AND `Block Debuff`, duration 1, on ONE proc roll. `mkNamedBuffGrant` grants a single buff name today; the existing skill parser emits one ability per buff for deterministic "A and B" ship-skill grants, but that gives **independent** proc rolls — unfaithful here ("gain Barrier and Block Debuff" is one chance for both).
  - **Co-grant extension:** add optional `alsoGrantBuffNames?: string[]` to the buff `AbilityConfig`. In the `cfg.type === 'buff'` executor branch, AFTER the single `passesProcChanceGate` check, build and apply a timed status for the primary `buffName` **plus** each name in `alsoGrantBuffNames`, to the same recipients with the same duration (small loop around the existing single-status hoist). `mkNamedBuffGrant` gains `alsoGrantBuffNames` in `opts` (each resolved via `BUFFS` for `parsedEffects`; unknown name → skip that co-buff, never throw).
  - Last Stand: `mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, { procChance, conditions: [{ subject: 'last-standing', derivable: true }], alsoGrantBuffNames: ['Block Debuff'] })`.
  - Byte-identical: `alsoGrantBuffNames` absent → single-buff path unchanged for every existing grant.

## 4. proc model

No once-per-round / once-per-combat caps — all four texts are pure per-event `% chance` procs (unlike D-PR14 Bulwark's "once per round"). Each qualifying event rolls the per-`(owner, ability)` rate gate (`procChanceGates`, deterministic accumulator). Firewall and Lockdown can therefore fire multiple times per round (multiple debuffs received / resisted), each an independent roll — faithful to the text.

## 5. Registry & coverage

- `buildEquipmentAbilities.ts`: four new `IMPLANT_ABILITIES` entries (FIREWALL, LAST_STAND, LOCKDOWN, TENACITY), values from `implants.ts` per-rarity proc chances.
- `equipmentCoverage.test.ts`: add the four to BOTH the decl-order `.toEqual` array AND the `implementedImplants` Set (known pitfall — must update both).
- DPS calculator page NOT wired — these are defensive/targeting-adjacent effects that don't affect outgoing DPS (consistent with D-PR14).

## 6. Editor / type stubs

New `AbilityTrigger` values (`on-debuffed`, `on-debuff-resisted`) and the `last-standing` condition subject need the usual exhaustiveness stubs so `tsc` and the ability editor stay complete: `AbilityCard.tsx` TRIGGER_OPTIONS, `ConditionRow.tsx` SUBJECT_VALUES + EXTRA_SUBJECT_LABELS, and any `AbilityTypePicker`/`abilityDefaults` switch arms. The new `attacked.damage` and config-filter / `alsoGrantBuffNames` fields are optional → no UI required beyond exhaustiveness.

## 7. Testing & invariants

- **Byte-identical goldens (load-bearing safety invariant):** no ship skill and no combat fixture grants any of these implants (verified — same posture as D-PR15). All DPS + healing goldens MUST stay byte-identical. If a golden moves, a gate leaked — fix the gate, never `vitest -u`.
- Per-applier integration tests (engine-level, positional or aggregate as fits):
  - **Firewall:** a debuff lands on the carrier → (proc forced via a deterministic gate) carrier gains Block Debuff → a subsequent incoming debuff is auto-resisted.
  - **Lockdown:** carrier resists an incoming debuff → all same-side allies gain Buff Protection → an enemy purge against an ally is no-op.
  - **Lockdown × Block Debuff synergy:** Block-Debuff holder auto-resists → `debuff-resisted` → same-side Lockdown grants team Buff Protection (the emergent chain).
  - **Tenacity:** a direct attack > 25% of victim max HP → all allies gain Buff Protection (2t); an attack ≤ 25% does NOT trigger; a DoT batch exceeding 25% does NOT trigger (DoT emits no `attacked`).
  - **Last Stand:** kill all same-side allies but one → the survivor (proc forced) gains BOTH Barrier and Block Debuff from one roll (assert both present; assert it does not fire while ≥2 allies live).
  - Enemy-side mirror for at least one applier (team-agnostic: the same effect fires for an enemy carrier against the player team).
- Pure-unit tests for the new `last-standing` evaluation and the Tenacity damage-fraction filter.

## 8. Out of scope / deferred

- **Block Buff** primitive (immune to RECEIVING buffs) — D-PR15 deferred it as golden-moving; no applier here needs it.
- Remaining D buckets (shield-grant family DORMANT on sub-project H, Reactive Ward cleanse, Chrono Reaver charge-gen, Voidfire Catalyst detonation, trivial Code Guard, special-effect gear sets) — unchanged, future PRs.
- No UI beyond editor exhaustiveness stubs; no DPS-page wiring.

## 9. Key file seams (for the plan)

- `src/types/abilities.ts` — `AbilityTrigger` += `on-debuffed`, `on-debuff-resisted`; buff `AbilityConfig` += `alsoGrantBuffNames?`; the Tenacity threshold filter field; `Condition` subject `last-standing`.
- `src/utils/combat/events.ts` — `attacked` event += optional `damage?`.
- `src/utils/combat/triggers.ts` — three new listener arms (`on-debuffed`, `on-debuff-resisted` self-scoped; Tenacity damage filter on the `on-attacked` arm); `cfg.type === 'buff'` co-grant loop; `last-standing` thread through `buildDrainContext`.
- `src/utils/combat/engine.ts` — `attacked` emission += aggregate `damage`; `isLastStandingFor` delegate on the IntentExecContext (both drain seams, side-bound); thread through `ReactiveSideCtx` if needed (D-PR14 lesson — not just the drain literals).
- `src/utils/combat/roundContext.ts` / condition-context builders — `isLastStanding` plumbing.
- `src/utils/abilities/abilityStatusGating.ts` — `LIVE_SUBJECTS += 'last-standing'`.
- `src/utils/combat/evaluateCondition` (wherever it lives) — `last-standing` case.
- `src/utils/abilities/buildEquipmentAbilities.ts` — `mkNamedBuffGrant` `alsoGrantBuffNames` opt; four registry entries.
- Editor stubs + `equipmentCoverage.test.ts`.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
