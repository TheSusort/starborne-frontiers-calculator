# E2 — Per-victim leech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make leech (lifesteal) per-victim: on the positional path, each leeching ship heals/shields its OWN pool off the damage it dealt (standing leech) or took (taken leech), with covered AoE cells contributing their reduced (50%) damage. Generalize the heal/shield pool-application closures to be per-victim (the machinery E5's per-victim repair also needs).

**Architecture:** Today `applyHealToTarget`/`grantShieldToTarget` (`engine.ts:1914`/`1930`) are hardcoded to the single `healTarget`; standing leech is *entirely suppressed* on the positional path (the `direct` credit is skipped per-victim to avoid double-counting); taken leech is *gated out* of the positional path (`!enemyPositional`). E2 (1) parametrizes the pool closures by victim — **default `healTarget`, so every non-positional call stays byte-identical**; (2) adds NEW per-victim leech procs on the positional path, applying to each leeching owner's own pool; and (3) leaves the non-positional leech paths (`procStandingLeeches` off aggregate, the `!enemyPositional` taken-leech block) **completely untouched**. Builds on E1's `perActorIncoming` surface + the per-hit `{shieldBefore,hpDamage,barriered}` outcome (surfaced through the positional apply hook).

**Tech Stack:** TypeScript, Vitest. Combat engine `src/utils/combat/engine.ts` + `positionalApply.ts`.

---

## Byte-identical strategy (READ FIRST)

E2's new per-victim leech runs **ONLY on the positional path**, where leech does not fire today (standing leech suppressed; taken leech gated). The legacy non-positional leech code (`procStandingLeeches` off the aggregate `direct` credit; the `if (!enemyPositional)` taken-leech block at `engine.ts:3921-3953`) is **NOT modified** — so `leech.test.ts` and the `healingGoldenParity` leech scenarios (all non-positional, all single-`healTarget`) stay byte-identical.

The risky part is the pool-closure parametrization (Task 1): it touches code every heal/shield path uses. The default-parameter (`victim = healTarget`) makes it a pure refactor — verify byte-identical after Task 1 before building on it.

**There is no existing test that exercises leech positionally** (confirmed: twoTeamBattle/positionalDamage/dpsSimulator have zero real leech configs). So E2's per-victim behavior is locked by NEW tests; expected golden churn against existing fixtures = **zero**. If any existing `.snap` moves or `leech.test.ts`/`healingGoldenParity` changes, STOP — the non-positional path leaked. Never `vitest -u`.

---

## File Structure

- **Modify:** `src/utils/combat/engine.ts`
  - Task 1: parametrize `applyHealToTarget`/`grantShieldToTarget` by `victim: CombatActor = healTarget` (`:1914-1938`). Resolver already exists: `allActorsById` (`engine.ts:1667`, both sides) and `runtimesById.get(id)?.actor` — **no new mechanism**.
  - Task 2: add an optional per-call `onVictimResolved?(victim, damage, outcome, didCrit)` callback arg to `drivePositionalApply` (`~:2525-2581`) and surface `applyToVictim`'s return into it. `drivePositionalApply` is ONE shared helper used by all three sites (focus `~:3329`, team `~:3508`, enemy `~:3866`), so per-direction leech is supplied per-call, NOT branched inside the shared inline `emitHit`.
  - Task 3: focus + team call sites pass a STANDING-leech callback (player→enemy); a NEW positional-only standing-leech proc (reuses the fold, own-pool apply) — `procStandingLeeches` (`~:2088`) is NOT modified. Standing-leech data `~:2027`.
  - Task 4: expand `takenLeeches` registration (`~:2061`) to a `Map<ownerId, TakenLeech[]>` over all player runtimes (mirror `standingLeeches` `~:2029`).
  - Task 5: enemy call site passes a TAKEN-leech callback (enemy→player) reading each victim's outcome.
- **Modify:** `src/utils/combat/playerTurn.ts` — `HealingRuntimeCtx` interface (`~:81-101`) carries the `applyHealToTarget`/`grantShieldToTarget` signatures; widen them with the optional `victim` param (Task 1). ~8 test files implement `HealingRuntimeCtx` doubles (triggers.test.ts, enemyActions.test.ts, salvationDeadRecipient.test.ts, …) — an OPTIONAL param keeps them compiling untouched.
- **Modify:** `src/utils/combat/positionalApply.ts` — change `applyToVictim`'s typed return from `void` so its `{shieldBefore,hpDamage,barriered}` reaches the new `onVictimResolved` callback (Task 2; `~:90`,`:132-134`).
- **Create (test):** `src/utils/combat/__tests__/perVictimLeech.test.ts` — positional standing + taken leech, covered-cell 50%, Barrier/`requiresHpDamage` per victim, own-pool application.
- **Modify (changelog):** `src/constants/changelog.ts` — E2 is user-facing (leech now works in the battle sim).

No type changes beyond the closure signatures, the `onVictimResolved` callback, and `takenLeeches` becoming a map.

---

## Task 1: Parametrize the heal/shield pool closures by victim (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts:1914-1938`

- [ ] **Step 1: No RED test — this is a byte-identical refactor**

`leech.test.ts` + `healingGoldenParity` already exercise `applyHealToTarget`/`grantShieldToTarget` thoroughly and serve as the guard. Skip adding a redundant characterization test; the byte-identical check in Step 3 is the gate.

- [ ] **Step 2: Parametrize the closures**

Change `applyHealToTarget` and `grantShieldToTarget` (`engine.ts:1914-1938`) to accept an optional `victim: CombatActor = healTarget`. Inside, replace every `healTarget.currentHp`/`healTarget.shieldPool`/`recipientMaxHp(healTarget.id)`/`repairedThisRound.add(healTarget.id)` with the `victim` equivalent. Keep the default = `healTarget` so all existing call sites (verified: playerTurn.ts:1520/1596/1614, triggers.ts:1166/1172, engine.ts:2113/2119/3942/3951 — all pass a single arg) are unchanged. **Also widen the matching signatures in the `HealingRuntimeCtx` interface in `playerTurn.ts:~81-101`** (the optional param keeps the ~8 test-double implementers compiling untouched). Example shape:

```typescript
applyHealToTarget: (raw, victim = healTarget) => {
    if (victim.currentHp <= 0) return { consumed: 0, overheal: raw };
    const targetMaxHp = recipientMaxHp(victim.id);
    const consumed = Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp));
    victim.currentHp += consumed;
    if (consumed > 0) repairedThisRound.add(victim.id);
    return { consumed, overheal: raw - consumed };
},
grantShieldToTarget: (raw, victim = healTarget) => {
    if (victim.currentHp <= 0) return;
    const targetMaxHp = recipientMaxHp(victim.id);
    victim.shieldPool = Math.min(victim.shieldPool + raw, targetMaxHp);
},
```

Update the `HealingRuntimeCtx` type for the two closures' new optional param.

- [ ] **Step 3: Run the full suite — verify byte-identical**

Run: `npx vitest run` then `git diff --stat -- '*.snap'`
Expected: all green, **zero `.snap` movement** (the default param means every current caller behaves identically).

- [ ] **Step 4: lint + tsc + commit**

Run: `npm run lint && npx tsc --noEmit`
```bash
git add src/utils/combat/engine.ts src/utils/combat/playerTurn.ts && git commit --no-verify -m "refactor(combat): E2 T1 — parametrize heal/shield pool closures by victim (byte-identical)"
```

---

## Task 2: Add a per-call `onVictimResolved` callback to `drivePositionalApply` (byte-identical)

**Files:** Modify `src/utils/combat/positionalApply.ts` (`~:90`, `:132-134`), `src/utils/combat/engine.ts` (`drivePositionalApply` `~:2525-2581`)

This is the SHARED hook that Tasks 3 and 5 supply per-direction leech logic to. It is intentionally a guard-only (no-RED) plumbing step — additive and unread until Tasks 3/5 wire callbacks, consistent with the E1 precedent.

- [ ] **Step 1: Capture `applyToVictim`'s return and expose it via an optional callback**

`applyToVictim` (= `applyIncomingToTarget`/`applyOutgoingToEnemy`) returns `{shieldBefore, hpDamage, barriered}` but `applyPositionalDamage` drops it (`positionalApply.ts:133`, typed `void` at `:90`). (a) Change `applyToVictim`'s declared return type so the outcome flows back. (b) Add an OPTIONAL param to `drivePositionalApply` — `onVictimResolved?(victim: CombatActor, damage: number, outcome: {shieldBefore;hpDamage;barriered}, didCrit: boolean)` — invoked per footprint victim after the hit resolves. `drivePositionalApply` is ONE helper shared by all three call sites (focus `~:3329`, team `~:3508`, enemy `~:3866`); since standing (player→enemy) and taken (enemy→player) leech need opposite logic, each call site supplies its own callback (Tasks 3/5) rather than branching inside the shared inline `emitHit`. No site supplies it in this task → fully inert.

- [ ] **Step 2: Verify byte-identical**

Run: `npx vitest run positionalDamage twoTeamBattle perActorIncoming && npx vitest run` then `git diff --stat -- '*.snap'`
Expected: green, zero `.snap` movement (new optional callback, unsupplied).

- [ ] **Step 3: lint + tsc + commit**
```bash
git add src/utils/combat/positionalApply.ts src/utils/combat/engine.ts && git commit --no-verify -m "feat(combat): E2 T2 — add per-victim onVictimResolved hook to drivePositionalApply (inert)"
```

---

## Task 3: Per-victim standing leech on the positional path

**Files:** Modify `src/utils/combat/engine.ts` (per-victim hook in `drivePositionalApply` `~:2574`; reuse `standingLeeches`/`procStandingLeeches` `~:2027`/`:2088`)

- [ ] **Step 1: Write the failing test** (`src/utils/combat/__tests__/perVictimLeech.test.ts`)

A positional healing-mode two-team run where the player attacker has a passive `damage-dealt` heal leech (standing) and its AoE hits an origin + a covered enemy. Assert the attacker's own HP/heal-credit reflects leech off (origin dealt + 0.5×covered dealt). Mirror the harness from `twoTeamBattle.test.ts` (positioned actors, `healTargetId`). Currently FAILS — standing leech is suppressed on the positional path (no proc).

Run: `npx vitest run perVictimLeech -t "standing"` → Expected: FAIL.

- [ ] **Step 2: Implement the per-victim standing-leech proc**

Wire an `onVictimResolved` callback at the focus + team call sites (player→enemy). In it, proc the ACTING attacker's standing leeches off THAT victim's dealt damage. **Write a NEW positional-only proc — do NOT modify `procStandingLeeches`** (its `rid === healTarget.id` pool-gating is load-bearing for the non-positional all-allies case, leech.test.ts:355-404, where teammates are credited but NOT pool-applied — changing it would alter non-positional behavior). The new proc may reuse the FOLD math (pct, healModifier, heal-crit draw) but does its OWN pool application: for each recipient id (`self` → the attacker/owner; `ally`/`all-allies` → resolve), look up the actor via **`runtimesById.get(rid)?.actor`** (the focus is keyed `'attacker'`, not its real id — use `runtimesById`, not `allActorsById`, for recipient resolution) and call the Task-1 parametrized `applyHealToTarget(raw, actor)` / `grantShieldToTarget(raw, actor)`. Do NOT write the cumulative `dmg()` accumulator (no double-count); leave the `if (!positional)` aggregate suppression AND `procStandingLeeches` itself untouched. Honor `scope` (detonation-scoped leeches don't fire on the per-victim `direct` channel). Document the heal-crit-gate cadence: per-victim procs draw the owner's `activeHealCritGate` once per victim (comment it; the new test pins the numbers).

Run: `npx vitest run perVictimLeech -t "standing"` → Expected: PASS.

- [ ] **Step 3: Byte-identical guard + commit**

Run: `npx vitest run leech healingGoldenParity && npx vitest run` then `git diff --stat -- '*.snap'`
Expected: green, zero `.snap` movement (non-positional leech untouched).
```bash
git add -A && git commit --no-verify -m "feat(combat): E2 T3 — per-victim standing leech on the positional path"
```

---

## Task 4: Expand taken-leech registration to all player runtimes (byte-identical)

**Files:** Modify `src/utils/combat/engine.ts:2060-2079`

- [ ] **Step 1: Make `takenLeeches` a `Map<ownerId, TakenLeech[]>`**

Mirror `standingLeeches` (`:2029`): loop all `runtimesById`, collect each owner's passive `damage-taken` heal/shield abilities keyed by owner id. The existing non-positional taken-leech block (`:3921-3953`) currently reads the heal target's list — update it to read `takenLeechesByOwner.get(healTarget.id) ?? []` so its behavior is unchanged.

- [ ] **Step 2: Verify byte-identical**

Run: `npx vitest run leech healingGoldenParity && npx vitest run` then `git diff --stat -- '*.snap'`
Expected: green, zero `.snap` (only the heal target had taken-leeches in non-positional fixtures → same list read).

- [ ] **Step 3: lint + tsc + commit**
```bash
git add src/utils/combat/engine.ts && git commit --no-verify -m "refactor(combat): E2 T4 — taken-leech registration per owner (byte-identical)"
```

---

## Task 5: Per-victim taken leech on the positional enemy branch

**Files:** Modify `src/utils/combat/engine.ts` (positional enemy branch `~:3852-3876`; the gate `~:3921-3926`)

- [ ] **Step 1: Write the failing test** (`perVictimLeech.test.ts`)

A positional run where an enemy AoE hits two player victims, ONE of which has a `damage-taken` heal-leech passive. Assert that victim heals its OWN pool off the damage IT took, the other does not. Add a case where the leeching victim has an active Barrier (full block) → its taken leech reads 0 (per-victim Barrier carve-out), and a `requiresHpDamage` (Quixilver-style) case. Currently FAILS — taken leech is gated out of the positional path.

Run: `npx vitest run perVictimLeech -t "taken"` → Expected: FAIL.

- [ ] **Step 2: Implement per-victim taken leech**

Wire an `onVictimResolved` callback at the enemy call site (enemy→player). For each player victim hit (with its per-hit `{shieldBefore, hpDamage, barriered}` from Task 2's callback), proc that victim's own taken-leeches (`takenLeechesByOwner.get(victim.id)`) off the damage it took, applying to the victim's OWN pool via the Task-1 closures (`applyHealToTarget(raw, victim)` / `grantShieldToTarget(raw, victim)`). The Barrier carve-out (skip if `barriered`) and `requiresHpDamage` (`shieldBefore > 0 && hpDamage > 0`) are evaluated **per victim** — matching the non-positional block's semantics (`engine.ts:3925`/`3929`). Leave the `!enemyPositional` non-positional block fully intact (it stays the path for non-positional fixtures). The positional branch's per-victim leech is the new behavior.

Run: `npx vitest run perVictimLeech -t "taken"` → Expected: PASS.

- [ ] **Step 3: Byte-identical guard + commit**

Run: `npx vitest run leech healingGoldenParity twoTeamBattle && npx vitest run` then `git diff --stat -- '*.snap'`
Expected: green, zero `.snap` movement.
```bash
git add -A && git commit --no-verify -m "feat(combat): E2 T5 — per-victim taken leech on the positional path"
```

---

## Task 6: Verification sweep + changelog + doc closeout

- [ ] **Step 1: Full gate**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run audit:skills`
Expected: all green, lint 0, tsc clean, audit 0 findings. Confirm `git diff --stat -- '*.snap'` empty across the whole PR.

- [ ] **Step 2: Changelog (E2 IS user-facing)**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` a plain-English entry: lifesteal/leech (heal or shield from damage dealt/taken) now works per-ship in the combat simulator — each ship heals itself off its own damage, and AoE splash leeches off the reduced splash damage.

- [ ] **Step 3: Spec closeout + commit**

Append an "E2 SHIPPED" note to the E-design spec §4 (pool generalization done, per-victim standing + taken leech live, E5 now thin).
```bash
git add -A && git add -f docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md
git commit --no-verify -m "feat(combat): E2 — changelog + spec closeout (per-victim leech)"
```

---

## Done criteria

- Per-victim standing + taken leech work on the positional path (own-pool, covered-cell 50%, Barrier/`requiresHpDamage` per victim) — locked by `perVictimLeech.test.ts`.
- Pool closures parametrized by victim (E5's per-victim repair can now reuse them).
- Non-positional leech byte-identical: `leech.test.ts` + `healingGoldenParity` green, zero `.snap` movement across the PR.
- Full suite green, lint 0, tsc clean, audit 0 findings.
