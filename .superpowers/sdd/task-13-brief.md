# Task 13: FINAL — two false claims and an inverted default ranking

Do-not-merge blockers from the pre-merge re-review. **The code is sound; almost all of this is text.**
One key-order change. Authority: spec ADDENDUM 3 (C2) + ADDENDUM 4.

## BLOCKER 1 — "attacker suppression lowers the headline" IS FALSE. Strike it everywhere.

I asserted this from ship data (`docs/ship-skills.csv` shows Opal's 1st passive inflicts
`Attack Down II`, Warden's 2nd inflicts `Out. Damage Down II`) and **never measured the engine**.
Measured (defence 0, one 10,000-attack enemy, 4 rounds):

| fixture | `damageAbsorbed` |
|---|---|
| plain | 40,000 |
| enemy SELF-buffs `Out. Damage Up +50%` | 60,000 ← channel live |
| enemy SELF-debuffs `Out. Damage Down -50%` | 20,000 ← reads debuffs on the enemy |
| **defender applies** `Out. Damage Down` / `Attack Down` | **40,000 — NO MOVEMENT** |

12 shapes swept (active/passive × enemy/primary-enemy/all-enemies × Attack Down/Out. Damage Down ×
on-cast/on-attacked). All 40,000. The debuff DOES land — a same-cast `Inc. Damage Up` halved the
enemy's survival while per-round `incomingDamageRaw` stayed flat. **The enemy attacker's outgoing fold
honours its OWN debuffs and ignores ones the DEFENDER applied.**

Strike or invert the claim in all three places:
- `src/constants/changelog.ts` entry 1 (the Opal/Warden sentence)
- `src/pages/DocumentationPage.tsx` (~2728-2745)
- **`src/utils/calculators/defenseSurvivabilitySim.ts:148-155`** — the jsdoc that IS the metric's
  definition. It currently tells callers "a defender that SUPPRESSES ITS ATTACKER lowers its own
  headline… Do not let a UI caller promise 'a defensive ability never lowers this'." That is backwards.

**Then re-derive the true claim and state it accurately.** Known routes by which the figure can fall
or fail to rise, each of which you must verify before writing it:
- ally **Protection** redirect — LOWERS it (addendum 4, LOCKED, a reassignment);
- **offence ending the fight early** — a defender that wipes the enemy roster terminates the run, so
  less is thrown in total (`healingEngineAdapter.ts:941`);
- same death round → raises NEITHER (pinned, `defenseSurvivabilitySim.test.ts:570-573`);
- survivor plateau → raises neither.
Do NOT write a route you have not measured. That instruction is the whole reason this task exists.

**Add a test arm pinning the measured fact** — a defender-applied attack/outgoing debuff does NOT
move `damageAbsorbed` — so the false claim cannot be reintroduced. Note in its comment that whether
the engine SHOULD honour defender-applied outgoing debuffs is an open question, not settled here.

## BLOCKER 2 — the zero-pressure default ranks on `elapsedRounds`, inverted

`enemies: []` becomes a **killable** practice target (40,000 HP / 5,000 defence,
`healingEngineAdapter.ts:298-307`) and the defender takes its own turns with its real `attack`
(set from the ship sheet at `DefenseCalculatorPage.tsx:101/340/405`). Measured at `rounds: 20`:
attack 0 → 20 rounds · 4,000 → 13 · 40,000 → 2 · 400,000 → 1, with `damageAbsorbed` 0 throughout.

So on the default page with real ships selected: key 1 ties at 0, **key 2 (`elapsedRounds`) decides,
key 3 never runs, and the badge goes to the WEAKEST-ATTACKING ship.**

**Fix: swap keys 2 and 3** → `damageAbsorbed → Theoretical EHP → elapsedRounds`. Rationale to state
in the comment: `damageAbsorbed` already contains rounds (more rounds thrown = more absorbed), so
`elapsedRounds` only speaks when `damageAbsorbed` ties — and in the one case where it speaks loudest
(zero pressure) it is actively inverted. Theoretical EHP at key 2 makes the default page rank on the
static estimate, which is what all three shipped claims already say it does.

Three false claims to correct, or delete once true:
`DefenseCalculatorPage.tsx:589-591`, `DocumentationPage.tsx`, `changelog.ts` entry 1 — all say it
"degrades gracefully to main's old static ranking".

**The existing arm cannot catch this**: it uses no selected ship, so attack is 0 and rounds tie.
Add an arm with two configs having DIFFERENT `attack` and zero enemies, asserting the badge follows
Theoretical EHP and not the weaker attacker. Mutation-check it against the current key order.

**Also a UI self-contradiction this commit added:** the first-run notice says "nothing is being
thrown at these ships… every ship trivially survives the window" while the card beneath prints
"Still standing — the enemy team was wiped on round 2 of 20", naming an enemy team the user never
created. Reconcile them.

## IMPORTANT

**I-1.** Docs + changelog: "two survivors that both last the FULL window under the same enemies tie
no matter how differently tanky they are" — still false via offence-driven attrition
(`defenseSurvivabilitySim.ts:126-128`; the file's own `DEFENDER` fixture uses `attack: 0` with the
comment "so the defender cannot kill an enemy and shorten its own window"). Same assert-then-retract
shape as the original C2. Qualify it.

**I-2.** `DocumentationPage.tsx:2795-2797` breaks a JSX text line before an element with no `{' '}`,
rendering "…what actually reached the **shipafter** everything…". Add the space.

**I-3.** `engine.ts:12637` says "a 100% incoming-block (which is `abilityDefaults.ts`'s DEFAULT
chance…)". `abilityDefaults.ts:71-78` defaults `blockPct: 1` but `procChance: 0`. The default block
PERCENTAGE is 100%; the default CHANCE is 0. Reachability holds, the sentence does not. Same loose
phrasing in the new test's fixture jsdoc.

## MINOR
- `DefenseShipCard.tsx`: the delta's `> 0` / `text-green-400` branch is unreachable —
  `bestDamageAbsorbed` is the maximum on that axis by construction. Either drop the branch or stop
  implying it is a guard.
- `changelog.ts` entry 3 says a Defense buff shows up "in Theoretical EHP" — that reads
  `computeBuffedStats(hp, defense, security, buffTotals)`, i.e. picker/gear buffs only. It does NOT
  move for the kit passive the same entry names (Redeemer's below-60% Defense Up II).
- Docs geometry: "sits directly under the two measured figures" — "Compared to best" and the survivor
  note are between them.

## Validation
- Baseline **584 files / 6538 tests**. Report actual counts and reconcile.
- **Every new arm mutation-checked** — apply, observe red, revert, observe green, report the message.
- Goldens: delete-and-rerun, NEVER `vitest -u`; verify numstat deletions are zero on snapshots.
- `npm run lint --max-warnings 0`, `tsc --noEmit`, `npm run audit:skills`.
- **Every claim you write must be measured against the ENGINE, not inferred from ship data or from a
  neighbouring channel.** Both blockers here are claims that were inferred rather than measured.
