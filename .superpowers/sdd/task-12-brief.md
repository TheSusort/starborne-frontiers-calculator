# Task 12: close the whole-branch review (4 blockers + carried findings)

Authority: spec **ADDENDUM 3 (C2)** for the metric definition, **ADDENDUM 4** for Protection.
*Damage absorbed* = everything thrown at the ship, all channels, BEFORE the defender reduces it.

## TIER 1 — MERGE BLOCKERS. Do these first, prove each.

**1. (C1) `bestShip` is `null` on the page's default state — a real regression vs main.**
`DefenseCalculatorPage.tsx:189` seeds `enemies: []`. An empty roster becomes the `attack: 0` practice
target, so `damageAbsorbed === 0` for EVERY config (pinned: `defenseSurvivabilitySim.test.ts:166`).
The reduce is `currentEHP > bestEHP ? current : best` — `0 > 0` is false forever, so `bestShip` stays
`null`: no `border-primary`, no "Best ship configuration" badge, `bestEffectiveHP` undefined so the
"Compared to best" row never renders, and no `isHighlighted` series in `DamageReductionChart`. On
main the static ranking always produced a best.
Fix the reduce so it always answers (seed with the first config, or `>=`-with-first-wins — your call,
but state the tie-break you chose and why).
**The existing guard test cannot catch this: it adds an enemy first.** Add an arm for the
zero-pressure default. Also handle the second-order case the reviewer names: when all configs survive
the figure is flat, so `>` never fires and the badge lands on whichever card was added first.

**2. (C2) The central user-facing claim is FALSE, three ways.**
`DocumentationPage.tsx:2712-2715` and `changelog.ts:9` say a defensive ability on the ship itself
"never lowers this number". Falsified by:
(a) same round of death → raises NEITHER (your own pin, `defenseSurvivabilitySim.test.ts:570-573`);
(b) survivor plateau → raises neither;
(c) **real ships that suppress the attacker.** `preMitigation` keeps `perHitShare` (from
`s.effectiveAttack`) and `outgoingPct`, so a defender that debuffs its attacker lowers its OWN raw
axis. Verified in `docs/ship-skills.csv`: **Opal** 1st passive inflicts `Attack Down II` when
directly damaged; **Warden** 2nd passive inflicts `Out. Damage Down II` — the exact mirror of
`Out. Damage Up`, which the same docs paragraph lists as counted IN.
The METRIC is right; the CLAIM is wrong. Also: changelog entry 1 asserts the raise in its opening
clause and RETRACTS it 900 words later ("two ships that die on the same round report the same total").
Suggested wording: "never lowers it through its own damage *reduction* — Defense, Inc. Damage Down,
gear reduction and block procs are all excluded — and raises it whenever it buys another round."
Present Protection as one of SEVERAL exceptions, not "One exception".

**3. (C3) Changelog entry 3's worked example misdescribes AEGIS.**
`changelog.ts:11` says "have AEGIS grant it Defense Up II". Per `docs/ship-skills.csv`, AEGIS grants
Defense Up II **to ITSELF**, triggered when an ally within the active pattern has their shield
destroyed. It cannot grant it to the front ship. The arithmetic is right (dr(5000)=58.34,
dr(6500)=64.68, 8,331 → 7,064) — only the attribution is wrong, and wrong in exactly the way that
makes a user try to reproduce it and conclude the fix does not work. Pick a ship that really does
grant Defense Up to an ally, or restate it without naming a granter.

**4. (C4) The module jsdoc that IS the metric's definition documents the RETIRED axis.**
`defenseSurvivabilitySim.ts:128-145`, headed "WHICH DEFENSIVE CHANNELS MOVE THE MEASURED NUMBER" and
prefaced "A caller wiring UI onto this result must not promise more than the engine delivers". Every
item on its REACHES-IT list is now stripped from the headline by construction; the list describes
`breakdown.gross`. Its Overload claim is backwards: less defence → dies sooner → FEWER rounds →
LOWER. Task 10/11 fixed this exact ambiguity 60 lines below (in `DefenseIntakeBreakdown.gross`) and
left the header standing. Rewrite it for the shipped axis, and say plainly which list belongs to
`damageAbsorbed` and which to `breakdown.gross`.

## TIER 2 — fix with Tier 1

**5. (I3) "Compared to best" measures a different axis from the one that chose "best".**
`DefenseShipCard.tsx:292-303` computes the delta on `effectiveHP` in hardcoded `text-red-500`, but
ranking is now on `damageAbsorbed`. A not-best card can render `+14.22%` in red. Also `:257` applies
the `isBest` primary highlight to the **Theoretical EHP value**, implying it is the best Theoretical
EHP. Put the delta on the ranking axis, and colour by sign.

**6. (I4) "Effective HP" survives in three places after the card renamed the figure:**
`DefenseCalculatorPage.tsx:596` (page subtitle — the first line a user reads),
`:676-679` (a card titled "Effective HP Explanation" whose text now reads as a definition of *Damage
absorbed*, which the docs insist Theoretical EHP is not), and `SecurityEHPChart.tsx:43,:183`.

**7. (I5) Roster-wipe termination falsifies two shipped claims.** A high-attack defender can wipe the
enemies on round 6 of a 20-round window: `survived === true`, `elapsedRounds === 6`, and the card
prints "Survived all 6 rounds" against a 20-round setting. Two survivors then absorb DIFFERENT
totals, so `changelog.ts:9`'s unqualified "two survivors tie" is wrong. Fix the claim and the card
wording.

**8. (I1/I2) Three comment sets assert invariants this branch made false.**
- `engine.ts:12626-12633`: the emptiness gate claims `incoming === 0 ⟹ incomingRaw === 0` "and a
  DoT-transform reversal nets both to 0 together". BOTH halves are now false — Task 10 stopped
  scaling `damageRaw` by `(1 - blocked)` (a 100% block, which is `abilityDefaults.ts:76`'s DEFAULT
  and reachable from this page's own skill editor, gives `incoming 0` with `incomingRaw > 0`), and
  Task 11 stopped reversing the raw axis on transform. Fix the comment; consider adding
  `incomingRaw` to the gate.
- `engine.ts:1721`, `healingEngineAdapter.ts:188`, `dpsSimulator.ts`: "always `>=`" is a WINDOW-SUM
  invariant, not per-round — the transform books full raw at throw time and the re-booking ticks
  carry `perTickPreMitigation: 0` while contributing real post damage. Say which it is.
- `rawIntakeAxis.test.ts:740` is named `'raw >= post for EVERY actor in EVERY run this file performs'`
  but the file contains no transform run — the one construction that can violate it. Rename to state
  the file-local scope.

**9. (I8) Two user-visible behaviours have no changelog entry and no docs paragraph:** the skill
editor on the defense card (including the deliberate `hasPassive` widening so defensive passives that
parse to nothing still get an Edit button), and the RANKING change (a different card gets highlighted
for the same inputs). Also: entry 3 closes "the defense calculator … change[s] with it" while entry 1
lists Defense mitigation as EXCLUDED from the headline — read together a user concludes a Defense
buff moves the headline. It moves Rounds survived and the "Reached the ship" sub-total only.

**10. (upgraded from follow-up) RENAME `attackerIncomingReductionPct` → a victim-side name.**
It is the bounce-back recipient's own reduction, and that misnomer let a Critical survive a full
review. The upgrade reason is new: this branch added **`attackerSideReductionPct`** (where "attacker"
is CAUSAL — the attacker's own squad-leader penalty) one call away from
**`attackerIncomingReductionPct`** (where "attacker" is POSITIONAL — the reflect recipient, i.e. the
victim). Two adjacent parameters, same prefix, opposite meaning. Rename the positional one.

**11. (I6) Join the Overload chain.** `* s.stacks` is pinned only at the pure-reducer level
(`dpsBuffHelpers.test.ts`), and EVERY arm in the sole engine-level gate
(`selfDefenceBuffMitigation.test.ts`) hardcodes `stacks: 1` — while one arm's comment says "Overload
at 5 stacks" about a `stacks: 1, defense: -50` fixture. Add ONE engine-level multi-stack arm so the
chain (real stacks → accumulate → −100% → zero mitigation) is verified end to end, and fix that
false comment.

## TIER 3 — only if cheap; STOP AND REPORT if any would balloon
12. **(M5/M8) Labels/lists understate.** "Reached the ship (after defence)" is after defence AND
    `Inc. Damage Down`, `equipReductionPct`, `preFightIncoming` and block. The docs' exclusion list
    omits `incomingDotReductionPct` (Vortex Veil) and the reflect channel's own reduction; the
    "Shields and Barrier still count" line omits Shield Converter.
13. **(M6) Docs geometry is wrong:** they say the breakdown renders "beneath"/"underneath"
    Theoretical EHP; it renders ABOVE. "Both figures side by side" — there are three, stacked.
14. **(M7) "Rounds survived" is the round it DIED in** — a casualty's `elapsedRounds` equals
    `destroyedRound`, so the card reads "Rounds survived: 5 … Destroyed round 5". It survived four.
15. **(M2) Dead test line:** two tests click `/Combat Settings/i` before `Add Enemy`, which lives in
    the "Enemy Team" panel; `CollapsibleForm` keeps children mounted, so the click is a no-op.
16. **(M9) First-run UX:** the default empty roster shows "Damage absorbed: 0" and "Survived all 20
    rounds" with nothing telling the user to add an enemy.

## Validation
- Baseline **584 files / 6528 tests**. Report actual counts and reconcile.
- **Every new arm must be mutation-checked** — apply the mutation, observe red, revert, observe
  green, report the message. An unchecked arm is not evidence.
- Goldens: delete-and-rerun, NEVER `vitest -u`; verify numstat deletions are zero on snapshots.
- `npm run lint --max-warnings 0` (not in the husky hook), `tsc --noEmit`, `npm run audit:skills`.
- Every claim you write into docs or changelog must be checked against the code or
  `docs/ship-skills.csv`. Four of this review's blockers are inaccurate claims.
