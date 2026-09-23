# Autogear Role Basis Implementation Plan (#544, pivot 2)

> **Post-split note (2026-09-23).** #498 (sim-rerank / "Simulate candidates") and the band-search
> tooling (`statBands`, `statBounds`, `OffFormulaTuningPanel`, `useOffFormulaTuning`,
> `sparringOpponents`, `roleObjectives`, `objectiveMetrics`, `runCandidates`) were removed before
> #544 merged. They survive only on branch `feat/autogear-sim-rerank` (`dbd85f63`). The three #544
> modules live in `src/utils/autogear/offFormula/`. References below to `simRerank/`,
> `SimRerankSection`, `buildSimRerankShipConfig`, or "retained band modules" describe code that is
> not on main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the derived scoring basis from a seeded custom formula onto the ship's REAL role
formula, so applying it stops degrading everything the basis does not touch.

**Architecture:** `SavedAutogearConfig` gains `roleBasis: { produces, terms }`. Each role scorer
resolves its primary quantity through `resolveBasisValue` instead of reading one stat, and honours
the basis only when the role's axis matches `produces`. Apply writes `roleBasis` and
leaves `shipRole` set. A DEFENDER-family ship is offered a Defence `StatBonus` tilt instead of an
equation it should not gear toward.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest. This work merges on its own.

## Read before Task 1

- Spec: `docs/superpowers/specs/2026-09-18-autogear-role-objective-tuning-design.md` (2026-09-21
  revision). It holds the measurement that forced this pivot and the role-to-axis table.
- Ledger: `.superpowers/sdd/progress.md`, the `#544` section. It records four controller errors
  and one bug that recurred three times. Read it before trusting any invariant in this plan.

## Owner rulings, 2026-09-21 — settled, do not re-ask

- **The Defender tilt is a FIXED MODEST NUDGE** — one Defence `StatBonus` magnitude shared by
  every tilt ship, not scaled from each kit's coefficient and not a player control. It must never
  buy Defence at the cost of a round of survival. Measured reach: 7 ships (Cinya, Isha, Kafa,
  Madax, Morao, Panon, Suku — all DEFENDER).
- **`SUPPORTER_OFFENSIVE` hosts NOTHING.** Its primary is `speed + sqrt(attack)`; the sqrt
  compresses a basis in a way no other role's does and no measurement backs it. No ship defaults
  to that role, so nothing is lost today. It joins the survival roles in the no-host set.

## Measured corpus shape (2026-09-21, `detectOffFormulaStats` at each ship's default role)

47 flagged: ATTACKER 15, DEBUFFER 5, **DEFENDER 24**, SUPPORTER 3. So roughly half the corpus
lands in the no-basis bucket, and only 7 of those 24 carry a defence scaler the tilt can reach.
The remaining 17 Defenders get the finding and nothing else — that is the honest outcome of the
Defender ruling, not a gap to close.

## Global Constraints

- **Execution PAUSES at the Stage A checkpoint** for the repo owner to test in a browser. It is
  not waivable: the last checkpoint was waived on a summary and the owner then found the
  pivot-forcing bug in the browser.
- **The axis vocabulary is `deriveBasis`'s own: `'damage' | 'repair' | 'shield'`.** Not
  `'healing'` — `basisDerivation.ts:314` and `OffFormulaFinding.produces` both say `repair`, and
  a third spelling is how a router silently matches nothing.
- **A `roleBasis` carries the `produces` it was derived for.** A bare `BasisTerm[]` cannot say
  what it DESCRIBES, and "routed by which row CAN hold it rather than which row it DESCRIBES" is
  the bug that recurred three times on this branch. The scorer applies a basis iff
  `roleHostsBasis(role, roleBasis.produces)`.
- An absent `roleBasis` must be byte-identical to current behaviour, for every role. This is the
  regression pin and every task preserves it.
- Weights are in multiplier units divided by 100, rounded to 0.001 — the precision the editor
  displays and its number input accepts. `basisDerivation` already does this; do not re-round.
- **A defect triaged against a read path must be re-triaged when a write path consumes it.** That
  exact miss produced a silent corruption bug across 189 ship-role combinations on this branch.
- Check REAL exit codes: redirect to a file and test `$?`. Do NOT pipe a test command into `tail`
  and read it as a pass — that let a red suite through on this branch.
- Use `src/components/ui/` components; the `card` class is the box primitive. No emojis, no
  `dangerouslySetInnerHTML`.
- Never run the Supabase CLI in any form. Never `git add -A` or `git add .`.
- Comments state present-tense behaviour contracts — no change history, task numbers, or diff
  justification.
- `npm start` runs the dev server on port 3000. Never `npm run dev`. Never `vitest -u`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types/autogear.ts` | `SavedAutogearConfig.roleBasis`. |
| `src/utils/autogear/priorityScore.ts` | Each role scorer resolves its primary quantity through the basis. |
| `src/utils/autogear/scoring.ts` | `roleBasis` in the score cache key. |
| `src/components/autogear/OffFormulaNotice.tsx` | Apply writes `roleBasis`; no equation for a non-hosting role; the Defender tilt. |
| `src/utils/autogear/offFormula/roleBasisHost.ts` | **New.** Role to axis and primary stat; the hosting predicate. |
| `src/schemas/sharedAutogearBuild.ts` | Carry `roleBasis`; retire the nullable-role branch. |

---

# STAGE A — the role basis

### Task 1: Role scorers take a basis

**Files:** `src/types/autogear.ts`, `src/utils/autogear/priorityScore.ts`,
`src/utils/autogear/scoring.ts`; test `src/utils/autogear/__tests__/roleBasis.test.ts` (new).

**Produces:** `SavedAutogearConfig.roleBasis?: { produces: 'damage'|'repair'|'shield'; terms: BasisTerm[] }`;
every hosting role scorer accepts an optional basis; `calculatePriorityScore` threads it and
applies it only when `roleHostsBasis(role, roleBasis.produces)` (Task 2's predicate — do not
restate the rule, call it).

**Runs AFTER Task 2.**

- [ ] **Step 1 — write the failing tests.** Three groups:
  - **Regression pin:** for all 12 roles, `calculateRoleScore(role, stats)` with no basis equals
    its value before this change. Capture the current numbers first and pin them literally.
  - **Losslessness** (the reason for this pivot): with a SUPPORTER basis applied, the marginal
    value of every non-primary stat is unchanged. `+30 crit` must read x1.2432 and `+20 heal
    modifier` x1.1667 — the real formula's numbers, NOT the seeded copy's x1.0788 / x1.2803.
    Those four figures are measured and in the spec; treat them as ground truth.
  - **The basis moves the primary quantity:** a SUPPORTER with `[hp x0.057, defence x1.067]` scores
    a +3,000 Defence piece above a +10,000 HP piece, and the reverse without it.
- [ ] **Step 2 — run them; expect failure** (`roleBasis` does not exist).
- [ ] **Step 3 — add `roleBasis` to `SavedAutogearConfig`**, documented as replacing the role's
  primary quantity, honoured only where the role's axis matches its `produces`.
- [ ] **Step 3b — validate the terms through ONE predicate.** A blank weight zeroed every score
  on this branch and the optimizer returned arbitrary gear; the fix guarded the formula-row path
  only. Reuse `usableBasis`'s own term filter (`customFormula.ts`) — extract the term-level half
  if it is welded to a row — so the scorer path cannot drift from it. A basis that validates to
  nothing must fall back to the plain stat, never to 0.
- [ ] **Step 4 — thread it.** Give each hosting scorer an optional basis and resolve its primary
  through `resolveBasisValue(stats, basis.terms, <primary>)`. `rolePrimaryStat` names the primary
  per role — read it from Task 2, do not hardcode a second copy. **Non-hosting roles take no
  basis** — do not add a parameter you then ignore; leave those signatures alone so the type says
  which roles host.
  Note `statResolution.ts` already threads a basis into `calculateDPS`, `calculateDirectDamage`
  and `calculateEffectiveHP` for the formula-row path. Reuse those seams; do not add a parallel
  one.
- [ ] **Step 4b — `buildSimRerankShipConfig` — removed in the split.** This step targeted
  sim-rerank's compared-role config builder, which does not exist on this branch (#498, removed).
- [ ] **Step 5 — cache key.** `scoring.ts`'s key must include `roleBasis`, order-independently and
  from a copy, exactly as `basisKeyPart` already does for a formula row's basis. An absent basis
  keeps the old key byte-for-byte. Without this, changing a basis returns a stale score — that bug
  already happened once on this branch.
- [ ] **Step 6 — run tests + `npx tsc --noEmit`.**
- [ ] **Step 7 — commit.** `feat(autogear): let a role formula score on a derived basis`

---

### Task 2: The hosting rule

**Files:** `src/utils/autogear/offFormula/roleBasisHost.ts` (new); test alongside.

**Produces:** `roleAxis(role): 'damage' | 'repair' | 'shield' | null`,
`rolePrimaryStat(role): OffFormulaStat | null`, `roleHostsBasis(role, produces): boolean`.

**THIS TASK RUNS FIRST.** It is pure data, depends on nothing, and Task 1's scorer needs its
predicate to honour "only where the role has one".

- [ ] **Step 1 — write the failing test.** Pin the spec's table for all 12 roles. Then the
  invariant: `roleHostsBasis` is true exactly when `roleAxis(role)` matches the basis's `produces`.
  Assert explicitly that DEFENDER, DEFENDER_SECURITY, DEBUFFER_DEFENSIVE,
  DEBUFFER_DEFENSIVE_SECURITY, DEBUFFER_CORROSION, SUPPORTER_BUFFER and **SUPPORTER_OFFENSIVE**
  host **nothing** (the last by the 2026-09-21 owner ruling above). The hosting set is therefore
  exactly ATTACKER, DEBUFFER, DEBUFFER_BOMBER (damage on attack), SUPPORTER (repair on hp) and
  SUPPORTER_SHIELD (shield on hp).
  Carry a **totality tripwire**: the table's key set must equal the full `ShipTypeName` union, so
  a role added later fails this test rather than silently reading `undefined` as non-hosting.
- [ ] **Step 2 — run; expect failure.**
- [ ] **Step 3 — implement.** Derive from `CUSTOM_FORMULA_SEEDS` and the scorers, not a hardcoded
  ship list. A role added later must fail the build or the test rather than silently default.
- [ ] **Step 4 — tests + `tsc`. Commit.** `feat(autogear): name which roles can host a basis`

---

### Task 2b: The basis reaches the optimizer, on every path

**Files:** `src/utils/autogear/AutogearStrategy.ts`, `src/utils/autogear/runShipOptimizer.ts`, all
three of `strategies/GeneticStrategy.ts` / `TwoPassStrategy.ts` / `SetFirstStrategy.ts`,
`fastScoring/context.ts`, `fastScoring/fastScore.ts`; tests alongside.

**Why, and why it is one task rather than two.** Task 1 taught `calculatePriorityScore` and
`calculateTotalScore` to honour a basis, but nothing hands them one. Measured:
`findOptimalGearForShip` (`runShipOptimizer.ts:363`) forwards twelve arguments to
`strategy.findOptimalGear` and stops at `config.customFormula`;
`AutogearStrategy.findOptimalGear` (`AutogearStrategy.ts:44`) has no basis parameter, so no
strategy can pass one on. `ShipOptimizerConfig.roleBasis` is a dead field.

So the fast path is NOT a separate gap — it is downstream of this one. Wiring
`FastScoringContext` alone would add a field nothing populates.

**Every existing `roleBasis` test calls the scorers and the config builder DIRECTLY, never
through `findOptimalGearForShip`.** That is exactly why a dead field survived a green suite and
two reviews. This task's tripwire has to run through the real entry point.

**Decisions already taken — do not re-litigate:**
- **All three strategies honour the basis.** They are alternative algorithms for one scoring
  objective; a basis that worked only under Genetic would make gear silently depend on the
  algorithm dropdown.
- **Add `roleBasis?: RoleBasis` as a thirteenth POSITIONAL parameter.** It is consistent with the
  seven optional scoring inputs already there and it is the smallest diff. Grouping those
  trailing inputs into an options object is the right eventual shape and is filed separately —
  do not start it here.

- [ ] **Step 1 — write the failing test, THROUGH `findOptimalGearForShip`.** For a hosting role,
  a `ShipOptimizerConfig` carrying a `roleBasis` must return different gear than the same config
  without one, given an inventory where the basis's stat and the role's plain primary favour
  different pieces. Assert on the RETURNED GEAR, not on a score. Run it for each of the three
  algorithms. It must fail before the wiring — paste the real failure.
- [ ] **Step 2 — thread it.** Interface parameter, `findOptimalGearForShip`'s forward, and each
  strategy's own `calculateTotalScore` call. `GeneticStrategy` has two (its main call and the one
  inside `verifyAgainstSlowPath`) — both, or turning `VERIFY_FAST_SCORING` on reports a false
  divergence and sends the next agent hunting a bug that is not there.
- [ ] **Step 3 — the fast path.** `roleBasis` onto `FastScoringContext` and
  `buildFastScoringContext`, through to `fastScore`'s `calculatePriorityScore` call, **and into
  `fastScore`'s OWN local `cacheKey`** — it has one, and a key ignoring the basis serves a stale
  fitness, the bug that already happened once on this branch in `scoring.ts`. Reuse
  `scoring.ts`'s `roleBasisKeyPart`; do not write a second key encoder.
- [ ] **Step 4 — fast-versus-slow equivalence.** For a hosting role with a real basis, `fastScore`
  and the slow path must return the same fitness for the same gear. Walk EVERY hosting role,
  derived from the hosting set (`Object.keys(SHIP_TYPES).filter(r => roleAxis(r) !== null)`, the
  shape `roleBasis.test.ts` already uses) rather than hand-listed, so a role added later without
  fast-path wiring reddens.
- [ ] **Step 5 — mutation-probe all three tripwires** and report what reddens for each: drop the
  basis from the strategy forward, from the `fastScore` call, and from the `fastScore` cache key.
  A probe that reddens nothing means the test is not load-bearing — say so rather than move on.
- [ ] **Step 6 — tests + `tsc` + eslint. Commit.** `feat(autogear): let every optimizer path score on a derived basis`

**An absent `roleBasis` must leave every path byte-identical.** That is the regression pin.

---

### Task 3: Apply writes a role basis

**Files:** `src/components/autogear/OffFormulaNotice.tsx`, `src/pages/manager/AutogearPage.tsx`,
`src/constants/changelog.ts`; tests alongside.

- [ ] **Step 1 — write the failing tests.**
  - Cobalt/ATTACKER Apply emits
    `{ shipRole: 'ATTACKER', roleBasis: { produces: 'damage', terms: [attack x2.100, hp x0.267] } }`
    — `shipRole` stays set and no `customFormula` is written. Note the shape: `roleBasis` is
    `{ produces, terms }`, NOT a bare term array. It carries the axis it was derived for, and the
    scorer applies it only where `roleHostsBasis(role, produces)` agrees.
  - Makoli/SUPPORTER emits the repair basis.
  - **Panon/DEFENDER offers no Apply**, and renders **no equation line**.
  - **Corpus invariant** over all flagged ships x 12 roles: Apply is offered only where
    `roleHostsBasis(role, produces)`. Carry a non-vacuity counter asserting the walk saw both
    offered and withheld cases — the previous version of this test passed over a walk that could
    not reach its failing case.
- [ ] **Step 2 — run; expect failure**, specifically on Panon/DEFENDER. Paste it in the report.
- [ ] **Step 3 — implement.** Choose the basis whose `produces` the role hosts, not
  `findings[0].produces`. Withhold Apply otherwise.
  **Nothing about the excluded carrier is persisted.** The row-level `excludedNote` exists only
  because the ABANDONED Apply set `shipRole: null`, which unmounted the notice that named the
  excluded passive. This Apply leaves `shipRole` set, so the notice stays mounted and renders the
  excluded carrier from its own `deriveBasis` call, for the `produces` the role hosts. Do not add
  `excludedNote` to `roleBasis` or to the config — the row-level plumbing is Task 6 retirement
  material, not something to carry forward.
- [ ] **Step 4 — drop the equation line for a non-hosting role.** The finding stays; the equation
  and the "add it by hand" advice go. For a Defender both are actively harmful: the equation names
  Attack, which a Defender never wants.
- [ ] **Step 4b — close the two write-path gaps a review measured.** Neither is optional; without
  them `roleBasis` is a field nothing reads.
  - `AutogearPage.tsx` (~:674-692) builds `SavedAutogearConfig` by HAND-ENUMERATING its fields,
    and the load direction does the same. `roleBasis` is in neither list, so today it is never
    persisted or restored. Add it to both, and add an assertion that a config round-trips a
    basis — a hand-enumerated layer silently drops any field added to the type.
  (The optimizer half of this gap — config -> strategy -> scorer -> fast path — is Task 2b.
  What remains here is only persistence: getting a basis INTO the config in the first place.)
- [ ] **Step 5 — audit `UNRELEASED_CHANGES`.** Nothing has released since these entries were
  written, so they must describe the pivoted behaviour, not the pre-pivot one. Re-read all seven;
  at minimum "ships scoring off an ignored stat now show their real damage equation" is now false
  for the 24 Defenders. Rewrite or drop, 8-12 words per entry, one entry per user-visible change.
- [ ] **Step 6 — tests, `tsc`, eslint. Commit.** `feat(autogear): apply a derived basis to the ship's role`

---

### Task 4: The Defender tilt

**Files:** `src/components/autogear/OffFormulaNotice.tsx`; tests alongside.

**Why:** among builds of equal survival, Panon prefers more Defence, because he converts it to
damage for free. `effectiveHp` treats HP and Defence as interchangeable, so nothing expresses it.

**This is a `StatBonus`, not a basis.** A basis would redefine what survival is; a bonus is a
preference inside it. `SavedAutogearConfig.statBonuses` already reaches every role scorer.

- [ ] **Step 1 — ANSWERED 2026-09-21: a fixed modest nudge.** One Defence `StatBonus` magnitude
  shared by all 7 tilt ships; not per-kit, not a player control. Do not re-ask the owner.
  **Pick the number by MEASUREMENT, and note the obvious phrasing is unsatisfiable:** "never
  reorder a build that survives fewer rounds above one that survives more" cannot hold for any
  nonzero bonus, because for every magnitude there is a pair with a small enough survival gap and
  a large enough Defence gap to flip. An implementer handed that sentence either picks 0 or fudges.
  The satisfiable version is a MEASURED FLOOR:
  - Measure the smallest survival delta a single realistic gear swap produces across the 7 tilt
    ships (sweep the corpus stat ranges; say which pieces and which ships you swept).
  - Require the tilt to LOSE to any survival gap at or above that floor, and to decide ties
    strictly below it.
  - Report both the floor and the chosen magnitude, with the measured pair that pins each side.
  That is what "modest" has to mean here — a number with a measurement behind it rather than a
  taste. If the floor turns out to be so small that no useful magnitude fits under it, STOP and
  report that: it would mean the tilt cannot be expressed as a flat `StatBonus` at all, and the
  owner needs to hear it rather than receive a fudged constant.
- [ ] **Step 2 — write the failing tests.** The tilt control renders for a DEFENDER-family ship
  with a defence-scaled carrier; it does not render for a ship without one; accepting it appends a
  defence `StatBonus` and touches nothing else. The reach is MEASURED at exactly 7 ships (Cinya,
  Isha, Kafa, Madax, Morao, Panon, Suku) — pin that corpus count with a non-vacuity counter, and
  assert one of the other 17 Defenders (e.g. Opal, damage off attack) is offered no tilt.
- [ ] **Step 3 — run; expect failure. Step 4 — implement. Step 5 — tests, `tsc`, eslint.**
- [ ] **Step 6 — changelog + commit.** `feat(autogear): offer a Defence tilt to defenders whose kit rewards it`

---

## STAGE A CHECKPOINT — STOP

Report: the basis Apply writes for Cobalt, Prophet and Makoli; the before/after marginal value of
crit and heal modifier for Makoli (the losslessness table); that Panon shows a finding, no
equation, and a tilt; and the dev server URL.

Also put these three in front of the owner — all behaviour, none a bug, and each a decision they
may want to revisit once they see it:

1. **A comparison row carries the ship's derived basis unblanked — moot.** There are no
   comparison rows on this branch (#498, removed).
2. **Apply is withheld for every DEFENDER-family ship**, Panon and Madax included. The honest
   consequence of the Defender ruling, but that bucket ends at a notice plus the tilt.
3. **Dual-axis ships store one basis.** Cinya, Isha, Madax and Morao carry BOTH a damage and a
   repair equation; `roleBasis` holds one `produces`. The compared-row consequence is moot (no
   comparison rows on this branch); closing the underlying fact would mean deriving on the fly —
   do not build that without the owner asking.

**Do not start Stage B until the owner has tested and replied.**

---

# STAGE B — sharing, and cleanup

### Task 4b: Let the player edit an applied equation

**Owner request, 2026-09-23:** "a user should be able to edit the formula in case of personal
preference or accommodating passives." The derivation deliberately excludes passives (their firing
frequency depends on the fight) and names them in the notice — editing is how a player adds one.

**Files:** `src/components/autogear/OffFormulaNotice.tsx`, the basis-editing controls in
`CustomFormulaForm.tsx` / `CustomFormulaRow.tsx` (reuse, do not rebuild); tests alongside.

- [ ] **Step 1 — failing tests.** With an equation applied, the notice offers an edit control;
  editing a weight, adding a term and removing a term each write `roleBasis.terms` through the
  existing update path and keep `produces` and `shipRole` unchanged; the edited terms are what the
  applied state then shows. A term that validates to nothing (blank, zero, negative, a derived
  stat) is refused at save — the SAME predicate as the scorer, `usableBasisTerms`, never a second
  copy. An all-zero equation cannot be saved.
- [ ] **Step 2 — implement.** Reuse the basis-term controls from the custom-formula editor rather
  than writing new inputs; extract a shared piece if they are welded to a formula row. The term
  picker offers only `isBasisStat` stats. Keep the excluded-carrier sentence visible beside the
  editor — it is the reason most players will open it.
- [ ] **Step 3 — "Restore the derived equation."** Once edited, offer a way back to the derived
  terms. Distinguish edited-from-derived visibly, so a player can tell whether autogear is scoring
  the kit's equation or their own version of it.
- [ ] **Step 4 — docs + changelog + commit.** One DocumentationPage sentence on editing and
  restoring. One changelog entry, area prefix + 8-12 words.
  `feat(autogear): let a player edit an applied equation`

---

### Task 5: Share a role basis, and a from-scratch Custom formula

**Owner rulings, 2026-09-23 — settled, do not re-ask:**
- Custom formulas STAY and stay SHAREABLE. Ships that fit no role (Prophet, Xcellence) become
  buildable as Custom formulas once #550's crit compound stat exists, and those builds should be
  shareable.
- **A Custom formula built entirely from scratch — no "start from" role — must be shareable too.**
  Today it cannot: `community_recommendations.ship_role` is `text NOT NULL`
  (`supabase/current-schema.sql:237`), so `mirroredShipRole` returns null for it and the write path
  refuses. The owner chose a nullable column over keeping the restriction.

**Files:** `src/schemas/sharedAutogearBuild.ts`, `src/types/communityRecommendation.ts`,
`src/utils/communityBuild.ts`, `src/services/communityRecommendations.ts`,
`src/components/autogear/SharedBuildFields.tsx`, `src/components/autogear/AutogearConfigList.tsx`,
a new `supabase/migrations/YYYYMMDD[seq]_…sql`; tests alongside.

- [ ] **Step 1 — the migration.** Make `ship_role` nullable. Load `supabase-postgres-best-practices`
  before writing it. Find every view, function, index, trigger, RLS policy and CHECK that references
  `ship_role` and state in the report what each does with NULL (a policy or index that assumes a
  value is the trap). **The user applies migrations — never run the Supabase CLI, in any form.**
  Never edit `current-schema.sql` by hand and never edit an applied migration.
- [ ] **Step 2 — failing tests.** A role build carrying a `roleBasis` round-trips; a `version: 1`
  row still reads; a corrupt basis is rejected at import rather than filtered at score time; a
  from-scratch Custom formula (no `seededFrom`) now shares and reads back with a null role; a
  build with neither a role nor a usable formula row is still refused.
- [ ] **Step 3 — implement.** Carry `roleBasis` in the shared build. Write a null `ship_role` for a
  role-less Custom build instead of refusing it. Keep the `version` union, the v1 migration, the
  basis-term validation at import and the payload caps. `mirroredShipRole` stops being a gate on
  sharing — decide by measurement whether it still earns its place or becomes Task 6 material.
- [ ] **Step 4 — every reader of a null role.** `SharedBuildFields`, `AutogearConfigList`,
  `normalizeShipRole`, and anything else that renders or filters by the column must show a null
  role as "Custom" and never crash, mislabel, or drop the row. Grep every reader; do not trust
  this list.
- [ ] **Step 5 — the docs sentence.** `DocumentationPage.tsx` currently says a Custom formula built
  entirely by hand with no starting role cannot be shared. Make it true for the new behaviour.
- [ ] **Step 6 — tests, `tsc`, eslint. Commit.** Changelog: one entry if a player would notice
  (they would — a from-scratch build is now shareable). Tell the owner the migration file exists
  and must be applied BEFORE this ships, or every role-less share fails at insert.

### Task 6: Retire what the pivot orphaned

- [ ] **Step 1** — find what is now unreferenced, by measurement (grep + `tsc`), not by memory.
  Candidates: `mirroredShipRole`'s `seededFrom` fallback, the Custom-mode Apply path,
  `hasBasisHost`'s formula-row variant. The band modules this step once protected were removed
  with #498 (split, 2026-09-23); they survive only on `feat/autogear-sim-rerank`.
- [ ] **Step 2** — update `DocumentationPage.tsx`: what the notice means, that passive skills are
  not counted and why, the Defender tilt, and how to edit a basis. No symbol names — players read
  this.
- [ ] **Step 3** — `npm test` in full. **Step 4** — commit.

---

## Notes carried from the spec

- **Out of scope:** Quixilver (no stat basis anywhere). Xcellence and Vindicator (gated — the
  channel switches at a threshold a linear basis cannot express).
- **The basis editor stays** for hand-authored formulas; it is no longer Apply's target.
- **This work merges on its own.**
