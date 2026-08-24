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
- [ ] Task 8: engine fix — **Phase 1 DONE**, Phase 2 authorised (see below)
- [ ] Task 4: `SkillSlotList` in the defense card

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
- [ ] Task 5: page wires the survivability sim
- [ ] Task 6: measured-EHP results block
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
