# Extra Actions + Per-Hit Crit Checks — Design

**Date:** 2026-06-06
**Status:** Approved by user (this session)
**Branch:** `feat/combat-engine-extra-actions-per-hit-crit`
**Baseline:** main after PR #84 (team ShipSkills walk). Golden parity suite = 19 snapshots.
**Handoff context:** `docs/superpowers/handoffs/2026-06-06-combat-engine-next-steps.md` increments 1+2, specced together on one branch (user decision).

## Goal

Close the last two DPS-side mechanic gaps before the healing phase:

1. **Extra actions** ("extra End Of Round Action" / "extra action" skill texts) — a ship
   re-enters the turn queue and takes a full additional turn.
2. **Per-hit crit checks** (coverage doc §6 backlog item 7) — each hit of a multi-hit
   skill crit-checks individually instead of one binary `roundCrit` per turn.

Plus one verification item: **Chakara's** round-start 60% damage proc (already live via
the passive payload-hit path; lock it with a test).

## Game-verified rules (user, 2026-06-06 — do not re-litigate)

1. An extra action is a **full normal turn**: charge cadence advances, the charged skill
   fires if charges are full, passives/triggers run as usual.
2. Timing: the ship is **re-added into the turn queue**, ordered by speed. If it has the
   highest speed among *remaining* actors this round, it acts immediately; otherwise
   faster remaining actors act first. Both phrasings ("extra action" and "extra End Of
   Round Action") behave this way.
3. Buff/debuff durations tick **per turn taken**: the owner's post-turn decrement runs
   after the extra turn too. A 1-turn buff applied on the regular turn is gone before
   the extra action resolves (if the owner decrements at its own post-turn).
4. Multi-hit skills crit-check **per hit** (verified earlier, Phase 3 backlog 7:
   Enforcer ~1.5 on-crit events/turn at 50% crit on a 3-hit skill).
5. On-crit follow-ups fire **once per critting hit** — 2 of 3 hits crit → the follow-up
   fires twice that turn.

## Ship catalog (from docs/ship-skills.csv survey)

| Ship | Slot | Text gist | Condition/trigger | Live? |
|---|---|---|---|---|
| Nuqtu | charged | "grants itself 1 extra End Of Round Action" if target has 3+ buffs | enemy-buff-count ≥ 3 | LIVE |
| Sustainer | charged | "gains one extra action" if this Unit has no debuffs | self-no-debuffs | LIVE (always true today — no enemy offense) |
| Tormenter | charged | "gains 1 Extra Action" if its HP is below 50% | self-HP < 50% | LIVE (never fires today — `selfHpPct` fixed 100; correct) |
| Liberator | 3rd passive | "once per round, this unit gains 1 extra action" | unconditional, once/round | LIVE (fires every round) |
| Tygr | 3rd passive | "After damaging an enemy affected by Stasis, once per round, give one extra action" | enemy-has-Stasis, once/round | LIVE |
| Sokol | 3rd passive | "one extra end of round action upon a kill, once per round" | on-kill | annotation-only (kill ends the sim) |
| Harvester | passive | "When an allied Unit is destroyed, gains 1 extra end of round action" | on-ally-destroyed | annotation-only (Phase 4 trigger) |
| Tithonus | passive | "gains 1 extra action after it purges at least 4 buffs with a single skill" | purge counting | annotation-only (purge not modeled) |

**Note:** the handoff listed Chakara under this increment, but Chakara's third passive is
a *start-of-round damage proc* ("deals 60% damage to the highest Speed Enemy"), not an
extra action. It already parses as a passive `damage` ability (verified this session via
`buildShipAbilities`) and the engine already walks passive payload hits (the Judge
pattern in `playerTurn.ts`). Scope here = a locking test, no engine code expected.

## Design

### 1. Extra actions — parser & ability model

- New type `extra-action` added to `SkillEffect` and the ability model (`AbilityType`).
  Config carries `oncePerRound: boolean` (from "once per round" in the clause).
- Detection in `skillTextParser.ts`: phrasings "extra action", "extra End Of Round
  Action", "extra end of round action" (case-insensitive). **No RegExp lookbehind**
  (iOS Safari 15 in browserslist).
- Conditions/triggers ride the existing machinery (`detectGrantConditions` /
  `detectReactiveTrigger` / `toCondition`), clause-scoped per the existing
  abbreviation-masked sentence splitting:
  - Nuqtu: enemy-buff-count threshold condition (existing subject).
  - Sustainer: self-no-debuffs condition.
  - Tormenter: self-HP-below-50% condition.
  - Liberator: no condition; `oncePerRound: true`.
  - Tygr: enemy-has-Stasis (`statusEffectCondition`); `oncePerRound: true`.
  - Sokol / Harvester / Tithonus: unmodeled triggers → NOT auto-parsed
    (`parseExtraAction` disqualifies these phrasings and returns null); the user can
    still add the ability manually in the editor.
- `buildShipAbilities` slots the ability with its position anchor; `auditSkills.ts`
  mirrors the detection (audit counts stay consistent).
- Editor: `extra-action` shows in `SkillSlotList` like other ability types (read +
  edit + manual add). No new UI primitives.

### 2. Extra actions — engine

- The round loop's turn queue (currently a fixed `orderByTurnPriority` ordering walked
  once) becomes **mutable for the round**: when an `extra-action` ability fires during
  any player actor's turn (focus or team — all player actors are full actors), the
  engine re-inserts that actor into the *remaining* queue at its speed position
  (verified rule 2). Insertion uses the same tiebreak as `orderByTurnPriority`
  (team → attacker → enemy at equal speed) so ordering stays deterministic.
- The extra turn runs the same `runPlayerTurn(PlayerActorRuntime)` pipeline — full
  normal turn per verified rule 1. Post-turn decrement runs again (rule 3).
- Caps: per-actor per-round `oncePerRound` enforcement for texts that say so; a global
  backstop `MAX_EXTRA_TURNS_PER_ROUND` (throw, mirroring `MAX_INTENT_GENERATIONS`)
  converts a pathological grant loop into an error. Chaining is naturally self-limited
  (charged-skill grants can't re-fire — charges were just consumed; passive grants are
  once-per-round), but the backstop guards future texts.
- Who executes the grant: the **executor** (sole mutator), via a new intent kind — the
  ability fires through the existing cast/trigger partition, listeners stay
  enqueue-only.
- Reporting: `focusTurns` / `RoundAccumulator` already sum multi-turn focus damage
  (the seam was built for this); team extra turns flow into `teamDamage` via the
  per-actor `ActorDamage` map. `totalRoundDamage + teamDamage` = round HP delta stays
  true by construction.
- Turn Order strip: unchanged — it shows the base per-round cadence. Extra turns appear
  in the round overview rows (which aggregate per round already). If the round overview
  needs a visible marker for an extra turn, keep it minimal (e.g. a "×2 turns" note on
  the actor's row) — implementer's choice, no new design surface.

### 3. Per-hit crit checks

- `playerTurn.ts` stops folding `hits` into the effective multiplier
  (`effectiveMultiplier = rawMultiplier * hits` goes away for the crit path). Each hit
  draws the **per-actor crit accumulator gate individually** — zero-RNG determinism
  preserved: at 50% crit on a 3-hit skill the draws alternate deterministically,
  averaging 1.5 crits/turn.
- Damage = Σ over hits of (per-hit base × crit multiplier if that hit crit). Defense/
  secondary scaling bonuses are **distributed evenly across hits**
  (per-hit = `rawMultiplier + scalingBonus / hits`) so each hit crits as one unit and
  totals match expectation.
- Passive payload hits and any other damage instances with their own `hits` follow the
  same per-hit rule; `noCrit` abilities draw nothing (unchanged — a noCrit attack
  consumes no crit chance).
- Events: `ability-performed` gains optional `critHits?: number` (additive). The
  `on-crit` trigger listener enqueues **once per critting hit** (verified rule 5).
  `didCrit` stays = "any hit crit" for back-compat.
- Crit-*gated* conditions (binary self-crit subjects in gating/modifier contexts)
  evaluate as **any-hit-crit**. `roundCrit` survives with that meaning for display and
  existing consumers.
- Crit-multiplier aggregation in the summary: per-turn crit damage attribution now sums
  per-hit outcomes; display fields keep their shape (additive only).

### 4. Chakara verification

- Add a unit/golden assertion that Chakara's third passive parses to a passive `damage`
  ability (multiplier 60) and contributes a passive payload hit each round. No engine
  code expected. (Its Attack Up II / Defense Up II lowest-speed-conditioned buffs are a
  separate buff-autofill concern — out of scope, note in coverage doc backlog if absent.)

## Golden parity policy (the referee)

- **Extra actions:** existing 19 scenarios must stay byte-identical (no current fixture
  carries an extra-action ability). Add a new hand-verified scenario: an extra-action
  ship (Liberator-style unconditional once/round) walked as the focus actor; assert
  round damage = two full turns' worth with correct per-turn buff decrement between.
- **Per-hit crits:** this WILL churn every multi-hit scenario with non-zero crit.
  Mandatory KNOWN-DIFF analysis in the plan: enumerate affected scenarios up front,
  hand-verify each new value, document the delta arithmetic per scenario. Regeneration =
  delete the entry + re-run; **NEVER** `vitest -u`.
- Add a dedicated multi-hit crit scenario (e.g. 3-hit skill at 50% crit with an on-crit
  follow-up) locking per-hit draw order and trigger frequency.

## Hard constraints (inherited, unchanged)

- DPS public API (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) stays additive.
- Zero-RNG determinism (`makeRateGate` accumulators; per-actor gates; fixed listener/
  queue/recipient order).
- Listeners never mutate state; only the engine/executor mutates.
- Engine core never compares against the literal `'attacker'` — key on
  `focusActorId`/owner ids.
- No RegExp lookbehind in src/.
- Pre-commit hook runs the full suite; no `--no-verify` for code commits.
- docs/ is gitignored — `git add -f` for spec/plan updates.
- Changelog: fold into the ONE evolving DPS entry in `UNRELEASED_CHANGES` — do not add
  separate entries.

## Testing

- Parser unit tests: each catalog ship's text → expected `extra-action` ability with
  conditions/`oncePerRound`; negative cases (no false positives on e.g. "End of Round"
  phrasing inside unrelated texts).
- Engine unit tests: queue re-insertion order (faster/slower than remaining actors;
  equal-speed tiebreak), once-per-round cap, backstop throw, per-turn decrement across
  the extra turn, charge cadence advancing on the extra turn.
- Per-hit tests: deterministic draw sequence at several crit rates; on-crit enqueue
  count per turn; any-hit-crit gating; noCrit non-consumption; scaling-bonus
  distribution arithmetic.
- Golden suite per policy above. Full suite (~1263 tests) green before each commit.
- Live verification at the end with the user's imported fleet (localhost:3002; reuse the
  existing Vite instance; `evaluate_script` over snapshots for 200+ ship pages;
  ShipSelector needs full pointerdown→click sequences). Verify Liberator (every round),
  Nuqtu (enemy-buff condition), and an Enforcer-style multi-hit on-crit ship.

## Documentation

- `docs/skill-model-coverage.md`: move backlog item 7 (per-hit crits) to §5 implemented
  rules with the verified semantics; add extra-action rules to §5; update §6 backlog
  (Sokol/Harvester/Tithonus annotation-only seams; Chakara buff-autofill gap if found).
- `src/pages/DocumentationPage.tsx`: only if the DPS page's user-visible docs describe
  crit or turn mechanics that change (check; likely a one-line touch).

## Out of scope

- Healing-calc adoption (next phase-sized milestone, own spec cycle).
- Phase 4 enemy offense (unlocks Harvester/on-kill/self-debuff realism).
- Backlog 8 (team-cast accumulating cadence) and 9 (drain-time enemy-debuff snapshot).
- Chakara's lowest-speed-conditioned buff autofill.
- Warding Screen persistent-stacking verification.
