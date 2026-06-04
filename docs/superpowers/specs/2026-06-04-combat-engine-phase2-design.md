# Combat Engine Phase 2: Ships Act in Order

**Date:** 2026-06-04
**Status:** Approved design
**Baseline:** `main` after PR #81 (combat-engine follow-ups: passive charge auras, enemy-buff grant parsing)
**Builds on:** `docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md` (Phase 1: engine core, attacker-only)

## Problem

Phase 1 made the attacker a real actor but left everyone else on synthetic schedules:

1. **Team-ship buffs ride a fake cadence.** `computeChargeSchedule(sourceChargeCount, sourceStartCharged)` pretends each team ship acts in lockstep with the attacker. Real timing — a faster support buffing *before* the attacker's hit, a team ship's true charged cadence — is unrepresentable.
2. **Debuff landing re-rolls every round** (Phase 1 invariant 3 deferred this). A landed debuff should persist its window; a resisted application should be skipped.
3. **Durations decrement at the top of the attacker's round** instead of in the status carrier's Post Turn (game-accurate per `docs/combat-system.md` §4).
4. **The attacker's own scheduled effects use the bonus-charge-blind `computeChargeSchedule`** while its real action cadence (with charge abilities and passive charge auras) diverges (Phase 1 invariant 4 quirk).
5. **`buff-expired` is declared but unemitted** — expiry has no single home until Post Turn exists.
6. Deferred review items: `hasChargedSkill` hides charged-only utility skills; `RegisteredAbilityStatus` is a runtime-convention union; `enemy-buff`/`self-debuff` derivability question.

Phase 2 makes team ships and the enemy real actors and fixes all of the above. It is the prerequisite structure for Phase 3 (reactive triggers need real turns to react to).

## Decisions (user-confirmed during brainstorming)

| Question | Decision |
|---|---|
| Turn model | **Once per round, speed = order.** A game round = every living actor acts exactly once; speed (turn meter) determines order, not frequency. Extra actions come only from effects (End-of-Round Actions — out of scope, seam reserved). |
| Round reporting | `RoundData` row *r* = game round *r* = exactly one attacker turn. Report stays 1:1 comparable with today. |
| Tiebreak / default order | **Team ships (list order) → attacker → enemy.** Buffers go before attackers. |
| Default speeds | Attacker 100, team 100, **enemy 50** (enemy naturally last). |
| DoT timing | **Tick at the start of the afflicted ship's turn** (the enemy's turn), game-accurate. |
| `hasChargedSkill` | **Fix now:** charged slot with ≥1 ability of any type (and `chargeCount` > 0) fires on cadence — utility charged skills apply their buffs. |
| Team-ship depth | **Re-timed buff lists** (existing `SelectedGameBuff` payloads applied on real team turns). Full ShipSkills walk for team ships is its own later spec (~Phase 2 again in size: target-routing semantics, per-actor contexts, editor UI). |
| Speed inputs | Auto-fill + editable everywhere: team speed from ship stats, attacker speed in the stats grid, enemy speed manual. |
| `enemy-buff` / `self-debuff` subjects | Stay manual (non-derivable). The Phase 2 enemy has no skills; nothing debuffs the attacker. Revisit in Phase 4. |

## Game-mechanics notes recorded from the user

- A round is one full game round; all living ships take **at least** one turn. Stasis/disable skips the action (turn passes on) — out of scope here, noted for Phase 4 (matches combat-system.md §3 freeze flow).
- DoTs trigger at the **start of a ship's turn** no matter what.
- Buff durations count down at the **end of turns** (owner's Post Turn).
- Some ships (Liberator, Nuqtu, Chakara) can gain **extra turns** ("End of Round Action") — not implemented anywhere yet; the per-round turn queue is the seam.

## Turn model

Each game round builds a **turn queue**: all living actors sorted by **speed descending**, tiebreak **player side before enemy, then input order (team 1–4, attacker — with the team-before-attacker default achieved by equal default speeds and list order: team ships are enqueued before the attacker at equal speed)**. Concretely: sort key = (speed desc, sideRank asc, inputIndex asc) where input order is team 1..4, attacker, enemy.

- The queue is recomputed per round (speeds are static in Phase 2, but the recompute is the seam for meter manipulation and extra turns).
- `selectNextActor` / `TURN_METER_THRESHOLD` scaffolding in `state.ts` is retained for future meter-manipulation phases but is not used by the Phase 2 loop; a doc note marks it reserved.
- Defaults (team 100 → attacker 100 → enemy 50) reproduce today's effective ordering: team actors precede the attacker in the queue, so **in round 1 team buffs are applied before the attacker's first hit** (matching the synthetic schedule's round-1-buffed behavior); enemy-side ticks and decrements land at the end of the round. **At default speeds the sim is numerically equivalent to Phase 1 except for the documented KNOWN-DIFFs.**

## Actor model

`CombatActor` (state.ts) gains `kind: 'attacker' | 'team' | 'enemy'` and per-actor charge state (`charges`, `chargeCount`, `startCharged`). The enemy keeps the DoT containers. Team actors carry their re-timed buff/debuff payload lists.

| Actor | Turn body |
|---|---|
| **Attacker** | The existing Phase 1 pipeline moved verbatim into an attacker-turn function — status fold-in, gating, damage, charge gains — *minus* DoT ticking/expiry (moved to the enemy's turn). Writes the round's `RoundData` row. |
| **Team ship** | Applies its `SelectedGameBuff` lists whose `skillSource` matches the slot fired this turn ('active'/'charge'; 'passiveN'-sourced stay permanent as today). Debuffs roll landing at application. Advances its own charge counter. No damage, no skill walk. |
| **Enemy** | Start of turn: DoT processing (corrosion/inferno ticks, bomb countdowns/bursts, accumulator countdowns/detonations — all the containers it carries). Then a no-op action (the Phase 3 `on-attacked` / Phase 4 enemy-skill seam). |

## Turn anatomy

**Pre Turn** (attacker + team): if banked charges ≥ that actor's `chargeCount`, this turn fires **charged** and resets to 0; else **active** fires and banks +1. Attacker bonus-charge gains (charge abilities incl. passive auras, `allyChargePerRound`) stay in its turn body exactly as today, capped at `chargeCount`.

**Turn body**: per the actor table above. The attacker's *detonate-dot* (early stack consumption) stays in the attacker's turn unchanged; only periodic ticking moves to the enemy's turn.

**Post Turn** (every actor): durations of statuses **on that actor** decrement by 1; expired statuses are removed; **`buff-expired` is emitted** (actorId, buffName, round). Buffs on the attacker decrement at the attacker's Post Turn; enemy debuffs and DoT windows at the enemy's. A status applied during round *r* still yields the same active window as Phase 1 at default speeds (decrement at owner's post-turn end-of-round-*r* ≡ Phase 1's top-of-round-*r+1*).

**Same-turn decrement rule (the off-by-one trap — make this explicit in code):** the owner's Post-Turn decrement applies to **all statuses on the owner, including ones applied during this same turn**. Trace for a 2-turn buff applied in round *r* (Phase 1: present r and r+1 — `step(r+1)` decrements 2→1, `step(r+2)` expires it): owner post-turn end-of-*r* decrements 2→1, the round-*r+1* snapshot shows 1, end-of-*r+1* expires it → present r and r+1, identical. Skipping same-turn applications would instead yield r, r+1, AND r+2 — a +1-round regression. This also matches the game's intuition ("2 turns" = this turn + the next, counting down at the end of each turn). Two consequences to encode in tests: (a) a duration-1 buff re-applied every round emits `buff-expired` each post-turn before its next-round re-application — correct, it genuinely expires and is re-applied; (b) a debuff applied to a FASTER enemy (whose post-turn already passed when the attacker applies it mid-round) gets its first decrement a round later and lives one round longer — game-accurate, part of the fast-enemy KNOWN-DIFF.

## Application-time debuff landing with persistence

Replaces Phase 1's per-round `debuffLandingGate` re-roll (invariant 3's deferred item; independently flagged by a CodeRabbit reviewer):

- Every **timed** debuff application — scheduled, team-sourced, or ability-sourced — draws the deterministic `debuffLandingGate` **once at application**. Landed → persists its full window, no further rolls. Resisted → that application is skipped (no status); a later re-application rolls fresh.
- `application: 'apply'` (affinity-based) stays deterministic: lands unless the attacker is affinity-disadvantaged.
- **Recurring/aura** debuffs are conceptually re-applied each round → keep a per-round roll (unchanged behavior).
- DoTs already roll at application and persist — unchanged.
- `RoundData.resistedEnemyDebuffs` semantics shift from "actives that failed this round's re-roll" to "applications resisted this round".

## Status engine reshape (action-fed)

`createStatusEngine` stops predicting cadences and starts being told what happened:

- **`computeChargeSchedule` is retired from the sim path** (module + tests removed unless another consumer surfaces during implementation). The engine reports "actor X fired slot S in round r"; timed scheduled buffs keyed (source actor, slot) apply at that moment.
- **Cadence unification:** manual picker buffs riding the attacker's charged skill follow the attacker's **real** cadence — including bonus charges (fixes Phase 1 invariant 4). Per-buff `sourceChargeCount`/`sourceStartCharged` become dead fields, superseded by per-team-actor `chargeCount`/`startCharged`.
- **Legacy path:** calls without `teamActors` that pass merged buff arrays (with or without source fields) ride the attacker's cadence. The DPS page — the only real caller — moves to the new shape.
- `step(r)` loses its internal decrement (moved to owner Post Turns) and its `chargedSet`; it becomes a pure per-turn application + snapshot machine. Strict-sequence guards stay.
- **`RegisteredAbilityStatus` becomes a discriminated union** on `kind`: `'timed'` requires numeric `duration`; `'accumulating'` requires `stackTrigger`; `'aura'` carries neither. (Deferred CodeRabbit nit; natural while the API reshapes.)

## `hasChargedSkill` widening

From "charged damage multiplier > 0" to "**the charged slot has ≥1 ability of any type AND `chargeCount` > 0**". Utility-charged ships bank charges and fire real charged turns whose buff/debuff abilities apply; their `RoundData` shows charged actions with 0 direct damage. Team actors rely on the same rule (their charged turns are typically pure utility).

## Public API (additive only — hard constraint)

`DPSSimulationInput` gains:

```ts
speed?: number;        // attacker, default 100
enemySpeed?: number;   // default 50
teamActors?: TeamActorInput[];

interface TeamActorInput {
    id: string;
    speed: number;          // default 100
    chargeCount: number;
    startCharged: boolean;
    selfBuffs: SelectedGameBuff[];     // buffs granted to the attacker
    enemyDebuffs: SelectedGameBuff[];
}
```

When `teamActors` is present, team buffs enter **there**, not the global merged arrays (no-double-count: each buff passes exactly one door — asserted by test). `DPSSimulationResult` / `RoundData` shapes are unchanged; `RoundData.action` remains the attacker's action.

**RoundData aggregation in the multi-actor world:** row *r* aggregates the whole game round — `activeSelfBuffs`/`activeEnemyDebuffs` are the statuses in effect during the **attacker's** turn of round *r* (the turn whose damage the row reports); `resistedEnemyDebuffs` lists applications resisted during round *r* regardless of which actor's turn applied them; DoT damage fields report the ticks processed in round *r* (at the enemy's turn). The adapter's existing per-round assertion (damage totals == HP deltas) carries over per game round.

**`allyChargePerRound` is unchanged:** it stays a flat attacker-side input applied on the attacker's active turns. It is NOT superseded by `teamActors` (team charge-grant skills aren't parsed until the full team-walk spec); the two coexist.

## Page / UI

- `TeamShipConfig` gains `speed` and `chargeCount` (joining `startCharged`) — auto-filled on ship pick (speed from ship stats, chargeCount from skill rows), user-editable. Per-buff `sourceChargeCount` plumbing is removed.
- Team ship cards (`CombatSettingsPanel`): "Speed" input + visible/editable charge count next to Start Charged.
- Attacker: "Speed" input in `ShipConfigCard`'s stats grid, auto-filled like the other stats.
- Enemy: "Speed" input in combat settings, default 50.
- All inputs via the shared `Input` component with labels (UI conventions).
- `DocumentationPage`: short "turn order" paragraph (speed-ordered turns, buffers-before-attacker default, enemy default slow). `UNRELEASED_CHANGES` entry.

## Events

- `turn-started` / `turn-ended` now fire once per **actor turn** (several per round); payload `round` = game round. Emission remains write-only taps.
- `buff-applied` / `debuff-applied` / `debuff-resisted` fire at application time (now possibly during team turns).
- **`buff-expired`** emitted from owner Post Turns — the Phase 1 contract gap closes.
- Consumers: still only the DPS adapter's round-log builder. The Phase 3 listener contract from the Phase 1 spec is unchanged.

## Determinism

Zero-RNG holds. All gates remain `makeRateGate` accumulators; the landing gate draws once per application event; application order is fixed by the turn order; identical inputs → identical outputs.

## Testing

**Golden parity (16 snapshots) is the referee.** Default speeds reproduce today's ordering, so every snapshot diff must be attributable to a KNOWN-DIFF — anything else is a regression:

- **KD-1 Legacy team-buff cadence collapse:** scenario 11 passes team buffs through the legacy merged arrays (no `teamActors`), with `sourceChargeCount: 4`/`sourceStartCharged: true`. The fixture deliberately stays on the legacy shape — its job is to lock the old API's behavior. Under Phase 2's legacy rule, that debuff's synthetic source schedule is dropped and it rides the attacker's real cadence (`chargeCount: 3`) instead; this re-timing is the snapshot diff to hand-verify round-by-round. Faithful team-actor re-timing is locked separately by the NEW golden scenario (below), which uses `teamActors`.
- **KD-2 Cadence unification:** scheduled buffs on a charged skill whose real cadence has bonus charges. No current fixture combines these → expected churn none; locked by a named new test ("scheduled charge-slot buff follows the real bonus-charge cadence": a charge ability accelerates the charged rounds and the scheduled buff fires on the accelerated rounds, not `computeChargeSchedule`'s).
- **KD-3 Landing persistence:** only fixtures with landing chance < 100%. `BASE` is 250 hacking vs 100 security (100%) → expected churn none.
- **KD-4 `hasChargedSkill` widening:** only fixtures with utility-only charged slots — none exist → expected churn none.

**New behavioral tests:**

- Fast support (speed > attacker): buff live for the attacker's round-1 hit; slow support (< attacker… and < enemy ordering as configured): first benefit in round 2.
- Enemy faster than attacker: DoT ticks and enemy-side decrements land before the attacker's hit (KD documented).
- Persistence at 50% landing: landed 2-turn debuff runs its full window; resisted application leaves no status; next application rolls fresh.
- Owner Post-Turn decrement + `buff-expired` with correct actor/round.
- Utility-charged ship: banks charges, fires 0-damage charged turns, charged-slot buffs apply.
- Team actor with own `chargeCount`/`startCharged`: charge-slot buffs land on its true charged turns.
- "Scheduled charge-slot buff follows the real bonus-charge cadence" (the KD-2 lock): a charge ability accelerates the attacker's charged rounds and the scheduled buff fires on the accelerated rounds.
- No-double-count: a buff present in `teamActors` contributes exactly once.
- Status-engine unit tests adapt (no internal decrement; action-fed application); discriminated-union compile coverage.
- One new **golden scenario**: team actor + non-default speeds, locking the multi-actor round shape.

## Out of scope (stated boundaries)

- Reactive `Ability.trigger` consumption / follow-up skills (Phase 3 — the per-round turn queue is the seam)
- Extra End-of-Round Actions (Liberator/Nuqtu/Chakara)
- Full ShipSkills walk for team ships (own spec; target-routing semantics for non-attacker sources is the open design problem)
- Enemy skills/damage, targeting/taunt/provoke/stealth, multi-enemy, hit checks beyond landing, heal/shield/cleanse/control consumption (Phase 4)
- Turn-meter manipulation effects; stasis/disable turn-skipping (Phase 4; combat-system.md §3 freeze flow)
- PvP/PvE round limits
