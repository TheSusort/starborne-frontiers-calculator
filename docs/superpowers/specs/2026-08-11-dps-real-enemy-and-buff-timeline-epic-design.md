# DPS Calculator: real full-walk enemy, then a truthful buff timeline

**Date:** 2026-08-11
**Status:** Approved (design), awaiting implementation plans
**Shape:** Epic — two sequenced sub-projects, one plan each.

## Motivation

Two problems, discovered in that order.

**The DPS calculator's buffed-stats summary is a parallel derivation that can disagree with the
engine.** `ShipConfigSummary` displays `attack × (1 + attackBuff/100)`, `crit + critBuff`,
`critDamage + critDamageBuff`, where the totals come from `mergedAttackerBuffTotals`
(`DPSCalculatorPage.tsx:205`) — a static pre-pass built by `configShipSkillsToSimInputs` →
`buffAbilitiesToSelectedBuffs` → `staticGateConditions`. That pre-pass deliberately neutralizes
derivable count-threshold conditions to `always` ("satisfiable in principle"), so it can report
totals from a buff the sim never grants, and it misses an enemy-buff-by-name condition entirely
(already flagged in-code as a documented limitation).

**What it is NOT:** a numerical divergence between the calculator and the sim. Those cannot
disagree — `configToSimInputs.ts:34-38` states the sim does not consume this output at all, and the
call chain confirms it (`configShipSkillsToSimInputs` has exactly one production caller,
`DPSCalculatorPage.tsx:200`, feeding a display-only panel). Buff/debuff abilities reach the engine
from `shipSkills` directly and are gated live per round by `liveGateConditions`
(`abilityStatusGating.ts:99`). This is a **display-fidelity** problem, not a correctness one. Any
future note claiming the DPS calculator and sim diverge on buff numbers is wrong.

**The engine already computes the truth.** `stats-snapshot` fires at every actor's `turn-started`
(`engine.ts:7909`), unconditionally and team-symmetrically, carrying the same
`effectiveStatsOf(statusEngine, selfBuffLookup, actor)` fold every live-stat read in the engine
uses. `status-snapshot` fires per actor at the round tail (`engine.ts:9864`) carrying the statuses
that genuinely survive — authoritative over accumulation, so cleanse/purge/steal/expiry are all
reflected. `simulateDPS` already accepts `bus?: CombatEventBus`, a documented emit-only tap. So the
fix consumes existing data rather than adding emissions.

**But consuming it for the ENEMY hits the dummy.** In DPS mode the enemy is a dummy whose named
debuffs route to the global `__enemy__` sentinel store, not its actor id. `ownerDebuffNamesFor`
(`triggers.ts:2004`) reads `snapshot(undefined, targetId)` keyed by the actor id, so the dummy's
`debuffNames` comes back empty — the engine's own comment at the emit site says exactly this.
Special-casing the dummy at the snapshot site would be branch #26 on top of ~25 existing
`isDummyEnemy`/`dpsEnemyTarget`/`dummyEnemyIsVestigial` sites, one of which (`engine.ts:9612`) IS
the sentinel routing. **Owner decision (2026-08-11): no new dummy branches.** The root fix is to
give the DPS calculator a real enemy, which the epic does first.

### Prior art and what was actually established

The engine-unification epic's D4 recorded "DPS-calc opponent = real skill-less ship," and SP-U
delivered that half: the DPS enemy is destructible with finite HP and real stats. Customizable
enemy *skills* were never in D4's scope, so a full-walk enemy is new scope rather than a dropped
commitment. SP-F F7 separately established that the dummy actor is load-bearing scaffolding and
**not** removable on its own.

What makes this tractable now: the machinery exists and is proven. `healingEngineAdapter.ts:255`
passes `enemyAttackers` — real ships carrying `shipSkills` — **without** positional placement,
alongside the existing scalars. And the engine has the escape hatch built in:
`dpsEnemyTarget = enemyAttackerInputs.length === 0` (`engine.ts:2294`). Supplying a real enemy
attacker switches the dummy path off by itself.

## Epic end-goal (owner, 2026-08-11)

**Simplify the engine so there are no dummy ships and everything is positional.** SP-1 and SP-2 are
the first two steps toward that, not the whole of it.

### Why this is coherent despite SP-F F7

SP-F F7 concluded the dummy is "NOT removable — load-bearing scaffolding" (`allActors`,
`TurnBindings.legacyVictim`, the `isDummyEnemy` turn-skip, `resolvePositionalTarget`'s null
fallback, and the `cumulativeDamage` scalar being the DPS-mode metric). That finding stands, but it
was **conditional**: every one of those props exists to serve a NON-POSITIONAL mode. The dummy is
load-bearing *because* DPS and healing run without a board. Put both on a board and each prop loses
its reason to exist:

| F7's prop | Dissolved by |
| --- | --- |
| `cumulativeDamage` scalar IS the DPS metric | SP-1 re-derives it from `perTargetDealt` |
| `resolvePositionalTarget` null-fallback to `legacyVictim` | a real positioned enemy always resolves |
| `isDummyEnemy` turn-skip | no dummy in the roster |
| `TurnBindings.legacyVictim` | no legacy victim to bind |

So the order matters: **the dummy cannot be removed first.** It is removed *last*, once nothing
depends on it.

### Roadmap

- **SP-1** — DPS calculator: real positional enemy. *(planned:
  `docs/superpowers/plans/2026-08-11-dps-real-full-walk-enemy.md`)*
- **SP-2** — the truthful buff timeline. *(specced below)*
- **SP-3** — Healing calculator: real positional enemy. Not yet specced. Note F7's second finding —
  `healingEngineAdapter`'s dummy is independently load-bearing because a healer casting `damage` at
  `target:'enemy'` feeds `basis:'damage-dealt'` heal/shield riders, so those riders need a real
  victim before the dummy can go.
- **SP-4** — Retire the dummy and the non-positional code paths from the engine. Only viable once
  SP-1 and SP-3 have removed every production caller. Expect this to delete, not add: the ~25
  `isDummyEnemy` / `dpsEnemyTarget` / `dummyEnemyIsVestigial` branches, the `!positional` credit
  forks (`engine.ts:8430`), and `dummyEnemyIsVestigial`'s turn-order gate.

**Standing rule for the whole epic: no new dummy branches.** If a task seems to need one, that is a
signal the sub-project ordering is wrong, not that the branch is warranted.

## Decomposition

**SP-1 — real full-walk enemy in the DPS calculator.** Must come first: it is what removes any
engine change from SP-2.

**SP-2 — the truthful buff timeline.** Lands on a real enemy, so the chips need no sentinel
special-casing at all.

---

# SP-1 — Real full-walk enemy

## Locked decisions

1. **The enemy takes turns and attacks back** (owner, 2026-08-11). It is a full participant: it
   acts, it can kill the attacker, and the run ends when either side dies or `numRounds` is hit.
2. **The DPS page always supplies a real enemy.** The scalar-only path is not kept as a second mode
   on this page. The engine retains it for other callers and tests until it is separately
   retirable.
3. **Default enemy = a skill-less real ship carrying today's scalar stats,** so an existing saved
   page loads with the same stats. Its behaviour still changes (see risk below).
4. **Positional, with auto-placement.** *(Corrected 2026-08-11 — an earlier draft said
   "non-positional, exactly the healing calculator's shape". That is unworkable, see below.)* The
   enemy is auto-placed in a fixed documented slot; each attacker config **and each team ship**
   carries a configurable slot (owner, 2026-08-11). Player-side slots must be unique — a pick that
   collides swaps the two occupants rather than being rejected.

   **Why the healing calculator's shape does not transfer.** `isPositional`
   (`positionalBinding.ts:20-25`) requires the acting actor to have a position AND at least one
   opposing actor to have one; otherwise `selectTurnTarget` (`engine.ts:6380`) falls back to
   `tb.legacyVictim` — the dummy. The healing calculator survives non-positionally because its
   enemies only ever need to DEAL damage; the healer never has to damage them. A DPS calculator
   inverts that requirement exactly, so without positions the focus would keep hitting the dummy
   while real enemies attacked it back and never took a scratch.

   `Position` is a slot label `'T1'`–`'B4'` (`types/encounters.ts:1`). Both
   `CombatEngineInput.position` (focus, `engine.ts:1288`) and `enemyAttackers[].position`
   (`engine.ts:1240`) already exist. **Column 4 is the FRONT** — see
   `reference_sim_test_harness_traps`; pick placement slots deliberately and document the choice.

## Architecture

Follow `healingEngineAdapter` directly.

```
DPSCalculatorPage  ──enemy ship config (stats + shipSkills)──┐
                                                             ▼
simulateDPS(input.enemyAttackers)  ──────────────►  runCombat({ enemyAttackers, … })
                                                             │
                                        dpsEnemyTarget = false (auto)
                                                             │
                              damage flows through the normal per-victim funnel
                                                             ▼
                                   RoundData.perTargetDealt  (SP-F F1)
                                                             │
                              cumulativeDamage / totalRoundDamage re-derived
```

`DPSSimulationInput` gains `enemyAttackers?: EnemyAttackerInput[]`, threaded to `runCombat`'s
`enemyAttackers` parameter. Reuse the existing `EnemyAttackerInput` type rather than defining a
parallel one.

## The metric re-derivation

This is the load-bearing change. **The reason is the POSITIONAL gate, not the `dpsEnemyTarget`
gate — an earlier draft of this spec named the wrong one.** Getting this right matters because the
two gates suggest different fixes.

`cumulativeDamage += totalRoundDamage` (`engine.ts:9702`) is itself **ungated**, and
`totalRoundDamage` is built from the focus actor's own channel accumulators. But those accumulators
are fed by `creditDamage(actor.id, 'direct', turn.directDamage)`, which sits inside
`if (!positional)` (`engine.ts:8430`). The comment there is explicit: in positional mode the
firing-hit damage lands per-victim via `applyPositionalDamage`, so crediting it again "would
double-count it."

So once SP-1 makes the run positional, `focus.direct` stops accumulating and
`rawTotals.cumulative` — the DPS metric — reads approximately zero. (Separately, the
`dpsEnemyTarget` false branch at `engine.ts:9753` keeps the dummy as a shadow HP tracker so its
HP%-gates still resolve; it is not the cause of the metric loss.)

Damage instead flows through the normal per-victim funnel into `RoundData.perTargetDealt`
(attacker id → victim id → dealt). `cumulativeDamage` and `totalRoundDamage` are re-derived from it
for the focus actor — the identical derivation `battleSimulator` already performs for
`ShipRoundState.damageDealt`, which SP-F F1 built `perTargetDealt` to serve and which "reconciles
with `damageTaken` by construction."

Do not invent a new accounting path. Mirror the proven one.

## Components

- `dpsSimulator.ts` — accept and forward `enemyAttackers`; re-derive `cumulativeDamage` /
  `totalRoundDamage` from `perTargetDealt` when `enemyAttackers` is non-empty; keep the existing
  scalar path intact for callers that supply none.
- `DPSCalculatorPage.tsx` — enemy state becomes a config object (ship id, stats, `shipSkills`)
  rather than loose scalars; build via `buildShipAbilitiesWithEquipment` on ship-select and
  `buildDefaultShipSkills` for a blank enemy, mirroring the attacker path.
- New `EnemyConfigCard.tsx` — ship-select, stat inputs, and `SkillSlotList`, mirroring
  `HealerConfigCard.tsx:217` and `ShipConfigCard.tsx:275`.
- Placement: a slot `Select` on each attacker config; the enemy's slot is fixed and not
  user-editable. Both are threaded to `runCombat` as `position` / `enemyAttackers[].position`.
- `DocumentationPage.tsx` and `changelog.ts` (`UNRELEASED_CHANGES`) per CLAUDE.md.

## Risk and golden discipline

**Every existing DPS number changes, and this is unavoidable.** Even a skill-less enemy acts —
`EnemyAttackerInput.shipSkills` is documented "Full kit walk. Absent → one synthesized basic attack
per turn." So the attacker now takes damage, `on-attacked` / counter / reflect / revenge kits fire
for the first time in DPS mode, and either side can die.

That last point is a genuine fidelity gain, not just churn: those kits are currently **understated**
in the DPS calculator because nothing ever hits the attacker, and the incoming-per-hit proc rule
locked on 2026-08-10 finally applies here.

Discipline: goldens move deliberately, audited individually. Never `vitest -u`. Each moved golden
needs a one-line justification in the PR, and any golden that moves for a reason *other* than "the
enemy now acts" is a defect to investigate, not to re-pin.

## Testing

TDD, red first, driven through the production page/sim seams rather than hand-built literals.

1. **Enemy acts.** A real enemy with a damage kit reduces the focus actor's HP across rounds.
2. **Reconciliation.** Focus actor's re-derived `cumulativeDamage` equals `Σ perTargetDealt[focus]`
   across rounds, mirroring `battleSimulator`'s reconciliation property. This is the correctness
   assertion for the derivation.

   **Do NOT specify a digit-parity test against the old scalar aggregate.** It is unachievable:
   adding a real enemy actor changes the number and order of RNG draws (the rate gate keys on
   `ownerId`), so even a zero-damage enemy shifts every later draw. Parity must be asserted against
   `perTargetDealt`, never against the pre-change number.
4. **Reaction kit fires.** A ship with an `on-attacked` trigger produces its reactive effect in the
   DPS calculator, which it provably cannot today.
5. **Death paths.** Attacker dies → run ends; enemy dies → `roundsToKill` reports correctly.
6. **RNG pinned** via `setupKeyedTestRng` / `resetRateGateRng` + `mulberry32`; the engine is not
   deterministic by default.
7. Full `npm test` (the golden skill audit spans the whole run) **plus** `npm run lint` — a
   separate hard gate that neither `npm test` nor the husky pre-commit hook runs.

---

# SP-2 — Truthful buff timeline

## Locked decisions

1. **Both halves:** per-round name chips *and* truthful stat totals (owner).
2. **The summary shows a turn-weighted average** across the run, not peak, range or opening
   values — it stays one comparable number, which matters because configs render side by side
   (`isComparing`), and it is the honest companion to a DPS total that is itself summed over rounds.
   (Chosen as "time-weighted" in discussion; "turn-weighted" is the precise name — see the
   weighting rule below. The two terms mean the same decision here.)
3. **Scope: focus attacker's buffs + enemy's debuffs.** The enemy's debuff state drives the damage
   number, so it explains the figure rather than decorating it.
4. **No engine emission is added or changed.** Both events already exist and already fire on this
   path. The only engine-side edit in SP-2 is a doc comment (see Components).

## Architecture

```
runCombat (emissions unchanged)
  ├─ turn-started → stats-snapshot   { actorId, round, stats: effectiveStatsOf(…) }
  └─ round tail   → status-snapshot  { actorId, round, buffNames, debuffNames }
                              │
                    dpsSimulator internal listener
                              │
                     RoundData rows gain (all optional):
                       statsSnapshot? · activeBuffs? · enemyDebuffs?
                              │
              ┌───────────────┴───────────────┐
     ShipConfigSummary                  DPSRoundChart
   time-weighted average           chips in the existing RoundTooltip
```

`runCombat` treats an external bus as a write-only tap whose listeners fan out **before** its own
reactive listeners (`engine.ts:1695-1709`), so the collector observes and never mutates — the
Phase 3 emit-only contract holds.

## The weighting rule

`stats-snapshot` fires per **turn**, not per round, and an extra action produces a second snapshot
in the same round. The average therefore weights **each focus-actor turn equally**, not each round.
This is deliberate: the snapshot is taken at turn-start, so each one describes the stats under
which that turn's damage was dealt, and an extra action legitimately earns extra weight.

Turn-blocked turns (Stasis/Disable) still emit `turn-started` and therefore still snapshot; they are
included, matching the engine's unconditional `turnsTaken` increment.

## Components

- `dpsSimulator.ts` — compose a collector bus that forwards to `input.bus` and collects both
  snapshot types, filtered to the focus actor and the enemy; attach the three optional fields to
  each `RoundData` row. Optional throughout, so existing goldens and callers are unaffected.
- New `roundStatsAverage.ts` — pure turn-weighted average over `RoundData[]`, kept out of the page
  so it is unit-testable. Returns `undefined` when no snapshot rows exist, so a caller that somehow
  runs without the collector renders nothing rather than a spurious zero.
- `ShipConfigSummary.tsx` — display the averaged snapshot stats instead of re-deriving from
  `attackerBuffTotals`. `ShipConfigCard.tsx` threads the prop.
- `DPSRoundChart.tsx` — buff/debuff chips inside the existing `RoundTooltip` (`:75`), per-round by
  construction, no new page surface; mirrors `HealingCumulativeChart`'s rich-tooltip precedent.
- `DPSCalculatorPage.tsx` — delete `convertedMap` and `mergedAttackerBuffTotals`. Keep
  `globalAttackerBuffTotals`: the manual attacker-buff pickers are not skill-derived and continue
  to work as they do today.
- `events.ts` — both events' doc contracts currently say folding them into an aggregated path
  "would be a bug." That was written to prevent *simulation* coupling. Reword to permit
  display-only aggregation while keeping the no-listener, no-state-mutation rule explicit.

## Dead code retired

Once the summary reads `statsSnapshot`, the static path has no production consumer:

- `configShipSkillsToSimInputs` (`configToSimInputs.ts`) — delete, taking its never-read
  `enemyDebuffs` half with it. `buildDefaultShipSkills` / `buildEmptyShipSkills` stay.
- `buildStaticBuffContext` and `buffAbilitiesToSelectedBuffs` (`buffAbilityConverters.ts`) — dead
  once their only caller goes.
- `selectedBuffsToBuffAbilities` — **already** dead today; no production caller. Remove.
- `selectedBuffToAbility` **stays** — `buildShipAbilities.ts:3145` uses it.

`abilityToSelectedBuff` is used internally by `buffAbilitiesToSelectedBuffs` and had no other
production caller as of 2026-08-11 (only a comment mention in `buildShipAbilities.ts:3475`). Re-grep
at implementation time and remove it if still unreferenced; if a caller has appeared, keep it.

## Testing

1. **Chips reflect removal.** A cleansed/purged/expired buff disappears from the round's chips —
   the property `status-snapshot` exists to provide, and the reason accumulation was abandoned.
2. **Enemy debuff chips populate** now that the enemy is a real actor keyed by its own id, with no
   engine change. This is the assertion that proves SP-1 unblocked SP-2.
3. **Weighting.** A fixture where a buff lands mid-run yields an average strictly between the
   unbuffed and fully-buffed values; an extra-action round weights its second turn.
4. **Summary equals the engine.** The displayed buffed attack equals `effectiveStatsOf` for a
   single-round run — one authority, not two.
5. **No double-count.** The sim's own numbers are unchanged by the collector; a run with and
   without a `bus` produces identical `RoundData` damage fields.
6. Full `npm test` plus `npm run lint`.

## Non-goals

- A placement **UI** (a board) in the DPS calculator. The run is positional — it must be, see SP-1
  locked decision 4 — but placement is chosen through slot dropdowns, not a board: one per attacker
  config and one per team ship, with the enemy on a fixed slot.
- Removing the dummy scaffolding from the engine **within SP-1/SP-2**. That is the epic's end-goal
  (see "Epic end-goal" above) but it lands in SP-4, after SP-3 removes the healing calculator's
  dependency too. SP-1 stops the DPS page from *exercising* the dummy, which is the prerequisite.
- Changing `liveGateConditions` or any live-gating semantics. This epic changes what is displayed
  and who the enemy is, never how conditions gate.
- Rebasing the DPS calculator onto `simulateBattle`. Considered and rejected for this epic: it
  would migrate `RoundData` → `BattleRound` and touch every chart and golden. It remains the
  plausible end state once the dummy is retirable.
