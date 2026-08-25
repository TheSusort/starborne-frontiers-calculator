# Task 11 report — closing the Task 10 review (#358)

Authority: spec **ADDENDUM 3 (C1–C5)**. Every finding in `task-11-brief.md` is addressed below, plus
one channel the brief did not name (see **FINDING 12**).

---

## CRITICAL

### 1. The reflect channel was still inverted — FIXED

`src/utils/combat/damageReflection.ts`

`reflectedDamageParts.preMitigation` folded `attackerIncomingReductionPct`. The name is positional,
not causal: at `engine.ts:6478` the value is
`incomingReductionForHit(incomingAbilitiesOf(attacker.id), …)` — the abilities of the ship the
bounce-back LANDS ON, i.e. the D-PR3 victim-side family. `preMitigation` now puts an exact `1` in
BOTH victim-side slots (`base * affinity * 1 * 1`); `damage` keeps its original operand order and
its own locals and is byte-identical, so no fitted constant moved.

The stale doc comment that argued against this (`attackerIncomingReductionPct` "is deliberately
folded into BOTH … stripping it here is a separate, unmade decision (this module's own duel-fit
model owns it)") is **rewritten**, and the rebuttal is written out explicitly: the duel fit governs
`damage`; `preMitigation` is by construction a DEPARTURE from that fit because it already replaces
the fitted defence term with a literal `1`, so no constant is fitted against the axis the term was
being defended on. The parameter also gained a `⚠️ THE NAME LIES ABOUT THE SIDE` doc block, since
the name is what carried this through a full review. Deliberately NOT renamed: its sibling
`attackerDefenceReductionPct` carries the same positional convention and splitting the two would be
worse — the warning travels instead.

New arm: `defenseSurvivabilitySim.test.ts` → **CHANNEL 8**, `0% / 30% / 60%` incoming-reduction on
the bounce-back recipient, all three now `damageAbsorbed === 200_000` over the same 4 rounds, with
`gross` at `83,312 / 58,320 / 33,324` as the liveness half.

**MUTATION-CHECK** — restored `preMitigation: base * affinity * 1 * incoming`:

```
× DIRECTION (channel 8 — reflect, the recipient's own incoming-reduction): absorbed is FLAT
  AssertionError: expected 140000 to be 200000 // Object.is equality
```

Exactly the 30% figure the brief reported. Reverted; file green (26/26 at that point).

---

## IMPORTANT

### 2. `equipReductionPct` was itself a MIXED channel, stripped wholesale — FIXED (split)

`engine.ts:7658` returned ONE fused number on a crit: `equip + victimCritTerm + attackerCritTerm`.
`attackerCritTerm` is the ATTACKER's squad-leader `outgoingCritDamage` penalty — it shrinks the
attack AS THROWN and must stay on both axes.

- `positionalApply.ts` — `incomingReductionFor` may now return
  `number | { victimSidePct, attackerSidePct }`. A bare number keeps its original meaning (100%
  victim-side), which is what every non-crit hit and every direct-call test supplies, so no existing
  caller or test moved.
- `victimDamage.ts` — `victimHitDamageParts` / `victimHitDamage` gained a 6th parameter
  `attackerSideReductionPct`, subtracted from BOTH `incoming` and `incomingAsThrown`.
- **Byte-identity of `damage` preserved deliberately**: the two halves are re-SUMMED before the
  subtraction (`incomingChannel - (equipReductionPct + attackerSideReductionPct)`) in the same
  left-to-right order the engine used when it handed over the fused number. `a - (b + c)` and
  `a - b - c` are not the same double, and splitting a channel must not move an existing damage
  figure.
- The **"comes out for free"** comment is gone. `victimDamage.ts:202` used to say
  `equipReductionPct` "is not added here at all" with no mention that a third, attacker-side term
  was riding inside it; the replacement enumerates all three terms and says which side owns each.
  The engine call site gained a matching block naming the mixed-channel trap.

New arms in `victimDamage.test.ts`:
- `attackerSideReductionPct` shrinks the attack as THROWN: it lowers BOTH axes
- the two halves of the split are INDEPENDENT: same total, different thrown axis

**MUTATION-CHECK** — dropped `- attackerSideReductionPct` from `incomingAsThrown` (the pre-split
behaviour):

```
× `attackerSideReductionPct` shrinks the attack as THROWN: it lowers BOTH axes
  AssertionError: expected 1000 to be close to 750, received difference is 250, but expected 5e-11
× the two halves of the split are INDEPENDENT: same total, different thrown axis
  AssertionError: expected 1000 to be less than 1000
```

Reverted; 13/13 green.

Note on scope: the AGGREGATE (legacy non-positional) mirror at `engine.ts:11432` fuses the same two
crit-family terms into `preFightCritFamilyPct`. It is left alone: that path books no
`preMitigationDamage` at all (zero corpus calls, parked with #357), so there is no second axis for a
split to reach.

### 3. The KEEP half of the split had NO test anywhere — FIXED at the engine population site

Two arms added to `defenseSurvivabilitySim.test.ts`, driving the engine end to end rather than the
damage site (`victimDamage.test.ts` proves `victimHitDamageParts` honours the split it is HANDED;
that is a different claim from "the engine hands it the right split", and a single `+ exposed` at
`engine.ts:7308` satisfies the first while violating the second):

- **KEEP (enemy-applied Inc./Out. Damage Up)** — `40_000 → 60_000` (×1.5), same 4 rounds.
- **KEEP (Exposed)** — `40_000 → 80_000` (×2), same 4 rounds. Built on the NAME (no
  `parsedEffects.incomingDamage`), so it exercises the `exposedIncomingPct` read rather than testing
  Inc. Damage Up twice.

Both place the debuff clause BEFORE the damage clause (locked clause-order rule, #289) so round 1
is amplified too and the ratio is a clean ×N instead of an off-by-one-round figure.

**MUTATION-CHECK 1** — `victimSideIncomingModifier: selfIncoming + preFightIncoming + exposed`:

```
× KEEP (Exposed): a name-keyed one-shot amplification RAISES absorbed
  AssertionError: expected 40000 to be greater than 40000
```

**MUTATION-CHECK 2** — `victimSideIncomingModifier: … + enemy.incomingDamageModifier`:

```
× KEEP (enemy-applied Inc./Out. Damage Up): amplification RAISES absorbed
  AssertionError: expected 40000 to be greater than 40000
```

Each mutation kills exactly its own arm and nothing else. Reverted; 28/28 green.

### 4. A third untested funnel write — FIXED (new path-8 arm)

`engine.ts:10463` (`preMitigationDamage: totalPreMit`, the per-victim DoT branch). Unreachable from
the defense sim because its focus IS the heal target and takes the other branch; reached by putting
the DoT on an **ALLY**, using `rawIntakeAxis.test.ts`'s walked-team harness.

New: `#358 A3 — path 8: the per-victim DoT tick batch on an ALLY`. A Vortex Veil passive on the ally
halves what ARRIVES (`bare.post → bare.post × 0.5`) and is invisible on the thrown axis
(`veiled.raw === bare.raw === 27_000`). Control arm asserts `bare.raw === bare.post` first, so the
divergence is attributable.

Two fixture traps found and documented in the test:
- the veil must be in a **passive** slot (`incomingAbilitiesById` filters non-passive) or every
  figure comes back equal and the arm passes for the wrong reason;
- the DoT applier needs **hacking 200**. `liveDebuffLandingChance` defaults a missing hacking base
  to 200 and a missing security base to 100, so this file's usual `hacking: 0` gives a landing
  chance of ZERO and the DoT never applies at all — measured, that build reported intake 0 on both
  axes and every assertion passed vacuously. At hacking 200 the chance is exactly 1 (certain, not
  drawn), so the file's "no live RNG" property holds; its header now says so.

**MUTATION-CHECK** — deleted `preMitigationDamage: totalPreMit`:

```
× an ally's ticks book the pre-REDUCTION figure on the raw axis
  AssertionError: expected 13500 to be close to 27000, received difference is 13500, but expected 5e-7
```

Reverted; 12/12 green.

### 5. Docs named two cards that do not exist — FIXED

`DocumentationPage.tsx` bolded **Enemy Attackers** / **Supporting Allies**. Verified against the
rendered components: `EnemyAttackersPanel.tsx:216` renders `Enemy Team (N)` and `TeamPanel.tsx:75`
renders `Team`, and `DefenseCalculatorPage.tsx` mounts exactly those two plus
`DefenseSettingsPanel`'s `Combat Settings`. Docs corrected to **Enemy Team** / **Team**. The
"Combat Settings holds only rounds 1–50 and shared buffs" sentence was re-verified accurate and
left alone.

Added a tripwire on the side that actually moves: `DefenseCalculatorPage.test.tsx` →
`renders the three collapsible cards the in-app docs name`, asserting `Enemy Team (N)`, `Team` and
`Combat Settings` render. Rename a heading and it goes red, which is the prompt to update the docs
paragraph in the same commit. (No mutation-check reported for this arm because it is not a
numeric-direction arm — its failure mode is a renamed string, which is what the assertion literally
reads.)

### 6. Four comments asserting the OPPOSITE of shipped behaviour — FIXED

All four claimed the raw axis is scaled by the incoming-block factor, which this branch deleted:

- `engine.ts` `ActorIntake.incomingRaw` — rewritten. Now enumerates what comes OUT (defence,
  `Inc. Damage Down` family, `preFightIncoming`, `equipReductionPct`, `incomingDotReductionPct`, the
  reflect incoming-reduction) and what stays IN, and states the scaling precisely: Protection
  retention YES, incoming-block NO.
- `engine.ts` `cause.preMitigationDamage` — rewritten, same correction, plus: "ABSENT means this
  path applies NO victim-side reduction whatsoever", since the old "applies no defence mitigation"
  reading is what let the DoT-tick sites look exempt.
- `rawIntakeAxis.test.ts` header — rewritten with an explicit `⚠️ SCALING — READ THIS BEFORE
  TRUSTING AN OLDER COMMENT` block, since this is the file whose whole purpose is documenting the
  contract.
- `dpsSimulator.ts` `perActorIncoming` — "before the victim's defence-mitigation factor" replaced
  with the full victim-side list, and the sentence now says why the old phrasing under-states it.

Two further stale comments in the same class, not in the brief, corrected while here:
- `defenseSurvivabilitySim.ts` `DefenseIntakeBreakdown.gross` said `gross` "is the measured-EHP
  figure". It is the POST-mitigation axis; the headline is `damageAbsorbed`, which reads RAW. That
  sentence was true for exactly one revision and is the reading addendum 3 retired the name over.
- `defenseSurvivabilitySim.ts` `incomingDamageRaw` / the `grossRaw` comment — both said "pre
  defence mitigation" only.

### 7. Minor comment defects — FIXED

- `engine.ts:1707-1708` "a SMALLER measured / EHP" (split across a line break, invisible to
  `grep "measured EHP"`) — gone with the rewrite above; the surviving mention now reads
  `"measured EHP" as a NAME is retired — addendum 3 C1`.
- `rawIntakeAxis.test.ts` fold-site list — path 1 renamed `victimHitDamage` → `victimHitDamageParts`
  and path 6 `reflectedDamageForHit` → `reflectedDamageParts`, with a note explaining why (both used
  to be a single-axis function plus a hand-copied twin; the twins are gone). The list also gained
  path 8 and a correction: the DoT tick batch is NO LONGER in the "folds no defence, so raw === post
  by construction" group.

### 8. Changelog mis-signalled the bug's direction — FIXED

Was: "quietly counting the buff twice: once as extra rounds and once as a discount on every hit" —
reads as inflation. The defect made the figure too LOW. Now: "…LESS than the unprotected ship
managed, because the buff was still being subtracted from every single hit on the way into the
total. Six rounds of 60,000 with 30% shaved off each one comes to 252,000, so the discount more than
cancelled out the extra round the buff had bought: protecting the ship LOWERED its score."

Also added the reflect example (the Critical, a genuine user-visible fix): 200,000 → 140,000 → 80,000
over the same four rounds, all three now 200,000.

### 9. Presence arms claiming more than they deliver — REWORDED

The DoT and bomb `damageAbsorbed === breakdown.gross` lines now say what they are: equality by
CONSTRUCTION on those fixtures (no defence folded, no other victim-side reduction), so they cannot
distinguish a correct raw booking from the funnel's `?? rawDamage` fallback. They are tripwires on
the FIXTURE, and the comments now point at where the booking IS fenced (channel 6 on the focus,
`rawIntakeAxis.test.ts` path 8 on an ally).

### 10. `victimHitDamage` has zero production callers — DOCUMENTED

Doc block added saying why it survives while its pre-mitigation sibling was deleted for the same
reason: it is the `.damage`-only façade a dozen unit tests are written against, it is a one-line
delegation to the parts helper so it cannot drift the way the hand-copied twin did, and it should be
deleted only together with those tests.

### 11. `args` tuple with an unused `null` at index 1 — FIXED

`victimDamage.test.ts`'s last arm rewritten with a named `CRIT_SCALARS` const and explicit
arguments; the placeholder tuple is gone.

---

## FINDING 12 (NEW) — a FIFTH channel the brief did not name: the Protection redirect

`engine.ts:5844`, `damageRaw = damageRaw * cascade.targetRetainedFraction`. This is the second of
the two funnel scalings C5 flagged as untested (`(1 - blocked)` is channel 5/5), and testing it
surfaced a channel C2 lists on NEITHER side of its IN/OUT ledger.

**MEASURED** — 4-round survivor window, 10,000/round, defender defence 5,000:

| board | damageAbsorbed | rounds |
|---|---|---|
| no ally | 40,000 | 4 |
| ally holding 0 Protection stacks | 40,000 | 4 |
| ally holding 3 stacks (30%) | **28,000** | 4 |
| ally holding 5 stacks (50%) | **20,000** | 4 |

Same rounds, same survival, half the headline. Shape-wise indistinguishable from the four inversions
this addendum exists to end.

**NOT changed, deliberately** — this is a game/product ruling, not something to infer from the
neighbouring channels:
- FOR counting it: the damage WAS thrown at this ship, and C2's governing sentence is "everything
  thrown at the ship … before the defender reduces it".
- AGAINST counting it: a redirect is a REASSIGNMENT, not a reduction. The slice is booked in full on
  the PROTECTOR's own raw axis (`rawIntakeAxis.test.ts` path 7), so counting it on both would
  double-count it across the board, and "absorbed" arguably names the ship that actually ate it.

**What was done instead:** current behaviour PINNED with the numbers above, in
`defenseSurvivabilitySim.test.ts` → `CHANNEL 9 — a Protection redirect currently LOWERS absorbed
(pinned, not endorsed)`, with a `⚠️ OPEN GAME-SEMANTICS QUESTION` header stating both readings. This
also closes C5's second untested funnel scaling. A zero-stack ally is the control arm, so the
movement is attributable to the redirect and not to "a second ship joined the board". The
user-facing text in `DocumentationPage.tsx` and the changelog entry were both softened accordingly
("a defensive ability **on the ship itself** never lowers this number") with the Protection carve-out
spelled out for the reader — leaving them absolute would have been a new user-facing inaccuracy
created by this finding.

Fixture trap worth recording: a `SelectedGameBuff` named `'Protection'` on a `TeamActorInput`
**never reaches** `selfBuffStacksForOwner`. Measured, that build reported 40,000 at every stack
count and would have "proved" the channel inert. The cascade needs an ABILITY-granted Protection
(`hasAnyProtectionGrant` scans ability configs).

## Channels swept and found already correct

Checked for a sixth: `outgoingAmplificationFor` (D-PR4, applied to both axes — correct),
`defensePenetrationPct` (attacker-side; irrelevant once defence is `1`), `victimDotMult` (the
APPLIER's outgoing DoT modifier plus victim-status-gated attacker bonuses — attacker-side),
`incoming-reduction` scope union (`'direct' | 'dot'` only, so no bomb-side victim reduction exists),
the counter-attack and reactive-proc paths (both pass `incomingDamageModifierPct: 0`, so there is no
victim-side reduction to strip), the passive-slot hit (no `equipReductionPct` passed), Barrier /
Shield Converter / Cheat Death (all sit AFTER `addIncomingRaw`, so the raw booking stands), and
`convertHitToSelfDot` (C4, booked at throw time with a load-bearing explicit
`perTickPreMitigation: 0`).

---

## Validation

| | baseline | after |
|---|---|---|
| test files | 584 passed (584) | **584 passed (584)** |
| tests | 6520 passed (6520) | **6528 passed (6528)** |
| failures | 0 | **0** |
| skipped | 0 | **0** |

**Reconciliation of +8**, all new arms, no file added or removed:

| file | + | arms |
|---|---|---|
| `defenseSurvivabilitySim.test.ts` | +4 | channel 8 (reflect), KEEP × 2, channel 9 (Protection) |
| `victimDamage.test.ts` | +2 | attacker-side lowers both axes; halves are independent |
| `rawIntakeAxis.test.ts` | +1 | path 8 (ally DoT tick batch) |
| `DefenseCalculatorPage.test.tsx` | +1 | the three card headings the docs name |

Other gates:
- `npx tsc --noEmit` — clean.
- `npx eslint src --max-warnings 0` — clean (not in the husky hook, run explicitly).
- `npm run audit:skills` — `Audited 149 ships → 0 findings.`
- `npx prettier --check` on every changed file — clean (`DocumentationPage.tsx` needed one
  `--write` pass after the JSX edit; re-checked clean).
- **Goldens: never `vitest -u`, never `--update`.** `git diff --numstat` shows **ZERO snapshot or
  golden files touched at all**, so snapshot deletions are 0. Total deletions across the whole
  branch diff: **105**, all in the 12 source/test files listed by `--numstat`, none in a `.snap` or
  golden fixture.
- No `git stash` / `git reset` / `git checkout -- <path>` was run at any point.
