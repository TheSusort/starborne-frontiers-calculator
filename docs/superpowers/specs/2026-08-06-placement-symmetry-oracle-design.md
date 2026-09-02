# Placement-symmetry oracle — design

**Date:** 2026-08-06
**Status:** approved, ready for a plan
**Supersedes:** the "Deferred: controlled team-symmetry" section of
`docs/superpowers/plans/2026-07-19-interaction-emergent-audit.md`

## Why

The interaction-audit harness (PR #270) shipped four oracles. None of them can see the enemy side:
the differential oracle compares a ship solo vs in-composition **on the player side only**, and the
team-symmetry oracle that would have covered the enemy side was deferred as structurally confounded.
The deferred note calls it "uniquely valuable — the ONLY oracle that catches enemy-side execution
bugs" and leaves the design open.

Reading the code turns up a second, larger hole that nobody had counted. The engine has **three**
actor kinds, not two — `state.ts:133`: `'attacker' | 'team' | 'enemy'`. `playerTeam[0]` becomes the
`'attacker'` focus, whose stats, target, pattern and affinity ride the *top-level* input
(`battleSimulator.ts:797`, `1016–1062`); `playerTeam[1..3]` become `'team'` walked actors; the enemy
side is `'enemy'`. The real-kit fingerprint suite from #298/#300 places every subject at the focus
slot (`kitFingerprintScenarios.ts:244` `FOCUS_ACTOR_ID = 'attacker'`, and `:346` fingerprints that id
directly), so **all 147 ships of real-kit coverage exercise the `'attacker'` path and nothing else.**

In the simulator three of a user's own four ships run the `'team'` path. It has no real-kit coverage
at all. That is a bigger and more user-facing gap than the enemy side, and it falls out of the same
sweep for nearly the same cost.

So this oracle is not "team symmetry" in the swap-the-board sense. It is **placement symmetry**: does
a ship's kit execute the same way regardless of which of the three engine paths runs it?

## What it does

For each corpus ship, run it in three placements and compare what it did.

| placement | `playerTeam` | `enemyTeam` | subject kind |
| --- | --- | --- | --- |
| `focus` | `[subject@M4, f@T4, f@T2, f@B4]` | `[f@M3, f@M2, f@M1, f@T3]` | `attacker` |
| `team` | `[f@B4, subject@M4, f@T4, f@T2]` | `[f@M3, f@M2, f@M1, f@T3]` | `team` |
| `enemy` | `[f@M3, f@M2, f@M1, f@T3]` | `[subject@M4, f@T4, f@T2, f@B4]` | `enemy` |

`f` is an inert filler. The table shows `PRIMARY_BOARD`'s cells (`kitFingerprintScenarios.ts:76`),
unchanged; `supportAnchor` runs the same transform over `SUPPORT_ANCHOR_BOARD`'s cells.

Note the `team` row's array order. The rule is **index 0 takes the filler at the *last* ally cell**
(`board.allies.at(-1)` — `B4` on the primary board, `M4` on the support-anchor one), never the first.
The fragile ally lives at `board.allies[0]`, so "last" is the one cell guaranteed never to be fragile
on either board. See sharp edge 4.

**The subject's board position never moves.** `playerTeam[0]` becomes `'attacker'` by *array index*,
not by position (`battleSimulator.ts:842`), so `team` is reached purely by reordering the array — the
subject stays at `M4`, still front-most in row M, still attacked by the same three enemies, still
reaching the same four opponents. `enemy` is an exact geometric mirror: `selectTargets` works
entirely in "the acting side's own frame" (`selectTargets.ts:9`, `casterPosition` +
`enemyOccupied`) and `rowScanOrder` is side-agnostic, so `M4` denotes the same cell on either team.

The `'attacker'` slot in `team` and `enemy` is filled by an inert filler, whose top-level targeting is
a bare "deals 90% damage". `fillerAttackFor` (`:170`) stays valid because it is derived from the
subject and the subject remains the ship under sustained attack.

One consequence is load-bearing rather than incidental: the top-level input carries the **focus's**
target and pattern (`battleSimulator.ts:1049–1058`), so in `focus` the subject's targeting rides the
top level, while in `team` and `enemy` it must be honoured through the per-actor path instead
(`teamTargetById`, `engine.ts:2388`). A ship whose targeting is only wired on the focus path would
therefore show up here as missing kinds — which is precisely the class of defect the sweep is for, not
a confound to control away.

### Turn order is invariant across the three placements

This needs establishing rather than assuming, because `orderByTurnPriority` (`state.ts:331`) breaks
ties as speed DESC → `positionTurnRank` → **player side before enemy** → input order. That side
tiebreak would be a genuine confound: it is deterministic, so seed-unioning cannot suppress it, and a
subject whose speed ties a filler's would win the tie in `focus`/`team` and lose it in `enemy`.
**33 of 147 corpus ships do tie a filler's base speed** (measured), so this is not a rare corner.

It is nonetheless unreachable here. `positionTurnRank` is `rowRank * 10 + col` (`state.ts:315`), which
is **injective** over positions, and both boards use eight distinct cells (already asserted by the
existing "uses eight distinct cells" test). So `px !== py` holds for every pair of actors, the
comparator returns at the position step, and neither the side nor the input-order tiebreak can ever be
reached. Turn order is a total function of (speed, position) — and both are identical in all three
placements.

That inference is what makes the transform sound, so it gets its own test rather than a comment: all
eight `positionTurnRank` values distinct, per board.

This is the only transform considered that holds the environment fixed. A whole-board swap of a
fuzzed composition preserves each ship's ally and opponent sets but changes the *kind* of the two
index-0 ships; a partial swap preserves kinds but changes who each ship is fighting — the same
confound that already limits the differential oracle (see its deferred "same-enemy baseline"
follow-up). Holding cells fixed and moving only `(side, array index)` avoids both.

## What is compared

Each ship yields three token sets, one per placement. A set is the **union of bare `kind` tokens over
(scenario × seed)**:

- **Scenarios** are the existing `plain` / `richEnemy` / `wounded`, plus `supportAnchor` for ships
  with a dark slot (`scenariosFor`, `:326`).
- **Seeds** are K pinned values (K = 5) rather than the suite's single `SEED`.
- **Bare `kind`, never `kind:slot`.** Per the Mender finding in #300, the `:slot` suffix records
  which log handler won the single-use `consumePendingSkill()` race, so it tracks emission order and
  flips under pure refactors. Across a placement change it would flip on its own and manufacture
  diffs. `fingerprintActor` (`fingerprint.ts:22`) already returns bare kinds and is what the
  differential oracle consumes.

A finding is any kind present in one placement's union and absent from another's, reported in both
directions:

- **missing** — fires as `attacker` but never as `team` or `enemy`. The execution gap this exists to
  find.
- **extra** — fires as `enemy` but never as `attacker`. Rarer, equally a defect.

### Why union, and what it costs

Union over seeds is what neutralises `ownerId`-keyed RNG. The same physical ship draws a different
crit/landing/proc stream depending on its owner id (see `reference_engine_rng_seeding`), so a
proc-gated kind can appear in one placement and not another purely by draw. A kind that the placement
can produce at all will appear in the union of enough seeds, so only a kind that appears in **zero**
of K seeds is reported.

**Measured during the build, and weaker than that sentence implies at K=5.** The sub-stream is seeded
`baseSeed ^ hashKey(actorId)` (`rateAccumulator.ts:50-60`), and the actor id necessarily changes with
placement, so the streams are not merely offset — they are unrelated. On Xiaodao/`wounded` the same
crit landed at rounds 6+13 as `focus`, 5+16 as `team`, 7+20 as `enemy`; the totals agreed only because
the crit *count* happened to be 2 in all three. Union-over-K is therefore a probabilistic mitigation
of unquantified strength, not a guarantee — and the sweep's own output bears that out: the three
`debuff-resisted` findings point in mutually inconsistent directions across ships, which is the
signature of seed noise rather than a path gap. The shipped ledger discloses this and tells a triager
to re-run with a different `--base-seed` before instrumenting a low-ship-count kind.

**A second, structural asymmetry the transform cannot remove.** `playerTeam[0]` is also the engine's
heal target in positional mode (`engine.ts:2282`), so the subject is the heal target *only* in the
`focus` placement. "Identical cells" is not "identical engine roles". This is disclosed in the ledger
too; it bears directly on reading any `heal` finding.

Union over scenarios goes the same direction and costs resolution: it trades "which scenario exposed
the gap" for a lower false-positive rate. The per-scenario breakdown is kept in the ledger as
evidence, but the finding is stated at the union level.

Both are deliberate false-negative trades. This is a discovery sweep whose findings each cost a
manual engine-instrumentation triage, so precision is worth more than recall on the first pass.

The alternative — the deferred sketch's `crit = 0` + huge HP + distinct speeds + fixed rounds — buys
single-seed determinism by *deleting* every crit-gated and death-gated kind from both sides. It makes
the comparison exact and the sweep blinder. Rejected for that reason; the ~16% residual damage delta
the sketch worried about is not a factor here because nothing quantitative is compared.

## Four places the existing code assumes the subject is the focus

Each is a silent-wrong-answer risk, not a compile error.

1. **`seedFor`'s `richEnemy` seeds `a.side === 'enemy'`** (`:259`). In the `enemy` placement the
   subject *is* an enemy, so it would receive the shield pool instead of facing it — inverting the
   scenario. Must become "seed the subject's opponents", derived from the subject's resolved side.
2. **`seedFor`'s `wounded` keys off `a.id === FOCUS_ACTOR_ID`** (`:270`) to give the subject
   `FOCUS_HURT_FRACTION` (45%) and everyone else `HURT_FRACTION` (35%). Must key off the subject.
3. **`fingerprintShip` hardcodes `FOCUS_ACTOR_ID`** (`:346`). The other placements mint
   `p:<shipId>:<idx>` and `e:<shipId>:<idx>` (`battleSimulator.ts:842–845`), so the subject's id must
   be resolved per placement.
4. **The fragile 1-HP ally is chosen by loop index** — `scenario === 'wounded' && i === 0` (`:314`)
   — which today coincides with `board.allies[0] === 'T4'`, the only ally cell an enemy resolves onto.
   Array order and position decouple the moment the subject stops being index 0. Left alone, the
   `team` placement would make the **1-HP fragile ally the `'attacker'` focus**: it dies to the first
   hit it takes and the whole `wounded` scenario collapses. Two things follow, and both are required —
   re-key the fragile ally to the **position** `board.allies[0]`, and order the `team` placement so
   index 0 takes the filler at `board.allies.at(-1)`.

All four resolve through one mechanism: **identify the subject and the fillers by `(side, position)`**
rather than by array index. Position is known at build time and is the same in all three placements,
which is exactly what array index is not. `__testTapActors` receives `CombatActor[]` carrying
`.side`/`.position`/`.id`,
and `BattleResult.roster` (`battleSimulator.ts:173`:
`{ actorId, side, name, position }`) supports the same match afterwards — which is how
`runDifferential` already locates a ship it did not place itself.

Point 3 is the #298 fixture-vacuity trap in new clothing: a mis-resolved id fingerprints an empty
set, every kind reads as "missing in that placement", and the sweep reports a screenful of confident
nonsense. It is guarded explicitly (below), not by inspection.

## Delivery

**`src/utils/combat/audit/placementSymmetry.ts`** — new, pure: subject-side/id resolution, union
fingerprinting, the pairwise diff, and the calibration runner.

*(As built: there is no separate `buildPlacementBattle`. An earlier draft of this section named one
and then, one bullet later, gave `buildScenarioBattle` the placement parameter — internally
inconsistent. The second option was implemented, because extending the existing builder is what makes
the default-path byte-identity directly provable by the committed snapshot.)*

**`kitFingerprintScenarios.ts`** — `buildScenarioBattle` and `seedFor` gain an optional placement
parameter **defaulting to `focus`, so the existing 147-ship snapshot suite stays byte-identical.**
That equivalence is asserted by a test, not assumed.

**`scripts/auditPlacementSymmetry.ts`** → `npm run audit:placement-symmetry -- --seeds 5`, writing
`docs/placement-symmetry-ledger.{json,md}` — gitignored local reference data, exactly like the
existing `docs/interaction-audit-ledger.*` and `docs/ship-kit-correctness-ledger.*`. **Not part of
`npm test`** — this is a discovery sweep, and the suite already carries the single-seed focus
snapshot.

Cost, measured: the existing 147-ship suite runs ~445 battles (147 × 3 scenarios + 3 `supportAnchor`)
in 4.77 s ≈ **10 ms/battle**. The sweep triples that — ≈ **1,330 battles per seed**, so ~13 s at K=1
and ~67 s at K=5.

### Calibration gate

The CLI's first action, before any real ship: run the 4 ENEMY-side inert filler
ships (`ENEMY_FILLER_NAMES` — verified kitless, guarded by the existing inertness test) as subjects.
Not all 7: the subject shares a side with the 3 ally-side fillers, so drawing a calibration subject
from that group would put the same ship twice on one side, an illegal in-game state. An
inert kit must fingerprint **identically in all three placements**. If it does not, the asymmetry is
in the harness, and the CLI prints `CALIBRATION FAILED` and exits non-zero **without writing a
ledger**. This mirrors the existing Wave-0 gate (`auditInteractions.ts`).

### Suite health, printed alongside findings

So that a zero-finding result is auditable rather than trusted (the #301 discipline of proving the
negative is non-vacuous):

- ships with an **empty** token set, per placement — must be 0
- distinct kinds observed, per placement
- ships whose three unions are identical — the symmetric majority
- a hard assert that the three resolved actor ids are **distinct** and carry the expected shapes
  (`attacker` / `p:*` / `e:*`)

  *(As built, this lives in a test rather than in the sweep, and checks the id SHAPE rather than the
  actor `kind` — `BattleResult.roster` carries no `kind` field. The shape is a faithful proxy:
  `battleSimulator.ts:841` mints `p:` for exactly the indices that become `kind: 'team'`. Because the
  shape is checked per placement at resolution time, a cross-placement id collision is structurally
  impossible, which is stronger than a runtime assert on distinctness.)*

### No pre-built exemption list

There will be diffs with legitimate structural causes — heal-target selection and `isPositional`
gating are the obvious candidates (a non-heal-target actor's own DoT ticks only when `isPositional`).
Whether any given one is legitimate or a defect is a game-model judgement, and it belongs in triage
on real evidence, not in a guard written before the sweep has ever run. Writing the exemptions first
also risks the #300 trap: a guard that duplicates the logic it guards proves nothing.

Findings are **candidates**. Per the FINDING-001 rule, none is recorded as a real bug until direct
engine instrumentation confirms it under controlled conditions.

## Testing

Unit tests in `npm test` cover the machinery; the sweep itself stays in the CLI.

- the three placements produce **identical cell assignments** — same positions, same fillers
- `focus` output is **byte-identical** to today's `buildScenarioBattle(subject, scenario)`
- subject id resolves to `attacker` / `p:*` / `e:*` and each carries the expected `kind`
- `richEnemy` under `enemy` seeds the shield pool on the **player** side (the subject's opponents),
  and the subject's own `shieldPool` stays 0
- `wounded` gives the subject `FOCUS_HURT_FRACTION` in **every** placement, fillers `HURT_FRACTION`
- the fragile 1-HP ally lands on the **`T4` cell** in every placement, and is never the `'attacker'`
  focus — the sharp-edge-4 regression, asserted on the built input rather than on a battle result
- the diff, both directions, on hand-built token sets, including a case with three mutually
  distinct sets that fails if any placement pair is dropped from the comparison
- the calibration property as a real test: 7 inert fillers, one scenario, identical across placements
- non-vacuity: a real kit produces a **non-empty** token set in each of the three placements

## Out of scope

- **Quantitative symmetry.** Nothing about damage magnitude is compared. If the kind-set sweep comes
  back clean, an amount comparison is a reasonable follow-on — and it would then be able to assume
  the execution paths agree structurally, which is a much better starting point than the deferred
  sketch had.
- **Composition-level coverage.** Fuzzed interaction-dense boards (the "Approach B" considered and
  set aside) would catch an asymmetry that only manifests alongside other kit. Its player-side half is
  already fuzzed by the differential and ablation oracles; revisit if findings here look
  composition-dependent.
- **Promoting the sweep to a permanent gate.** The reviewed result could be frozen as a snapshot
  suite later. Not until the first triage is done — freezing an unreviewed baseline would pin whatever
  bugs exist today as correct.

## Related

`project_interaction_audit_epic` (the deferred oracle) · `project_real_kit_golden_fingerprints`
(the focus-only suite this extends) · `project_support_anchor_fingerprint_board` (the second board,
and the derived-guard lesson) · `reference_engine_rng_seeding` (why union-over-seeds is required) ·
`reference_sim_test_harness_traps`
