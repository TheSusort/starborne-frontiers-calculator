### Task 6c: Repair wave E — the fixtures whose SUBJECT is the empty roster

These six are not mechanical. Each one exists to exercise the very fallback this PR forbids, so
handing it a real enemy would delete the thing it tests. Read each fixture's own comment before
deciding, and state the decision per file in your report.

**Files (7 files / 14 tests):**
- `src/utils/combat/__tests__/damageChannelAccounting.integration.test.ts` (2) — **moved here from
  wave C on the wave-A review's advice.** Its "an EMPTY opposing roster credits every cast to the
  LEGACY sink" case and its sibling INVARIANT test both have premises the classifier makes illegal.
  These are Step-4 "the premise has evaporated" cases that no roster line can repair: the legacy sink
  is exactly what this PR makes unreachable. Decide per test whether the invariant can be re-expressed
  against a real roster (keep the coverage) or whether it only ever described the sink (then it
  becomes a throw-assertion and you say what stopped being covered).
- `src/utils/combat/__tests__/normalizeRoster.test.ts` (1) — the test is literally named "leaves an
  empty enemy roster empty — it never invents an enemy". Its premise is the OLD contract, which this
  PR reverses. It becomes a throw-assertion.
- `src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts` (1) — a REGRESSION
  test that sets `enemyAttackers: undefined` with the comment "the lone enemy is the dummy sink", i.e.
  it deliberately invokes the dummy fallback. Decide whether the regression it guards can be observed
  on a real roster; if it can, migrate it there and keep the guard. If it genuinely cannot, say so
  explicitly rather than converting it to a throw-assertion and losing the coverage.
- `src/utils/combat/__tests__/shieldBasisSecondaryDamage.integration.test.ts` (2) — casts
  `as CombatEngineInput` over a `CLEAN_MATH` spread that never sets the field. The cast is what let a
  required field go missing; give it a real enemy AND drop the cast so the compiler can see it.
- `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` (1) — its subject is the dummy's turn gate.
  Judge whether the gate is still observable at all now that no run reaches the dummy.
- `src/utils/combat/__tests__/runModeEquivalence.test.ts` (6) — equivalence across run modes, using
  the empty roster as a convenient default. Give it a real enemy; the equivalence claim should survive.
- `src/utils/combat/__tests__/dummyReachability.test.ts` (1) — its "STILL takes it with an empty
  roster" case. Invert it to a throw-assertion here so the suite is green; **Task 7 then widens this
  file's coverage and adds the sink-credit counter.** Do not do Task 7's work.

- [ ] **Step 1: Decide and repair each of the six**

For any file where the honest answer is "this coverage is gone and cannot be recovered", say so and
name what is no longer covered — do not paper over it with a throw-assertion that tests the guard
instead of the mechanic. That trade is the controller's to make, not yours.

- [ ] **Step 2: Full suite green — the first time since Task 3**

```bash
npm test 2>&1 | tail -20
npx tsc --noEmit && npx eslint src
```

Expected: all green, tsc 0, eslint 0. Report the file/test totals; the pre-branch baseline was 528
files / 5837 tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(engine): wave E — the empty-roster fixtures meet the new contract"
```

---

