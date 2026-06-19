# Dynamic Hacking/Security & Debuff Landing — PR A2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hacking (attacker) and security (defender) dynamic in-fight and route them into the debuff-landing roll — landing/resist shift when a Hacking/Security buff is active, with affinity ±25% applied to the attacker's hacking in the engine path.

**Architecture:** Build the buff-fold pipeline + base-stat plumbing **byte-identically** (folds carried but unread), then turn on the parser emission and the dynamic landing consumer as **audited churn**. The engine recomputes the landing chance per round per-target from `effectiveStatsOf(attacker).hacking·(1+affinity/100) − effectiveStatsOf(defender).security`, becoming the source of truth; the statically-threaded `debuffLandingChance` scalar is demoted.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`; buff parsing in `src/utils/calculators/`.

**Spec:** `docs/superpowers/specs/2026-06-17-dynamic-hacking-security-a2-design.md`. Epic: `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`. Predecessors A1a/A1b shipped (`effectiveStats.ts`, `buffTotals.ts`).

**Golden gate:** **AUDITED CHURN**, but staged so impact is isolated per task:
- Tasks 1-2 (infra + base plumbing): **byte-identical** — folds/bases carried but unread by any consumer; zero `.snap`.
- Task 3 (parser emits Hacking): combat goldens **byte-identical** (hacking still unread by landing); the **skill-audit golden `docs/skill-audit.md`** and any parser-snapshot move — expected, explained.
- Task 4 (dynamic landing): **combat goldens move ONLY** where a hacking/security buff is active or affinity is non-neutral on an `'inflict'` debuff. No-buff/neutral fixtures stay byte-identical (the DPS-mode parity check). Every moved snapshot explained; never blind `vitest -u`.

---

## Design decisions (read before implementing)

**1. Binding order (the sequencing landmine).** Plumb BASE hacking/security onto every actor (Task 2) BEFORE the landing consumer reads them (Task 4). If an actor's base is undefined→0, the attacker over-lands / the defender never resists. Tasks are ordered to honor this.

**2. `hackingBuff`/`securityBuff` are flat-additive** and folded by the existing two self-buff sources (scheduled + timed) — they ride the same `foldActorBuffTotals` machinery. The `ModifierTotals` channel (firing-skill modifiers) has NO hacking/security, so `effectiveDamageStatsOf.totals` sums only scheduled+ability for these two (like `outgoingHealBuff`/`speedBuff`).

**3. The engine becomes the landing source of truth.** Today `dpsSimulator`/`deriveTeamEngineActors`/`healingEngineAdapter` each compute a `debuffLandingChance` scalar and thread it in; the engine's gates consume that baked value. Task 4 makes the engine recompute live from actor stats + affinity, demoting the threaded scalar (it stays only as a fallback when an actor carries no hacking/security base). The recompute uses the SAME formula (`dpsSimulator.ts:240-246`), so the no-buff/neutral case reproduces the baked value exactly → DPS-mode parity.

**4. Healing-mode affinity consequence (flag for review).** `healingEngineAdapter.ts:174` computes its landing chance WITHOUT affinity. Once the engine recomputes with affinity uniformly, a healer config with **non-neutral affinity that lands `'inflict'` debuffs** will shift (affinity now applied — closing the documented divergence). This is expected audited churn, but call it out explicitly when healing goldens move in Task 4 and confirm the moves are correct per the affinity model (not an accidental double-apply). If the user wants healing mode left unchanged, that becomes a scope carve-out — surface it, don't silently decide.

**5. Determinism.** `makeRateGate` is a rate accumulator; changing its rate mid-fight (buff expiry) changes the fire schedule — that IS the intended behavior. A constant rate (no hacking/security buff, fixed affinity) reproduces the old schedule → byte-identical.

**Workflow:** Work on the **main checkout** (branch `feat/combat-sim-phase5-pr2`) — no fresh worktree (esbuild crash). `gh auth switch --hostname github.com --user TheSusort` only for PR ops. Docs gitignored → `git add -f` + `--no-verify`.

**Test runner:** NEVER bare `npm test` (Vitest WATCH — hangs agents). Use:
- Single: `npx vitest run <pathOrName>` · Full: `npx vitest run`
- Types: `npx tsc --noEmit` · Lint: `npm run lint` (max-warnings 0 — run EVERY task) · Skills: `npm run audit:skills`

---

## File Structure

- `src/types/calculator.ts` — add `hacking?` to `ParsedBuffEffects`; add `'hacking' | 'security'` to the `Buff.stat` union.
- `src/utils/calculators/dpsBuffHelpers.ts` — `toSimBuffs`: add `hacking` + `security` branches.
- `src/utils/combat/buffTotals.ts` — `calculateBuffTotals`: fold `hackingBuff` + `securityBuff`; extend return shape.
- `src/utils/combat/effectiveStats.ts` — `foldActorBuffTotals` + `effectiveDamageStatsOf.totals`: carry the two new fields; `effectiveStatsOf`: fold (base + buffTotal) instead of pass-through.
- `src/utils/calculators/buffParser.ts` — emit `hacking` from buff text.
- `src/utils/combat/engine.ts` (+ `dpsSimulator.ts` / team & enemy input types) — base hacking/security plumbing onto every actor; the live per-round landing recompute + routing.
- Tests co-located in `src/utils/combat/__tests__/` and `src/utils/calculators/__tests__/`.

---

## Task 1: Fold pipeline infra (byte-identical, unread)

**Files:**
- Modify: `src/types/calculator.ts` (`ParsedBuffEffects` ~91-117; `Buff.stat` ~60-74)
- Modify: `src/utils/calculators/dpsBuffHelpers.ts` (`toSimBuffs` ~3-57)
- Modify: `src/utils/combat/buffTotals.ts` (`calculateBuffTotals` ~17-50)
- Modify: `src/utils/combat/effectiveStats.ts` (`foldActorBuffTotals`, `effectiveDamageStatsOf`, `effectiveStatsOf`)
- Test: `src/utils/combat/__tests__/effectiveStats.test.ts` (+ a `toSimBuffs`/`calculateBuffTotals` test)

- [ ] **Step 1: Write failing tests**

In a new/existing unit test, assert: (a) `toSimBuffs` maps `parsedEffects.hacking` and `parsedEffects.security` into `Buff{stat:'hacking'|'security', value: pe * stacks}`; (b) `calculateBuffTotals` returns `hackingBuff`/`securityBuff` summing those; (c) `effectiveStatsOf` folds a self hacking/security buff into `.hacking`/`.security` (`base + buffTotal`), and treats undefined base as 0. Reuse the harness in `effectiveStats.test.ts` / `effectiveSpeed.test.ts`.

```typescript
// effectiveStatsOf folds hacking/security (was base pass-through in A1a/A1b)
it('folds a self Hacking/Security buff into effectiveStatsOf', () => {
    const { statusEngine, selfBuffLookup, actor } = buildHarness({
        base: { /* ...other stats..., */ hacking: 200, security: 100 },
        selfBuffs: [{ stat: 'hacking', value: 40 }, { stat: 'security', value: 20 }],
    });
    const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
    expect(eff.hacking).toBe(200 + 40);
    expect(eff.security).toBe(100 + 20);
});
```

> NOTE: the harness feeds buffs through `toSimBuffs`; for the buffs to fold, `toSimBuffs` must emit the new branches AND `selfBuffLookup` entries must carry `parsedEffects.hacking`/`.security`. Build the fixture `SelectedGameBuff`s with those `parsedEffects`.

- [ ] **Step 2: Run to verify failure** — `npx vitest run effectiveStats` → FAIL (`securityBuff`/`hackingBuff` undefined; `Buff.stat` rejects `'hacking'`).

- [ ] **Step 3: Implement, in dependency order:**

(a) `src/types/calculator.ts` — `ParsedBuffEffects`: add `hacking?: number; // flat additive on hacking stat` (next to `security?`). `Buff.stat` union: add `| 'hacking' | 'security'`.

(b) `dpsBuffHelpers.ts` `toSimBuffs` — add two branches mirroring the existing flat-stat branches EXACTLY (same `id` suffix convention, same `* stacks`):
```typescript
if (parsedEffects.hacking !== undefined)
    entries.push({ id: `${s.id}-hack`, stat: 'hacking', value: parsedEffects.hacking * stacks });
if (parsedEffects.security !== undefined)
    entries.push({ id: `${s.id}-sec`, stat: 'security', value: parsedEffects.security * stacks });
```

(c) `buffTotals.ts` `calculateBuffTotals` — add folds + extend the returned object:
```typescript
const hackingBuff = buffs.filter((b) => b.stat === 'hacking').reduce((s, b) => s + b.value, 0);
const securityBuff = buffs.filter((b) => b.stat === 'security').reduce((s, b) => s + b.value, 0);
// ...add hackingBuff, securityBuff to the return literal
```

(d) `effectiveStats.ts` — `foldActorBuffTotals` returns a literal typed `ReturnType<typeof calculateBuffTotals>`; add `hackingBuff: scheduled.hackingBuff + timed.hackingBuff, securityBuff: scheduled.securityBuff + timed.securityBuff`. In `effectiveDamageStatsOf`'s `totals` literal, add `hackingBuff: scheduledTotals.hackingBuff + ability.hackingBuff, securityBuff: scheduledTotals.securityBuff + ability.securityBuff` (NO `mod.*` term — `ModifierTotals` has none). In `effectiveStatsOf`, change the pass-through lines to fold:
```typescript
hacking: (s.hacking ?? 0) + t.hackingBuff,
security: (s.security ?? 0) + t.securityBuff,
```

- [ ] **Step 4: Verify pass + BYTE-IDENTITY**

`npx vitest run effectiveStats` → PASS. `npx vitest run` → all green (2444). `git status --porcelain | grep '\.snap'` → **empty** (folds are unread: nothing consumes `eff.hacking`/`eff.security` yet; `securityBuff`/`hackingBuff` are new unread fields). `npx tsc --noEmit` clean; `npm run lint` 0.

> If a `.snap` moves here: a consumer already reads `eff.security`/`eff.hacking`, or `effectiveDamageStatsOf.totals` leaked into the damage math. Find and fix the seam.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(combat): A2 — fold hacking/security through toSimBuffs/calculateBuffTotals/effectiveStatsOf (unread, byte-identical)"`

---

## Task 2: Base-stat plumbing onto every actor (byte-identical, unread)

**Files:**
- Modify: `src/utils/combat/engine.ts` — walked-team stats block (~1162-1173); enemy actor construction (`buildEnemyPlayerActorRuntime` ~441-459); DPS dummy (~1123-1131); player attacker `createActor` (~1111).
- Modify: `src/utils/calculators/dpsSimulator.ts` — `deriveTeamEngineActors` (~178-211) walk bundle must carry base `security`; thread configured `enemySecurity` to the dummy and `hacking` to the attacker.
- Modify: any input type carrying these (e.g. `EnemyActorInput`, the team/walk stats bundle type, the DPS input) — add `security`/`hacking` where missing. Trace from the construction sites.
- Test: `src/utils/combat/__tests__/actorStats.test.ts` (extend) — assert constructed actors carry the bases; an `effectiveStatsOf` integration assert that a defender's base security is read.

- [ ] **Step 1: Write failing tests** — assert (a) a walked-team actor carries `stats.security` from its input; (b) an enemy actor carries `stats.hacking` and `stats.security`; (c) the DPS dummy carries `stats.security` = configured enemy security; (d) the player attacker carries `stats.hacking` = configured hacking.

- [ ] **Step 2: Run to verify failure** — `npx vitest run actorStats` → FAIL.

- [ ] **Step 3: Implement** — thread base values at each site. Walked-team (mirror A1a's `hacking: t.walk.stats.hacking` line): add `security: t.walk.stats.security` once `deriveTeamEngineActors` populates it. Enemy: add `hacking`/`security` from `EnemyActorInput`. DPS dummy: `security: input.enemySecurity ?? <existing default>`. Attacker: `hacking: input.hacking ?? <existing default>`. Use the same defaults the OLD landing formula used (`hacking ?? 200`, `enemySecurity ?? 100` per `dpsSimulator.ts:241-242`) so Task 4's parity holds.

> Decision recorded: defaults MUST match the old `?? 200` / `?? 100` so the Task-4 recompute equals the baked chance for no-buff fixtures.

- [ ] **Step 4: Verify pass + BYTE-IDENTITY** — `npx vitest run actorStats` PASS; `npx vitest run` green; `git status --porcelain | grep '\.snap'` **empty** (bases are read only by `effectiveStatsOf.hacking/security`, still unconsumed by landing). `tsc`/`lint` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(combat): A2 — plumb base hacking/security onto every actor (walked team, enemy, dummy, attacker); unread"`

---

## Task 3: Parser emits Hacking (combat byte-identical; skill-audit golden moves)

**Files:**
- Modify: `src/utils/calculators/buffParser.ts` (`parseBuffEffects` ~52-54)
- Test: `src/utils/calculators/__tests__/` parser test (mirror the Security test if one exists)

- [ ] **Step 1: Write failing test** — `parseBuffEffects('Hacking Up II', '+40 Hacking')` → `{ hacking: 40 }`; a Hacking Down → negative. Spot-check the real buff text in `src/constants/buffs.ts` for spacing (`+40Hacking` vs `+40 Hacking`) so the regex matches actual entries.

- [ ] **Step 2: Run to verify failure** — `npx vitest run buffParser` (or the parser test name) → FAIL.

- [ ] **Step 3: Implement** — add, mirroring the flat `Security` branch:
```typescript
const hacking = extract(/([+-]\d+)\s*Hacking/);
if (hacking !== undefined) effects.hacking = hacking;
```

- [ ] **Step 4: Verify + AUDIT the golden delta**

`npx vitest run buffParser` PASS. `npx vitest run` → green; **combat `.snap` must NOT move** (hacking folds into `effectiveStatsOf.hacking` but is still unread by landing). Run `npm run audit:skills` — `docs/skill-audit.md` regenerates with newly-recognized Hacking buffs. **Inspect the diff:** confirm it ONLY adds hacking-effect recognition (no spurious changes). If a parser-snapshot test moves, inspect and confirm it's solely the new hacking emission, then update that snapshot deliberately (this is the one place a snapshot legitimately changes — document why in the commit).

> If a COMBAT `.snap` moves here, hacking is being consumed somewhere it shouldn't be yet — investigate before proceeding to Task 4.

- [ ] **Step 5: Commit** — `git add -A && git add -f docs/skill-audit.md && git commit -m "feat(combat): A2 — parser emits Hacking Up/Down; regenerate skill-audit (audited)"`

---

## Task 4: Dynamic landing/resist consumer (audited combat churn) + changelog

**Files:**
- Modify: `src/utils/combat/engine.ts` (landing-chance compute + the gate consumers ~474/1250/1253-1264/467-479) and/or `playerTurn.ts` (`roundDebuffLanded` ~729-734) — wherever the live attacker+defender effective stats are reachable.
- Modify: `src/utils/calculators/battleSimulator.ts` — **(scope added post-T2)** its `toWalkStats`/`toEnemyStats` shapers omit hacking/security, and it threads its OWN static per-actor `landingChance` (representative-team security, default 100). Plumb base hacking/security onto its actors (same defaults) AND reconcile its static landingChance with the engine recompute, or battle-sim landing breaks (hacking 0) when the engine becomes source of truth.
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`).
- Test: `src/utils/combat/__tests__/` new team-vs-team landing tests.

**Healing-mode decision (user-ratified 2026-06-17):** UNIFORM — apply affinity ±25% to landing in ALL modes incl. healing (`healingEngineAdapter` currently omits it). Healing goldens with non-neutral affinity on `inflict` debuffs WILL move — audited, explained; this closes the documented divergence.

**This is the high-risk integration task. Steps 1-2 are a tracing/spike step before TDD, because the threading mechanism (the timed-application landing callback is configured at runtime-build, while the live attacker/defender stats are in `runPlayerTurn` scope) must be confirmed against the real flow.**

- [ ] **Step 1: Trace the landing-chance flow (spike, no edits).** Read how `debuffLandingChance` flows today: from `dpsSimulator`/team/enemy construction → the runtime → `roundDebuffLanded` (`playerTurn.ts`) AND `landsTimedEnemyApplication` (engine runtime callback → `statusEngine`). Determine the cleanest seam to inject a LIVE per-round value computed from `effectiveStatsOf(attacker).hacking·(1+affinityDamageModifier/100) − effectiveStatsOf(defender).security`, where attacker=acting actor, defender=the turn's target (`enemy`). Options to evaluate: (a) compute once at the top of `runPlayerTurn` and thread the number into both consumers; (b) make the runtime carry a thunk `() => number` that reads live stats. Record the chosen seam in the commit message / a comment. **If the threading proves to require a signature change rippling widely, report DONE_WITH_CONCERNS or BLOCKED with the trace and proposed seam before implementing.**

- [ ] **Step 2: Write failing team-vs-team tests** (each asserts a NON-ZERO baseline then the shift — vacuous-test guard):
  - A **Hacking Down** debuff active on the attacker lowers the number of landed `'inflict'` debuffs vs a baseline run without it.
  - A **Security Up** buff active on the defender raises its resist (fewer landed) vs baseline.
  - An **affinity-disadvantaged** attacker fails to land an `'apply'` debuff (existing rule still holds).
  - A **no-buff, neutral-affinity** run lands EXACTLY as before (parity).
  Mirror the harness in existing engine team tests (e.g. `enemyActions.test.ts` / `turnArgsUnification.test.ts`).

- [ ] **Step 3: Run to verify failure** — `npx vitest run <new test>` → FAIL (landing still static).

- [ ] **Step 4: Implement the live recompute + routing.** Add the per-round, per-target landing computation (cache per `(attacker, round)` like other effective reads) and route it into `roundDebuffLanded` + the `'inflict'` branch of `landsTimedEnemyApplication`. Keep the `'apply'` branch = `!affinityDisadvantage`. Demote the threaded scalar to a fallback (used only when an actor carries no hacking/security base). Apply affinity ONLY to the attacker's hacking (not the defender's security). Do NOT double-apply affinity (read RAW base+buffs from `effectiveStatsOf`, multiply by affinity once, ignore any pre-baked threaded value on the dynamic path).

> **Wire ALL the landing build sites for both-sides parity** (reviewer-confirmed): `landsTimedEnemyApplication` is baked at THREE+ runtime-build sites — the player attacker (`engine.ts:1263`), the enemy attacker (`:476`), and the team variants (`:1393`/`:1428`) — plus the synchronous `roundDebuffLanded` in `playerTurn.ts`. The live value must reach EVERY one (not just the player attacker), or an enemy/team attacker keeps static landing and the "behaves identically on both sides" goal is half-met. Since `runPlayerTurn` is the shared turn fn, prefer computing the live chance INSIDE it (where attacker+defender+statusEngine are in scope) so all three caller paths get it uniformly.

- [ ] **Step 5: Verify + AUDIT the combat golden moves**

`npx vitest run <new test>` PASS. `npx vitest run` → green. Then audit `.snap` movement:
- **DPS-mode parity:** no-buff / neutral-affinity DPS fixtures must be **byte-identical**. If such a fixture moved, the recompute diverges from the old baked chance — diff and fix (check defaults match `?? 200`/`?? 100`, affinity applied once, dummy security plumbed).
- **Expected moves:** fixtures with hacking/security buffs active, or non-neutral affinity on `'inflict'` debuffs. For EACH moved snapshot, confirm the new landed/resisted pattern matches the formula by hand. Document the set of moved snapshots and the reason in the commit.
- **Healing-mode (Design §4):** if healing goldens move, confirm it's the affinity-now-applied effect and that the new values are correct (not a double-apply). If the move looks wrong or the user should weigh in on changing healing-mode behavior, STOP and surface it.
- Never blind `vitest -u`. `tsc`/`lint`/`audit:skills` clean.

- [ ] **Step 6: Changelog** — add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, e.g.: "Combat simulator: debuff landing and resist now respond to Hacking/Security buffs during the fight, and affinity advantage/disadvantage adjusts your landing chance."

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(combat): A2 — dynamic per-target debuff landing/resist from live hacking/security + affinity on hacking (audited)"`

---

## Task 5: Full gate + holistic review prep

**Files:** none (verification only).

- [ ] **Step 1:** `npx vitest run` → all green.
- [ ] **Step 2:** `npm run lint` → 0 warnings.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** `npm run audit:skills` → 0 findings / 141 ships (the `skill-audit.md` delta from Task 3 already committed).
- [ ] **Step 5:** Produce the audited-snapshot ledger: `git diff --stat e985bfc1..HEAD` and a list of every moved `.snap` with its one-line reason (for the holistic reviewer).
- [ ] **Step 6:** `git status` → clean after per-task commits.

---

## Done criteria (A2)
- `ParsedBuffEffects.hacking`, `Buff.stat` union (hacking+security), `toSimBuffs` branches, `calculateBuffTotals` folds, `effectiveStatsOf` folding — all in; parser emits Hacking.
- Base hacking/security plumbed onto walked-team, enemy, DPS dummy, and player attacker actors (defaults match the old `?? 200`/`?? 100`).
- Debuff landing/resist recomputed per round per-target from live hacking-vs-security with affinity ±25% on attacker hacking; engine is the source of truth; `'apply'` disadvantage rule preserved.
- Tasks 1-2 byte-identical; Task 3 moves only skill-audit/parser snapshots; Task 4 moves only buff-active/non-neutral-affinity combat snapshots — every move explained, DPS-mode parity proven.
- Changelog entry added. Suite + lint + tsc + audit:skills clean.

**Next:** sub-project B (Stasis) or the remaining A sweep, per the epic roadmap.
