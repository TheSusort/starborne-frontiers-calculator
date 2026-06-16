# Combat Engine bySide Unification — PR5b: Flip Healing Readers to the Per-Actor Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the three heal-target intake readers at the healing row assembly (`engine.ts` ~3907–3909) from the per-round scalars (`roundIncomingDamage`/`roundShieldAbsorbed`/`roundBarrierAbsorbed`) to the per-actor bucket written in PR5a (`perActorIncoming.get(healTarget.id)`). The scalars stay (still bumped, now unread) — PR5e deletes them.

**Architecture:** PR5a writes `perActorIncoming` (a `Map<string, ActorIntake>`) in parallel with the scalars; in the single-target / non-positional path the heal target's bucket entry is provably equal to the scalar (it is the only victim the `playerSink` ever records). PR5b is a pure source swap of the three reader expressions — the bucket becomes the source of truth for the heal target's row. In positional AoE mode the scalar inflates (it sums every AoE victim's intake onto the tank), so reading the bucket is the more-correct per-victim value; that divergence is invisible to every golden (no golden is positional) and full per-victim AoE attribution remains PR7's job.

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts`. Result type: `HealingRoundEngine` (engine.ts ~991–1016). Adapters (`healingEngineAdapter.ts`, `dpsSimulator.ts`) are NOT touched.

**IMPLEMENTATION NOTE (post-execution):** The plan as written kept the three `round*` scalars (deletion deferred to PR5e). In practice, once the readers flip, the scalars are *assigned but never read* — ESLint's `no-unused-vars` (`--max-warnings 0`) rejects them. So the three `round{Incoming,Shield,Barrier}` scalar declarations **and their `playerSink` bumps were removed in PR5b**, absorbing that slice of PR5e. PR5e's remaining job is the `enemyHpDecline` scalar (only dead after PR5d wires `indestructible`). Byte-identity is unaffected (removing dead write-only `+=` mutations changes no observable). Shipped commit `5112426c`.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` §3 item 6, §4 PR5 row. This is sub-split **PR5b of 5** (a–e). Re-deriving the golden expectation from the PR5 parent row: PR5 as a whole permits *audited healing-side churn*, but **PR5b specifically is byte-identical for BOTH DPS and healing goldens** — bucket == scalar holds for every golden (all are single-target / non-positional), so the swap changes no emitted value. Campaign memory: `project-combat-engine-byside-unification` (PR5 = item 5).

---

## Background (verified against the current PR5a tip `f83121d2`)

- `ActorIntake` interface (engine.ts ~983–989): `{ incoming, shieldAbsorbed, barrierAbsorbed }`.
- `HealingRoundEngine.perActorIncoming: Map<string, ActorIntake>` (~1001–1004) — the additive field added in PR5a; documented "readers flip to this map in PR5b. Adapters must NOT read this field until PR5b."
- Per-round scalars declared at ~2120–2125; per-round `const perActorIncoming = new Map<...>()` + `intakeFor(id)` get-or-create at ~2129–2135.
- `playerSink` (~2315–2333) bumps BOTH the scalar AND `intakeFor(victimId).<channel>` for each of the three channels. `enemySink` (~2347–2351) no-ops all three (player→dummy intake is outgoing, never recorded).
- In the legacy single-target path, `applyIncomingToTarget(damage, victim = healTarget!)` always defaults `victim` to `healTarget`, so the ONLY key the `playerSink` ever writes is `healTarget.id` → `perActorIncoming.get(healTarget.id)` is provably equal to the scalar, and the map has exactly one entry (no dummy `'enemy'` entry). This is the byte-identical invariant locked by `perActorIncoming.test.ts` (PR5a).
- **The ONLY reader** of the three scalars is the healing row push at ~3902–3910 (verified by grep: every other mention is a declaration, a `playerSink` bump, or a comment). After the flip the scalars are dead reads-wise but still written; PR5e deletes them (and at that point tsc would fail if any reader still pointed at them — that is the structural guard that the flip stuck).
- **DPS mode** runs with `healing: undefined`; the healing row push is never reached and `perActorIncoming` is never populated → DPS goldens trivially byte-identical.
- **Healing goldens** snapshot the ADAPTER output (`HealingRoundData`). The adapter reads `incomingDamage`/`shieldAbsorbed`/`barrierAbsorbed` off the row; PR5b changes only the SOURCE of those three numbers, and the source value is identical (bucket == scalar) for every golden fixture → adapter output byte-identical.

## Why no new behavioral test (and why that's correct)

In non-positional mode the bucket has exactly one entry equal to the scalar, so there is **no value-level way** to distinguish "row reads bucket" from "row reads scalar" — that is precisely what makes PR5b byte-identical. The existing `perActorIncoming.test.ts` (PR5a) asserts `row.perActorIncoming.get(healTarget.id) === row.<scalar field>` across all three channels, non-vacuously, and stays green; after the flip it confirms the row exposes the bucket value (the assertion is definitionally satisfied but still guards that the bucket is populated and the row surfaces it). The structural guard that the flip is real and not silently reverted is PR5e: deleting the scalars makes tsc fail if any reader still references them. Adding a positional-divergence assertion here would pre-empt PR7 (genuine per-victim AoE attribution) and is out of scope. Do NOT `vitest -u`: a golden moving means the bucket and scalar disagreed on a fixture that should be single-target — STOP and diagnose the seam.

## File Structure

- **Modify:** `src/utils/combat/engine.ts` — the three reader expressions in the healing row push (~3907–3909). Nothing else.
- **Update (doc comment only, optional):** the `HealingRoundEngine.perActorIncoming` JSDoc (~1001–1004) — soften "Adapters must NOT read this field until PR5b" to reflect that the heal-target row now sources its scalars from it.
- **Do NOT touch:** `healingEngineAdapter.ts`, `dpsSimulator.ts`, `battleSimulator.ts`, the `playerSink`/`enemySink`, the scalar declarations or bumps, `perActorIncoming.test.ts` (it already locks the invariant).

---

### Task 1: Flip the three healing-row readers to the per-actor bucket

**Files:** Modify `src/utils/combat/engine.ts`.

- [ ] **Step 1: Establish the byte-identical baseline.** Run the golden suites on the PR5a tip BEFORE editing:

  Run: `npm test -- dpsGoldenParity healingGoldenParity`
  Expected: PASS, and `git status --short` shows no `.snap`/golden file changed. This is the baseline the flip must preserve.

- [ ] **Step 2: Read the exact site.** Read `engine.ts` ~3898–3911 (the `if (healTarget) { healingRounds.push({ … }) }` block). Confirm `healTarget` is in scope (the `if (healTarget)` guard at ~3902 narrows it non-null) and that the three lines read verbatim:
  ```ts
  incomingDamage: roundIncomingDamage,
  shieldAbsorbed: roundShieldAbsorbed,
  barrierAbsorbed: roundBarrierAbsorbed,
  perActorIncoming,
  ```

- [ ] **Step 3: Flip the three readers.** Replace those three reader lines with reads off the bucket, keyed by the heal target. Add a single local for readability and to avoid three `.get()` calls:
  ```ts
  // PR5b: the heal target's intake totals are sourced from its per-actor bucket
  // (written in parallel by playerSink in PR5a). In the single-target path this is
  // byte-identical to the legacy scalars (the heal target is the only recorded victim);
  // in positional AoE it is the correct per-victim share rather than the inflated
  // tank-sums-everything scalar. The scalars remain (unread) until PR5e deletes them.
  const healTargetIntake = perActorIncoming.get(healTarget.id);
  ```
  then in the pushed object:
  ```ts
  incomingDamage: healTargetIntake?.incoming ?? 0,
  shieldAbsorbed: healTargetIntake?.shieldAbsorbed ?? 0,
  barrierAbsorbed: healTargetIntake?.barrierAbsorbed ?? 0,
  perActorIncoming,
  ```
  Place the `const healTargetIntake` line just inside the `if (healTarget)` block, before the `healingRounds.push({`. Leave `perActorIncoming,` on the object as-is (still passes the whole map for downstream/PR5c+).

- [ ] **Step 4: Verify the scalars are now write-only.** Confirm `roundIncomingDamage`/`roundShieldAbsorbed`/`roundBarrierAbsorbed` no longer appear on the right-hand side of any assignment or in any read (grep): the only remaining mentions should be their declarations (~2120–2125), the three `playerSink` bumps (~2317/2321/2325), and comments. They are intentionally kept (PR5e deletes them) — do NOT delete them in this PR.

  Run: `grep -n "roundIncomingDamage\|roundShieldAbsorbed\|roundBarrierAbsorbed" src/utils/combat/engine.ts`
  Expected: only declarations + `playerSink` bumps + comment lines; NO occurrence inside the `healingRounds.push({ … })` object.

- [ ] **Step 5: tsc + lint.** Run `npx tsc --noEmit` and `npm run lint` — both clean (max-warnings 0).

- [ ] **Step 6: Commit.**
```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): flip heal-target intake readers to per-actor bucket (PR5b)"
```

---

### Task 2: Prove byte-identical + the PR5a invariant still holds

**Files:** None created — this task is verification. (Optionally update the `perActorIncoming` JSDoc; see Step 4.)

- [ ] **Step 1: Re-run the golden suites.** Run: `npm test -- dpsGoldenParity healingGoldenParity`
  Expected: PASS with ZERO snapshot movement; `git status --short` shows no `.snap`/golden file changed. **If a golden moved, the flip diverged on a fixture that should be single-target → STOP and diagnose the seam (a fixture set a `position`, or the bucket key ≠ `healTarget.id`). Never `vitest -u`.**

- [ ] **Step 2: Re-run the PR5a invariant lock.** Run: `npm test -- perActorIncoming`
  Expected: PASS (all three channels). It now confirms the row exposes the bucket value across incoming/shield/barrier.

- [ ] **Step 3: Full suite + gates.** Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (expect 0 findings / 141 ships). All clean.

- [ ] **Step 4 (optional doc): Update the `perActorIncoming` JSDoc.** Edit the `HealingRoundEngine.perActorIncoming` comment (~1001–1004): change the PR5a "readers flip to this map in PR5b. Adapters must NOT read this field until PR5b — it is write-only in PR5a." to reflect the post-flip reality, e.g. "The heal target's `incomingDamage`/`shieldAbsorbed`/`barrierAbsorbed` row totals are sourced from this map's `healTarget.id` entry (PR5b). The legacy per-round scalars are still written in parallel but unread; PR5e removes them." Then re-run `npx tsc --noEmit` (comment-only, no behavior change).

- [ ] **Step 5: Commit (if Step 4 done).**
```bash
git add src/utils/combat/engine.ts
git commit -m "docs(combat): note heal-target row now sources the per-actor bucket (PR5b)"
```

---

### Task 3: Verification sweep + handoff

- [ ] **Step 1:** No changelog entry — internal refactor, no user-visible change (DPS + healing displays byte-identical). Confirm and skip.
- [ ] **Step 2:** `git diff feat/combat-sim-phase5-pr2...HEAD --stat` — confirm ONLY `engine.ts` (and this plan doc) changed; no adapter files, no golden snapshots, no test files modified.
- [ ] **Step 3:** Hand off for final holistic review (a reviewer should `git revert` the Task-1 hunk and confirm goldens stay green either way — that is the signature of a correct byte-identical refactor — then confirm the reader genuinely points at the bucket and that the scalars are now write-only / slated for PR5e).

---

## Notes for the executor

- **Branch:** `feat/combat-engine-unify-pr5b-flip-readers` (already created off the PR5a tip `f83121d2` on `feat/combat-sim-phase5-pr2`). Will be locally squash-merged into `feat/combat-sim-phase5-pr2` (matching PR4/PR5a), then PR5c branches off the new tip.
- **The load-bearing invariant:** PR5b is BYTE-IDENTICAL for all goldens. The flip swaps only the SOURCE of three numbers whose value is unchanged on every fixture. If any golden moves, a fixture left the single-target path — fix the seam, never `vitest -u`.
- **Do NOT** delete the scalars (PR5e), touch `healTargetDestroyedRound` (PR5c), wire `indestructible` (PR5d), or modify any adapter.
- **Workflow:** `gh auth switch --hostname github.com --user TheSusort` before any push. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. `git push … | cat` (progress output crashes the Bash wrapper).
