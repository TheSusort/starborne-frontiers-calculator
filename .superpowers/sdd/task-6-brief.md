### Task 6: Repair wave C — 27 mechanical files, alphabetical first half

**Files (27 files / 61 tests)** — all under `src/utils/combat/__tests__/` unless noted:

`accumulatorGather.integration` (1), `actorStats` (3), `adjacentEnemiesDebuff.integration` (2),
`adjacentEnemiesDot.integration` (1), `allyDebuffReactivePromotion.integration` (1),
`apexSelfShieldGate.integration` (2), `applyOutgoingToEnemy` (3), `blockBuff` (1),
`bombDetonatedVictimId` (1), `bombModifierExclusion` (1), `bombSplashOnDeath.integration` (1),
`buffDurationOwnTurnReprieve` (3), `buffOnlyTeamWalk.integration` (1), `chargedOverdrive.integration` (5),
`corrosionToAcidicDecay` (2), `deathFallback.integration` (1),
`decrementUnification` (3), `demolisherBombSplash.integration` (1), `destroyedRoundUnification` (1),
`enemiesHitGate.integration` (1), `enemyBuffSelfDebuffGate` (4), `enemyDotCountGate.integration` (3),
`forcedAffinityReciprocalGate.integration` (2), `gearSetDotPair.integration` (4),
`healingPerRecipientApply` (6), `healingPerRecipientAxis` (5)

- [ ] **Step 1: Apply Task 4's recipe to all 27 files**

Read Task 4's brief in full for the recipe. Work through the list in order and report per file.

Two notes specific to this wave. The bomb/detonation files (`bombDetonatedVictimId`,
`bombModifierExclusion`, `bombSplashOnDeath`, `demolisherBombSplash`) exercise the positional burst
path, where a standing leech provably pays nothing — that is a documented gap with an owner ruling to
fix it in a separate PR, so do not chase a zero leech payout there. And `deathFallback.integration`
turns on a victim dying: with a real 500,000-HP enemy the death may no longer happen, so give that
fixture an enemy it can actually kill rather than re-pinning what it observes.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/accumulatorGather.integration.test.ts # …and the other 26
git add -A && git commit -m "test(engine): wave C — real enemy roster for 27 fixtures"
```

---

### Task 6b: Repair wave D — 27 mechanical files, alphabetical second half

**Files (27 files / 64 tests)** — all under `src/utils/combat/__tests__/` unless noted:

`hpCrossing` (1), `indestructibleDeath` (6), `leech` (8), `lowestSpeedAlly` (3),
`multiEnemyDotStateReporting.integration` (1), `outDetonationDamageUpBuff.integration` (3),
`outgoingAmplificationEngine` (1), `overloadLifecycle` (4), `ownCleanseReactivePromotion.integration` (2),
`perActorIncomingSurface` (1), `perActorShield` (1), `perVictimDotTick.integration` (1),
`perVictimPlayerTimedDetonation.integration` (2), `perVictimTimedDetonation.integration` (1),
`preFightModifiersEngine` (4), `procChanceGate` (4), `purgeConditionalSources` (2),
`reactiveShieldRouting` (1), `shieldAppliedEvent` (3), `shieldGrantBattleSim` (1),
`shieldPenetration` (4), `statVsTargetGate.integration` (3), `teamAuraDistribution.integration` (3),
`victimEnemyModifiers` (1), `wave7WardenDebuffInflicted.integration` (1),
`wildfireTeamAuraCritPower.integration` (1), and
`src/utils/calculators/__tests__/rhodiumChakaraDpsModeCredit.integration.test.ts` (1)

- [ ] **Step 1: Apply Task 4's recipe to all 27 files**

Read Task 4's brief in full for the recipe.

Three notes specific to this wave:
- **`rhodiumChakaraDpsModeCredit.integration`** has a recorded trap: its proc uses a most-buffs
  selector, and `mostBuffsAmong` returns undefined against an unbuffed enemy, so the proc DROPS
  entirely rather than shifting. The dummy-fallback era made that selector trivially satisfiable, so
  the fixture was never really testing the selector. **Buff the fixture's enemy** — never re-pin to 0.
- **`leech` (8 tests)** interacts with Task 2b's fix: a standing `leechScope:'all'` leech now pays out
  on a positional DoT tick where it previously paid nothing. That is the intended new behaviour.
- **`perVictimDotTick` / `perVictimTimedDetonation` / `perVictimPlayerTimedDetonation` /
  `outDetonationDamageUpBuff`** sit on the per-victim channels Task 2b touched. A DoT-tick leech
  payout is expected; a detonation-burst leech zero is the documented gap.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/hpCrossing.test.ts # …and the other 26
git add -A && git commit -m "test(engine): wave D — real enemy roster for 27 fixtures"
```

---

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

