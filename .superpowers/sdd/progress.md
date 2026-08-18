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
Task 1: complete (commit 4104adbc, review APPROVED — 118 files, 231 insertions; full suite 525 files
  / 5828 tests green, ZERO .snap movement; reviewer independently verified first-property placement
  across every multi-insertion file and reconciled the 4 deletions exactly).
  ⭐ LESSON from the implementer: `cp -r node_modules` into a probe worktree DEREFERENCES the
  .bin/tsc symlink, so tsc appears to run and reports 0 errors — a FALSE GOOD that would have
  validated any codemod. Use `cp -a`. The implementer caught it itself and re-verified from scratch.
  Also: making the field required produced 3 legitimate no-unnecessary-type-assertion lint errors
  (redundant `!` on .enemyAttackers) in normalizeRoster.test.ts (2) + onCritDebuffRouting (1);
  removed, compile-time-only, confirmed absent pre-codemod via git stash.
  MINOR carried to final review: (i) scripts/sp4b2b-require-enemy-roster.mjs:41-53 treats "no error
  lines" as "converged" with no proof tsc ran — the very false-good above; add a sanity check or
  delete the script post-merge. (ii) Comments in ~3 fixtures still say "no enemyAttackers" directly
  above a literal that now sets `[]` (rhodiumChakaraDpsModeCredit:227, adjacentEnemiesDot:325-326,
  demolisherBombSplash:1143) — these get falsified AGAIN by Tasks 4-6, so sweep them in Task 8.

Task 2: COMPLETE. Golden audit below was recorded BEFORE any regeneration (brief Step 9).
  Full report: task-2-report.md. tsc 0 / eslint 0 / full suite 527 files / 5832 tests green (baseline
  525/5828 + the 2 new suites). Exactly ONE .snap file moved, the audited one.
  ⭐ TWO EXTRA floor tests the brief did not list also pinned the old contract and failed:
  HealingCalculatorPage.test.tsx:126 and EnemyAttackersPanel.test.tsx:199 (plus the canRemove prop
  doc at EnemyAttackersPanel.tsx:62). LESSON: a behaviour reversal's blast radius is every test that
  pinned the OLD contract, and a brief's file list is scoped to the change, not to its pins — sweep
  for the claim's own words (`floored at one`, `last enemy`, `cannot be removed`) before believing
  the list is complete. Also: the brief's own sample test did not COMPILE (heal config is
  {pct,basis}, not {multiplier}; `security` is not on HealerStats) and its third test was VACUOUS
  (a pure-hp heal cannot observe the defence basis it claimed to pin) — 4th time this epic that a
  plan's sample code could not have passed.

### Four-reader verification (brief item 1)
Verified independently against the file, not taken on trust. `grep -n '\benemies\b'` over the WHOLE
adapter (not just >325) before the edit returned exactly four CODE readers — :503, :504, :505, :507 —
plus the interface field (:119), the destructure (:331) and 7 comment lines. The brief's list was
correct. After the edit the same scan (excluding `effectiveEnemies`) returns ONLY comments + the
interface field + the destructure: zero surviving code readers.

### The three `enemies: []` fixtures — audit
Method: every move was decomposed by PROBE before regenerating, and each candidate mechanism was
ISOLATED by running the same scenario with an EXPLICIT enemy at (a) the sink's exact stats
(defence 10,000 / hp 1,000,000) and (b) the practice target's stats, on BOTH the modified and the
UNMODIFIED adapter. My change is provably a no-op for any non-empty roster (identical numbers on
both adapters for every explicit-enemy probe), so anything that reproduces at sink stats on the
unmodified adapter is pre-existing.

Cast damage moves purely with defence: 1289.708 (def 10,000) -> 2082.797 (def 5,000), ×1.615.

| Fixture | Assertion | Old | New | Mechanism |
|---|---|---|---|---|
| healingGoldenParity sc 9 (Magnolia) snapshot | r1 directHeal / round | 1258 | 417 | THREE stacked: (a) defence 10,000->5,000 lifts the 20% cast leech 258->417; (b) the inferno-tick leech 1000->0 — PRE-EXISTING, see below; (c) rounds 7-10 -> 0, the practice target is KILLABLE and dies in round 6 (2082.8 cast + 5000 inferno = 7082.8/round vs hp 40,000) |
| healingGoldenParity sc 9 in-code | `rounds[0].directHeal` | 1258 | 417 | same; re-derived by hand as 0.2 × 2082.797 = 416.56 -> 417 (cast leech only) |
| healingGoldenParity sc 9 summary | totalDirectHeal | 12579 | 2499 | same three (417 × 6 surviving rounds) |
| healingGoldenParity sc 10 (Tithonus/Pallas) | directHeal / round | 181 | 292 | DEFENCE ONLY. 7% rider per recipient: 0.07×1289.708=90 -> 0.07×2082.797=146, ×2 recipients. Enemy survives all 10 rounds (no DoT, 40,000/2082.8 = 19.2 rounds), so no killable component |
| healingGoldenParity sc 10 summary | totalDirectHeal | 1806 | 2916 | same |
| healingGoldenParity sc 11 (Valkyrie) | totalDirectHeal | 129 | 0 | PRE-EXISTING, not my stats — see below |
| healingGoldenParity sc 13 (Defiant) | snapshot | `perTargetDealt` absent | populated | FIELD PRESENCE ONLY, zero value movement. The per-victim positional apply now runs because there IS a positioned victim; the dummy is position-less so it never appeared in this map |
| dpsSubAttackEvents `on-crit repairs off THIS sub-attack's damage` | `performed).toHaveLength(3)` | 3 | 4 | The practice target takes its own turn and emits one `ability-performed` with `damage: 0` (probed: `[attacker×3 @8331.187302073396, practice-target @0]`). The focus's three sub-attacks are BYTE-IDENTICAL. Fixed by SHARPENING the assertion to focus-actor events — NOT by re-pinning 3->4, which would have made the count mean "however many actors happen to exist" |

`healingEngineAdapter.test.ts` needed NO change: all 33 tests pass unmodified, including
`empty enemies: no intake, targetHpPct stays 100` (the practice target has attack 0, so there is
still no intake). The brief predicted this file would move; it did not.

### ⚠️ TWO PRE-EXISTING DEFECTS EXPOSED (not introduced here, NOT fixed here)
Same class, and the two regenerated goldens were the LAST tests observing the working path:

  **A `basis:'damage-dealt'` standing leech with a non-direct `leechScope` pays out ZERO against a
  real positioned enemy, and always has. Only the dummy path ever credited it.**

  - `leechScope:'all'` (sc 9, Magnolia): the inferno tick DOES land on the real enemy —
    `perTargetDealt` round 1 = 6289.708 = cast 1289.708 + inferno 5,000 — but the 20% leech pays only
    on the cast (258), never on the 5,000 tick. Proved pre-existing: explicit enemy at sink stats on
    the UNMODIFIED adapter also yields 258/round, never 1258.
  - `leechScope:'detonation'` (sc 11, Valkyrie): directHeal is `[0,0,0,0]` for an explicit enemy at
    the sink's EXACT stats on the UNMODIFIED adapter, and identical at the practice target's stats.
    The 129 existed ONLY on the dummy path.

  This is SP-4b-2a's lesson in MIRROR IMAGE: there, production migrated ahead of its corpus and
  banked latent regressions. Here the corpus was the last holdout still exercising a path production
  abandoned in SP-3 — so the gap has been live in production since SP-3 for every real-enemy run.
  Regenerating these goldens is correct (they now record what every production run actually does) but
  it DELETES the last observer, which is why it is written down here. Needs its own task; it is a
  leech-attribution gap on the positional path, not a dummy-removal blocker.

### Incidental finding — corrects the brief's Step 4 rationale
The brief's practice-target comment says corrosion scales with "the victim's max HP
(`min(enemyHp, 500_000)`)", implying the practice target's HP feeds it TODAY. It does — this claim
was re-checked and reversed after Task 2's own review: `engine.ts:1054`'s `args.enemyHp` is fed
`recipientMaxHp(actor.id)` at the per-victim positional DoT-tick branch (`engine.ts:8741`, comment
"Corrosion scales with the AFFLICTED ship's own max HP"), which is the ONLY site that calls
`creditDealt(sourceId, actor.id, dealt)` for a DoT tick (`engine.ts:8806`) — i.e. the site that
populates the `perTargetDealt` entry Task 2's own fixture asserts on. The practice target sits in
`baseHpById` via `enemyAttackerActors` (`engine.ts:2753-2758`), so it runs this branch, not the
fight-wide scalar. The bare `enemyHp` scalar (`LEGACY_SINK_HP`) only reaches `tickDoTs` through the
vestigial `actor.id === enemy.id` dummy branch (`engine.ts:9450`), which the practice target never
takes. Confirmed empirically: the inferno tick is 5,000 against both a 1,000,000-HP and a
40,000-HP victim (inferno scales off the APPLIER's attack, `engine.ts:1065`, not HP), while
corrosion against the 40,000-HP practice target ticks at the practice target's own basis today, not
the sink's 1,000,000. (Detonation also already reads the real victim: `detonation.ts:106`
`min(c.victimHp, 500_000)`.) Consequence: inflating the practice target's HP to make it immortal
would NOT be free — it would immediately multiply every corrosion tick against it by the same
ratio (e.g. 40,000 -> 500,000 is 12.5x). The comment in the code is kept re-tensed to the present
rather than SP-4d-forward-looking, per this correction.
Task 2: complete (commits 70234483 + fix wave 21120626, review APPROVED then fix RE-REVIEWED clean).
  527 files / 5832 tests; tsc 0; eslint 0; exactly ONE .snap moved (the audited one).
  ⭐ The brief's own third test was VACUOUS as written — a pure-`basis:'hp'` heal cannot observe the
  defence basis it existed to pin, so it would have passed with the practice target at defence 0,
  exactly the drift it guards. Rewritten with a damage-dealt rider + an anti-vacuity guard; the
  reviewer mutation-verified it BOTH ways (practice defence -> 0 fails the equality; the shared
  constant -> 0 fails the guard). FOURTH plan in this epic whose sample code could not pass.
  ⭐ A subagent CONTRADICTED recorded epic knowledge and was WRONG: it inferred corrosion's HP basis
  from an INFERNO measurement (inferno is attack-scaled, so it proves nothing about corrosion) and
  wrote 3 comments claiming corrosion reads the fight-wide scalar. Truth: engine.ts:8741 passes
  `enemyHp: recipientMaxHp(actor.id)` in the per-victim positional tick branch — the branch a
  positioned enemy actually runs; the fight-wide scalar reaches tickDoTs only at :9450 inside the
  `actor.id === enemy.id` dummy branch. Both reviewers verified in source. Fixed in 21120626.
  ⭐ A behaviour REVERSAL's blast radius is every test that pinned the old contract: un-flooring the
  roster failed 2 tests the brief never listed (HealingCalculatorPage.test.tsx:126,
  EnemyAttackersPanel.test.tsx:199). Sweeping for the claim's OWN WORDS found them.
  Also: the falsified UNRELEASED changelog entry was SPLIT, not left contradicting the new one —
  shipping both would have put a contradiction inside one release's notes.
  MINOR carried to final review: (iii) the two exposed leech gaps have no tripwire on the sc-11 side
  (sc-9 keeps a positive guard); (iv) HealingCalculatorPage.zeroEnemies.test.tsx duplicates ~20 lines
  of its sibling's vi.mock block (vi.mock hoisting makes sharing awkward).
OWNER RULING 2026-08-17: fix the production-reachable `leechScope:'all'` half in THIS PR (Task 2b);
  tripwire the corpus-unreachable `'detonation'` half. Brief: task-2b-brief.md.
Task 2b: complete (commit d4dba512 + fix wave 8ec848ba/90855a6b; review "needs fixes" -> fixes
  RE-REVIEWED clean). 528 files / 5837 tests; tsc 0; eslint 0.
  Fix = ONE call, `procStandingLeechesPerVictim(sourceId, damage)`, in the positional per-victim
  DoT-tick credit callback. Deliberately NOT `creditDamage`: that would also write
  `dmg(sourceId)[dotType]` (double-feeding the scalar DoT channel the branch avoids) AND resolves its
  owner from the PLAYER-ONLY `runtimesById`, which would have shipped a one-directional fix.
  ⭐ THE STRONGEST FORM OF BLAST-RADIUS EVIDENCE: exactly one golden scenario moved
  (healingGoldenParity sc-9, directHeal 417 -> 1417/round) and it ROUND-TRIPS to its PRE-EPIC value
  measured in a worktree at 39d463f1 (1258 = cast 258 + inferno 1000), with perTargetDealt
  byte-identical there. A restored number beats an explained number.
  ⭐ A TRIPWIRE CAN RECORD A FALSE MECHANISM AND STILL PASS. The detonation tripwire blamed the
  `scope==='detonation'` guard; truth is `applyPositionedTimedBurst` (engine.ts:6923-6944) reaches
  NEITHER leech proc, so deleting that guard would have left the test green and its claimed
  sensitivity was fiction. Worse, the false diagnosis HID a third instance: an `'all'`-scope leech
  (Magnolia, Leech gear set — production-reachable) also pays ZERO on a positional burst.
  ⭐ THE LEECH GAP IS A 3-INSTANCE CLASS: (1) DoT tick FIXED here; (2) detonation burst — no proc at
  all, reachable via `'all'` scope; (3) heal-target DoT tick (engine.ts:8670-8672 discards the
  applier), reachable and the likeliest victim on both surfaces.
  OWNER RULING 2026-08-17: instances 2+3 get a DEDICATED FOLLOW-UP PR that sweeps the class — small
  enough to actually earn a CodeRabbit review, and a class is better swept than patched per
  discovery. This PR ships instance 1 fixed + 2/3 documented with ACCURATE mechanisms + tripwired.
  MINOR carried to Task 8's sweep: (v) the fix wave's own new comment in positionalDotLeech.test.ts
  cites BASE-commit line numbers (3992/8808/9085/9364/10168), stale by ~13 lines because the SAME
  commit's other edits shifted the file (+4 then -17). Recompute after a same-commit line-count edit.

Task 3: COMPLETE. The guard (verbatim from the brief) + the two dead branches deleted + the stale
  field doc rewritten. Full report: task-3-report.md. RED BY DESIGN: 528 files / 5838 tests, 464
  files / 5585 tests GREEN, **64 files / 253 tests RED** — all with the new throw. tsc 0, eslint 0,
  zero `.snap` movement (none of the 64 touch a snapshot).
  ⭐ THE "~20 FILES" ESTIMATE WAS MEASURED AT THE WRONG COMMIT FOR THIS QUESTION. Progress.md's own
  "Measured at 39d463f1" section already says "Exactly 20 files pass no `enemyAttackers` at all" —
  but that count is PRE-Task-1: it counts fixtures that omitted the field entirely, back when it was
  optional. Task 1 (4104adbc) mechanically added `enemyAttackers: []` to 148 call sites across 118
  files purely to satisfy the newly-required TS field — which is exactly the population Task 3's
  runtime guard now catches. 20 was never wrong, it was answering a different (pre-Task-1) question;
  64 is the real number on this branch, post-Task-1/2. Tasks 4-6 should plan around 64, not 20.

## Task 3 inventory
Guard message (verbatim, greppable): `enemyAttackers is empty`. Produced by
`npx vitest run` on this branch (commit adding the guard, pre-`--no-verify` commit). 64 files /
253 tests fail. 249 tests across 61 files fail with the exact contract message. **4 tests across 3
files fail for a DIFFERENT reason — a `TypeError`, not the contract — and are diagnosed below rather
than folded into the 249.**

### (a) Fail with the contract message — 61 files / 249 tests
| File | Failing tests | Contract | Other |
|---|---|---|---|
| `src/utils/calculators/__tests__/rhodiumChakaraDpsModeCredit.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/accumulatorGather.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/actorStats.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/adjacentEnemiesDebuff.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/adjacentEnemiesDot.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/allyDebuffReactivePromotion.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/apexSelfShieldGate.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/applyOutgoingToEnemy.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/blockBuff.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/bombDetonatedVictimId.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/bombModifierExclusion.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/bombSplashOnDeath.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/buffDurationOwnTurnReprieve.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/buffOnlyTeamWalk.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/chargedOverdrive.integration.test.ts` | 5 | 5 | 0 |
| `src/utils/combat/__tests__/corrosionToAcidicDecay.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/damageChannelAccounting.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/deathFallback.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/decrementUnification.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/demolisherBombSplash.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/destroyedRoundUnification.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/enemiesHitGate.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/enemyBuffSelfDebuffGate.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/enemyDotCountGate.integration.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/engine.events.test.ts` | 36 | 36 | 0 |
| `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` | 18 | 18 | 0 |
| `src/utils/combat/__tests__/forcedAffinityReciprocalGate.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/gearSetDotPair.integration.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/healing.test.ts` | 39 | 39 | 0 |
| `src/utils/combat/__tests__/healingPerRecipientApply.test.ts` | 6 | 6 | 0 |
| `src/utils/combat/__tests__/healingPerRecipientAxis.test.ts` | 5 | 5 | 0 |
| `src/utils/combat/__tests__/hpCrossing.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/indestructibleDeath.test.ts` | 6 | 6 | 0 |
| `src/utils/combat/__tests__/leech.test.ts` | 8 | 8 | 0 |
| `src/utils/combat/__tests__/lowestSpeedAlly.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/multiEnemyDotStateReporting.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/outDetonationDamageUpBuff.integration.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/outgoingAmplificationEngine.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/overloadLifecycle.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/ownCleanseReactivePromotion.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/perActorIncomingSurface.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/perActorShield.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/perVictimDotTick.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/perVictimPlayerTimedDetonation.integration.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/perVictimTimedDetonation.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/preFightModifiersEngine.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/procChanceGate.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/purgeConditionalSources.test.ts` | 2 | 2 | 0 |
| `src/utils/combat/__tests__/reactiveShieldRouting.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/runModeEquivalence.test.ts` | 6 | 6 | 0 |
| `src/utils/combat/__tests__/shieldAppliedEvent.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/shieldGrantBattleSim.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/shieldPenetration.test.ts` | 4 | 4 | 0 |
| `src/utils/combat/__tests__/statVsTargetGate.integration.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/teamAuraDistribution.integration.test.ts` | 3 | 3 | 0 |
| `src/utils/combat/__tests__/triggers.test.ts` | 23 | 23 | 0 |
| `src/utils/combat/__tests__/victimEnemyModifiers.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/wave7WardenDebuffInflicted.integration.test.ts` | 1 | 1 | 0 |
| `src/utils/combat/__tests__/wildfireTeamAuraCritPower.integration.test.ts` | 1 | 1 | 0 |

### (b) Fail for a DIFFERENT reason — 3 files / 4 tests, all the SAME root cause
All four are `TypeError: Cannot read properties of undefined (reading 'length')` thrown from
`normalizeRoster.ts:98` (`input.enemyAttackers.length`), NOT the contract `Error`. Root cause: these
fixtures don't pass `enemyAttackers: []` — they omit the key entirely (or explicitly set it to
`undefined`) and paper over the missing required field with an `as CombatEngineInput` cast, so
`input.enemyAttackers` is `undefined` at runtime and `.length` throws before the guard's own message
can form. Per the brief's Step 3 code (verbatim, not to be embellished), the guard only checks
`.length === 0`, so it does not defend against `undefined`. Same population, different crash shape —
still fixtures secretly running without an opponent, and Tasks 4-6 fix them the same way (give them a
real enemy); they'll just see a `TypeError` instead of the contract message until then.

| File | Test | Cause |
|---|---|---|
| `src/utils/combat/__tests__/normalizeRoster.test.ts` | "leaves an empty enemy roster empty — it never invents an enemy" (line 93-96) | Calls `normalizeCombatRoster(baseInput())` where `baseInput()`'s factory never sets `enemyAttackers` at all; the test's own premise (the boundary tolerates and preserves an empty roster) is exactly what SP-4b-2b reverses — the test itself is now testing the OLD contract |
| `src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts` | "REGRESSION: a NON-positional walked-team detonate still surfaces detonationDamage via the legacy aggregate path" (line 331) | Sets `enemyAttackers: undefined` explicitly, with an inline comment "the lone enemy is the dummy sink (no enemyAttackers)" — deliberately invoking the dummy fallback this epic is deleting |
| `src/utils/combat/__tests__/shieldBasisSecondaryDamage.integration.test.ts` | both tests in "PR9a: shield-basis additional damage reads the LIVE caster shieldPool at cast time" (lines 110, 133) | `runCombat({ ...CLEAN_MATH, ... } as CombatEngineInput)` never sets `enemyAttackers`; the cast hides the missing required field from `tsc` |

### Production-safety check (brief item 4)
All 64 files are test files under `__tests__/`. None is `battleSimulator.ts`, `dpsSimulator.ts`, or
`healingEngineAdapter.ts` — confirmed by grep. No production path hits the new throw:
`battleSimulator.ts:830` already throws its own `enemyTeam is empty` before reaching the engine;
`dpsSimulator.ts:500-502` synthesizes `effectiveEnemyAttackers` when the UI-facing input omits one;
`healingEngineAdapter.ts:634` always passes `engineEnemyAttackers`, which Task 2 populates with the
practice target when the caller supplies no real enemy.
Task 3: complete (commits 9cfd4c1e/50fd1759 + guard fix 745b9559; review "needs fixes" -> fixed).
  Guard lives at the ONE boundary; message `enemyAttackers is empty` is greppable and load-bearing.
  ⭐ THE INVENTORY IS 64 FILES / 253 TESTS, NOT ~20. The 20-file figure counted files that never
  mention enemyAttackers ANYWHERE; Task 1's 148 insertions across 118 files exposed every CALL SITE
  that used a base literal without overriding it. The throw-as-classifier is what surfaced the real
  population — the plan's original idea (infer it from moved goldens) would have understated it 3x.
  ⭐ AN `as CombatEngineInput` CAST DEFEATS A REQUIRED FIELD. 3 files/4 tests reached the boundary
  with the field UNDEFINED (not `[]`) behind a cast, so `input.enemyAttackers.length` threw a bare
  TypeError one line before the named error could form — a validation guard silently non-uniform over
  its own population. Fix: `!input.enemyAttackers?.length`. Now 253/253 carry the one signature.
  A required field is a compile-time claim; the runtime guard must still handle undefined.
  Waves restructured (deea2c25) into A-E balanced by TEST count, explicit file lists, all 64
  verified present exactly once. Waves A-D end RED (husky needs --no-verify); wave E ends GREEN.
Task 4 (wave A): complete (commit 94b14d4e + fix wave 5becf538; review APPROVED). healing.test.ts
  73/73, engine.events.test.ts 42/42 (115 total; the "39+36=75" was the FAILING subset).
  ⭐ THE INERTNESS CLAIM IS NOW EMPIRICALLY STRONG: healing.test.ts took a ONE-LINE roster change and
  moved ZERO assertion values across 73 tests — including hand-computed timelines at 6 decimals, with
  a live enemy on the board. The reviewer confirmed no numeric expectation appears anywhere in that
  file's diff. Independent confirmation of "a 0-attack positioned enemy is RNG-stream-inert".
  ⭐ BUT THE RECIPE WAS INCOMPLETE, AND WAVE A IS WHERE WE WANTED TO LEARN THAT (2 files, not 60):
  six roster insertion points in one file (3 inline literals a factory search misses) + three NEW
  mechanisms (M5 affinity re-derivation — the highest-yield grep; M6 dummy scalars inert; M7 scheduled
  enemyDebuffs decrement at the round boundary) + `bareEnemy()`'s 500k HP is NOT survival (it died in
  round 4 of 6). All folded into the plan (be134b6f) with a hard gate: a scan for `enemyAttackers: []`
  must return nothing. damageChannelAccounting moved C -> E (premise evaporated, not mechanical).
  ⭐ TWO `expected 0 to be greater than 0` FAILURES, NEITHER CHURN — the exact shape that invites the
  forbidden toBe(0). Both were premise failures with real causes (M5; detonate-only). The reviewer
  re-derived both causes in affinityUtils.ts rather than trusting the report.
  ⭐ VERIFIED FALSE ALARM: the escalated "detonate-only cast drops its detonation" (measured
  10,800 -> 0) is a REAL engine gap but CORPUS-UNREACHABLE. Full scan of 147 ships: only Crocus,
  Demolisher, Incinerator take the DOT_DETONATE_RE path and all three carry damage in the same clause;
  Lingshe's charged skill parses to `bomb-countdown-reduce` (skillTextParser.ts:4523) and resolves
  damage in reduceBombsOnVictim from the cast's own footprint, never touching detonationTargets.
  LESSON: I relayed that escalation to the owner as possibly-production-live BEFORE verifying it. A
  subagent's reachability claim is a hypothesis; the corpus CSV settles it in one scan.
  ⭐ A VACUITY FIX NEEDS A DEMONSTRATED RED STATE. The bomb burst test summed ALL `bomb-detonated`
  events, and bombs also detonate on EXPIRY — so it had been passing without the skill path firing at
  all, and would have stayed green if that path regressed to zero. Fixed + proven by stubbing
  applyPerVictimDetonation to resolve no victim (went red), then reverting (42/42).
  ALSO OPEN for SP-4c: after the opposing roster is WIPED, a cast lands back on the dummy with the
  dummy's enemyDefense folded (measured 45,000 -> 14,820.90) — contradicting engine.ts's stated intent
  that the cast "whiffs against corpses rather than teleporting onto the dummy". 4c's deletion is NOT
  a pure no-op. No assertion is pinned to that path (the death was removed by raising HP).
  ⚠️ CORRECTED by the Task 8 final review (the two lines above are kept as history; "kept crediting"
  was WRONG). Post-wipe the fallback is CONSULTED and the `ability-performed` event PAYLOAD carries a
  dummy-defence-folded number, but NO channel and no HP is touched. Re-measured (focus attack 100k,
  one 50k-HP positioned enemy killed in round 1, enemyDefense 8000, 4 rounds):
      ability-performed  R1 100000 · R2/R3/R4 30549.08935443992
      rounds             R1 {direct:0, cum:0, ptd:{attacker:{e1:100000}}} · R2-R4 ptd ABSENT
      rawTotals          all zero · counters {consulted: 3, credited: 0}
  30549.089 is byte-identical to what the SAME fixture reports every round when the roster is a
  pressure source (hp:0, non-positional, everything drains the dummy) — so the magnitude really is
  folded against the dummy's defence. But `directDamage`, `cumulativeDamage`, `perTargetDealt` and
  `rawTotals` are all untouched, and the dummy's HP never declines, so `__getDummySinkCreditCount()`
  stays 0. The branch's own code already said so: `dummyReachability.test.ts`'s CORPSE TARGETING case
  pins `consulted: 2, credited: 0`, and `healingGoldenParity` scenario 9's rounds 7-10 read all-zero
  with `perTargetDealt` absent once the practice target dies.
  SO: "4c's deletion is not a pure no-op" SURVIVES but NARROWS to an event-payload value. 4c should
  plan a LOG/EVENT-FIDELITY assertion (the post-wipe `ability-performed.damage`), not an accounting
  migration — there is no accounting to migrate. This is the repo's own logged lesson in action:
  measure `deliveredDamage`, not `ability-performed.damage`.
Task 5 (wave B): complete (commit ec969d1d + fix wave 6c4def78; review APPROVED). triggers 137/137,
  equipmentAbilities 76/76. 38 of 41 failures fixed by 12 lines. Gate scan clean.
  ⭐ NEW CLASS — GREEN-BUT-VACUOUS: a repaired file can pass on `0 === 0` because both arms'
  rawTotals.direct are 0 positionally. So FAILURES ARE NOT THE WHOLE JOB; every wave must also scan
  equality assertions on rawTotals.direct/directDamage/cumulativeDamage.
  ⭐ M10: the reactive DRAIN-time hp-threshold gate with hpSubject !== 'self' is dead positionally
  (buildDrainContext derives enemyHpPct from cumulativeDamage/enemyHp, both dummy scalars; measured
  cum=0 at every drain). The review CORRECTED the record twice: the dead predicate includes the
  UNDEFINED hpSubject case (evaluateConditions.ts:254-258), so a follow-up scoped to
  hpSubject:'enemy' would UNDER-FIX; and Judge's condition comes from parseHpThresholdCondition
  (buildShipAbilities.ts:1627-1637, no hpSubject field), NOT hpThresholdFromSentence — a
  misattribution INHERITED from the engine comment at :1670-1672.
  ⭐⭐ AND IT IS A LIVE DEFECT, not just a trap: corpus-unreachable from parsed skill text, but the
  in-app ability EDITOR authors exactly this shape (ConditionRow.tsx:182-193 offers "Whose HP" ->
  enemy; AbilityCard.tsx:964-965 offers reactive triggers; feeds config.shipSkills into the DPS calc).
  A user-authored on-crit reactive gated on "enemy below 50% HP" silently never fires.
  OWNER RULING 2026-08-17: M10 joins the leech follow-up PR. This PR carries the corrected record +
  a fail-loud tripwire (6c4def78, red-green proven by forcing enemyHpPct=10).
Task 6 (wave C): commit 2777e0d4 — 146/146 across 26 files, 32 insertion points, review PENDING.
  ⭐ THE LEGACY SINK IS STILL REACHABLE: resolvesPositionalVictim keys on MAX hp, so a 0-max-HP
  "pressure source" roster still routes to the sink, byte-identical to pre-branch. Coverage that
  looked lost is preservable. Used for 4 wave-C fixtures, each marked for SP-4c.
  ⭐ Omitting target/pattern does NOT keep a run non-positional — withTargeting fills both.
Task 6b (wave D): commit d1c69e0b — 189/189 across 27 files, review PENDING.
  ⭐ M14 isPositional is a TAUTOLOGY below the boundary; M13 the pressure source does NOT make the
  dummy destructible/observable; M12 a bomb burst emits no dot-detonated positionally (and a RATIO
  guard then yields NaN and can go green in the WRONG direction).
  ⭐ simulateDPS RE-FOLDS per-victim credit back into RoundData.directDamage, so directDamage
  assertions that go through simulateDPS are LIVE and must not be migrated. Entry point decides.
  ⭐ MY BRIEF PASSED WAVE C'S SPECULATIVE 'e1' COLLISION LIST ALONG AS FACT — wrong in BOTH
  directions. Controller lesson: label an unverified hand-off as unverified.
  OPEN FOR OWNER (non-blocking, fixture records both ways): hpCrossing's "crossing trigger is dormant
  in DPS mode" premise is FALSE — it was masked by the fixture having no attacker. Under real damage a
  DPS-mode focus emits hp-changed, crosses 40%, and DOES grant Reinforced (1 grant, round 1). Is that
  correct game behaviour?
Task 6 (wave C) review: NEEDS FIXES -> fixed f358ebd9. The Important: adjacentEnemiesDebuff/Dot still
  asserted the FALSE non-positional premise in comments + describe/it titles, so their "DPS invariance"
  blocks passed for the green-and-blind "a lone enemy has no neighbour" reason.
  ⭐ THE FIXER MEASURED BEFORE CHOOSING and took the honest route: the pressure source DID restore a
  non-positional landing, but it moved the recipient id BARE_ENEMY_ID -> the 'enemy' dummy sink, which
  would have required re-pinning an assertion. That is the "don't force it" signal, so it rewrote the
  comments/titles to the positional truth and DECLARED the non-positional coverage lost (needs a fresh
  fixture to restore). Also corrected indestructibleDeath's citation 5876 -> 9130 (the reactive-proc
  credit skip is not the direct-cast credit skip).
Task 6b (wave D) review: APPROVED, Minors only. ⭐ The review found the REPORT understated the code:
  one "throw-assertion conversion" was actually a positive RE-PIN to real new behaviour. Reports drift
  pessimistic as well as optimistic. It also reconstructed the frozen exact numbers ARITHMETICALLY
  (corrosion clamps at min(victimHp, 500_000), so both the old dummy 10M and the new roster 10M clamp
  to the same 500k) — stronger evidence than the measurement it could not re-run.
Task 6c (wave E): complete (commit 7db8c435; review APPROVED, Minors only).
  ⭐⭐ FULL SUITE GREEN: 528 files / 5842 tests, committed WITHOUT --no-verify (husky's full-suite hook
  passed). First green suite since the guard landed.
  Tool per file: Tool 1 (real enemy) runModeEquivalence + shieldBasisSecondaryDamage; Tool 2 (pressure
  source) dummyEnemyTurnGate + perVictimWalkedTeamDetonation; Tool 3 (throw) normalizeRoster,
  dummyReachability, damageChannelAccounting.
  ⭐ THE IMPLEMENTER VOLUNTEERED A REAL COVERAGE LOSS instead of hiding it: dummyReachability's
  inverted test WAS the liveness proof for __getLegacyVictimFallbackCount (the reason its sibling's
  toBe(0) is not vacuous), and a throw-assertion cannot read the counter. The reviewer then verified
  the feared compound failure did NOT occur — the replacement proof
  (damageChannelAccounting:374, toBe(ROUNDS)) sits in the MIRROR describe, untouched by this wave.
  TASK 7 MUST RE-HOME THAT LIVENESS PROOF.
  ⭐ runModeEquivalence: the ROSTER guard fires 600+ lines AHEAD of the mode guards (normalization at
  engine.ts:1785, mode guards at :2411/2428/2433), so all four mode-guard tests had been masked.
  ⭐ Dropping `as CombatEngineInput` for `satisfies` moves enforcement from a runtime guard to the
  COMPILER — better than the brief asked for.
  Minors for Task 8's sweep: perVictimWalkedTeamDetonation:349 stale inline comment (contradicts the
  corrected block comment 12 lines above); dummyEnemyTurnGate:9-12 header says "positioned" where the
  gate means TARGETABLE; damageChannelAccounting:142's 0-max-HP shape is now the SOLE carrier of the
  legacy arm of the player-side invariant (dies in SP-4c).
Task 7: complete (commit 2ba2f8bb; review APPROVED, Minors only). 528 files / 5850 tests (+8, this
  file 2 -> 10); tsc 0; eslint 0; ZERO .snap movement.
  ⭐ THE IMPLEMENTER CORRECTLY OVERRODE MY BRIEF'S INCREMENT SITE, and proved it with a MUTANT.
  `playerTurnBindings.applyToVictim` can never see the dummy (victims come only from
  enemyAttackerActors / opposingRoster; the dummy is built separately and is never a member), and a
  0-max-HP positive control makes resolvesPositionalVictim false so drivePositionalApply never runs at
  all. Symptom: positive control read 0 where it must read 2 while the negative control still held —
  exactly the "if only one of the two can be satisfied you are on the wrong site" test.
  REAL SITE: the round-tail vestigial-sink branch, keyed on the ROUND'S OWN delta, not the cumulative
  decline. The reviewer independently established it is EXACT: `enemy.currentHp` is assigned in exactly
  ONE place in engine.ts, from cumulativeDamage + cumulativeTeamDamage, whose only reachable mutations
  are that round's totals — so the guard fires iff the dummy's HP declined that round. One visit per
  round: no double-count, no miss. It also closed the three non-scalar leak routes (per-actor DoT tick
  gated `actor.id !== enemy.id`; applyPositionedTimedBurst early-returns for a position-less actor; the
  only applyVictimDamage(..., enemy, ...) calls sit inside the unreachable dpsEnemyTarget).
  ⭐ FOR SP-4c: `dpsEnemyTarget` IS ALREADY DEAD CODE — normalization throws on an empty/undefined
  roster on runCombat's first statement, so `enemyAttackerInputs.length === 0` can never hold. The
  enemyOutcome block, both applyVictimDamage(..., enemy, ...) calls and the round-tail reactive
  reconciliation are unreachable. Framing to keep: UNREACHABLE, not proven absent.
  ⭐ `perTargetDealt` records damage DEALT, not HP REMOVED — a 5,000-HP victim taking a 10,000 cast
  reads 10,000. The implementer's first draft asserted the clamped value and went red, which is itself
  evidence the assertion reads the real channel.

## Accumulated MINOR findings for Task 8's sweep / final-review triage
(i)    scripts/sp4b2b-require-enemy-roster.mjs treats "no error lines" as "tsc converged" with no proof
       tsc ran — the exact false-good that nearly validated a no-op codemod. One-shot script: DELETE it
       (the migration is recorded in commit 4104adbc + this ledger) or add a ran-check.
(ii)   ~3 fixtures still comment "no enemyAttackers" above a literal that now has a roster
       (rhodiumChakaraDpsModeCredit, adjacentEnemiesDot, demolisherBombSplash).
(iii)  healingGoldenParity sc-11 has no tripwire on the detonation-scope leech zero (sc-9 has a
       positive guard).
(iv)   HealingCalculatorPage.zeroEnemies.test.tsx duplicates ~20 lines of its sibling's vi.mock block.
(v)    positionalDotLeech.test.ts's comment cites BASE-commit line numbers, stale by ~13 lines because
       the same commit's other edits shifted the file. Recompute after a same-commit line-count edit.
(vi)   perVictimWalkedTeamDetonation:349 stale inline comment contradicts the corrected block comment
       12 lines above it.
(vii)  dummyEnemyTurnGate:9-12 header says "positioned enemies" where the gate means TARGETABLE.
(viii) preFightModifiersEngine:138's new control is near-vacuous (victimIncomingModifiers returns
       {0,0} for ANY unknown id, so it passes whether or not the roster entry exists).
(ix)   hpCrossing's new positive pins the grant in ROUND 1, the same round a phantom seed would appear;
       a round-2 crossing would make it self-discriminating.
(x)    indestructibleDeath's rawTotals-all-zero and enemyOutcome pins are on channels SP-4c deletes —
       flag for deletion with the dummy so they are not later mistaken for asserted intent.
(xi)   enemyBuffSelfDebuffGate's 12 directDamage assertions are live only because its `as
       EnemyAttacker` casts omit stats.hp — the same cast-hides-a-required-field class wave E fixed in
       shieldBasisSecondaryDamage. Worth its own ticket.
(xii)  dummyReachability header says "five paths" but enumerates SIX; and its "a zero means the dummy
       absorbed nothing" sentence should note the counter measures ROUNDS IN WHICH HP DECLINED via the
       scalar channel, since SP-4c will quote that sentence.
(xiii) bareAlly exposes unused hp/position knobs; PER_CAST is shared between two fixtures whose
       magnitudes coincide; the whiff-window case duplicates the corpse-targeting shape.
(xiv)  damageChannelAccounting:142's 0-max-HP shape is now the SOLE carrier of the legacy arm of the
       player-side invariant — and SP-4c removes that shape too.

## Task 8 — comment sweep, Minor triage, whole-branch gates (2026-08-18)

### Snapshot attribution gate — 494 moved lines, 0 unclassified

SCOPE, stated honestly: this repo has FIVE `.snap` files and only ONE moved
(`healingGoldenParity.test.ts.snap`). None of the five covers a direct `runCombat` fixture, so
"zero snapshot movement" would only ever have been load-bearing for the three PRODUCTION callers
(`simulateDPS` / `simulateHealing` / `simulateBattle`). The 64 direct-engine fixtures this PR
repaired are guarded by their own in-code assertions, not by goldens — which is exactly why the
five repair waves each had to argue magnitude preservation in prose.

`git diff --stat 39d463f1..HEAD -- '*.snap'` → 1 file, 299 insertions, 195 deletions.
`git diff 39d463f1..HEAD -- '*.snap' | grep -cE '^[+-][^+-]'` → **494**.

Two commits touched it: `70234483` (Task 2, the practice target) and `d4dba512` (Task 2b, the
positional DoT-tick standing leech). 2b's 90 lines are INTERNAL to the branch and cancel in the
cumulative diff — Task 2 alone drove Magnolia's inferno-tick leech term to 0 and 2b restored it to
1,000, so base..HEAD shows only the net.

| lines | scenario | mechanism |
| --- | --- | --- |
| 50 | Defiant (shield-on-Stasis) | **M-A** `perTargetDealt` newly PRESENT — the cast lands per-victim on the practice target instead of the scalar sink. Ten inserted 5-line blocks; NO healing value moved (no `damage-dealt` rider in this scenario). |
| 50 | Tithonus/Pallas | M-A, ten inserted blocks. |
| 30 | Magnolia | M-A, six inserted blocks (rounds 1-6 only — see M-D). |
| 17 | Valkyrie | M-A, inserted blocks + the rows that replaced a removed `perRecipient` opener. |
| 172 | Tithonus/Pallas | **M-B** rebase — the 7% all-allies rider now reads the practice target's defence 5,000, not the sink's 10,000. directHeal 181 → 292/round, overheal 90 → 146 per recipient, totals 1,806 → 2,916. |
| 91 | Magnolia | M-B rebase — cast leech 258 → 417 while the inferno term round-trips at 1,000: directHeal 1,258 → 1,417/round. |
| 55 | Magnolia | **M-D** the practice target is KILLABLE — 6 × 7,082.797 dealt exceeds its 40,000 HP, so it dies in round 6 and rounds 7-10 heal nothing. Verified in the new snapshot: directHeal `[1417 ×6, 0, 0, 0, 0]`, six `perTargetDealt` rows. The zero rounds drop `perRecipient`/`effectiveHealing`/`hotHeal` under the "absent when empty" convention. |
| 5 | Valkyrie | M-D, same convention on its zero rounds. |
| 24 | Valkyrie | **M-E** the known `leechScope:'detonation'` standing-leech gap surfaces as an all-zero scenario (129 → 0), documented at length on the fixture and tripwired in `positionalDotLeech.test.ts`. |
| **494** | | **classified 494 / 494 — UNCLASSIFIED 0** |

### Gates
- `npx tsc --noEmit` → exit 0.
- `npx eslint src` → exit 0.
- `npm test` → **528 files / 5853 tests passed** (5850 + 3 added this task: the preFight
  discriminator, the sc-11 tripwire, the hpCrossing round-2 twin).
- Placement-symmetry oracle (`npm run audit:placement-symmetry -- --seeds 15 --base-seed 20260805`)
  → shipsSwept 147, symmetricShips **146**, findings **2**, focus/team/enemy **13/13/13** distinct
  kinds and 0 ships observing nothing. Byte-identical to the pre-branch ledger, findings included
  (both Enforcer `debuff-resisted`, enemy→focus and enemy→team). NOT MOVED.
- `git status --short -- '*.snap'` → clean.

### WITHDRAWN — the earlier "browser finding" below was a harness artefact, not an engine property
An earlier version of this section reported a browser comparison (Direct Heal 478 with a real
enemy card vs. 483 with no enemies) and a crit-50 divergence (`[3332,1666,1666,1666]` total 8,331
vs. `[1666,3332,833,1666]` total 7,498), attributing both to the opponent's actor id feeding an
id-keyed per-victim RNG stream. That attribution does not survive a proper control. Re-running the
SAME config twice with no re-seed between runs reproduces the exact divergence shape
(`[1250,1250,1875,833]` then `[1250,1875,1250,833]`) with no roster change at all — the two
"different" runs were never independent draws, they were one continuous unseeded stream split in
two. Re-running with a re-seed (`setupKeyedTestRng`) before EACH run instead gives byte-identical
`totalDirectHeal` and per-round series at healer crit 0 (3332/3332), crit 50
(5207/5207, `[1250,1250,1875,833]` both ways) and crit 100 (7498/7498) — see
`healingPracticeTarget.test.ts`. No engine code is keyed by the opponent's id in the healer's own
draw sequence (every crit/landing/proc gate is owner-keyed, e.g.
`` makeRateGate(`${focusActorId}:active-crit`) `` at `engine.ts:2104`); that mechanism was never
real.

**Durable lesson:** a browser comparison of two nonzero-crit runs proves nothing on its own,
because production RNG is unseeded `Math.random` (`rateAccumulator.ts:11-14`, `17-18`, `39-40`) —
page-level output-equality claims can only be checked under a seeded harness, and even then the
control (same config, twice, with and without a re-seed between runs) is what distinguishes a real
divergence from stream continuation. This artefact was produced by a harness that never ran that
control. The adapter's paragraph claiming exact equality is CORRECT as originally written and has
been restored; `healingPracticeTarget.test.ts`'s exact-equality assertion needed no caveat and no
change.

### ⭐ HAND-OFF — `hitMitigation.ts`'s inertness argument no longer holds
Its "no production path reaches a SCHEDULED TIMED Hit Mitigation" rationale rested on
`enemyAttackers` distinguishing callers, which SP-4b-2a/2b ended: every caller now supplies a
roster. `simulateDPS` pairs a non-empty `selfBuffs` with `enemyAttackers` on every run and its
AUTO-FILLED picks carry `skillSource`/`skillDuration`, and Oleander is the one corpus ship whose
charge grants `Hit Mitigation` (for 3 turns). Whether the auto-fill actually produces the SCHEDULED
channel for it rather than the `applyTimedAbilityStatus` ability path is UNVERIFIED. The comment now
says so; the measurement is a ticket.

### Other hand-offs recorded in-file for SP-4c
- `indestructibleDeath.test.ts` — the all-zero `rawTotals` block and the `enemyOutcome` pin assert
  the ABSENCE of channels 4c deletes: DELETE them with the dummy, do not migrate.
- `damageChannelAccounting.integration.test.ts` — the 0-max-HP shape is now the SOLE carrier of the
  LEGACY arm of the §4B invariant, and 4c removes that shape too; delete the arm rather than keeping
  an artificial roster alive to feed it.
- `enemyBuffSelfDebuffGate.test.ts` — twelve `directDamage` assertions are live only because an
  `as EnemyAttacker` cast hides the required `stats.hp`; supplying it flips all twelve to the
  positional channel. Own ticket; prefer dropping the casts so `tsc` demands `hp`.
Task 8: complete (commit e840e85e + fix wave 1e05ae06; review "NEEDS FIXES" -> fixed).
  GATES: 494 moved .snap lines / 0 unclassified across 4 named mechanisms (M-A perTargetDealt now
  present 147; M-B rider rebase off defence 5,000 vs the sink's 10,000, 263; M-D the practice target is
  KILLABLE -> zero-heal rounds, 60; M-E the known detonation-scope leech gap as an all-zero scenario,
  24) — the reviewer re-derived the sum as 494 and confirmed each mechanism against the snapshot and
  the constants. SCOPE stated: only 5 .snap files exist and none covers a direct runCombat fixture, so
  the gate is load-bearing only for the 3 production callers.
  tsc 0 · eslint 0 · 528 files / 5853 tests · oracle 147 swept / 146 symmetric / 2 findings / 13-13-13
  with the ledger JSON BYTE-IDENTICAL before and after (stated as a COMPARISON, not a re-baseline) ·
  .snap status clean · browser-verified /healing at Enemy Team (0) and /damage, real numbers.
  ⭐⭐ THE MOST IMPORTANT LESSON OF THE WHOLE PR — A CONFIDENT SUBAGENT "FINDING" WAS FABRICATED BY A
  HARNESS BUG, AND THE REVIEWER KILLED IT WITH THE CONTROL THE AUTHOR NEVER RAN.
  Task 8 reported the PR's own design premise FALSE ("emptying the roster changes only incoming damage"
  -> "false for any healer with nonzero crit"), with two measured series and a named mechanism (the
  opponent's actor id feeding an id-keyed per-victim RNG stream). All of it was wrong:
   - Re-running WITH a re-seed before each run: IDENTICAL at crit 0 (3332/3332), 50 (5207/5207) and
     100 (7498/7498).
   - THE MISSING CONTROL: two runs of the SAME config with NO re-seed reproduce the identical
     permutation-shaped divergence. The "finding" was an un-re-seeded harness artefact.
   - The mechanism does not exist: every crit/landing/proc gate is OWNER-keyed
     (`makeRateGate(`${focusActorId}:active-crit`)`, engine.ts:2104), invariant across the two runs.
   - The browser numbers could never have supported it: keyedProvider is TEST-ONLY and production rng
     is plain Math.random (rateAccumulator.ts:17-18,39-40), so 478 vs 483 is unseeded variance with no
     same-config control.
  NET EFFECT IF UNCAUGHT: a TRUE claim weakened into a FALSE one in production source, contradicting
  the passing test that asserts the exact equality, plus a PHANTOM hand-off written into the tracked
  ledger for SP-4c to inherit. Withdrawn in 1e05ae06 (history kept, marked WITHDRAWN).
  ⭐ GENERALISE: before believing "X differs from Y", run X-vs-X. A comparison harness without a
  same-input control cannot distinguish a real difference from its own nondeterminism. And a
  page-level equality claim is uncheckable in production here at all, because production is unseeded.
  ⭐ Also falsified by this task (kept as UNCONFIRMED, ticketed): hitMitigation.ts's inertness argument
  rested on `enemyAttackers` distinguishing callers, which this epic ended. Whether simulateDPS's
  selfBuffs auto-fill reaches the scheduled channel is UNVERIFIED — if reachable it is silently inert
  in production. Its own note now states what would settle it.

## FINAL whole-branch review + PR
Final review (opus, 962KB package, 36 commits): **READY WITH FOLLOW-UPS, no Critical.** Fix wave
8b066c51. PR OPENED: #326 https://github.com/TheSusort/starborne-frontiers-calculator/pull/326
(38 commits, 162 files, +7950/-941). Final gates: 528 files / 5855 tests · tsc 0 · eslint 0 ·
494 moved .snap lines / 0 unclassified · oracle byte-identical at 147/146/2/13-13-13 · browser OK.

⭐ THE TWO IMPORTANT FINDINGS WERE BOTH IN THE HAND-OFF RECORD, NOT THE CODE:
1. **"the dummy kept crediting" after a roster wipe was WRONG** and I had put it in the ledger.
   Measured: `ability-performed` carries 30549.089 = 100000 x postDefenseFactor(8000) every round, but
   directDamage/cumulativeDamage/perTargetDealt/rawTotals are ALL zero and the dummy's HP never
   declines (credit counter stays 0). The branch's own code already said so (dummyReachability's
   CORPSE TARGETING pins consulted:2 / credited:0). Conclusion survives but NARROWS to an event
   payload → 4c plans a log-fidelity assertion, not an accounting migration. Repo's own logged lesson,
   re-earned: measure `deliveredDamage`, not `ability-performed.damage`.
2. Leech instance 3 (heal-target DoT tick) existed only in the gitignored ledger + user-facing
   changelog prose — the code site had NO marker and the canonical block listed the channels that DO
   reach the proc without naming the one that doesn't. Now marked in-code both places.

⭐ THE FIX-WAVE AGENT CAUGHT TWO REVIEWER ERRORS — reviewers need verifying too:
- The review's "verified CORRECT, leave alone" citation list had 2 wrong entries (8344, 1065).
- **Minor 5's prescribed parametrization would have been VACUOUS**: `HEALER.critDamage` is 0, so a crit
  multiplies by 1 and all three crit arms measure identically — `it.each([0,50,100])` would have
  shipped three copies of one test. Fixed by setting CRIT_DAMAGE=100 so the arms span
  no-crit/mixed/always-crit. The review's cited numbers matched neither family (it measured a
  different stat block); only the fixer's own measurements went into source.

⭐ CITATION ROT IS A REAL MAINTENANCE CLASS ON THIS FILE: ~7 of 27 new engine.ts line citations were
stale by 40-80 lines because later tasks grew engine.ts ~125 lines AFTER earlier tasks wrote their
comments. Now ~30 citations are SYMBOL-PAIRED (positionalDotLeech.test.ts's convention), so a stale
number is self-correcting. Adopt that convention for any new engine citation.

⭐ Four sibling copies of "DPS mode has no enemy attackers" survived the sweep (triggers.ts:1885,
playerTurn.ts:560, roundContext.ts:85, evaluateConditions.ts:70) — including in a file where THIS
branch had already corrected the same claim 437 lines above. The hand-enumerated-layer class again:
correcting one copy of a claim obliges sweeping every site that repeats it.
