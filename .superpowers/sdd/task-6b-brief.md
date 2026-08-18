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

