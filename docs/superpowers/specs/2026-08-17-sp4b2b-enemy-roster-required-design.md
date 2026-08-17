# SP-4b-2b — a non-empty enemy roster becomes the engine's contract

Epic: `2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md`
Parent spec: `2026-08-13-sp4-retire-the-dummy-design.md` (§3 decision 1, §4.1)
Base: `39d463f1` (SP-4b-2a, PR #325)
Position in the ladder: 4a ✅ → 4b-1 ✅ → 4b-2a ✅ → **4b-2b** → 4c delete the dummy → 4d scalars → 4e heal routes

## 1. Goal

`CombatEngineInput.enemyAttackers` stops being optional. Every run — production or fixture —
arrives with at least one real enemy on the board, and an empty roster is a validation error
rather than a silent handover to the vestigial dummy.

This is the last precondition for 4c. Cluster C (`selected ?? tb.legacyVictim`) is the keystone the
dummy hangs from; it is reachable today only because a run can legally have no opponent. Once the
contract forbids that, nothing needs the sink and 4c becomes deletion.

## 2. Measured facts (probed at `39d463f1` — do not re-derive)

**2.1 The type flip touches 115 files, not the 18 on record.** Patching `enemyAttackers?:` →
`enemyAttackers:` and running `tsc --noEmit` yields **145 errors across 115 files**. Only 25 are
`TS2741` (a call site genuinely missing the property). **111 are `TS2322`**, all from one per-file
idiom:

```ts
const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    /* … no enemyAttackers … */ ...overrides,
});
```

The annotated base literal fails even when every call site supplies an enemy through `overrides`.
So the recorded "18 direct-engine fixtures" was the **behavioural** population; the **type**
population is ~115 files.

**2.2 Exactly 20 files pass no `enemyAttackers` at all** — not 18. 4b-1 and 4b-2a added
`normalizationBoundary.integration`, `runModeEquivalence`, and `positionalSubBuckets`.

**2.3 All three production callers are already safe to throw at.** `battleSimulator.ts:829`
already throws on an empty `enemyTeam`; `dpsSimulator` synthesizes a real enemy from its scalars
since 4b-2a; `healingEngineAdapter` receives ≥1 from a page that floors the roster at one.
**No production path reaches an empty roster.**

**2.4 Three test callers pass `simulateHealing({ enemies: [] })`** —
`dpsSubAttackEvents.integration`, `healingEngineAdapter.test`, `healingGoldenParity`. The adapter
calls that shape TEST-ONLY in prose (`healingEngineAdapter.ts:309`) and documents the cost of
reaching it: `totalDirectHeal` 3,876 with one real enemy at defence 1,000 → **1,290** with none,
because the sink's 10,000 defence rebases every `basis:'damage-dealt'` rider.

**2.5 The boundary already carries the two branches this contract deletes.**
`normalizeCombatRoster` (`normalizeRoster.ts`, 138 lines, one export) opens with
`input.enemyAttackers ?? []` and guards enemy placement on `enemyAttackers.length ? … : []`. Both
become dead once the roster is required and non-empty, so the guard **shrinks** this module rather
than adding to it.

## 3. Locked decisions (owner, 2026-08-17)

1. **One PR, ~115 files, no CodeRabbit review.** The >100-file skip is accepted knowingly — the
   third instance in this epic after SP-4a (197 files) and the review-errored variant on #325.
   Consequence, planned for rather than noted: the internal whole-branch review is the *only*
   review, so the golden audit is a first-class task, not a checklist line.
2. **A zero-enemy healing run is a legitimate scenario, shipped in this PR.** The adapter
   synthesizes an inert practice target and the healing page's floor at one comes off. Overheal is
   already a first-class axis, so the scenario needs no new reporting.
3. **The practice target is the page's default enemy card with attack 0 and no skills** — defence
   5000, HP 40000, security 100. (Recommended by this spec; the owner did not select an alternative,
   so it ships as the stated assumption.)

## 4. The contract

`enemyAttackers` becomes required on `CombatEngineInput`, and `normalizeCombatRoster` throws on an
empty array with a named message. The boundary is already "the ONLY accommodation" (parent spec
§4.1), so the guard belongs there and nowhere else — one throw site, not a scatter of call-site
assertions. This follows SP-4a's earned rule: **prefer a validation guard over a derivation**, which
on that PR caught a real contradiction the migration had created.

This closes open follow-up (c) from 4b-2a's ledger: "explicit `enemyAttackers: []` is silently
replaced by synthesis; 4b-2b should throw once a non-empty roster is mandatory."

The doc comment on the field (`engine.ts:1259`) is stale on two counts and gets rewritten: it opens
"Enemy attackers (healing mode)" — the field is now every run's roster — and asserts "the singular
dummy `enemy` remains the player-offense target + DoT carrier", which has been false since 4b-1.

## 5. Zero-enemy healing

**The adapter, not the engine, is where "no enemies" is interpreted.** `simulateHealing` maps an
empty `enemies` array to a one-member roster holding the practice target, so the engine's contract
holds unconditionally and no accommodation fork is created below the boundary.

The practice target's stat block moves out of `HealingCalculatorPage.tsx:76-78`
(`DEFAULT_ENEMY_HP` / `DEFAULT_ENEMY_DEFENCE` / `DEFAULT_ENEMY_SECURITY`) into a shared module that
both the page and the adapter import, so there is one number rather than two that can drift. The
target carries **attack 0 and no `shipSkills`** — the difference between it and a default enemy card
is precisely that it does not act.

Why this stat basis: removing every enemy then means exactly one thing — *nothing shoots back* — and
a `damage-dealt`-scaled repair reads the same basis it read with an enemy present. Defence 0 would
silently maximize damage-scaled repair, so that comparing a one-enemy run against a zero-enemy run
would attribute to "incoming damage" a change that was really the mitigation basis moving.

Two consequences accepted rather than engineered around:

- **A healer with a damage clause can kill the practice target**, after which resolution finds no
  targetable member and the run falls to the sink for its remaining rounds. This is identical to
  what happens today when a healer kills its one real enemy, so it introduces no new shape — and 4c
  removes the sink underneath both. An "unkillable" target would need either a huge HP or a new
  indestructible flag; see the next point for why the first is wrong.
- **HP stays 40000.** Corrosion scales with the victim's max HP (`min(enemyHp, 500_000)`), so an
  inflated HP would inflate corrosion damage and, through it, every `damage-dealt` rider — the exact
  distortion this section's stat choice exists to avoid.

**Page changes.** `removeEnemy` (`HealingCalculatorPage.tsx:386`) drops its `prev.length <= 1`
guard and `EnemyAttackersPanel.tsx:247` drops `canRemove={enemies.length > 1}`. The ⚠️ comment at
`:378-384` exists *because* an empty roster hands the run to the dummy — the condition this PR
removes — so it is **rewritten, not deleted**: its measured 3,876 → 1,290 history stays as the
rationale for why the practice target carries a real defence. (SP-4a's rule: describes current
behaviour → rewrite; historical rationale → keep, glossed.)

This is user-facing, so it needs an `UNRELEASED_CHANGES` entry and a `DocumentationPage.tsx` line.

## 6. Fixture migration

Two populations, one diff.

**(a) The 20 files with no roster** get a real enemy. This is behavioural: their damage stops
landing on a sink and starts landing on a positioned actor. Expect the 4b-1 churn story again at
smaller scale — and its rules apply unchanged. `front` selection scans **rows from the caster's own
row** before the front-most column, so pinning a victim to `M4` is often not enough; the enemy must
be pinned to the victim's row too.

**(b) The ~95 files whose base literal breaks** get an `enemyAttackers` entry in the literal. Where
every call site already overrode it, this is type-only and inert. Where some call used the bare
base, it is behavioural. **That distinction is not statically decidable**, so the classifier is the
suite itself: apply the change, run, and let the moved tests name the behavioural subset. A file
that moves is then audited like any (a) file.

**(c) The 3 `enemies: []` healing callers** now exercise the practice target instead of the sink.
Their numbers move by construction — §2.4 measured the size of that move — and
`healingGoldenParity` is among them, so its golden is regenerated against an audited diff.

**Non-negotiable, because it has already happened once in this epic:** no assertion is re-pinned to
absorb a move. A subagent on 4b-1 converted a `> 0` assertion to `toBe(0)` on a fixture shaped like
the production page, and it passed review. Every moved number is either attributed to a named
mechanism or treated as a defect.

## 7. `dummyReachability` — closing both of its recorded gaps

The file's own header states that a zero there is **not** 4c's go-ahead, for two independent
reasons. This PR closes both.

**Coverage.** It exercises `bareInput()` — one focus-attacker damage path — plus an empty roster. It
does not exercise team-actor turns, enemy turns, corpse targeting, death retargeting, or
walked-team damage. All five get cases. A zero across them supports "no shape reaches the fallback";
a zero on `bareInput()` alone never did.

**Semantics.** The counter records **consultations** of `tb.legacyVictim`, not credits to the sink,
and the two come apart: in the mid-run whiff window the fallback is consulted and nothing is booked.
So a second counter is added for **credits to the legacy sink** — the number 4c can demand be zero —
while consultations stay a diagnostic that may legitimately be non-zero.

The existing "STILL takes it with an empty roster" case inverts into a throw-assertion. That test
exists so the file cannot go vacuous before the contract lands; after it lands, the throw is what
keeps it honest.

## 8. Gates

- `tsc --noEmit` 0 · `eslint` 0 · full suite green (husky runs it on every commit)
- **Every moved golden attributed to a named mechanism, zero unclassified** — the 4b-2a gate
  (1160 lines, 0 unclassified), measured against a worktree at the base commit. Every 4b-2a wave
  that used a base-commit worktree separated real defects from assumed churn; the one hypothesis
  table written without one was mechanically wrong on 3 of 10 files.
- Placement-symmetry oracle at its baseline: **2 findings / 146 / 13-13-13**
- Browser pass on `/healing` with the roster emptied, and on `/damage` (route is `/damage`, dev
  server is `npm start`)
- No `vitest -u`

## 9. Non-goals

- Deleting the dummy or cluster C — 4c.
- Deleting `enemyHp` / `enemyDefense` / `enemySpeed` / `enemySecurity` from the input — 4d. The
  practice target deliberately does not read them, so 4d does not have to revisit §5.
- `enemyType` stays: fight-wide condition context, not a dummy scalar (parent spec §3.1).
- The three open follow-ups from 4b-2a that are not about the roster contract: (a) the D6
  passive-slot instance procs no leeches, (b) a cast with no firing-slot damage ability never
  enters the positional branch, (d) D4's missing enemy-side assertion.
- Any per-victim `enemy-type` gating.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| ~115 files with no external review | Golden audit as its own task; base-commit worktree; whole-branch internal review before merge |
| A behavioural move hidden inside the type-only bucket | The suite is the classifier — a moved test is audited, never re-pinned |
| The practice target's basis drifts from the page's default enemy | One shared constant, imported by both; the compiler enforces it |
| A widened `dummyReachability` reports zero because nothing covers the path | Each of the five new cases must be shown to reach the code it claims to cover — the epic's "no goldens moved can mean nothing covers this" rule |
| Golden regeneration masking a defect | Regenerate only after the diff is attributed, never before |
