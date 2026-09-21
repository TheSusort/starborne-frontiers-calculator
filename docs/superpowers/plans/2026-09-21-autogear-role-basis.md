# Autogear Role Basis Implementation Plan (#544, pivot 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the derived scoring basis from a seeded custom formula onto the ship's REAL role
formula, so applying it stops degrading everything the basis does not touch.

**Architecture:** `SavedAutogearConfig` gains `roleBasis`. Each role scorer resolves its primary
quantity through `resolveBasisValue` instead of reading one stat. Apply writes `roleBasis` and
leaves `shipRole` set. A DEFENDER-family ship is offered a Defence `StatBonus` tilt instead of an
equation it should not gear toward.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest. Branch `feat/autogear-sim-rerank`
(PR #541, draft) — this work builds on it and the combined branch merges together.

## Read before Task 1

- Spec: `docs/superpowers/specs/2026-09-18-autogear-role-objective-tuning-design.md` (2026-09-21
  revision). It holds the measurement that forced this pivot and the role-to-axis table.
- Ledger: `.superpowers/sdd/progress.md`, the `#544` section. It records four controller errors
  and one bug that recurred three times. Read it before trusting any invariant in this plan.

## Global Constraints

- **Execution PAUSES at the Stage A checkpoint** for the repo owner to test in a browser.
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
| `src/utils/autogear/simRerank/roleBasisHost.ts` | **New.** Role to axis and primary stat; the hosting predicate. |
| `src/schemas/sharedAutogearBuild.ts` | Carry `roleBasis`; retire the nullable-role branch. |

---

# STAGE A — the role basis

### Task 1: Role scorers take a basis

**Files:** `src/types/autogear.ts`, `src/utils/autogear/priorityScore.ts`,
`src/utils/autogear/scoring.ts`; test `src/utils/autogear/__tests__/roleBasis.test.ts` (new).

**Produces:** `SavedAutogearConfig.roleBasis?: BasisTerm[]`; every role scorer accepts an optional
basis; `calculatePriorityScore` threads it.

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
  primary quantity, honoured only where the role has one.
- [ ] **Step 4 — thread it.** Give each hosting scorer an optional basis and resolve its primary
  through `resolveBasisValue(stats, basis, <primary>)`. The spec's table names the primary per
  role. **Survival roles take no basis** — do not add a parameter you then ignore; leave those
  signatures alone so the type says which roles host.
- [ ] **Step 5 — cache key.** `scoring.ts`'s key must include `roleBasis`, order-independently and
  from a copy, exactly as `basisKeyPart` already does for a formula row's basis. An absent basis
  keeps the old key byte-for-byte. Without this, changing a basis returns a stale score — that bug
  already happened once on this branch.
- [ ] **Step 6 — run tests + `npx tsc --noEmit`.**
- [ ] **Step 7 — commit.** `feat(autogear): let a role formula score on a derived basis`

---

### Task 2: The hosting rule

**Files:** `src/utils/autogear/simRerank/roleBasisHost.ts` (new); test alongside.

**Produces:** `roleAxis(role): 'damage' | 'healing' | 'shield' | null`,
`rolePrimaryStat(role): OffFormulaStat | null`, `roleHostsBasis(role, produces): boolean`.

- [ ] **Step 1 — write the failing test.** Pin the spec's table for all 12 roles. Then the
  invariant: `roleHostsBasis` is true exactly when `roleAxis(role)` matches the basis's `produces`.
  Assert explicitly that DEFENDER, DEFENDER_SECURITY, DEBUFFER_DEFENSIVE,
  DEBUFFER_DEFENSIVE_SECURITY, DEBUFFER_CORROSION and SUPPORTER_BUFFER host **nothing**.
- [ ] **Step 2 — run; expect failure.**
- [ ] **Step 3 — implement.** Derive from `CUSTOM_FORMULA_SEEDS` and the scorers, not a hardcoded
  ship list. A role added later must fail the build or the test rather than silently default.
- [ ] **Step 4 — tests + `tsc`. Commit.** `feat(autogear): name which roles can host a basis`

---

### Task 3: Apply writes a role basis

**Files:** `src/components/autogear/OffFormulaNotice.tsx`; tests alongside.

- [ ] **Step 1 — write the failing tests.**
  - Cobalt/ATTACKER Apply emits `{ shipRole: 'ATTACKER', roleBasis: [attack x2.100, hp x0.267] }`
    — `shipRole` stays set and no `customFormula` is written.
  - Makoli/SUPPORTER emits the repair basis.
  - **Panon/DEFENDER offers no Apply**, and renders **no equation line**.
  - **Corpus invariant** over all flagged ships x 12 roles: Apply is offered only where
    `roleHostsBasis(role, produces)`. Carry a non-vacuity counter asserting the walk saw both
    offered and withheld cases — the previous version of this test passed over a walk that could
    not reach its failing case.
- [ ] **Step 2 — run; expect failure**, specifically on Panon/DEFENDER. Paste it in the report.
- [ ] **Step 3 — implement.** Choose the basis whose `produces` the role hosts, not
  `findings[0].produces`. Withhold Apply otherwise. Carry only the matching `produces`'
  `excludedNote`.
- [ ] **Step 4 — drop the equation line for a non-hosting role.** The finding stays; the equation
  and the "add it by hand" advice go. For a Defender both are actively harmful: the equation names
  Attack, which a Defender never wants.
- [ ] **Step 5 — tests, `tsc`, eslint. Commit.** `feat(autogear): apply a derived basis to the ship's role`

---

### Task 4: The Defender tilt

**Files:** `src/components/autogear/OffFormulaNotice.tsx`; tests alongside.

**Why:** among builds of equal survival, Panon prefers more Defence, because he converts it to
damage for free. `effectiveHp` treats HP and Defence as interchangeable, so nothing expresses it.

**This is a `StatBonus`, not a basis.** A basis would redefine what survival is; a bonus is a
preference inside it. `SavedAutogearConfig.statBonuses` already reaches every role scorer.

- [ ] **Step 1 — ASK THE OWNER the tilt magnitude before writing code.** Nothing in the kit says
  how much to prefer Defence — the damage is incidental, so there is no number to transcribe. Put
  the question with options (a fixed nudge, a value from the kit's defence coefficient, a player
  control) and wait. Do not pick one silently.
- [ ] **Step 2 — write the failing tests.** The tilt control renders for a DEFENDER-family ship
  with a defence-scaled carrier; it does not render for a ship without one; accepting it appends a
  defence `StatBonus` and touches nothing else.
- [ ] **Step 3 — run; expect failure. Step 4 — implement. Step 5 — tests, `tsc`, eslint.**
- [ ] **Step 6 — changelog + commit.** `feat(autogear): offer a Defence tilt to defenders whose kit rewards it`

---

## STAGE A CHECKPOINT — STOP

Report: the basis Apply writes for Cobalt, Prophet and Makoli; the before/after marginal value of
crit and heal modifier for Makoli (the losslessness table); that Panon shows a finding, no
equation, and a tilt; and the dev server URL.

**Do not start Stage B until the owner has tested and replied.**

---

# STAGE B — sharing, and cleanup

### Task 5: Share a role basis

**Files:** `src/schemas/sharedAutogearBuild.ts`, `src/types/communityRecommendation.ts`,
`src/utils/communityBuild.ts`; tests alongside.

- [ ] **Step 1 — write the failing tests.** A role build with a `roleBasis` round-trips; a
  `version: 1` row still reads; a corrupt basis is rejected at import, not filtered at score time.
- [ ] **Step 2 — run; expect failure. Step 3 — implement.** Carry `roleBasis`. Return
  `shipRole` to non-nullable **only if** open question 3 is resolved against hand-authored Custom
  sharing — otherwise leave the union alone and just add the field. Ask rather than assume.
- [ ] **Step 4 — tests, `tsc`. Commit.**

### Task 6: Retire what the pivot orphaned

- [ ] **Step 1** — find what is now unreferenced, by measurement (grep + `tsc`), not by memory.
  Candidates: `mirroredShipRole`'s `seededFrom` fallback, the Custom-mode Apply path,
  `hasBasisHost`'s formula-row variant. **Do not delete the retained band modules** — they are
  deliberately unmounted for the two gated ships.
- [ ] **Step 2** — update `DocumentationPage.tsx`: what the notice means, that passive skills are
  not counted and why, the Defender tilt, and how to edit a basis. No symbol names — players read
  this.
- [ ] **Step 3** — `npm test` in full. **Step 4** — commit.

---

## Notes carried from the spec

- **Out of scope:** Quixilver (no stat basis anywhere). Xcellence and Vindicator (gated — the
  channel switches at a threshold a linear basis cannot express).
- **The basis editor stays** for hand-authored formulas; it is no longer Apply's target.
- **PR #541 remains a draft and does not merge on its own.** This work merges with it.
