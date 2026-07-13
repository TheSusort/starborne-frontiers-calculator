# SP-F PR1: Accounting Surface (F7 + F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the vestigial dummy `enemy` sink from the sim/healing (positional) path and add per-victim *dealt* attribution so `attacker.damageDealt` reconciles with `Σ victims.damageTaken`.

**Architecture:** Two coupled changes on one accounting surface. F7 removes the dummy `enemy` actor + `enemyHp: 1e9` input from the positional `runCombat` call, after auditing which references are vestigial-in-positional vs load-bearing-in-DPS mode. F1 adds a per-attacker×victim dealt channel (`roundPerTargetDealt`) parallel to the existing victim-keyed `roundPerTargetDamage`, so the attacker aggregate is derived from per-victim rows and reconciles; this same channel is what SP-M's M1 FrontLine shield will consume.

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts` (~8k lines), `src/utils/combat/playerTurn.ts`. Consumer: `src/utils/calculators/battleSimulator.ts` (`assembleBattleResult`).

## Global Constraints

- **Production RNG untouched** — `rng = Math.random`; only the test harness seeds (`setupTests.ts`). Do not add/remove/reorder production draws.
- **Team-symmetric** — every accounting change behaves identically on player and enemy side.
- **Two golden tiers** — synthetic DPS/healing goldens + SP-0 sim goldens. `vitest -u` is FORBIDDEN as a blind operation; each golden regen is a deliberate, audited move with a recorded rationale.
- **`audit:skills` stays at 0 findings.**
- **Lint + tsc clean** (`npm run lint` is max-warnings 0).
- **Full suite must be green before any commit that regens goldens** (husky runs vitest; golden audit spans the WHOLE `npm test`).
- **Workflow:** `gh auth switch --user TheSusort` before PR ops; docs are gitignored (`git add -f`; docs-only commits `--no-verify`); dev server on :3000.
- **Env:** worktrees lack the gitignored `.env` — `cp` the main repo's `.env` in before running the full suite, or ~14 `.tsx` test files fail to collect.

---

## Task 1: F7 audit — map vestigial-vs-load-bearing dummy references

**Files:**
- Create: `docs/superpowers/notes/2026-07-13-f7-dummy-audit.md` (gitignored; `git add -f`)
- Read only: `src/utils/combat/engine.ts`, `src/utils/calculators/battleSimulator.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the audit note — the authoritative list of which dummy references Task 2 removes and which it must preserve. Tasks 2/3 cite it.

This task produces NO code change. It resolves the spec's audit-first mandate: the dummy `enemy` object is load-bearing for DPS-calc mode (the `cumulativeDamage` scalar IS the DPS metric) but vestigial for the sim/healing positional path. Task 2 must remove it from the positional path WITHOUT breaking DPS mode.

- [ ] **Step 1: Enumerate every dummy/scalar reference**

Run and capture output into the note:

```bash
cd src/utils/combat
grep -n "legacyVictim\|1_000_000_000\|enemyHp\|cumulativeDamage\|focus-dummy\|dummy sink\|dummy enemy" engine.ts
grep -n "1_000_000_000\|enemyHp\|enemyDefense\|dummy" ../../calculators/battleSimulator.ts
```

- [ ] **Step 2: Classify each reference**

For each hit, record in the note one of:
- **DPS-mode load-bearing** — used when `positionalTeamBattle` is false / `enemyAttackers.length === 0` (the single-attacker-vs-configured-enemy DPS calc). MUST be preserved.
- **Positional vestigial** — only reachable when `positionalTeamBattle: true` and real `teamActors`/`enemyAttackers` exist; the real per-victim apply (`applyOutgoingToEnemy` → `applyVictimDamage`) already carries the accounting. Task 2 removes.
- **Fallback binding** — `playerTurnBindings.legacyVictim = enemy` at `engine.ts:4955`. Determine whether `selectTurnTarget` ever falls back to it in positional mode (cross-check `tb.legacyVictim` uses, `engine.ts:5184`).

- [ ] **Step 3: Record the answer to the load-bearing question**

Write the explicit finding: "In positional mode, the dummy `enemy` object is [never / only in case X] read; removing `enemyHp/enemyDefense` from the positional `runCombat` call [is / is not] safe because ___." This sentence gates Task 2's approach.

- [ ] **Step 4: Commit the audit note**

```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git add -f docs/superpowers/notes/2026-07-13-f7-dummy-audit.md
git commit --no-verify -m "docs(sp-f): F7 dummy-reference audit"
```

---

## Task 2: F7 — retire the dummy from the positional path

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts:850–907` (the sim/healing `runCombat` call) and `:858–861`, `:876–884` (dummy comments)
- Modify: `src/utils/combat/engine.ts` — the positional-mode construction/binding of the dummy `enemy` (exact sites per Task 1's note; `:4955` `legacyVictim`, and the `enemyHp` default consumption)
- Test: `src/utils/combat/__tests__/twoTeamBattle.test.ts` (add the F7 invariant)

**Interfaces:**
- Consumes: Task 1's audit note (the vestigial vs load-bearing classification).
- Produces: a positional `runCombat` path with no dummy `enemy` actor. DPS-calc path (`positionalTeamBattle` false) unchanged.

- [ ] **Step 1: Write the failing invariant test**

Add to `twoTeamBattle.test.ts`. The dummy `'enemy'` id must never appear as a turn actor or a damage target in a positional team battle:

```typescript
it('F7: positional team battle has no dummy enemy actor in the event stream', () => {
    const result = runTwoTeamBattleFixture(); // existing 2v2 helper in this file
    const dummyReferenced = result.combatLog
        .flatMap((r) => r.turns)
        .some((t) => t.actorId === 'enemy' || t.entries.some((e) => e.targetId === 'enemy'));
    expect(dummyReferenced).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- twoTeamBattle`
Expected: FAIL — the dummy `'enemy'` id is still present as a target/actor.

- [ ] **Step 3: Remove the dummy from the positional `runCombat` inputs**

In `battleSimulator.ts` (the `simulateBattle` positional call, ~`:850`), guard the dummy inputs behind DPS-mode. Per Task 1, in positional mode (`teamActors`/`enemyAttackers` present) the engine builds the real roster; drop `enemyHp: 1_000_000_000` / `enemyDefense: 0` for that call and let the engine's positional branch not construct the dummy actor. Keep the DPS-calc call site (single-attacker) exactly as-is.

Show the edited positional call block (the `enemyHp`/`enemyDefense`/dummy-comment lines removed) in the commit; the exact engine-side change is the removal identified in Task 1 Step 3.

- [ ] **Step 4: Run the F7 invariant + full engine suite**

Run: `npm test -- twoTeamBattle && npm test -- combat`
Expected: the new F7 test PASSES; all other combat tests PASS (no dummy leak elsewhere).

- [ ] **Step 5: Run the full suite; audit any golden movement**

Run: `npm test`
Expected: green. If any DPS/healing or sim golden moved, STOP — the dummy was load-bearing somewhere Task 1 missed. Do not `-u`. Reconcile against the audit note first; a positional-only dummy removal should move NO DPS-mode golden.

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/battleSimulator.ts src/utils/combat/engine.ts src/utils/combat/__tests__/twoTeamBattle.test.ts
git commit -m "feat(combat): SP-F F7 — retire vestigial dummy enemy from positional path"
```

---

## Task 3: F1 — per-victim dealt attribution + reconciliation

**Files:**
- Modify: `src/utils/combat/engine.ts` — add a per-attacker×victim dealt channel alongside `roundPerTargetDamage` (`:3374`, populated at `:4398`, `:4792`, `:4009`, `:3701`, `:4198`), surfaced on `RoundData`
- Modify: `src/utils/calculators/battleSimulator.ts` — thread the new channel into `perRoundPerTarget`-style maps; change `damageDealt` (`:378`, computed at `:326–332`) to sum per-victim dealt; rewrite the `ShipRoundState` docstrings (`:81–94`)
- Test: `src/utils/combat/__tests__/twoTeamBattle.test.ts` (AoE reconciliation invariant) + a sim golden fixture in `src/utils/calculators/__tests__/simGolden*`

**Interfaces:**
- Consumes: Task 2's dummy-free positional surface.
- Produces: `RoundData.perTargetDealt: Map<string, Record<string, number>>` (attackerId → victimId → dealt), and `damageDealt` derived from it. SP-M's M1 FrontLine reads `perTargetDealt`.

Today `damageDealt = Σ ability-performed.damage by actorId` (anchor-full base) and `damageTaken = perRoundPerTarget[round][victimId]` (per-victim, origin-full/covered-half) — different bases, so they cannot reconcile. `roundPerTargetDamage` is keyed by victim only, with no attacker attribution. F1 adds the missing attribution.

- [ ] **Step 1: Write the failing reconciliation test**

```typescript
it('F1: attacker damageDealt equals sum of per-victim damageTaken it caused (AoE)', () => {
    const result = runAoEFixture(); // AoE attacker vs 3-victim footprint; add helper if absent
    for (const round of result.rounds) {
        for (const attacker of round.ships) {
            if (attacker.damageDealt === 0) continue;
            const causedByThisAttacker = sumDealtTo(result, round.round, attacker.actorId);
            expect(attacker.damageDealt).toBe(causedByThisAttacker);
        }
    }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- twoTeamBattle`
Expected: FAIL — `damageDealt` (anchor-full) ≠ `Σ` per-victim taken under AoE.

- [ ] **Step 3: Add the per-attacker×victim dealt channel in the engine**

Alongside every `roundPerTargetDamage.set(victimId, …)` site, also record `roundPerTargetDealt.set(attackerId, victimId, amount)` using the acting attacker's id (`actingActorId` / the site's `attacker.id`). Surface `perTargetDealt` on `RoundData` only when non-empty (mirror the `perTargetDamage` "set only when non-empty → goldens byte-identical" convention at `:3373`).

- [ ] **Step 4: Consume it in `assembleBattleResult`; reconcile `damageDealt`**

Replace the `ability-performed`-summed `dealt` map (`battleSimulator.ts:326–332`) with a sum over `perRoundPerDealt[round][attackerId]`. Rewrite the two `ShipRoundState` docstrings (`:81–94`, `:89–93`) to state the new invariant: "`damageDealt` == `Σ` per-victim `damageTaken` attributed to this attacker."

- [ ] **Step 5: Run the reconciliation test + full suite**

Run: `npm test -- twoTeamBattle`
Expected: PASS.
Run: `npm test`
Expected: green except deliberate golden movement (next step).

- [ ] **Step 6: Add a reconciliation sim golden; audit + regen**

Add an AoE sim fixture to `simGoldenFixtures.ts` (per the SP-0 harness) whose snapshot now shows reconciled `damageDealt`/`damageTaken`. Regenerate ONLY the goldens whose diff you have eyeballed and confirmed is the reconciliation change:

```bash
npm test -- simGolden -u   # ONLY after confirming every diff is the F1 reconciliation
git diff -- '*golden*' '*Golden*'   # audit: every changed number must be explained
```

Record the audited rationale (which goldens, why each delta) in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/calculators/battleSimulator.ts src/utils/combat/__tests__/ src/utils/calculators/__tests__/
git commit -m "feat(combat): SP-F F1 — per-victim dealt attribution reconciles damageDealt/damageTaken"
```

---

## Task 4: Close-out — comment sweep, changelog, verification

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts` (remove the retired approximation comments)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

**Interfaces:**
- Consumes: Tasks 2 + 3.
- Produces: PR1 ready to open.

- [ ] **Step 1: Remove the closed approximation comments**

Delete the "NOT expected to reconcile — by design" language (`battleSimulator.ts:83–94`) and the dummy-`'enemy'` "deferred follow-up" notes (`:20–24`, `:858–861`, `:876–884`) that Tasks 2/3 made false. Leave F2–F6 approximation comments intact (later PRs).

- [ ] **Step 2: Add the changelog entry**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`: a plain-English line — e.g. "Battle simulator now reports damage dealt and damage taken consistently under area-of-effect attacks."

- [ ] **Step 3: Full verification**

Run:
```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
```
Expected: lint clean (0 warnings), tsc clean, all tests green, audit 0 findings.

- [ ] **Step 4: Commit**

```bash
git add src/utils/calculators/battleSimulator.ts src/constants/changelog.ts
git commit -m "docs(combat): SP-F PR1 — remove closed approximation comments + changelog"
```

- [ ] **Step 5: Open the PR**

```bash
gh auth switch --user TheSusort
gh pr create --title "SP-F PR1: accounting surface (F7 dummy retire + F1 AoE reconcile)" --body "..."
```

---

## Self-Review

- **Spec coverage:** F7 (Tasks 1–2), F1 (Task 3), golden discipline (Task 3 Step 6 + Global Constraints), comment sweep + acceptance (Task 4). PR1 scope from the spec is fully covered. F2–F6 are explicitly out of PR1.
- **Audit-first honored:** Task 1 is the mandated audit; Tasks 2/3 cite its findings. The one genuine uncertainty (exact positional-mode dummy seam) is resolved by Task 1 before code, not papered over.
- **Type consistency:** the new `perTargetDealt` / `roundPerTargetDealt` (attackerId → victimId → number) is named identically across Task 3 and the M1 handoff note. `damageDealt`/`damageTaken` match `ShipRoundState`.
- **Open items intentionally deferred:** F1's exact channel representation (new `RoundData` field vs event augmentation) is fixed here as a `RoundData.perTargetDealt` map — chosen over a new event so it parallels `perTargetDamage` and needs no event-schema change.
