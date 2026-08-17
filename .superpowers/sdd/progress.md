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
