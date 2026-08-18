# SP-4b-2a — simulateDPS synthesizes a real enemy + DPS display fixes

Plan: docs/superpowers/plans/2026-08-17-sp4b2a-dps-real-enemy-everywhere.md
Branch: feat/sp4b2a-dps-real-enemy-everywhere (base 7a2fb97e)

## Progress
Task 1: complete (commit 05b6841c, review clean — mutation-verified by the reviewer; also fixed 2 stale assertions in dpsRealEnemy.integration.test.ts, delta 0.2477)
Task 2: complete (commit 1a5b513e, review clean — mutation-verified; zero churn assessed as credible: this is the first coverage of the field on a real-enemy run)
  CARRY to final review (Important, non-blocking): the `Math.max(0, …)` clamp on the Direct subtraction could absorb a large negative remainder (a genuine double-count) on paths the fixture does not exercise — detonation-only rounds, the Protection-redirect exclusion. Consider a detonation-round assertion.
Task 3: complete (commit e8eb9342, review clean — reviewer independently grep-audited the one-write/one-read claim and mutation-verified the tests)
  CARRY (Minor): the team-side `td.secondary`/`td.conditional` write is DEAD — rawTotals is FOCUS-only by design (engine.ts:9994). The lift is correct for team-symmetry but has no observable effect there, and the new comment at ~8923 overclaims parity with the focus site. Fix the comment in the final wave.
  CARRY (Minor): task-3 report did not name dpsGoldenParity.test.ts.snap in its audit; reviewer checked it independently — its fixtures are damage-only so the fields are structurally 0 there. Zero-churn credible.
Task 4: complete (commit d4645033, review clean — reviewer spot-checked one mutation itself; fixture now at src/utils/calculators/__testutils__/dpsRealEnemyFixture.ts; ShipConfigSummary got one real-sim assertion)
Task 5: complete (commits dd8f9863 + fix wave 379c5b70 + 841e1bc0). Two Important findings raised and closed: assertion widening (now ratio form at precision 3, ~±12 damage) and NO automated guard on the page wiring (now DPSCalculatorPage.realEnemy.test.tsx drives both affinity selects and asserts what reaches simulateDPS; mutation-verified by the reviewer in one direction, the fixer in both).
  Measured during Task 5: the CRIT half of the matchup is NOT inert positionally — crit is decided once per cast from the attacker-fixed pre-resolved values (victimDamage.ts:125-130, engine.ts:695-696/731-733). No second defect.
  CARRY (Minor): ShipConfigCard affinity Select has no accessible name at all (pre-existing a11y gap); the new test queries it by data-testid, the only getByTestId-on-Select in that suite.
Task 6: complete (commits 071f2a33 + 0bd79e21, review APPROVED on opus + controller follow-up 9a8f0ade).
  Plan defect found by the implementer: Step 3 was INCOMPLETE — `hasRealEnemy`/`realEnemyIds` still read `input.enemyAttackers`, so the brief`s own tests could not pass. Fixed by one `effectiveEnemyAttackers` local threaded through every reader (reviewer confirmed: 3 remaining mentions = type decl, the const, the pass-through).
  Reviewer findings folded in (9a8f0ade): the synthesized enemy is NOT event-inert (takes a turn, emits a zero-damage ability-performed, shows in turn-order arrays) — comment corrected; REAL_ENEMY_ID now re-exports SYNTHESIZED_DPS_ENEMY_ID.
  SUITE IS RED BY DESIGN: 10 files / 61 tests. Task 7 must re-derive the cause per file — the inventory hypotheses are mechanically wrong on at least 3 files:
    - rhodiumChakaraDpsModeCredit: the proc DROPS entirely (mostBuffsAmong returns undefined against an unbuffed enemy; engine.ts:7766/7861). Buff the fixture enemy or escalate — NEVER re-pin to 0.
    - perHitCrit + dynamicSpeedExtraAction: event COUNTS moved because enemy-1 takes a turn. Filter on actorId, do not re-pin.
    - teamWalk Echoing Burst: detonationDamage reads 0 positionally — vanishing-channel class, investigate.
  CARRY (Minor): explicit `[]` is silently replaced by synthesis; 4b-2b should throw once a non-empty roster is mandatory.
Task 7a (wave A, 8 files): complete (commits e00f8d9c, d5617a1e). 18/20 tests repaired, ZERO assertions deleted/skipped/widened. Three mechanisms derived and measured against a worktree at 841e1bc0: M1 the dummy turn is now gone (dummyEnemyIsVestigial true) so fixtures filtering the id `enemy` must filter `attacker`; M2 enemy-1 ACTS (one zero-damage ability-performed/round) so event counts moved; M3 per-victim credit replaces scalar credit.
  TWO GENUINE ENGINE DEFECTS found and left red (verified independently by the controller in-source):
    D1 accumulate-detonate gathers 0 on ANY positional run (engine.ts:6582/9030 read roundDamage[*].direct, written only inside `if (!positional)` at :8682). Measured 30000 -> 0. LIVE IN PRODUCTION: page + battle sim are both positional, so Echoing Burst deals zero for every user.
    D2 reactive on-crit enemy-debuffs route to ctx.enemy.id (the dummy) while the cast hit enemy-1 (triggers.ts:2976 + engine.ts:7553). The on-cast control in the same file is correct. Known half-swept class — triggers.ts:2934-2940 fixed it for on-debuff-inflicted only.
  OWNER RULING 2026-08-17: fix BOTH in this PR. Briefs written: task-9-brief.md (D2), task-10-brief.md (D1).
Task 7a review: APPROVED (read-only review; reviewer re-ran all 8 files and confirmed 61 pass / 2 fail exactly as reported, verified teamWalk byte-identical, and audited every changed assertion line-by-line — the "nothing weakened" claim holds; the rhodium buffed-enemy repair judged a legitimate fixture fix, not a test-identity swap).
Tasks 11-16 (the six-defect sweep + snapshot): complete. D2/D4 e989d1c5+6f4da110 · D3/D5 01c0ca92+74b33867 · D1/D6 63033996 · review fixes 8c288379/690171f2/1bf157f7/8c85789c · corrosion anomaly ADJUDICATED NOT A DEFECT (51812f97: a victim killed inside the turn walk is continued before its DoT-tick prologue; the old numbers came from the dummy deferring HP to post-round) · snapshot regenerated + audited 03334d2d (1160 moved lines, 0 unclassified).
BRANCH GREEN: 524 files / 5821 tests, tsc 0, lint 0, oracle 2/146/13-13-13.
Browser verification (controller, on /damage + /healing, dev server npm start):
  Direct row: "Direct: 8,706" (was 0) with NO decimal tail; Total: 113,172 clean integer. Default run Avg 8,706 / Total 174,111 / survived 65.2% — unchanged from the pre-PR baseline, as intended.
  Affinity: Chemical vs Antimatter correctly stays neutral (affinityUtils.ts:16 — antimatter on either side is neutral); Chemical vs ELECTRIC now shows "Advantage" and moves Avg 8,706 -> 10,882 (x1.2499) and Total 174,111 -> 217,638, HP left 65.2% -> 56.5%. Pre-PR that dropdown moved nothing.
  /healing renders. No console errors on either page.

PR OPENED: #325 https://github.com/TheSusort/starborne-frontiers-calculator/pull/325 (31 commits, 34 files, +6135/-765).
Final whole-branch review (opus): READY WITH FOLLOW-UPS, no Critical. Fix wave b9f03f08/f6014259/ec00ed3e/e15d1c2a + changelog accuracy 5b9b6d0f.
OPEN FOLLOW-UPS (recorded in code, not just here): (a) the D6 passive-slot instance procs NO leeches in either direction — pre-positional it did, via creditDamage direct -> procStandingLeeches; corpus-bounded (needs Snakeroot/Provider + a leech carrier). (b) a cast with no firing-slot damage ability never enters the positional branch, so its passive instance is still lost. (c) explicit `enemyAttackers: []` is silently synthesized — 4b-2b should throw. (d) D4 has no enemy-side assertion (production IS symmetric; the __enemy__ bucket being side-wide is a separate pre-existing leak worth its own look).
