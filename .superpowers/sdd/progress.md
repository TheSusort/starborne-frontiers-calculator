# SP-4b-2b — a non-empty enemy roster becomes the engine's contract

Spec: docs/superpowers/specs/2026-08-17-sp4b2b-enemy-roster-required-design.md
Plan: docs/superpowers/plans/2026-08-17-sp4b2b-enemy-roster-required.md
Branch: feat/sp4b2b-enemy-roster-required (base 39d463f1)
Prior sub-project's ledger: progress-sp4b2a-archived.md

## Owner rulings (2026-08-17)
- ONE PR, ~115 files, NO CodeRabbit review — accepted knowingly (3rd time this epic).
  Consequence: the internal review is the only review, so the golden audit is a first-class task.
- A zero-enemy healing run is a LEGITIMATE scenario and ships in this PR: the adapter synthesizes
  an inert practice target and the page's floor-at-one comes off.
- Practice target = the page's default enemy card with attack 0 and no skills (defence 5000,
  HP 40000, security 100). Recommended by the spec; owner did not pick an alternative.

## Measured at 39d463f1 (do not re-derive)
- The type flip touches 115 files / 145 errors, NOT the 18 on record. 111 are TS2322 from the
  `(overrides): CombatEngineInput => ({...})` base-factory idiom; only 25 are genuinely missing.
- Exactly 20 files pass no enemyAttackers at all.
- All 3 production callers are already safe to throw at (battleSimulator.ts:829 throws on an empty
  enemyTeam; dpsSimulator synthesizes since 4b-2a; the healing page floors at one).
- 3 test callers pass simulateHealing({enemies: []}): dpsSubAttackEvents.integration,
  healingEngineAdapter.test, healingGoldenParity.
- The healing adapter has exactly FOUR code readers of `enemies` (:503,:504,:505,:507).
- The single legacyVictim fallback site is engine.ts:7027-7028; player-side legacyVictim is the
  dummy (:6761), enemy-side is the healTarget (:6775) — a real actor, NOT a dummy credit.

## Progress
(nothing yet)
