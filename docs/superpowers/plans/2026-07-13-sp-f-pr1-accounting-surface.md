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

## Task 2: F7 — drop the fake dummy inputs from both positional callers

**Reshaped after the Task 1 audit** (`docs/superpowers/notes/2026-07-13-f7-dummy-audit.md`): the dummy `enemy` actor is load-bearing scaffolding and MUST still be constructed (referenced by `allActors`, `TurnBindings.legacyVictim`, the `isDummyEnemy` turn-skip, and `resolvePositionalTarget`'s null-target fallback). F7 is therefore NOT structural removal — it is: make `enemyHp`/`enemyDefense` optional with internal defaults, then stop the two positional callers from passing fake values. This is a **byte-identical refactor** for `battleSimulator.ts` (its passed values `1_000_000_000`/`0` become the exact internal defaults) so its oracle is the golden corpus — NO new behavioral test. `healingEngineAdapter.ts` passed *different* values (`1_000_000`/`10000`); the audit proved its dummy-derived outputs are unread, so dropping them must leave its goldens green — that is the audited gate.

**Files:**
- Modify: `src/utils/combat/engine.ts` — `CombatEngineInput.enemyDefense`/`enemyHp` field decls (`:988–989`, verify) → optional; add internal defaults where destructured (`:1397–1398`, verify): `enemyDefense ?? 0`, `enemyHp ?? 1_000_000_000`
- Modify: `src/utils/calculators/battleSimulator.ts:858–861`, `:876–884` — delete the `enemyDefense: 0, enemyHp: 1_000_000_000` lines + trim the dummy comments
- Modify: `src/utils/calculators/healingEngineAdapter.ts` (~`:177–178` consts, `:217–250` call) — delete `ENEMY_DEFENSE`/`ENEMY_HP` from its `runCombat` call (and the now-unused consts)

**Interfaces:**
- Consumes: Task 1's audit note (§5 minimal edit set).
- Produces: `CombatEngineInput.enemyDefense?`/`enemyHp?` optional with defaults `0`/`1_000_000_000`. `dpsSimulator.ts` (which passes real values) is untouched and byte-identical.

- [ ] **Step 1: Re-verify the audit's line numbers against the live tree**

Run (line numbers may have shifted):
```bash
grep -n "enemyDefense\|enemyHp" src/utils/combat/engine.ts | grep -iE "number|\?\?|const enemy|hp: enemyHp" | head
grep -n "enemyHp: 1_000_000_000\|enemyDefense: 0" src/utils/calculators/battleSimulator.ts
grep -n "ENEMY_HP\|ENEMY_DEFENSE\|enemyHp\|enemyDefense" src/utils/calculators/healingEngineAdapter.ts
```
Expected: field decls, the two `battleSimulator` literals, and the `healingEngineAdapter` consts + call site.

- [ ] **Step 2: Make the engine fields optional with internal defaults**

In `engine.ts`, change `enemyDefense: number;`/`enemyHp: number;` on `CombatEngineInput` to `enemyDefense?: number;`/`enemyHp?: number;`, and at the destructure/consumption site apply defaults so the dummy actor still gets `stats.defence = enemyDefense ?? 0` and `stats.hp = enemyHp ?? 1_000_000_000`. Every existing `runCombat` caller/test that still passes a value is unaffected (default only applies when the field is absent).

- [ ] **Step 3: Verify types compile (the default path is net-new)**

Run: `npx tsc --noEmit`
Expected: clean — `battleSimulator.ts`/`healingEngineAdapter.ts` may still pass the fields at this point (removed next step); no type error from making them optional.

- [ ] **Step 4: Drop the fake inputs from both positional callers**

In `battleSimulator.ts` delete `enemyDefense: 0,` and `enemyHp: 1_000_000_000,` from the positional `runCombat` call and trim the two dummy comments (`:858–859`, `:877–884`). In `healingEngineAdapter.ts` delete `enemyDefense`/`enemyHp` from its `runCombat` call and remove the now-unused `ENEMY_DEFENSE`/`ENEMY_HP` consts.

- [ ] **Step 5: Run the full suite — the audited byte-identical gate**

Run: `npm test`
Expected: green with **zero golden movement**. `battleSimulator` is byte-identical by construction (defaults == dropped values). `healingEngineAdapter` goldens MUST also stay green (the audit proved its dummy-derived outputs are unread). If ANY golden moves, STOP and report — do not `-u`. A `healingEngineAdapter` golden move means a real read-path the audit missed; a `battleSimulator` move means the defaults don't match and is a bug.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/calculators/battleSimulator.ts src/utils/calculators/healingEngineAdapter.ts
git commit -m "refactor(combat): SP-F F7 — make enemyHp/enemyDefense optional; drop fake dummy from positional callers"
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

**Case-c scope (from the Task 1 audit, user-ratified):** ships with NO targeting data at all (`target === undefined`) route real damage into the unread `cumulativeDamage` scalar — it never reaches `perTargetDamage`, so it is lost pre-existingly and cannot be attributed to a victim. F1's invariant is therefore **scoped to ships with targeting data** (the real corpus). Case-c is documented as a known pre-existing gap, NOT fixed here. Use fixtures built from ships that have parsed `target`+`pattern` (every ship in the standard corpus).

- [ ] **Step 1: Write the failing reconciliation test**

The fixture uses an AoE attacker WITH targeting data (parsed `target`+`pattern`) vs a multi-victim footprint. The invariant asserts reconciliation only for such attackers:

```typescript
it('F1: a targeted attacker\'s damageDealt equals the sum of per-victim damage it caused (AoE)', () => {
    const result = runAoEFixture(); // AoE attacker WITH target+pattern vs 3-victim footprint; add helper if absent
    for (const round of result.rounds) {
        for (const attacker of round.ships) {
            if (attacker.damageDealt === 0) continue; // skips non-attacking + case-c-only actors
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

Delete only the "NOT expected to reconcile — by design" language on the `ShipRoundState` docstrings (`battleSimulator.ts:81–94`) that Task 3 made false. **Do NOT touch** the `:20–24` header note about dummy-`'enemy'` targetId log lines — it stays TRUE (the dummy still exists as scaffolding and ally/self-targeting ships still produce those lines; Task 2 confirmed the dummy is not removed). Task 2 already trimmed the `:858–884` input comments. Leave F2–F6 approximation comments intact (later PRs).

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
