# Ledger — engine-backed Defense calculator (#358)

Plan: `docs/superpowers/plans/2026-08-24-defense-calculator-ability-model.md` (`a65c9fbf`, fixed `41a4cff9`)
Spec: `docs/superpowers/specs/2026-08-24-defense-calculator-ability-model-design.md` (`a5910ae8`)
Branch: `feat/defense-calculator-ability-model`, from main @ `0ec6b3a1`.

Workspace: **plain branch in the main checkout, NOT a worktree** — fresh worktrees here lack the
gitignored `.env` and `docs/*.json`/`*.csv`. Same choice as the #362 and #367 epics, same reason.

Baseline suite at branch point: **579 files / 6449 tests, 0 failures, 0 skipped** (24s).
(`apexShieldDestroyedNoise` did NOT skip on this run — the inherited gotcha stays a possibility, not
a standing condition. Any 3-skipped delta later is that, not a new break.)

## Inherited gotchas (from the #367 ledger — do not re-learn these)
- `npm run lint` is **NOT** in the husky hook (hook = lint-staged + tsc + tests). `--max-warnings 0`,
  so warnings are fatal at the final gate. Run it explicitly per task.
- `apexShieldDestroyedNoise`'s `beforeAll` times out under full-suite load and reports as
  **3 skipped**, NOT a failure. So "0 failures" is never sufficient — reconcile test COUNTS too.
- Never `vitest -u`. Golden churn is inspected and hand-updated.
- A clean per-diff review does NOT mean the design is right (#362 Task 3: the reviewer correctly
  called a sentinel "pre-existing", and it was, but combined with a later task it was a live bug).
- Compiler-as-enumerator is weaker than it looks: `tsc` does not flag test doubles with FEWER
  params, and only ANNOTATED sites (not `as unknown as …` casts). Bitten twice on #362.
- **Re-verify EVERY sketched call signature in the plan.** Plan-authoring style produces plausible
  but wrong argument orders (#367 Task 1: `applyTimedAbilityStatus(1, s, victimId)` should have been
  `(1, s, undefined, victimId)`).

## Pre-flight findings (this epic)
- **#358's own issue text is partly STALE.** Defensive buffs ALREADY auto-fill via
  `buildSkillBuffAutoFill` + `mergeAutoFill` (`DefenseCalculatorPage.tsx:147`), and the card already
  shows a read-only `ShipSkillList`. The converter constraint the issue warns about
  (`buffAbilitiesToSelectedBuffs`) no longer exists. Corrected in spec §1.1 — do not re-derive the
  issue's framing.
- **PLAN DEFECT 0 (mine, fixed pre-flight in `41a4cff9`):** Tasks 3 and 5 each ended by committing
  with their own Step-1 test still red. Husky runs the full suite on commit, so those commits were
  impossible. Type/wiring tasks now gate on `tsc` + green suite; the UI assertions moved to the
  tasks that can satisfy them (4 and 6).
- **PLAN DEFECT 1 (mine, caught by pre-verifying Task 3's field names before dispatch):** I wrote
  `speed: Math.round(final.speed ?? 0)` and `hacking: … ?? 0`. The reference implementation
  (`healerStatsFromShip`, `HealingCalculatorPage.tsx:173-174`) uses `?? 100` and `?? 200`.
  **A speed-0 defender never takes a turn**, so its self-shields/self-buffs never fire and its
  measured EHP is silently understated — the exact failure class this epic exists to remove.
  Fixed in the plan + brief before Task 3 was dispatched.
  Lesson: every `??` fallback I author is a guess until checked against the sibling implementation.
- Verified pre-dispatch (do not re-derive): `final.{hp,attack,defence,crit,critDamage,healModifier,
  speed,hacking,security}` all exist; `asFactionKey` is at `src/constants/factions`;
  `healerStatsFromShip` (HealingCalculatorPage.tsx:166) is the reference for `defenderFieldsFromShip`.
- The load-bearing measurement rule: **measured EHP = Σ gross `incomingDamage`, nothing added.**
  `hpLost = incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield` (`engine.ts:1672`,
  confirmed `:5087`). Adding the mitigation terms double-counts, silently, worst for tanky builds.

## Tasks
- [x] Task 1: **complete** (commit `ae17341a`, review clean — spec PASS, quality Approved,
      0 Critical/Important, 1 Minor already covered by the Task 2 addition below).
      Suite 579 files / 6450 tests (baseline +1 test, reconciles exactly).
      Implementer BLOCKED on golden churn
      (correctly); I adjudicated. **The instrument that settled it: `git diff --numstat` on the
      `.snap` = 194 insertions, 0 DELETIONS.** Zero deletions is the proof no existing value moved;
      one deletion would have meant a real behaviour change. All 194 added lines are
      `"convertedToShield": 0,` — grepped for added lines that were anything else, got none.
      Re-bless is delete-and-rerun (the suite's own header, `healingGoldenParity.test.ts:14`),
      NEVER `vitest -u`. Implementer's "225 occurrences" was wrong; measured 194.
      Bycatch it found unprompted: 4 UI test files construct literal `HealingRoundData` and needed
      the new required field — the **hand-enumerated-layer class** again.
      **FINDING → folded into Task 2:** all 194 values are `0`, i.e. NO golden scenario exercises
      Shield Converter, so the new channel was inert in every test. `toConversion` would have
      shipped never observed non-zero. Added a 10th Task 2 test using the name-keyed
      `'Shield Converter'` buff (`utils/combat/shieldConverter.ts`; working grant fixture in
      `utils/combat/__tests__/shieldConverter.integration.test.ts`).
- [x] Task 2: **complete** (commit `0f9e852c`, review: spec PASS, 0 Critical, 2 Important,
      3 Minor). Reviewer MUTATION-TESTED the module (reintroduced the double-count, hardcoded
      `survived`, removed the `toHp` clamp, broke the `hpPct` mapping) — each mutation caught by
      exactly ONE test. That is the strongest evidence the tripwires are load-bearing.
      **Both Important findings are SUPERSEDED by the engine fix (see USER RULING) — not discarded:**
      (I1) test 10's comment should warn its pass doesn't mean "gated Defense Up works" → moot once
      test 10 reverts to Defense Up. (I2) the `defenceUp` pin doesn't first assert the buff was
      APPLIED, so it could go green for the wrong reason → that pin gets DELETED by the fix.
      Fixing them now would be work the next task throws away; both are folded into the fix task's
      requirements instead.
      Suite 580 files / 6460 tests (baseline +1 file / +10 tests, reconciles exactly).
      Both tripwires INTACT and strict; two of my inequalities became EXACT constants.
      Every numeric constant I authored was right first try. **Three FIXTURES were wrong:**
      1. Shield Converter needs a NUMERIC `duration`, not `'recurring'` — `holdsShieldConverter`
         reads `timedAbilityStatuses` only (an aura grant would be unspendable). 99 → 8331/round;
         `'recurring'` → 0. My plan said `'recurring'`.
      2. `modifier` + `channel:'incomingDamage'` CANNOT reduce damage taken, by design —
         `applyAbilities.ts:92` "no DPS bucket — ignore", and `modifier` folds attacker-side only.
         My §6.2 modifier test was built on a channel that cannot work. Test 8 now measures which
         defensive channels actually reach the number and PINS the two inert ones as tripwires.
      3. The gate proof's two runs came back EQUAL (24993). Implementer diagnosed instead of
         loosening — cause was NOT the ability model (see the finding below). Test 10 keeps its exact
         shape with the buff swapped to `parsedEffects.incomingDamage` (`Inc. Damage Down II`):
         **ungated 17_496 vs gated 24_993, strictly greater. The gate proof STANDS.**
- [x] Task 3: **complete** (commit `58d7b085`, review PASS — 0 Critical, 0 Important, 2 Minor). Suite 580/6460 — UNCHANGED, as a
      type-only task should be. `as unknown as` grep found no casts touching `DefenseShipConfig`.
- [x] Task 8: **complete** (commits `79372d56` + fix wave `cb2b9607`; review spec-COMPLIANT,
      0 Critical, 4 Important + 3 Minor — ALL FIXED). Final suite **581 / 6472**.
      **The review's two big finds, both by MEASUREMENT not argument:**
      (F1) **`* s.stacks` was pinned NOWHERE** — deleting it left the WHOLE repo green (5991 tests),
      because every arm used `stacks: 1`. That factor is the entire basis of the Overload ruling:
      without it a 10-stack Overload is -10%, not -100%, and the changelog's Butcher figures are
      fiction. Now pinned + mutation-verified (red: `-10 !== -50`).
      (F2) **MY ERROR, propagated to 5 places:** I wrote that the floor guard stops defence
      "inverting into a damage bonus". `calculateDamageReduction` = `88.3505*exp(-((4.5552-log10 d)/1.3292)^2)`
      is bounded `[0, 88.3505]` and CAN NEVER go negative — measured `d=0 -> 0`, `d=-2500 -> NaN`.
      The guard prevents **NaN propagation**, not inversion. Two corollaries: at EXACTLY -100% the
      guard is a NO-OP (reduction already 0), so only an OVERSHOOT arm exercises it; and
      `expect(x).not.toBeGreaterThan(cap)` is **NaN-BLIND** (`NaN > x` is false) — it passed on the
      exact failure it named. Corrected in spec A5.1/A5.2 and all 5 sites; assertion is now
      `not.toBeNaN()`.
      (F3) stale-neighbour comment at `engine.ts:~5548` still described the just-fixed defect as
      current. (F4) a `protectionTransfer` test became a TAUTOLOGY on its own named axis post-fix —
      restored via a 50%-pen aura, mutation-verified. (F5) changelog "did nothing whatsoever"
      overstated — Defense Up already worked on counter/reactive/Protection-fallback paths.
      **METHOD NOTE: I told the reviewer to judge the TESTS, not the green, because Phase 1 had
      already proven the goldens are blind here. Every one of these findings is invisible to a
      passing suite.** Suite **581 / 6467** — +1 file,
      +7 tests, all its own; reconciles exactly. ZERO snapshot movement, as Phase 1 predicted.
      The change is ONE term: `enemyDefenseModifier: enemy.enemyDefenseModifier + selfDefense`,
      plus a `toSelfDefenseModifier` helper twinning `toSelfIncomingDamageModifier`.
      **Mutation-proved:** neutralise the fix → 7/7 red; invert the sign → 6/7 red; delete the floor
      guard → exactly the 2 floor arms red.
      **THE VACUITY IT CAUGHT IN ITSELF (worth remembering):** under the neutralise probe the
      cross-side SYMMETRY test initially stayed GREEN — because *an engine where the term reaches
      NEITHER side is still symmetric*. Two identical wrongs read as agreement. It hardened the test
      with a per-buff "moves away from its own control" loop to get 7/7. **A symmetry assertion is
      not a reachability assertion; it needs its own non-vacuity arm.**
      **SECOND TREE MUTATION, which I had not found:** a `git reset` at 19:25:40 (reflog) silently
      discarded the same four source edits, separately from the reviewer's `git stash`. It noticed
      only because an assertion returned the PRE-fix number moments after the same code returned the
      post-fix one. **Its rule, which I am adopting: an unexplained REVERSAL of a number you just
      measured is a tree-state event, not a flaky test.**
      Changelog: exactly ONE entry added — **Task 7 must not duplicate it.**
      ⚠️ `selfDefenceBuffMitigation.test.ts` is now the SOLE regression gate for this behaviour; the
      goldens are blind to it by construction. If that file is ever deleted or weakened the engine
      loses its only guard on the sign and the floor.
- [x] Task 4: **complete** (commit `854afabd`, review PASS — 0 Critical, 2 Important, 3 Minor).
      **PLAN DEFECT 3 (mine): `hasPassive={!!selectedShip}` is WRONG** and diverges from BOTH sibling
      calculators, which use `slots.some(passive) || !!getSkillRowForSlot(ship,'passive')`
      (`ShipConfigCard.tsx:94-99`, with a comment explaining why). Mine renders an editable Passive
      row with a live Edit button for ANY selected ship, including ships with no passive text —
      letting a user fabricate an ability for a slot that does not exist in-game. The implementer
      complied with my brief correctly; the brief was wrong. **Folded into Task 6 Step 0** (same
      file), WITH a required test arm, since Task 6 locks this UI in further.
      Reviewer verified the RED by reconstructing the pre-implementation state in a worktree, and
      confirmed 'Active'/'Charged' has no other source on a blank page (GameBuffPicker renders those
      words only per-selected-buff, and a fresh config has `buffs: []`). Suite **582 / 6474** (+1 file,
      +2 tests, both its own). Observed RED was a clean query miss
      (`Unable to find an element with the text: Active`), NOT a crash — the sibling smoke test
      passed, proving the harness was sound and the test failed for the right reason.
      **PLAN DEFECT 2 (mine):** I put the REQUIRED `onShipSkillsChange` prop in Task 4 but its page
      wiring in Task 5 — so Task 4 could not typecheck at its own gate. The implementer added
      minimal real wiring (`updateConfigShipSkills`, mirroring `updateConfigBuffs`) rather than a
      stub. Correct call. **Same shape as PLAN DEFECT 0: I keep drawing task boundaries that split a
      required prop from its only caller.**
      **STALE-FILE TRAP it caught:** `.superpowers/sdd/` still held `task-5-*` and `task-7-*` from
      the MERGED #367 epic, same filenames, different epic. A Task 5 dispatch pointing at that brief
      would have handed an agent another epic's requirements. Moved to `archive-367/`.
      **Instrument note:** my grep-for-"358" heuristic mislabelled my OWN `task-8-brief.md` as stale
      (it cites the spec path, not the issue number). mtime was the correct instrument. Two
      instruments disagreed and the content-based one was wrong.

## ⛔ PROCESS RULE ADDED (incident, 2026-08-24) — DO NOT run a reviewer concurrently with an
## implementer in the SAME working tree.
The Task 3 reviewer ran `git stash` to get a clean read while Task 8 Phase 2 was mid-edit. That
pulled BOTH the implementer's uncommitted source edits AND my own uncommitted docs work out of the
tree in one go. Recovered in full (`86b299fb`), stash dropped after confirming its source half was a
STALE snapshot — restoring it would have rolled Task 8 backwards.
**Two things I lost that I did not realise were uncommitted:** the A5 Overload ruling in the spec,
and the `?? 100`/`?? 200` fallback fix in the PLAN (the brief had already been regenerated from the
fixed plan, so Task 3 still shipped the correct code — the plan file alone had silently reverted to
contradicting the shipped code).
**Rules going forward:**
1. Reviewers are NOT read-only in practice. A reviewer that runs git commands mutates shared state.
   Either wait for the implementer to finish, or require the reviewer to work in its own
   `git worktree` and forbid `git stash` outright.
2. **Commit my own docs/ledger edits immediately**, not at the next convenient batch. Uncommitted
   coordinator work is the easiest thing to lose and the least likely to be noticed missing.
3. The Task 3 reviewer's own instinct was right and worth copying: when the shared tree gave
   moving-target failures, it verified the commit in an ISOLATED worktree. That is the correct
   method; the `git stash` that preceded it was the error.

## Task 8 Phase 1 findings (measured, not asserted)
- **Blast radius: 2 test files, 2 assertions. ZERO golden snapshots move.**
- **The zero churn is EXPLAINED, and reachability was PROVEN separately** — this is the
  "a zero is not a measurement until you know the rate" rule applied correctly. Per-file probe of
  `victimIncomingModifiers`: `simGolden` 0 non-zero self-defence reads, `dpsGoldenParity` 0,
  `healingGoldenParity` 0 (all three are synthetic fixtures with no self-side defence buff), but
  `realKitFingerprints` **2534**. The term reaches the damage path; the numeric goldens simply have
  nothing to say about it. **Corollary: the goldens do NOT gate this change — a sign error or a
  double count would produce the same clean run.** Phase 2 must pin direction itself.
- Both moving assertions are pins ON THE DEFECT: Task 2's FINDING A tripwire (24993 → 21192, exactly
  the `5000 × 1.30` its own comment predicted) and a premise line in
  `protectionTransfer.integration.test.ts:953` whose stated premise IS the defect (its core
  assertion still passes).
- **Team symmetry: YES** on the timed + aura ability channels, evidenced at four sites. Inherits one
  PRE-EXISTING player-only gap on the scheduled channel (`selfBuffLookup` empty for enemy/walked
  runtimes) — identical in kind to the already-shipped `selfIncoming` twin. Real ships grant Defense
  Up via abilities, so it is symmetric where it matters. **Phase 2's symmetry test must use the
  ABILITY channel or it will be vacuous on the enemy side.**
- **My A2 justification was slightly WRONG; the conclusion was right for better reasons.** The
  `engine.ts:5548-5556` comment documents the Protection *fallback*, and `targetMitigation` is
  derived from the profile, so changing the `defence` field would also stay self-consistent. The
  real reasons to use the percentage channel: (1) `effectiveStatsOf` folds only 2 of the 3 self-buff
  channels, so it would silently DROP aura-granted defence buffs; (2) leaving `defence` alone keeps
  Meatshield substitution semantics untouched.
- **Stronger "oversight, not design" evidence than my `selfIncoming` parallel:** every OTHER
  direct-damage site (counter, reactive, Protection fallback) ALREADY uses buff-folded defence. The
  positional applied path was the sole hold-out.
- [x] Task 5: **complete** (commit `baa87c44`, review PASS — 0 Critical, 0 Important, 2 Minor).
      Reviewer verified memo deps TRANSITIVELY and confirmed `getShipById` is `useCallback`-memoized
      in `ShipsContext`, so `enemyInputs` only gets a new identity when the roster really changes —
      the memo will not thrash per keystroke. Also cleared the id-seeding deviation and checked the
      Task 6 collision surface (the two carried fixes are docs-only commits touching no code). Suite **582 / 6474** — unchanged, as
      a wiring task with no new tests should be.
      **PLAN DEFECT 4 (mine): my Step-4 code omitted `targeting`.** The defender's cast therefore
      fell back to synthetic single-target-front instead of its real parsed kit — an AoE defender
      kills attackers slower than it would in game, incoming pressure stays high longer, and
      measured EHP reads LOW. **Folded into Task 6 Step 0b**, extracting the healing page's private
      `targetingOf` to a shared module rather than making a second copy.
      Implementer's ONE deliberate deviation was correct: seeded the enemy/team id refs at 1, not the
      healing page's 2, because this page's rosters start EMPTY rather than pre-seeded — copying
      verbatim would have made the first added enemy display as "Enemy 2".
- [x] Task 6: **complete** (commit `085ae607`; review pending). Suite **583 / 6480**. Both carried
      fixes done; NO healing test moved during the `targetingOf` extraction (10/10 before and after).
      Caught a fixture defect in MY brief: `toHp`/`gross`/`measuredEHP` all `30_000` made
      `getByText('30,000')` AMBIGUOUS (2 DOM matches). Rewrote to 25_000/5_000/30_000, which also
      exercises the shield-row branch.
      **ITS END-TO-END CHECK IS WHAT EXPOSED THE METRIC BUG** — Isha: Measured 1,408 (survived 4
      rounds) vs Formula 543,950. A 386x gap is not two estimates disagreeing; it is two different
      quantities. That check existed only because I asked for a number READ OFF THE RUNNING APP
      rather than computed.

## ⚠️ DESIGN ERROR IN MY OWN SPEC — found Task 6, ruled by user, fixed in Task 9
**`incomingDamage` is gross w.r.t. the shield/Barrier/conversion POOLS but NOT w.r.t. DEFENCE.**
`engine.ts:5423` — "The DEFENCE mitigation factor the CALLER already folded into `rawDamage`".
So Measured EHP counted damage that got THROUGH defence, not damage thrown.
- Ship that DIES: absorbs ~its HP regardless of defence. The page's central stat barely moves it.
- Ship that SURVIVES: tankier ship shows a LOWER number, and `isBest` ranks highest-first →
  **the ranking inverted.**
- It also contradicted what I told the user when they chose the metric (that it would capture
  incoming-damage reduction and gated defence buffs — those REDUCE it as shipped).
**THE GENERALISABLE FAILURE: I verified "gross" along the ONE axis I was worried about (pools),
then used the word unqualified. The double-count tripwire I built made the blind spot HARDER to see,
because it made the grossness question feel closed. Every test compared post-mitigation to
post-mitigation, so they all passed and always would have.**
User ruling: **raw EHP headline + rounds beside it** (spec ADDENDUM 2 / B1-B3, `66bda507`).

## Task 9 Phase 1 findings (measured over 406 files with a stack-frame probe)
- **14 paths reach the intake bucket; 7 FOLD the defence factor.** A naive fix on the obvious one
  (182,548 of 184,776 folding applications) **MISSES 6**: positional passive-slot hit, counter-attack,
  reactive proc, reflect/thorns, **Protection-transfer chunk** (most important here — a tank would get
  no credit for raw damage an ally redirected onto it), and the legacy non-positional aggregate.
  The other 7 fold nothing (raw === post) and need no change.
- **MY SPEC'S B3 WAS WRONG, and how it was wrong IS the finding:** I predicted Task 2/8 constants
  would move. They move ZERO — every `measuredEHP` assertion sits on a defence-0 fixture. **The
  property being fixed was never gated by any test.** Reachability proven SEPARATELY: casualty
  regime 120k -> 300k -> 720k as defence rises.
- Blast radius: 2 files, 54 snapshot assertions, **413 added lines / 0 changed** (ANSI-stripped).
- Team symmetry measured byte-identical on all four arms.
- **Survivor regime is defence-INDEPENDENT** (flat 60,000 across defence 0->20k) — raw thrown at a
  survivor is a property of the ENEMIES. Direction test must live in the CASUALTY regime.
- **Casualty regime is a STEP FUNCTION of the death round** — defence 5k and 5k+DefUp30 both report
  exactly 300,000 (both die round 5). Quantum = one round of enemy throughput. Inherent to a
  round-based sim; the continuous counterpart is the static formula shown beside it. **This makes
  "rounds beside it" load-bearing, not decorative.**
- MY RULINGS: pin the survivor flatness explicitly (delete-don't-loosen); accept the quantum and
  document it; ADD the raw axis to `RoundData.perActorIncoming` (turns 194 zero-information golden
  rows into 219 real `raw > post` pins); no division; **PARK path 3 (corpus-unreachable) per the
  established #357 stance** — add it to that issue.
- [x] Task 9: **complete** (commit `99e85a0a`; review running). Suite **584 / 6497** (+1 file,
      +17 tests). **Goldens: 219/0 and 194/0 — ZERO deletions**, every added line one of the two new
      fields; I re-verified both myself. **All 219 dps rows now carry `raw > post`** (I counted:
      219 gt, 0 eq, 0 lt) — rows that previously held NO information are now a real numeric pin on
      the dominant fold path. Ruling 3 paid off.
      6 of 7 folding paths fixed, one non-vacuous test each (mutating ONLY its own site). Path 3
      parked, corpus-unreachable → **belongs on #357**.
      **Instrument note (mine): my first row-count regex returned 0 pairs.** That is a BROKEN
      INSTRUMENT, not evidence of absence — a direct grep plainly showed a real pair. Fixed the
      measurement instead of reporting the zero.
- [x] Task 7: **complete** (commit `3e33d4f7`; review pending). Suite **584 / 6498**.
      Ranking guard RED observation: with the comparator flipped the reduce never advances past its
      `null` seed, so NO card gets the marker — it discriminates. Docs section had been partly
      written by `99e85a0a`; it added only the missing pieces and verified no changelog overlap.

## ⛔ TASK 9 REVIEW: 2 CRITICAL, MERGE-BLOCKING. The metric is STILL INVERTED on two channels.
Mechanical work is excellent (6 fold sites each mutation-proven one-at-a-time, byte-identical
mitigated expressions, 0 golden deletions, direction test genuinely catches re-inversion, both
known-behaviour pins carry delete-me framing). The DEFINITION is wrong.
- **C2/§A — the axis is pre-DEFENCE, not pre-MITIGATION.** `victimDamage.ts:194`:
  `nonCritFactorPreDefence = 1 * (1+outgoingPct/100) * (1+incoming/100) * affinityMult` — the
  `incoming` term SURVIVES. MEASURED, casualty regime: plain 300,000 (dies r5) vs
  `Inc. Damage Down II` 252,000 (dies r6). **The warded ship survives LONGER and reports LOWER.**
  Exactly the inversion B1 exists to remove, on a channel B1 NAMES.
  **And the channel is MIXED:** `incomingDamageModifierPct` combines enemy-sourced amplification
  (Out. Damage Up, Exposed — legitimately part of "what was thrown") with victim-side protection
  (`selfIncoming`, `preFightIncoming`). A correct fix must SPLIT it, not strip it.
  Also falsifies the shipped jsdoc claim that measured EHP is "the same quantity the static formula
  estimates" — `calculateEffectiveHP` RISES with reduction, measured EHP FALLS.
- **C1 — the DoT-transform seam is NOT corpus-inert; it is a 4x collapse on the live page.**
  Voron/Orel `transform-incoming-to-dot` defender, 5k defence: plain 100,000 vs Voron **24,993**
  (raw collapses onto the post axis, because the re-booking ticks are `byDirectDamage:false` and
  supply no pre-mitigation). A purely DEFENSIVE ability drops the headline 75% and re-inverts.
  Reachable from this page today. I had accepted the implementer's "corpus-inert" filing; the
  reviewer built the fixture and disproved it.
- **I3 — two funnel scalings covered by NOTHING.** Deleting either leaves 406 files / 3950 tests
  GREEN: `damageRaw *= (1 - blocked)` and `damageRaw *= cascade.targetRetainedFraction`. The second
  is what stops a PROTECTED victim's raw from double-counting the slice its protector absorbed.
- I4 dominant path now computes the hit TWICE (`positionalApply.ts:426/433`) on the 182,548-call
  hot path. I5 `reflectedDamagePreDefenceForHit` duplicates a body with nothing tying the copies.
  M6 `ProtectionChunk.totalPreMitigation` is DEAD. M9 "raw" now means two things in one file.
**THE PATTERN: three iterations on this metric, each revealing another mitigation channel. That is
a signal about the METRIC, not just the implementation. Escalated to the user rather than starting
a fourth.**

## ✅ RESOLVED by the user's own definition (2026-08-25) → spec ADDENDUM 3 (`59cf6d17`), Task 10
**The root cause was MINE and it was not a coding error: I never wrote the definition down in full.**
I said "gross" (meaning: not double-counting shield pools), then "raw" (meaning: before defence).
Each implementation faithfully delivered the narrow thing I said while the metric stayed wrong on
channels I had not considered. The user's one-sentence definition — "the full attacker's attack with
modifiers, before it's mitigated by the defender, plus other sources like DoTs or bombs; a mix of the
channels" — is a COMPLETE specification. My two previous statements were not specifications at all,
just corrections to whatever was most recently broken.
**Naming was load-bearing too:** retiring "Measured EHP" for **Damage absorbed / Rounds survived /
Theoretical EHP** fixed the contradictory changelog entry for free — that entry went wrong precisely
because "EHP" kept inviting the old post-mitigation reading.

- [x] Task 10: **complete** (commit `62d194ee`, review: substantially compliant, **1 Critical**,
      5 Important, 5 Minor → Task 11 fix wave). Reviewer verified 8 mutations, reproduced both
      previously-broken arms independently (`60,000 x 6` identity holds exactly), audited the rename
      (no numeric moved), and confirmed the ranking blind spot CLOSED (both wrong reduces now red).
      **THE CRITICAL IS ONE I PERSONALLY WAVED THROUGH.** Task 10 told me
      `attackerIncomingReductionPct` "belongs to the empirical duel-fit model" and I recorded that as
      a defensible separate decision. **It was wrong and I did not check it.** The term is
      `incomingReductionForHit(incomingAbilitiesOf(attacker.id), …)` — the bounce-back RECIPIENT's
      own abilities, i.e. OUR DEFENDER's. The duel fit governs `damage`; `preMitigation` already
      departs from the fit by replacing defence with a literal 1, so stripping touches no empirical
      constant. Measured: **200,000 -> 140,000 -> 80,000** at 0/30/60% of the defender's OWN
      reduction, identical round counts. A defensive ability quartering its owner's headline —
      the FOURTH channel of the same inversion. **Lesson: I accepted a justification instead of
      testing it, on a point the implementer itself had flagged as "arguably victim-side by C2".**
      **AND THE OVER-STRIP RISK I FLAGGED IS REAL (item 3):** mutating the engine to drop `Exposed`
      from the KEEP side leaves **ALL 6,520 tests GREEN**. Every arm proves reductions RAISE the
      figure; NONE proves amplifications still COUNT. Half the split is unfenced.
      Plus: `equipReductionPct` is ITSELF a mixed channel stripped wholesale (contains the ATTACKER's
      squad-leader crit penalty, which must stay IN) — the same atomic-treatment defect, on the
      SECOND mixed channel, while fixing the first. A third untested funnel write introduced. Docs
      traded a structural error for a naming error (two card names that exist nowhere in the app).
      **Four comments now assert the OPPOSITE of shipped behaviour.**
- [x] Task 11: **complete** (commit `2293ade2`; review pending). Suite **584 / 6528** (+8 arms).
      All 11 findings closed. Critical mutation-check: restoring the reflect fold →
      `expected 140000 to be 200000` (exactly the 30% figure). Item-3 KEEP arms: dropping `exposed`
      → `expected 40000 to be greater than 40000`; same for `enemy.incomingDamageModifier`. Snapshot
      deletions ZERO (no golden file touched at all).
      **IT FOUND A FIFTH CHANNEL AND CORRECTLY DID NOT FIX IT — needs a user ruling.** Protection
      redirect (`damageRaw *= cascade.targetRetainedFraction`): fixed 4-round survivor window,
      no ally 40,000 · ally 0 stacks 40,000 · 3 stacks **28,000** · 5 stacks **20,000**. Same rounds.
      **But this is a REASSIGNMENT, not a reduction** — the slice is booked IN FULL on the
      PROTECTOR's own raw axis. Whether damage an ally intercepted counts as "absorbed" by the ship
      it was thrown AT is a product ruling, not inferable from the neighbouring channels. Pinned with
      those exact numbers + a zero-stack control, both readings in the test header. Also closes C5's
      second untested funnel scaling.
      It softened the docs/changelog to "a defensive ability **on the ship itself** never lowers this
      number" with the carve-out spelled out — leaving it absolute would have been a NEW user-facing
      inaccuracy created by the finding. Correct.
      **TWO FIXTURE TRAPS caught by MEASURING, both the vacuity class:** (1) a `SelectedGameBuff`
      named `'Protection'` on a `TeamActorInput` never reaches `selfBuffStacksForOwner` — that build
      read 40,000 at EVERY stack count and would have "proved" the channel inert; (2)
      `rawIntakeAxis`'s usual `hacking: 0` gives landing chance ZERO, so the path-8 DoT never applied
      and every assertion passed VACUOUSLY until hacking 200 (chance exactly 1 — certain, not drawn,
      so the file's no-live-RNG property holds).
      Also fixed 2 more stale comments in item 6's class that the brief did not name.
      Note: `victimHitDamage`'s byte-identity is deliberately preserved by re-summing the split halves
      in the engine's original left-to-right order — `a - (b + c)` and `a - b - c` are not the same
      double.
- [ ] Task 11 review, then the WHOLE-BRANCH review. Suite **584 / 6520** (+22 arms).
      **ZERO golden/snapshot files touched** — no re-bless needed. 185 test-file deletions are all
      the `measuredEHP`→`damageAbsorbed` rename (identical values on the added side) + a fixture
      reorder. No numeric value moved.
      **Per-channel direction, all rise or stay flat, no inversions:** defence 120k→300k→720k ·
      own `Inc. Damage Down` **252k/5rds → 360k/6rds** (= 60k x 6, arithmetic checks) ·
      `equipReductionPct` 300k→360k · incoming-block 300k→540k · Vortex Veil flat ·
      **Voron DoT transform 24,993 → 100,000** (the 4x collapse gone). 11 mutations, all caught.
      Presence pinned: DoT 81k · bomb 80k · detonation differential · reflect 200k thrown / 83,312
      arrived. The mixed channel is split (`incomingAsThrown`; `engine.ts:7210`) — verified myself.
      **MY SPEC'S C4 MECHANISM WAS WRONG AND IT SUBSTITUTED A BETTER ONE.** I prescribed "carry the
      pre-mitigation figure through the re-book"; measured, that gave 60,000 vs a plain 100,000,
      because the deferral runs past the window edge and those ticks never fire — **a window edge
      would have decided whether a hit had been thrown.** It shipped book-at-throw-time instead.
      ACCEPTED: damage thrown is thrown regardless of when/whether the deferred slice lands, and a
      metric that moves with the window boundary is indefensible.
      Also ACCEPTED: it stripped Vortex Veil's `incomingDotReductionPct` though C2's OUT list omitted
      it — C2 says "every victim-side reduction", the list was illustrative, and this is the same
      class. Correct call.
      OPEN (documented, not blocking): `preFightIncoming` has no sim-level arm (no passthrough on
      `DefenseSimulationInput`); fenced in two halves instead. `attackerIncomingReductionPct` is
      still folded into both reflect axes — arguably victim-side by C2 but part of the empirical
      duel-fit model, so stripping it is a separate decision.
- [ ] Task 7: documentation + changelog

## ✅ USER RULING (2026-08-24): Defense Up SHOULD reduce damage taken, and the engine fix is
## IN SCOPE for this epic. I recommended a separate spec; the user chose in-epic. Proceeding.
## Consequences accepted by that choice: golden/snapshot numbers WILL move across the combat-sim
## and DPS suites (the regression gate), and every move must be individually audited + explained.
## Also: the fix must be TEAM-SYMMETRIC (both sides' defenders), per the standing engine rule.
## Two silver linings: test 10 can REVERT to its intended, stronger form (proving a gated DEFENCE
## buff, not just any channel), and test 8's inert-channel pin gets deleted rather than loosened.

## THE FINDING (verified independently at three sites)
**A defender's own `Defense Up` does NOT reduce the damage it takes, on the positional per-victim
path.** Found by Task 2, verified independently by me at three sites:
- `victimDefenseProfileOf` (engine.ts:7229) reads `substitutedDefenceFor(v, v.stats.defence)` — the
  BASE stat. The buff-folded `effectiveStatsOf().defence` is deliberately NOT used here.
- The modifier return (engine.ts:7110-7112) is ASYMMETRIC:
  `enemyDefenseModifier: enemy.enemyDefenseModifier` (enemy debuffs ONLY, no self term)
  vs `incomingDamageModifier: enemy.… + selfIncoming + preFightIncoming + exposed` (HAS a self term).
- So enemy-sourced **Defense Shred works**, victim's own **Defense Up does not**. Two independent
  places a self-defence term could enter; it enters neither.
- The `selfIncoming` term on the OTHER channel is D-PR12's work. That exact parallel is the
  strongest evidence this is an OVERSIGHT, not a design choice — the job was done for one channel
  and never for its twin.
- **Pre-existing, identical through the old `selfBuffs` route. NOT an epic regression.**
- Product consequence: a Defense-Up ship will show measured EHP BELOW formula EHP (the static
  formula does apply it: `defense * (1 + defenseBuff/100)`), and users will read that as the new
  page being broken.
- What DOES move measured EHP: shield grants, name-keyed statuses (Barrier, Shield Converter with a
  numeric duration), and the `Inc. Damage Down` family.
- Pinned by Task 2's test 8. **If the engine is fixed, that pin goes RED by design — delete it,
  never loosen it.**

## Minor findings roll-up (for the final whole-branch review to triage)
- **Task 5 / code health: ~230 lines + module helpers are now duplicated VERBATIM between
  `HealingCalculatorPage` and `DefenseCalculatorPage`.** This was deliberate — I instructed
  "copy, do not re-derive" because drift between the two mappings is the worse failure (the
  positional-apply gate fails SILENTLY when `pattern` is missing). But the debt is real and now sits
  in a third place. Suggested follow-up: extract a shared `useEnemyTeamRoster` hook when a fourth
  calculator needs the same shape. NOT blocking.
- **Task 5 / test-env (pre-existing, shared with `HealingCalculatorPage.test.tsx`):** the page test
  mocks `ShipsContext` returning a FRESH `getShipById` closure per call, so the memo-stability
  guarantee is exercised only by the real context, never by a test. The thing most likely to regress
  into N-sims-per-keystroke has no guard.
- Task 1: the two new scalar pass-throughs are only tested at ZERO. Reviewer checked precedent:
  `barrierAbsorbed` (the direct sibling) also has zero adapter-level and zero non-zero golden
  coverage, so this is existing pattern, not regression. The underlying computation IS covered with
  real non-zero values in `shieldConverter.integration.test.ts`. **Addressed** by the 10th Task 2
  test. Nothing to fix at merge.

## Reviewer-confirmed facts worth not re-deriving
- `convertedToShield` already existed on `ActorIntake`, in `intakeFor`'s init, in the
  `perActorIncoming` Record type and its mapping loop — from earlier unrelated work. Task 1 touched
  ONLY the interface declaration + the single assembly site.
- There is exactly ONE production construction site each for `HealingRoundEngine` (the
  `healingRounds.push` in engine.ts) and `HealingRoundData` (the `.map` in the adapter).
- The 4 UI fixture files are the ONLY literal construction sites outside the adapter. No
  `as unknown as` cast sites exist for these types.
- `battleSimulator.ts` / `battleAssemble.test.ts` references to `convertedToShield` are the
  pre-existing Battle Simulator feature (`e3f7fadf`), unrelated to this epic.
