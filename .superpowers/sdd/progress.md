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
- The load-bearing measurement rule: **measured EHP = Σ gross `incomingDamage`, nothing added.**
  `hpLost = incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield` (`engine.ts:1672`,
  confirmed `:5087`). Adding the mitigation terms double-counts, silently, worst for tanky builds.

## Tasks
- [ ] Task 1: `convertedToShield` on the healing round row — implementer BLOCKED on golden churn
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
- [ ] Task 2: `defenseSurvivabilitySim` boundary + 9 tests
- [ ] Task 3: `DefenseShipConfig` gains `shipSkills` + engine stats
- [ ] Task 4: `SkillSlotList` in the defense card
- [ ] Task 5: page wires the survivability sim
- [ ] Task 6: measured-EHP results block
- [ ] Task 7: documentation + changelog

## Minor findings roll-up (for the final whole-branch review to triage)
_(none yet)_
