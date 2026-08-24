# Defense Calculator adopts the ability model — engine-backed survivability

**Issue:** #358 · **Date:** 2026-08-24 · **Status:** approved, ready for planning

## 1. Why this exists

The Defense calculator is the last calculator that does not read a ship's parsed skills through
the ability model. DPS and Healing both run the real combat engine off `shipSkills`; Defense is a
22-line static formula (`src/utils/calculators/defenseCalculator.ts`) over three buff totals.

### 1.1 What #358 got wrong — corrected premises

The issue text is partly stale. Measured against `0ec6b3a1`:

| #358 claim | Verified reality |
| --- | --- |
| `DefenseShipConfig` has no `shipSkills` | **True** (`src/types/calculator.ts:266`) |
| The page renders no `SkillSlotList` | **True** |
| "buffs are hand-picked only" | **FALSE.** `selectShipForConfig` already calls `buildSkillBuffAutoFill(ship)` + `mergeAutoFill` (`DefenseCalculatorPage.tsx:147`), and `DefenseShipCard` renders a read-only `ShipSkillList` "Skill Reference" |
| Constraint (a): "do not call the ability→buff converter in render" | **MOOT.** `src/utils/abilities/buffAbilityConverters.ts` now exports only `selectedBuffToAbility`; the ability→buff direction (`abilityToSelectedBuff`, `buffAbilitiesToSelectedBuffs`) was deleted |
| Constraint (c): scheduling fields dropped by the converters | **MOOT** for the same reason — there is no ability→buff converter left to drop them |

Constraints (b) `modifier.isMultiplicative` is a no-op and the memoization requirement both still
stand and are honoured below.

So defensive buffs *do* auto-fill today, through the pre-ability-model flat `SkillEffect` path. The
genuine gaps are narrower and different from the ones #358 names:

1. **No condition gating.** An auto-filled conditional buff ("+30% Defense while HP below 50%")
   counts as permanently active, overstating EHP. Silent — the number stays plausible.
2. **No `modifier` abilities.** Passive stat auras are not `SkillEffect`s, so the flat path cannot
   see them at all.
3. **No editing.** Parsed skills are read-only reference text; DPS and Healing let you adjust them.
4. **No shield / Barrier concept.** The static formula has no term for absorbed damage.
5. **Not engine-backed.** No attacker side, so no interaction between defence, shields, reactive
   repairs and real incoming pressure.

## 2. Decisions taken

| Question | Decision |
| --- | --- |
| Scope | Engine-backed survivability calculator, not a skill-aware static formula |
| Headline metric | **Measured EHP** — damage absorbed before death (or across the window) |
| Ally support | **Optional shared team**, reusing the healing calculator's `TeamPanel` |
| Ship survives the window | Report absorbed total + an explicit `survived` flag (honest lower bound) |
| Architecture | Thin defense-named boundary over `simulateHealing` — no second engine adapter |

### 2.1 Why a boundary and not a second adapter

`healingEngineAdapter.ts` is 954 lines and already does what a survivability run needs:
`healTargetId: 'healer'` makes the focus actor the bombarded ship, `teamActors` carries supporting
allies, `enemies` supplies pressure, `rounds` sets the window. `HealingSimulationResult` already
reports `incomingDamage`, `shieldAbsorbed`, `barrierAbsorbed`, `targetHpPct` per round and
`summary.destroyedRound`.

Duplicating that adapter would duplicate a dozen PRs' worth of absorbed corrections — the
`defence ?? 10000` vs the engine's `?? 0` default, positional-apply gating, faction seeding,
affinity matchup construction — and then drift from them. A thin boundary reuses all of it and
gives the page a defense-named API with one place to change if the heal adapter is later
generalised.

**Accepted consequence:** the focus actor takes its own turns, so the defender casts at the enemies
each round. Its self-shields and self-buffs therefore fire on its own turn (correct), and a
defender that kills attackers reduces its own incoming pressure (real game behaviour). Measured EHP
is consequently *not* a pure-defence number, and that is deliberate.

## 3. The measurement rule

**Measured EHP = Σ `incomingDamage` over elapsed rounds. Nothing is added to it.**

The engine's intake identity (`ActorIntake`, `engine.ts:1672`, confirmed at `engine.ts:5087`) is:

```
hpLost = incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield
```

`incomingDamage` is **gross**: it already contains everything the shield pool and Barrier soaked.
`barrierAbsorbed` and `convertedToShield` are documented as "netted against `.incoming` for
display".

### 3.1 The double-count trap

The intuitive formula `incoming + shieldAbsorbed + barrierAbsorbed` double-counts every point of
mitigation. It fails *silently* and *worst for the tanky builds the page exists to find* — a
shieldless ship reports identically under both formulas, so the bug is invisible on the fixture
most likely to be written first.

This is pinned by a dedicated tripwire test (§6.1), not merely by asserting the correct value.

### 3.2 Intake breakdown

The same identity yields a per-ship breakdown worth displaying: of everything thrown at this ship,
how much landed on HP, how much the shield ate, how much Barrier blocked outright, how much was
converted to shield.

**Gap to close:** `convertedToShield` is tracked in `ActorIntake` but never surfaced on
`HealingRoundData`. Without it the four terms do not close and a Shield Converter ship shows an
unexplained residual. PR 1 surfaces it — additive field, no behaviour change.

**The HP term is derived, not reported.** `HealingRoundData` carries no `hpLost`; the breakdown's HP
figure is `incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield`. This matters for the
test plan: an "identity closes" assertion written against that derivation is **tautological** — it
restates the definition and would pass with every term wrong. §6.2 cross-checks it against an
independent signal instead.

### 3.3 Survivors

When the ship outlasts the window, `summary.destroyedRound` is absent. The result reports the
absorbed total with `survived: true`, and the UI must render survivors distinctly so the figure is
never read as a death threshold. Two survivors are still separated by how much they soaked.

## 4. Modules

- **`src/types/calculator.ts`** — `DefenseShipConfig` gains `shipSkills` plus the stats the engine
  needs for the ship to take its own turns: `attack`, `crit`, `critDamage`, `speed`, `hacking`,
  `chargeCount`, `startCharged`, `position`, and affinity / role / faction derived from the picked
  ship.
- **`src/utils/calculators/defenseSurvivabilitySim.ts`** (new) — the boundary. Maps
  `DefenseSimulationInput → HealingSimulationInput` and reduces `HealingSimulationResult` to
  `DefenseSurvivabilityResult`: `measuredEHP`, `survived`, `destroyedRound?`, the intake breakdown,
  and the per-round rows. The EHP arithmetic and the survived-vs-died policy live here so both are
  testable without a page.

  Two `HealerStats` fields need a deliberate mapping rather than a default: `healModifier` takes the
  defender's **real** value (a defender with self-repair must actually repair — zeroing it would
  silently understate every sustain tank), and `defensePenetration` is `0` (the defender's own
  offence is incidental here).
- **`src/utils/calculators/defenseCalculator.ts`** — **untouched.** The static formula stays as the
  displayed baseline.
- **`src/components/calculator/DefenseShipCard.tsx`** — `SkillSlotList` in the Advanced section,
  **replacing** the read-only "Skill Reference" (the editor modal already shows per-slot skill text
  via its `ship` prop; keeping both is two views of one thing). Results block: measured EHP as
  headline + survived / destroyed-round-N badge, static formula EHP beneath as baseline, intake
  breakdown.
- **`src/pages/calculators/DefenseCalculatorPage.tsx`** — `buildShipAbilitiesWithEquipment` at both
  ship-select sites (`getInitialConfig` and `selectShipForConfig`); shared `EnemyAttackersPanel`,
  `TeamPanel` and a rounds control folded into the existing `DefenseSettingsPanel`; `isBest` ranks
  on measured EHP.
- **Unchanged:** `DamageReductionChart`, `DamageReductionTable`, `SecurityEHPChart` — pure-formula
  reference content, still correct.

### 4.1 Performance

The healing page already runs one engine sim per config synchronously in a `useMemo`
(`HealingCalculatorPage.tsx:664`, 20-round default). The N-configs × engine pattern is established
precedent; no worker. Memoize on configs + enemies + team actors + rounds, per constraint (b).

## 5. Data flow

```
Ship (imported)
  └─ buildShipAbilitiesWithEquipment(ship, getGearPiece) ──► DefenseShipConfig.shipSkills
                                                                      │
        SkillSlotList (user edits) ────────────────────────────────────┤
                                                                      ▼
  DefenseSimulationInput { defender stats + shipSkills, teamActors, enemies, rounds }
                                                                      │
                              defenseSurvivabilitySim.ts (boundary)   │
                                                                      ▼
                          simulateHealing({ healTargetId: 'healer', … })
                                                                      │
                                       HealingSimulationResult        │
                                                                      ▼
   DefenseSurvivabilityResult { measuredEHP, survived, destroyedRound?, breakdown, rounds }
                                                                      │
                                                                      ▼
                        DefenseShipCard  ·  page-level ranking (isBest)
```

## 6. Testing

### 6.1 The two tests that carry the weight

**The double-count tripwire.** A *shielded* fixture asserting measured EHP equals gross intake
**and** explicitly asserting it does not equal `incoming + shieldAbsorbed + barrierAbsorbed`. A
test that only checks the correct value passes under both formulas on an unshielded fixture — which
is exactly how this bug would survive review.

**The non-vacuous proof the ability model changed the answer.** A ship whose defence buff is
conditionally gated must measure *lower* than the static formula predicts. This test **must fail
under today's flat `buildSkillBuffAutoFill` path**. If it passes both ways, the epic has
demonstrated nothing and #358 is not closed.

### 6.2 Supporting tests

- **Intake breakdown reconciles against an independent signal.** Do NOT assert
  `hpLost + shield + barrier + converted === incoming` — the HP term is *defined* by that
  subtraction (§3.2), so the assertion is tautological. Instead, on a **solo run with no healing of
  any kind**, assert the derived Σ HP loss reconciles with the target's own HP trajectory
  (`targetHpPct` movement × max HP). Healing breaks the reconciliation by design, so the fixture
  must have none — a team-supported fixture here would produce a mismatch and invite "fixing" a
  correct calculation.
- Survived-vs-destroyed policy asserted **both ways** — `destroyedRound` present and absent.
- A Barrier ship reports non-zero `barrierAbsorbed`.
- A `modifier`-ability ship (passive stat aura) affects measured EHP — invisible to the flat path.
- Card and page render tests.

### 6.3 Regression gate

The golden suite stays **byte-identical**. PR 1 is the only engine-adjacent change and is purely
additive. Any golden churn is a STOP — never `vitest -u`.

## 7. PR sequence

Each PR is independently green and mergeable.

1. **`convertedToShield` on `HealingRoundData`** — additive field, no behaviour change. Goldens
   byte-identical.
2. **`defenseSurvivabilitySim.ts`** — the boundary + the EHP / survived / breakdown reducer, fully
   unit-tested including both §6.1 tests at the reducer level. No UI.
3. **Config + card** — `DefenseShipConfig` gains `shipSkills` and engine stats; `SkillSlotList` in
   the card replacing the Skill Reference; `buildShipAbilitiesWithEquipment` at both ship-select
   sites.
4. **Page wiring** — shared enemy / team / rounds panels, measured EHP display, ranking switch,
   memoization.
5. **Docs** — `src/pages/DocumentationPage.tsx` + `UNRELEASED_CHANGES` in
   `src/constants/changelog.ts`.

## 8. Out of scope

- Making the static formula ability-aware — superseded; it stays as the baseline.
- Generalising `healingEngineAdapter` into a shared harness. The boundary is the seam that makes
  that a later, mechanical refactor if it is ever wanted.
- Escalating-pressure or uncapped run-until-death modes (§2 decided the window + flag).
- Autogear integration. Measured EHP is a page-level metric here; `Effective HP` as an autogear
  limit stat is unchanged.

---

# ADDENDUM (2026-08-24): self-sourced defence buffs reduce damage taken

**Status:** approved by the user, IN SCOPE for this epic. Task 2 surfaced the defect; the user ruled
the behaviour is wrong and chose to fix it here rather than in a separate spec. I recommended a
separate spec (the blast radius is engine-wide, not calculator-local); the user's decision stands.

## A1. The defect

A defender's own `Defense Up` (`parsedEffects.defense`) does **not** reduce the damage it takes on
the positional per-victim damage path. Verified at three sites:

1. `victimDefenseProfileOf` (`engine.ts:7229`) sets `defence: substitutedDefenceFor(v, v.stats.defence)`
   — the **base** stat. The buff-folded `effectiveStatsOf(...).defence` is deliberately not used here
   (see the note at `engine.ts:5548-5556`, which matched this raw read to fix a *different* consumer).
2. The modifier return (`engine.ts:7110-7112`) is **asymmetric**:
   - `enemyDefenseModifier: enemy.enemyDefenseModifier` — enemy-sourced debuffs ONLY, no self term.
   - `incomingDamageModifier: enemy.incomingDamageModifier + selfIncoming + preFightIncoming + exposed`
     — carries a self term.
3. Consequence: enemy-sourced **Defense Shred works**; the victim's own **Defense Up does not**. Two
   independent places a self-defence term could enter, and it enters neither.

The `selfIncoming` term on the twin channel is D-PR12's work. That exact parallel is the strongest
evidence this is an oversight rather than a design choice: the job was done for one channel and never
for the other.

**Pre-existing** — identical through the older `selfBuffs` route. Not introduced by this epic.

## A2. The fix

Add a self-sourced defence term to the percentage channel that already exists, mirroring
`selfIncoming`:

```
enemyDefenseModifier: enemy.enemyDefenseModifier + selfDefense
```

`defenceModifierPct` is already consumed as a signed percentage multiplier on defence
(`victimDamage.ts:113`: `v.defence * (1 + v.defenceModifierPct / 100) * (1 - pen/100)`), with
negative meaning less defence. A `Defense Up II` of `+30` therefore rides it as `+30` with no new
plumbing.

**Why this site and not `victimDefenseProfileOf`'s `defence` read:** leaving `defence` as the base
stat keeps faith with the reversed-repairs caller documented at `engine.ts:5548-5556`, which
deliberately matches this raw read. Routing the buff through the percentage channel changes one term
instead of changing the meaning of a field two other callers depend on.

**Bonus:** this is the same arithmetic the static formula uses
(`computeBuffedStats`: `defense * (1 + defenseBuff / 100)`), so measured and formula EHP will finally
agree on Defense Up instead of contradicting each other.

## A3. Binding constraints

- **TEAM-SYMMETRIC.** Both sides' defenders must benefit. A player-only fix is a defect, per this
  project's standing engine rule.
- **Sign convention:** negative = less defence. Defense Up is positive. Get this wrong and the buff
  becomes a debuff — a test must pin the direction, not just the magnitude.
- **The golden suites are the regression gate.** This fix WILL move numbers in the combat-sim and DPS
  suites. Every moved number must be individually audited and explained as a legitimate consequence
  of a defender's Defense Up now applying. Re-bless is delete-and-rerun, **never `vitest -u`**.
- **A zero-churn result is a RED FLAG, not a success.** If no golden moves, the term is not reaching
  the damage path and the fix is inert — exactly the defect being fixed. Prove reachability before
  believing a clean run.

## A4. Consequences for already-merged Task 2

- Test 8's `defenceUp` inert-channel pin **goes red by design → DELETE it**, and replace it with an
  assertion that the buff now DOES reduce measured intake. Do not loosen it.
- Test 10 (the conditional-gate proof) **reverts to `Defense Up II`**, its originally intended and
  strictly stronger form: it then proves a gated *defence* buff is suppressed, not merely that some
  channel is. Its two exact constants will change; re-measure them.
- The module jsdoc's "WHICH DEFENSIVE CHANNELS MOVE THE MEASURED NUMBER" list must move
  `parsedEffects.defense` from the DOES-NOT list to the DOES list.
- This also resolves both Important findings from Task 2's review (a test-10 comment gap and a
  missing applied-guard on the pin being deleted).
- `modifier` + `channel: 'incomingDamage'` stays inert and stays pinned — out of scope, separate
  defect, no user ruling on it.

## A5. Overload ruling (user, 2026-08-24)

Phase 1 measurement found that the fix's largest real-kit consequence is **not** `Defense Up` — it is
`Overload`: `'+10% Outgoing Direct Damage, -10% Defense, Stackable up to 10 times'`, a SELF-buff on
Butcher, Mangler, Ravager, Asphyxiator and Ruiner, plus Refine's `Supercharged III` (`-60% Defense`).
297 probe reads at `-100%`, with a full `-10…-90` ladder.

**Ruling: apply BOTH halves.** Today the app grants Overload's damage bonus and ignores its defence
cost, which makes those 6 ships strictly better than their card text. A capped Butcher's defence term
collapsing to zero is the correct reading, and applying only the upside would be the very asymmetry
this addendum exists to remove.

Consequences:
- **No name-special-casing.** The new term is sign-agnostic: it carries positive self-sourced defence
  (Defense Up) and negative (Overload, Supercharged III) alike.
- Overload is a SELF-buff, so it lives in the victim's own self-buff store, NOT the enemy-debuff
  store that `enemy.enemyDefenseModifier` reads. **There is therefore no double count** — verified
  before ruling.
- `victimDamage.ts:114` already guards non-positive effective defence, so the `-100%` case floors at
  zero damage reduction rather than inverting into a damage bonus. No new clamp needed — but a test
  must pin that floor, because an unclamped implementation would look identical on every fixture
  that never reaches -100%.
