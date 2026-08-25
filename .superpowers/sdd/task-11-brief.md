# Task 11: close the Task 10 review (1 Critical, 5 Important, 5 Minor)

Authority: spec **ADDENDUM 3 (C1-C5)**. Definition of *Damage absorbed*: everything thrown at the
ship, all channels, BEFORE the defender reduces it. Attacker-side modifiers and enemy-APPLIED
amplification (`Out. Damage Up`, `Exposed`) stay IN. Every victim-side reduction comes OUT.

## CRITICAL

**1. The reflect channel is still inverted.** `damageReflection.ts:59-66` folds
`attackerIncomingReductionPct` into `preMitigation`. That term is NOT attacker-side: at
`engine.ts:6478` it is `incomingReductionForHit(incomingAbilitiesOf(attacker.id), …)` — the
bounce-back RECIPIENT's own `incoming-reduction` abilities, the same D-PR3 family that direction arms
4/5 already fence on the direct channel.
Measured (defender attack 50,000, 200% swing into a 50%-reflect enemy, defence 5,000, 4 rounds):
`0% -> absorbed 200,000` · `30% -> 140,000` · `60% -> 80,000`, identical round counts. **A purely
defensive ability quarters its owner's headline.**
Strip `incoming` from `preMitigation` only. `damage` stays byte-identical, so no empirical constant
moves — the duel fit governs `damage`, not `preMitigation` (which already replaces defence with an
exact `1`). **Fix the doc comment too: it currently argues against this on grounds that apply only to
the other return field.** Add a direction arm.

## IMPORTANT

**2. `equipReductionPct` is itself a MIXED channel, stripped wholesale.** At `engine.ts:7671-7685` it
sums `equip` (victim → OUT, correct) + `victimCritTerm` (victim preFight → OUT, correct) +
`attackerCritTerm` (the ATTACKER's squad-leader outgoing-crit penalty → **must stay IN**; it makes
the attack smaller AS THROWN). Same atomic-treatment-of-a-mixed-channel defect C3 exists to end,
applied to the second mixed channel while fixing the first. Unreachable from
`DefenseSimulationInput` today, so impact is nil — **but delete the "comes out for free" comment,
which is what would keep it hidden**, and split the term.

**3. The KEEP half of the split has NO test anywhere.** Mutating
`victimSideIncomingModifier: … + exposed` (i.e. over-stripping) leaves **all 584 files / 6520 tests
GREEN**. Same for `+ enemy.incomingDamageModifier` (one incidental snapshot only). C5 asks for an arm
per channel; the two KEEP channels have none. Add arms at the ENGINE population site
(`engine.ts:7301`) — the damage-site arms in `victimDamage.test.ts` are good but fence the wrong
layer.

**4. A third untested funnel write was introduced.** Deleting `preMitigationDamage: totalPreMit`
(`engine.ts:10441`, the per-victim DoT branch) leaves all 6520 tests green — the defense sim's focus
takes the heal-target branch, so the twin is unreached. Same class as the `(1 - blocked)` line this
task just cleaned up. Testable by putting the DoT on an ALLY.

**5. Docs name two cards that do not exist.** `DocumentationPage.tsx` bolds **Enemy Attackers** and
**Supporting Allies**; the UI renders `Enemy Team (N)` (`EnemyAttackersPanel.tsx:216`) and `Team`
(`TeamPanel.tsx:75`). Neither doc string exists anywhere in the app. This traded the previous
structural error for a naming error, same user-facing-inaccuracy class.
("Combat Settings holds only rounds 1-50 and shared buffs" IS accurate — leave it.)

**6. Four comments now assert the OPPOSITE of shipped behaviour** — all four claim the raw axis is
scaled by the incoming-block factor, which this commit DELETED:
`engine.ts:1709`, `engine.ts:5506`, `rawIntakeAxis.test.ts:9` (the file whose whole purpose is
documenting this contract), `dpsSimulator.ts:302` (says "before the victim's defence-mitigation
factor"; it is now before ALL victim-side reductions).

## MINOR

7. `engine.ts:1707-1708` still says "a SMALLER measured / EHP" — spans a line break, so a
   `grep "measured EHP"` cannot see it. Also `rawIntakeAxis.test.ts:26` names `victimHitDamage` for
   the positional path, which now calls `victimHitDamageParts`.
8. **Changelog mis-signals the bug's direction:** "quietly counting the buff twice: once as extra
   rounds and once as a discount on every hit" reads as making the number too HIGH; the defect made
   it too LOW (252,000 < 300,000). Everything else in the entry is verified accurate.
9. The DoT and bomb presence arms assert `damageAbsorbed === breakdown.gross`, true by construction
   on those channels — they cannot distinguish a correct raw booking from the funnel's
   `?? rawDamage` default. Not vacuous for the presence claim, but the comments claim more than the
   arms deliver. Reword, or strengthen.
10. `victimHitDamage` now has zero production callers while its sibling was deleted for that reason.
    Keeping it is defensible (real test users) — say so in a comment.
11. `victimDamage.test.ts`'s last arm builds an `args` tuple with an unused `null` at index 1; reads
    as a mistake.

## Validation
- Baseline **584 files / 6520 tests**. Report actual counts and reconcile.
- Every fix that changes a number needs a direction arm; **prove each new arm fails under the
  mutation it targets** and report the observed failure.
- Goldens: delete-and-rerun, NEVER `vitest -u`; verify numstat deletions are zero on snapshots.
- `npm run lint --max-warnings 0` (not in the husky hook), `tsc --noEmit`, `npm run audit:skills`.
