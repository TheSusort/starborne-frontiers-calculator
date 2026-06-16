# Combat Engine bySide Unification — PR5c: Heal-Target Destroyed-Round → Per-Actor `destroyedRound` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the heal-target-only `healTargetDestroyedRound` scalar (`engine.ts`) with reads of the per-actor `CombatActor.destroyedRound` field already stamped by `recordDestroyed`. The healing result's `healing.destroyedRound` becomes `healTarget.destroyedRound` (modulo the post-round backstop, see below). Audited-no-diff (byte-identical goldens; the seam is the backstop's independent contribution, which must be preserved or proven dead).

**Architecture:** `healTargetDestroyedRound` (a local `let`, engine.ts ~1739) is fed from two places: (1) `playerSink.onHealTargetDestroyed` copies `victim.destroyedRound` right after `recordDestroyed(victim,…)` fired (~2326) — **100% redundant** with `healTarget.destroyedRound`; (2) the post-round backstop (~3936) sets `= r` when `healTarget.currentHp <= 0` but `recordDestroyed` never fired — **the only independent contribution.** The result read (~3959) emits `healing.destroyedRound` from the scalar. PR5c removes source (1) and the scalar, reading `healTarget.destroyedRound` instead; the backstop is the crux — Task 1 characterizes whether it is reachable, Task 2 picks the byte-identical end-state.

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts`. Per-actor field: `CombatActor.destroyedRound` + `recordDestroyed` helper (`src/utils/combat/state.ts` ~115/163-171). Adapters NOT touched.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` §3 item 6, §4 PR5 row. Sub-split **PR5c of 5** (a–e). Per the PR5 parent row, PR5c is **audited-no-diff**: all DPS + healing goldens stay byte-identical, and every retained/removed seam is explained. Campaign memory: `project-combat-engine-byside-unification` (PR5 = item 5).

---

## Background (verified against the PR5b tip `eec309db`)

- `CombatActor.destroyedRound?: number` (state.ts ~115): "Round this actor first reached 0 HP (set once via recordDestroyed). Undefined while alive."
- `recordDestroyed(actor, round, bus)` (state.ts ~167): idempotent (`if destroyedRound !== undefined return`), stamps `destroyedRound` AND emits exactly one `ship-destroyed`. The "set once" guard doubles as the single-emit guard.
- `let healTargetDestroyedRound: number | undefined;` (engine.ts ~1739).
- Sink write (~2326, inside `playerSink.onHealTargetDestroyed`, gated `victim === healTarget`): `healTargetDestroyedRound = victim.destroyedRound;`. This callback runs from `applyVictimDamage` right AFTER `recordDestroyed(victim, r, bus)` (~2283) on the heal-target death path, so at that instant `victim.destroyedRound === r` and `victim === healTarget` → the scalar equals `healTarget.destroyedRound`. **Redundant.**
- Backstop (~3936, end of the per-round loop, inside `if (healTarget)`): `if (healTargetDestroyedRound === undefined && healTarget.currentHp <= 0) { healTargetDestroyedRound = r; }`. Sets a LOCAL value only — **no actor mutation, no `ship-destroyed` emit.** Comment (~3900): "a backstop for any other 0-HP path."
- Result read (~3959): `...(healTargetDestroyedRound !== undefined ? { destroyedRound: healTargetDestroyedRound } : {})` inside `healing: { rounds, … }`.
- **Other `destroyedRound` readers (must stay unaffected):** turn-skip dead-actor guard (~2793 `actor.destroyedRound !== undefined`), enemy death/combat-end paths (~3826 `recordDestroyed(enemy,…)`), the per-victim positional path (each victim records its own `destroyedRound` via `recordDestroyed` at ~2283). **These read the ACTOR field. So any change that newly stamps `healTarget.destroyedRound` where the old code only set the LOCAL scalar would leak into these readers in subsequent rounds — that is the central correctness risk and the reason the backstop's end-state is not a free choice.**

## The central question (Task 1 resolves it): is the backstop reachable?

`recordDestroyed(healTarget,…)` fires inside `applyVictimDamage` whenever the heal target's HP first reaches 0 via ANY damage intake (direct enemy hits, DoT ticks, bombs — all funnel through `applyIncomingToTarget`/`applyVictimDamage`). So `healTarget.destroyedRound` is set on every damage-death path. The backstop only adds value if the heal target can reach `currentHp <= 0` via a path that does NOT call `recordDestroyed`. Task 1 must try to construct that. Two outcomes:

- **(A) Backstop is DEAD (no constructible path).** Then `healTarget.destroyedRound` is provably equal to the old scalar at the read site for every input → delete the scalar, the sink callback, AND the backstop; read `healTarget.destroyedRound`. Cleanest, fully byte-identical. The death is proven by a characterization test that drives the heal target to 0 HP every way the engine allows and shows `destroyedRound` is always already set at round end (the backstop condition `destroyedRound === undefined && currentHp <= 0` never holds).
- **(B) Backstop is REACHABLE.** Then it must be preserved WITHOUT side effects. **Do NOT** stamp `healTarget.destroyedRound = r` in the backstop (that leaks into the turn-skip/combat-end readers above) and **do NOT** call `recordDestroyed` there (that adds a `ship-destroyed` emit the old code never produced). Instead retain a minimal local fallback: read the result as `healTarget.destroyedRound ?? backstopRound`, where `backstopRound` is a tiny local `let` set ONLY by the surviving backstop (still no actor mutation, no emit) — i.e. keep just the independent half of the old scalar, drop the redundant half. Byte-identical and side-effect-free.

Default expectation from the code read: **(A)** — but Task 1 must PROVE it, not assume it. If the proof is inconclusive, ship **(B)** (strictly safe).

## File Structure

- **Modify:** `src/utils/combat/engine.ts` only — remove the `healTargetDestroyedRound` scalar (~1739) + the `onHealTargetDestroyed` sink write (~2326, and likely the whole callback if nothing else uses it — VERIFY), adjust the backstop (~3936) and result read (~3959) per Task 1's outcome.
- **Create:** `src/utils/combat/__tests__/destroyedRoundUnification.test.ts` — characterization locks + (if outcome B) a backstop-reachability repro.
- **Do NOT touch:** `state.ts` (`recordDestroyed`/`destroyedRound` are correct as-is), any adapter, `enemyHpDecline` (PR5d/5e), `indestructible` (PR5d).

---

### Task 1: Characterize current `healing.destroyedRound` behavior + decide backstop reachability

**Files:** Create `src/utils/combat/__tests__/destroyedRoundUnification.test.ts`.

- [ ] **Step 1: Read the sites.** Read engine.ts ~1739, ~2279-2330 (recordDestroyed call + onHealTargetDestroyed callback), ~3900-3965 (per-round backstop + result assembly), ~2785-2855 (turn-skip dead-actor guard, to understand who else reads `actor.destroyedRound`), and state.ts ~163-171. Confirm the identifiers and that the backstop sets ONLY the local scalar today.

- [ ] **Step 2: Write characterization locks (GREEN against current code).** In a healing fixture (mirror `perActorIncoming.test.ts` / `decrementUnification.test.ts` — `healTargetId` set, manual enemies, NON-positional), assert `result.healing!.destroyedRound` for:
  - **Target survives all rounds** → `destroyedRound` is `undefined` (absent key).
  - **Target dies from a direct hit in round N** → `destroyedRound === N`.
  - **Target dies from a DoT tick** (apply a corrosion/inferno that kills at turn-start in round N) → `destroyedRound === N`.
  - **Target dies, then "revives" is impossible** (death is sticky — once set it never advances): drive a kill in round 2 with `numRounds: 4`, assert `destroyedRound === 2` (not 4).
  - Non-vacuous: at least one scenario has a defined `destroyedRound` AND one has `undefined`.

- [ ] **Step 3: Probe the backstop.** Attempt to construct a heal target at `currentHp <= 0` at round end WITHOUT `recordDestroyed` firing (the only path that sets the local scalar independently). Candidates to try: a heal target seeded at 0/negative HP; HP driven to exactly 0 by a non-`applyVictimDamage` mutation if any exists; a Cheat-Death interaction that floors HP without recording. NOTE: `createActor` always sets `currentHp = stats.hp` (state.ts ~147) — there is no constructor param for starting HP, so a "seeded at 0 HP" target needs a post-construction mutation path or an input that drives HP to 0 (don't assume a constructor knob exists). For each attempt, log whether `healTarget.destroyedRound` is already set at round end (i.e. whether the backstop condition `destroyedRound === undefined && currentHp <= 0` can ever be TRUE).
  - If NO attempt makes the backstop condition true → record **OUTCOME A** (backstop dead). Write a test documenting that across these scenarios `destroyedRound` is always set whenever `currentHp <= 0` (the backstop is unreachable).
  - If an attempt DOES make it true → record **OUTCOME B** (reachable). Capture that exact scenario as a locking test asserting the current `destroyedRound` value (this is the behavior Task 2 must preserve).

- [ ] **Step 4: Run.** `npm test -- destroyedRoundUnification` — all GREEN against current (unmodified) engine. Commit the characterization.
```bash
git add src/utils/combat/__tests__/destroyedRoundUnification.test.ts
git commit -m "test(combat): characterize heal-target destroyedRound + backstop reachability (PR5c Task 1)"
```

---

### Task 2: Replace the scalar with the per-actor field (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts`.

- [ ] **Step 1: Flip the result read.** At ~3959, source the destroyed round from the actor field:
  - **Outcome A:** `...(healTarget.destroyedRound !== undefined ? { destroyedRound: healTarget.destroyedRound } : {})`.
  - **Outcome B:** keep a minimal local `let backstopDestroyedRound: number | undefined;` set ONLY by the surviving backstop (Step 3), and read `const dr = healTarget.destroyedRound ?? backstopDestroyedRound;` then `...(dr !== undefined ? { destroyedRound: dr } : {})`.

- [ ] **Step 2: Remove the redundant sink write.** Delete `healTargetDestroyedRound = victim.destroyedRound;` (~2326). If `onHealTargetDestroyed` has no other body, remove the callback from `playerSink` AND from the `DamageAccountingSink` interface (~1033) IF no other sink supplies it (`enemySink` already omits it — verify nothing else implements/needs it). If removing the interface member is non-trivial or risks churn, leave the optional member and just drop the body — note the choice. Update the interface `today:` JSDoc (~1033) and the comments at ~2279-2287 / ~2310 that describe the scalar.

- [ ] **Step 3: Resolve the backstop (~3936).**
  - **Outcome A:** delete the backstop block entirely (it can never fire; `healTarget.destroyedRound` already covers every 0-HP path). Add a one-line comment at the read site noting the death-round comes from `recordDestroyed`'s per-actor stamp.
  - **Outcome B:** keep the backstop but have it set the minimal local `backstopDestroyedRound = r` (NOT the actor field, NO emit) — preserving the exact old no-side-effect behavior. Comment WHY it cannot stamp the actor field (would leak into the turn-skip/combat-end `destroyedRound` readers) and cannot call `recordDestroyed` (would emit a spurious `ship-destroyed`).

- [ ] **Step 4: Delete the `healTargetDestroyedRound` scalar** (~1739) — it now has no reader (Outcome A) or is replaced by `backstopDestroyedRound` (Outcome B). Confirm `grep -n "healTargetDestroyedRound" src/utils/combat/engine.ts` returns nothing.

- [ ] **Step 5: Gates.** `npx tsc --noEmit`, `npm run lint` (max-warnings 0 — a dead `let` will fail, confirming full removal), `npm test -- destroyedRoundUnification` (Task 1 locks still GREEN — they encode the preserved behavior).

- [ ] **Step 6: Byte-identical goldens.** `npm test -- dpsGoldenParity healingGoldenParity` — PASS, ZERO `.snap` movement (`git status --short` clean of golden files). **If a golden moved, the refactor changed an emitted value (most likely a new/lost `ship-destroyed` emit or a destroyedRound delta) — STOP and diagnose. Never `vitest -u`.**

- [ ] **Step 7: Full suite + audit.** `npm test`, `npm run audit:skills` (0/141).

- [ ] **Step 8: Commit.**
```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): read heal-target destroyed round from per-actor field, drop scalar (PR5c)"
```

---

### Task 3: Verification sweep + handoff

- [ ] **Step 1:** No changelog entry (internal refactor, byte-identical). Confirm + skip.
- [ ] **Step 2:** `git diff feat/combat-sim-phase5-pr2...HEAD --stat` — confirm only `engine.ts` + the new test + this plan doc changed; no adapter, no `state.ts`, no golden snapshots.
- [ ] **Step 3:** Hand off for final holistic review. Reviewer must independently: (a) confirm `ship-destroyed` emission is unchanged (count emits in a target-death scenario before/after — the redundant-sink-write removal must NOT change emits since `recordDestroyed` already owns the emit); (b) confirm no new actor-field stamp leaks into the turn-skip/combat-end `destroyedRound` readers; (c) re-derive Outcome A/B and confirm the chosen end-state is byte-identical via the golden run + a `git stash` revert experiment.

---

## Notes for the executor

- **Branch:** create `feat/combat-engine-unify-pr5c-destroyed-round` off the PR5b tip (`eec309db` on `feat/combat-sim-phase5-pr2`). After review → LOCAL squash-merge into `feat/combat-sim-phase5-pr2` + push (matching PR4/PR5a/PR5b); then PR5d branches off the new tip.
- **The load-bearing invariant:** PR5c is byte-identical for all goldens. The risk is NOT the value of `destroyedRound` (the actor field holds it) — it is (1) a spurious `ship-destroyed` emit if the backstop is wrongly converted to `recordDestroyed`, and (2) a leaked actor-field stamp affecting the turn-skip/combat-end readers. The plan's Outcome-B fallback (local var, no actor mutation, no emit) is the strictly-safe path; Outcome A (delete) is only valid if Task 1 PROVES the backstop dead.
- **Do NOT** touch `recordDestroyed`/`destroyedRound` semantics in `state.ts`, the `enemyHpDecline` scalar (PR5d/5e), or wire `indestructible` (PR5d).
- **Workflow:** `gh auth switch --hostname github.com --user TheSusort` before push. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. `git push … | cat`.
