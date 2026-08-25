# Task 13 report — two false claims and an inverted default ranking (#358)

Status: **complete.** Both do-not-merge blockers closed, the three Importants and two of the three
Minors done, the third Minor **refuted by measurement and deliberately not changed**.

---

## The measurement discipline, and the trap it caught

The brief's own measurement table for BLOCKER 1 was **itself vacuous**, and I only found that
because I re-measured instead of trusting it.

The brief reported "12 shapes swept (active/passive × enemy/primary-enemy/all-enemies × Attack
Down/Out. Damage Down × on-cast/on-attacked). All 40,000." I reproduced that and got 40,000 too —
and then my liveness probe came back **inert**: the very same debuff instance carrying an
`incomingDamage: +200` half did not shorten the enemy's life either. A debuff that changes nothing
at all is a debuff that never applied.

Swept the shape space and found the cause: **`duration: 'recurring'` on a defender-applied enemy
debuff is INERT; only a NUMERIC duration lands.**

| shape (defender applies `incomingDamage: +200` to the enemy, defender swings) | enemy dies |
|---|---|
| `duration: 'recurring'`, any `application`, any `target`, either clause order | round 5 = no effect |
| `duration: 3`, debuff clause first | round 2 |
| `duration: 3`, debuff clause second | round 3 (intra-cast clause order) |

Mechanism confirmed in `statusEngine.ts` (the timed enemy write is gated on
`typeof buff.skillDuration !== 'number'`).

So the brief's sweep proved nothing: 12 fixtures in which the debuff had never landed. **The right
conclusion happened to survive a wrong instrument.** Every figure below was re-measured on a shape
whose landing is independently demonstrated.

---

## Candidate routes: measured, kept, or dropped

| candidate route | measurement | verdict |
|---|---|---|
| a defender that **suppresses its attacker** lowers its own headline | 4-round pinned window, defence 0, one 10,000-attack enemy. plain **40,000**; defender-applied `Out. Damage Down −50%` **40,000**; `Attack Down −50%` **40,000**; `Attack Down −90%` **40,000**; `{−50% out, +200% inc}` **40,000**. `breakdown.gross` flat too. Liveness A: the same −50% **self-applied by the enemy** → **20,000** (fold is live and sign-sensitive). Liveness B: the same debuff instance's `+200% incoming` half killed the enemy in round 2 instead of round 5 (the instance lands). | **DROPPED — FALSE.** Struck from all three sites. |
| ally **Protection** redirect LOWERS it | `defenseSurvivabilitySim.test.ts` CHANNEL 9, green in baseline: alone **40,000**, 0-stack ally control **40,000**, 30% **28,000**, 50% **20,000**, identical rounds. | **KEPT** (addendum 4, LOCKED). |
| **offence ending the fight early** | 6-round window, 10,000/round: defender attack 0 → **60,000 over 6**; 20,000 → **40,000 over 5**; 200,000 → **0 over 1**. | **KEPT.** |
| **offence-driven attrition inside a fully-survived window** (not in the brief — found while re-deriving I-1) | two 5,000-attack enemies, one killable, 6 rounds, **all three runs survived 6/6**: attack 0 → **60,000**; 20,000 → **40,000**; 60,000 → **30,000**. | **KEPT — new**, and it is what makes the shipped "two full-window survivors tie" claim false. |
| same death round → raises neither | already pinned (the round-quantum arm), green in baseline. | KEPT, unchanged. |
| survivor plateau → raises neither | already pinned (SURVIVOR PLATEAU arm), green in baseline. | KEPT, unchanged. |
| zero-pressure practice target is killable, so rounds track attack | `rounds: 20`, `enemies: []`, defender with an offensive active: attack 0 → **20 rounds**, 4,000 → **13**, 40,000 → **2**, 400,000 → **1**, `damageAbsorbed` **0** throughout. **NOTE:** with NO offensive ability in the kit it is 20 rounds at every attack value — the kit is load-bearing for this effect, which is why the new page arm gives its fake ships parseable damage text. | KEPT — this is BLOCKER 2. |

Nothing was written that is not in this table.

---

## BLOCKER 1 — struck, re-derived, fenced

Removed from:
- `src/utils/calculators/defenseSurvivabilitySim.ts` — the jsdoc that **defines** `damageAbsorbed`.
  It told UI callers "a defender that SUPPRESSES ITS ATTACKER lowers its own headline… Do not let a
  UI caller promise 'a defensive ability never lowers this'." Replaced with the measured table, an
  explicit note that the Opal/Warden citation was verified from `docs/ship-skills.csv` and **never
  measured against the engine**, and a new bullet for the defender's own offence (both shapes).
- `src/pages/DocumentationPage.tsx` — "Three things that ability will not do" → "Two", and a new
  paragraph "Debuffing the attacker does not lower it either" carrying the measured figures.
- `src/constants/changelog.ts` entry 1 — the Opal/Warden sentence replaced with the measured
  40,000/40,000/20,000 comparison and the open question stated as open.

## BLOCKER 2 — keys 2 and 3 swapped

`DefenseCalculatorPage.tsx` `rankKeyOf` is now
`damageAbsorbed → Theoretical EHP → elapsedRounds`, with the rationale and the measured
attack→rounds table in the comment.

Three false "degrades gracefully to main's old static ranking" claims corrected:
`DefenseCalculatorPage.tsx` (the ladder comment), `DocumentationPage.tsx`, `changelog.ts` entry 1.
Each now says the fallback is Theoretical EHP and explains why rounds sit last (`damageAbsorbed`
already contains rounds; with no enemy configured rounds run **backwards**).

**UI self-contradiction reconciled.** New `noEnemiesConfigured` prop on `DefenseShipCard`: with an
empty roster the early-finish note now reads "this ship destroyed the inert practice target on round
N of M" instead of naming an enemy team the user never created. The page notice was rewritten to
match — it now says the fight runs against one inert-but-**killable** practice target and that
Rounds survived can therefore read short.

## Importants

- **I-1** — qualified in both docs and changelog, and grounded in the new attrition measurement
  (60,000 / 40,000 / 30,000 at 6/6 rounds). The claim now reads "…provided neither of them kills an
  attacker", with both shapes of offence-driven separation spelled out.
- **I-2** — fixed. `…reached the ship <em>after</em>{' '}` (was rendering "shipafter").
- **I-3** — fixed in both places. `engine.ts` now says `abilityDefaults.ts` defaults `blockPct: 1`
  (a full block) while its `procChance` default is 0, so the **magnitude** is 100% and the
  **chance** is 0; the `rawIntakeAxis.test.ts` fixture jsdoc now attributes `procChance: 1` to the
  fixture rather than to the default.

## Minors

- **Unreachable green branch** — dropped. `bestDamageAbsorbed` is the maximum on that axis by
  construction, so the delta is never positive on a not-best card; two tones now, with a comment
  saying why a third would be dead code. The existing `0.00%` assertion still holds.
- **Docs geometry** — fixed: "sits below the two measured figures — after the 'Compared to best'
  row and the survivor note where those are shown — and above Theoretical EHP".
- **changelog entry 3, "a Defense buff shows up in Theoretical EHP"** — **REFUTED, left alone.**
  The premise was that `computeBuffedStats` reads picker/gear buffs only. Measured: selecting a ship
  calls `buildSkillBuffAutoFill(ship)` and merges the result into `config.buffs`. On Redeemer's real
  passive text that auto-fill produces
  `{buffName: 'Defense Up II', parsedEffects: {defense: 30}, skillSource: 'passive1'}`, and
  `mergedBuffTotals` sums exactly `c.buffs → parsedEffects.defense` into what
  `computeBuffedStats` reads. So the kit passive the entry names **does** move Theoretical EHP. The
  claim is true as written; "fixing" it would have introduced a new falsehood. (Aside, not changed:
  the auto-fill drops the below-60% gate, so Theoretical EHP shows it as always-on.)

---

## New test arms and their mutation checks

All three were checked: mutation applied → red → reverted → green.

**Arm 1 — `defenseSurvivabilitySim.test.ts`, describe "a DEFENDER-APPLIED outgoing debuff does NOT
move the headline"** (3 `it`s: two liveness, one direction). Comment states explicitly that whether
the engine *should* honour defender-applied outgoing debuffs is an **open question this task does
not settle**, and that the arm is DELETE-ME-DON'T-LOOSEN-ME if the answer is later yes.

- *Semantic production mutation*, `statusEngine.ts` `applyTimedAbilityStatus` — route an
  enemy-side (applied) status onto the target's own SELF map, i.e. make the engine honour a
  defender-applied debuff in the target's outgoing fold:
  `status.side === 'self' ? getSelfMap(selfEffectiveId) : getSelfMap(enemyEffectiveId)`
  → **RED**: `DIRECTION … leaves absorbed FLAT` — `AssertionError: expected 20000 to be 40000`.
  (Also reddened two pre-existing amplification arms, as expected for a mutation this broad.)
- *Vacuity fence*, fixture `duration: 99` → `'recurring'`
  → **RED**: `LIVENESS: the same debuff instance DOES land` —
  `AssertionError: expected 5 to be 2`. This is the trap that made the brief's own sweep vacuous;
  the arm now cannot be rewritten back into it silently.
- Reverted; file green at 33 tests.

**Arm 2 — new file `DefenseCalculatorPage.zeroPressureRanking.test.tsx`.** Two configs with
DIFFERENT `attack` and no enemies. The weak attacker is added FIRST so "first wins" and "best wins"
cannot coincide; the tanky hard-hitter is second. Two liveness assertions (the round counts really
differ — one shows "Survived all 20 rounds", the other "destroyed the inert practice target on round
N"; and the zero-pressure notice is present, so key 1 really is tied) plus the assertion that the
badge is on the high-EHP / FEWEST-rounds card, and that there is exactly one badge.

- *Mutation*: swap `rankKeyOf` keys 2 and 3 back to `damageAbsorbed → elapsedRounds → Theoretical
  EHP` → **RED**: `TestingLibraryElementError: Unable to find an element with the display value:
  999999.` — the badge moved to the weak-attacking Peashooter, which is the shipped bug.
- Reverted; green.

Why this needed a new file: `attack` has **no input on the ship card**, so the only way to give a
config a non-zero one is to pick a ship — and `DefenseCalculatorPage.test.tsx` mocks `ShipSelector`
to `() => null`. `vi.mock` is hoisted per module, so the stub cannot be shared (same reason
`HealingCalculatorPage.zeroEnemies.test.tsx` duplicates its mock block). Confirmed the existing
zero-pressure arm is blind here: it runs at attack 0 for every config, where rounds tie.

**Arm 3 — `defenseSurvivabilitySim.test.ts`, describe "offence-driven attrition separates two
FULL-window survivors".** Two 5,000-attack enemies, one killable and one not (so the roster can
never be wiped and the window is always used in full — which is what makes this attrition rather
than the early termination the docs already covered). Ordered strict inequalities plus the pinned
60,000 / 40,000 / 30,000, with a survived-6/6 liveness gate on all three runs.

- *Mutation*: `defenseSurvivabilitySim.ts` stop threading the defender's own offence
  (`attack: input.defender.attack` → `attack: 0`)
  → **RED**: `AssertionError: expected 60000 to be less than 60000`.
- Reverted; green.

Also updated the stale ladder comment in `DefenseCalculatorPage.test.tsx:115`
(`damageAbsorbed -> elapsedRounds -> Theoretical EHP` → `damageAbsorbed -> Theoretical EHP ->
elapsedRounds`).

---

## Validation

| check | result |
|---|---|
| baseline | **584 files / 6538 tests, 0 failures, 0 skipped** (confirmed before any edit) |
| after | **585 files / 6543 tests, 0 failures, 0 skipped** |
| reconciliation | +1 file = the new page test. +5 tests = 3 (arm 1) + 1 (arm 3) + 1 (arm 2). Exact. |
| `tsc --noEmit` | clean, exit 0 |
| `npm run lint -- --max-warnings 0` | clean, no output |
| `npm run audit:skills` | 149 ships → 0 findings, `docs/skill-audit.md` unchanged |
| prettier | one file needed formatting (`DocumentationPage.tsx`); ran `--write`; the resulting diff is confined to the paragraphs I rewrote — no unrelated churn |
| **snapshot deletions** | **0** — `git diff --numstat -- '*.snap'` is EMPTY; no snapshot file was touched at all. `vitest -u` / `--update` never run. |
| total diff | 9 files modified + 1 new; 402 insertions / 63 deletions, every deletion inside a region I rewrote |

## Files changed

- `src/utils/calculators/defenseSurvivabilitySim.ts` — the metric-defining jsdoc
- `src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts` — arms 1 and 3
- `src/pages/calculators/DefenseCalculatorPage.tsx` — key swap, notice text, new prop wiring
- `src/pages/calculators/__tests__/DefenseCalculatorPage.zeroPressureRanking.test.tsx` — NEW, arm 2
- `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx` — stale ladder comment
- `src/components/calculator/DefenseShipCard.tsx` — practice-target wording, dead branch dropped
- `src/pages/DocumentationPage.tsx` — blocker 1, blocker 2, I-1, I-2, geometry minor
- `src/constants/changelog.ts` — blocker 1, blocker 2, I-1
- `src/utils/combat/engine.ts` + `src/utils/combat/__tests__/rawIntakeAxis.test.ts` — I-3

## Concerns

1. **An open engine question is now pinned as behaviour.** A defender-applied `Attack Down` /
   `Out. Damage Down` does not reduce what the attacker throws. That is almost certainly wrong for
   the *game* — Opal's and Warden's passives exist to do exactly that — but deciding it is a
   game/product ruling, not something to infer. The arm and all three text sites say so and name
   themselves as the things to delete if the ruling goes the other way. **This is a candidate
   follow-up issue.**
2. **`duration: 'recurring'` silently swallows defender-applied enemy debuffs.** Any fixture in this
   codebase that applies an enemy debuff with a recurring duration is measuring nothing. I checked
   only what this task needed; a sweep of the wider corpus for that shape may be worth an issue.
3. The `noEnemiesConfigured` prop defaults to `false`, so a future caller that forgets it gets the
   old "the enemy team was wiped" wording back. The only caller passes it.
