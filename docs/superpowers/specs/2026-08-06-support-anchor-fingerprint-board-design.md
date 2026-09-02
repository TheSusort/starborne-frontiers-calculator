# Support-anchor fingerprint board — design

**Date:** 2026-08-06
**Status:** approved, ready for planning
**Follows:** #298 (real-kit golden fingerprints), #299 (buff granter attribution)
**Scope:** test-fixture only. No production engine, parser, or UI change.

---

## Problem

The real-kit fingerprint suite (`realKitFingerprints.test.ts`, 147 corpus ships × 3 scenarios)
anchors every focus ship at `FOCUS_POSITION = 'M4'`. M4 is the front-most column of its row
(`board.ts`: `M4 = {q: 2, r: 1}`, and there is no `(3, 1)` cell). `Pattern-Line-Support-*` extends
FORWARD (`+q`), so a Line-Support caster anchored at M4 resolves to **zero cells**.

Measured across the corpus, both targeting slots: **6 dark slots across 3 ships.**

| Ship   | Slots         | Pattern                                | Occupied cells @ M4 | @ M1 |
| ------ | ------------- | -------------------------------------- | ------------------- | ---- |
| Faust  | active+charge | `Pattern-Line-Support-Not-Self-Range-3` | 0                   | 3    |
| Mender | active+charge | `Pattern-Line-Support-Not-Self-Range-2` | 0                   | 2    |
| Refine | active+charge | `Pattern-Line-Support-Not-Self-Range-1` | 0                   | 1    |

Nothing else in the corpus is dark on either anchor.

The observed cost, from today's snapshot:

```
Faust   → ["charge-changed"]  (all three scenarios)
Mender  → ["charge-changed"]  (all three scenarios)
Refine  → ["buff", "charge-changed"]   ← the `buff` is its reactive passive, not its active
```

Faust and Mender are **fully vacuous fingerprints**: green, deterministic, observing nothing. This
is the fixture-vacuity defect class that #298 exists to eliminate ("a fixture that RUNS is not a
fixture that OBSERVES"), surviving inside the suite that eliminated it.

### Two facts the prior write-up got wrong

1. **Charged slots are dark too, and were never guarded.** `parseShipTargeting`
   (`targetingParser.ts:241-244`) inherits the active targeting when both charged columns are blank.
   All three ships have blank charged columns, so their charge skills are equally unreachable. The
   existing guard only inspects `active.pattern`, so it under-reports by half.
2. **"Narrower option: an ally at M3" does not work.** Forward is `+q` toward column 4. M3 is
   *behind* M4. An ally placed there is unreachable by the identical geometry.

### Why one board cannot do both jobs

`selectTargets` (`selectTargets.ts:53-54`) picks the first row in scan order holding a target, then
the front-most occupied column of that row. For a Line-Support caster to have anyone to support,
allies must sit **forward of it in its own row** — which makes one of them front-most, so the focus
stops being single-target attacked.

This is a structural conflict, not a tuning problem:

- **The primary board's whole purpose** is that the focus takes real incoming damage. Before #298's
  final fix, the focus took zero damage in 136 of 147 fixtures and every on-damaged clause
  (counterattack, reflect, revenge, cheat-death, shield-destroyed, hit-counted Barrier) was silent.
- A back-selecting enemy would break the tie, but **all ten inert filler ships are
  `front,Pattern-Base`** — there is no inert backline attacker available, and a non-inert one would
  contaminate all 147 fingerprints.

Therefore: **two boards, split by what each can observe.**

---

## Approach

Add one new scenario, `supportAnchor`, run **only** by ships whose active or charged pattern
resolves to zero occupied cells on the primary board. Membership is **derived at test time**, not
listed. The primary board is untouched.

Rejected alternatives:

- **A uniform 4th scenario for all 147 ships.** 147 extra battles on an already-slow suite and a new
  section in every snapshot entry, to differentiate 3 ships. This is the same move already measured
  and rejected in #298 (the player-side-shield variant that "lit up 131 ships" was uniform
  fixture-caused inflation). Rejected.
- **Move the primary `FOCUS_POSITION` back and re-tune.** Ruled out by the conflict above: any
  anchor with allies forward of it loses incoming damage. This is the support-anchor board *minus*
  the primary board — strictly worse. Rejected.

---

## The support-anchor board

```
row M:   M1 [FOCUS]   M2 [ally]   M3 [ally]   M4 [ally]      (col 4 = front)
row B:   B2 [enemy]   B3 [enemy]  B4 [enemy]
row T:   T4 [enemy]
```

- **Focus at M1**, the back-most column of the middle row: three forward cells, covering
  Line-Support ranges 1 through 3.
- **Three filler allies at M2/M3/M4**, occupying every cell the support patterns reach.
- **Four filler enemies at B4/B3/B2/T4.** The focus's row-scan from M is `M → B → T`; row M holds no
  enemies, so it finds B4 front-most and reaches all four under an `all` pattern. The focus's
  enemy-directed kit therefore stays live.
- Eight distinct cells, same rule as the primary board: an ally and an enemy sharing a cell would be
  indistinguishable in position-keyed engine state.

### Seeding: reuse `wounded` verbatim

`supportAnchor` applies **exactly** `wounded`'s seeding tap — non-focus actors to `HURT_FRACTION`
(35%), focus to `FOCUS_HURT_FRACTION` (45%). One new variable (geometry), not two.

This is load-bearing, not tidiness. Faust and Mender's actives *repair* allies. A repair aimed at a
full-HP 500,000,000-HP filler is an overheal that may emit no `heal` log entry at all — a
support-anchor board seeded `plain` would be green, deterministic, and observing nothing, which is
the precise trap this work exists to close.

### No fragile ally

`wounded` overrides `ALLY_POSITIONS[0]` to `FRAGILE_ALLY_HP = 1` so it dies and lights
on-ally-destroyed clauses. `supportAnchor` does **not**: a dying support target would make reach
flaky, and on-ally-destroyed coverage for these three ships already exists on the primary board. All
three allies keep `FILLER_HP`.

### Accepted: the focus takes zero incoming damage here

Unavoidable, per the conflict above. Nothing is lost — Faust, Mender and Refine keep their full
primary-board fingerprints, which is where their on-damaged coverage lives. `supportAnchor` answers
one narrow question: *does this ship's support footprint reach anyone, and what does it do when it
does.*

The `suite health` incoming-damage invariant iterates `SCENARIOS`. Keeping `supportAnchor` out of
that array excludes it **by construction**, with no exemption list to go stale.

---

## Types and structure

```ts
export type ScenarioName = 'plain' | 'richEnemy' | 'wounded';        // unchanged; universal
export type FingerprintScenario = ScenarioName | 'supportAnchor';
export type FingerprintResult = Record<ScenarioName, string[]> & { supportAnchor?: string[] };
```

The three universal scenarios are always present; the fourth is optional. Existing callers — the
Malvex (#296/#297) and Purifier (#299) pinned tests, and `scripts/reportThinKitFingerprints.ts` —
compile unchanged.

Widening the union makes `seedFor`'s `never` exhaustiveness guard fail to compile until
`supportAnchor` is handled. That is the guard doing its job, and the new case shares `wounded`'s
branch.

New exports from `kitFingerprintScenarios.ts`:

- `SUPPORT_ANCHOR_FOCUS_POSITION`, `SUPPORT_ANCHOR_ALLY_POSITIONS`, `SUPPORT_ANCHOR_ENEMY_POSITIONS`
- `scenariosFor(ship): FingerprintScenario[]` — the three universal scenarios, plus `supportAnchor`
  when the ship is derived-unreachable.
- `darkSlotsOnPrimaryBoard(): Array<{ name: string; slot: 'active' | 'charged' }>` — the derivation,
  exported so the guard test and `scenariosFor` share one implementation rather than two that can
  drift.

`buildScenarioBattle` branches on the scenario to select the position triple. Ships whose targeting
cannot be parsed or resolved are **skipped**, not counted either way — this is a geometry-
reachability question, not targeting-text coverage (preserving the existing guard's behaviour).

---

## Guards

`KNOWN_UNREACHABLE` is **deleted**, not re-pointed.

1. **Reachability derivation** (`kitFingerprintScenarios.test.ts`) — sweep the corpus across
   **both** slots on the primary board; anything at zero occupied cells forms the derived set.
   Assert every derived slot resolves to ≥1 occupied cell on the support-anchor board, failing by
   ship *and slot* name. A future ship dark on both boards fails loudly rather than needing a
   hand-maintained exemption.
2. **Non-vacuity** (`realKitFingerprints.test.ts`) — each derived ship's `supportAnchor` token set
   must contain at least one **slot-suffixed** token. Deliberately *any* suffixed token rather than
   a specific kind such as `heal:active`: `ctx.consumePendingSkill()` is single-use per cast
   (`buildCombatLog.ts`), so only the first log entry of a cast carries `{skillName, slot}` and a
   later `heal` legitimately lands bare. Asserting a specific kind would be flaky for reasons
   unrelated to the kit.
3. **Strictly richer** — those slot-suffixed tokens must appear in **no** primary scenario for that
   ship. This is the actual claim: previously invisible behaviour is now observed.
4. **Board sanity** (`kitFingerprintScenarios.test.ts`) — eight distinct cells; focus at
   `SUPPORT_ANCHOR_FOCUS_POSITION`; nothing dies; the battle reaches round `ROUNDS`.
5. **`EXPECTED_KINDS`** — the coverage-ledger sweep extends over `supportAnchor` tokens, so a
   newly-reachable log kind announces itself instead of slipping in unlisted.

Plus a **pinned regression test** naming Faust, Mender and Refine, in the style of the existing
Malvex and Purifier tests. The snapshot catches the move; the pinned test records *why* it moved.

---

## Files touched

| File                                                        | Change                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/utils/combat/audit/kitFingerprintScenarios.ts`          | board variant, `scenariosFor`, `darkSlotsOnPrimaryBoard`, widened union; rewrite the `FOCUS_POSITION` docstring |
| `src/utils/combat/audit/__tests__/kitFingerprintScenarios.test.ts` | reachability describe rewritten (guard 1), board sanity added (guard 4), `KNOWN_UNREACHABLE` deleted     |
| `src/utils/calculators/__tests__/realKitFingerprints.test.ts` | per-ship scenario list, guards 2/3/5, pinned regression test                                                 |
| `...__snapshots__/realKitFingerprints.test.ts.snap`          | 3 entries gain a `supportAnchor` key                                                                          |
| `scripts/reportThinKitFingerprints.ts`                       | iterate the per-ship scenario list                                                                            |

`FOCUS_POSITION`'s docstring currently documents the rejection this design overturns ("Moving
`FOCUS_POSITION` was considered and rejected") and must be rewritten to explain the two-board split
instead. Same for the reachability describe's header comment.

No changelog entry: CLAUDE.md excludes test-only changes.

---

## Verification

- `tsc --noEmit`, lint, and the **full `npm test`**. Husky's pre-commit hook is the only gate —
  there is no CI test workflow.
- **Snapshot diff is an assertion, not an expectation:** `git diff` on the snapshot file must show
  additions *only* inside the Faust, Mender and Refine blocks. Any of the other 144 moving means the
  board leaked and the change is wrong.
- `vitest -u` on `realKitFingerprints.test.ts` is forbidden except as a deliberate audited move.
  This is one, and the commit message must explain it.
- Re-run `npx tsx scripts/reportThinKitFingerprints.ts` and confirm Faust/Mender/Refine leave the
  thin list (or record why they remain).

---

## Risks

- **A kit may still produce nothing from M1 for a genuine engine reason.** If so, that is a
  **finding, not a fixture failure** — record and raise it, do not widen a guard until it passes.
  #299's Purifier case is the precedent for how this looks: correct code that appeared dead.
- **Overheal may swallow the `heal` token even at 35% HP.** Filler currentHp at 35% of 500,000,000
  is ~175M, far below max, so a ~3k repair lands as a real heal. Verify empirically during
  implementation; guard 2 asserts on any slot-suffixed token, so the design holds even if the
  observable token turns out to be `buff:active` rather than `heal:active`.
- **Faust's two passives stay dark** ("purges N buffs from the enemy **when killed by direct
  Damage**") — the focus-survival invariant forbids the focus dying. Out of scope; same family as
  the documented `death` / `cheat-death` dark kinds.

---

## Out of scope

- The `'buff'` entry in `auditInteractions.ts`'s `BASE_EXCLUDED_KINDS`, which needs its own
  real-corpus recalibration run (#299 follow-up).
- The deferred status-seeded scenario that would light `cleanse` / `purge`.
- The `consumePendingSkill` read-not-consume redesign.
