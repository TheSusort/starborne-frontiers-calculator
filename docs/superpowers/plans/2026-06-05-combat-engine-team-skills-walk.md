# Combat Engine: Team ShipSkills Walk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team ships walk their actual parsed `ShipSkills` through ONE generalized player-actor pipeline (`runPlayerTurn`): per-actor statuses/gates/rates, ally-target routing to all player actors, team damage/DoTs/charges/reactive triggers, per-actor damage accounting with an internal `focusActorId`, plus the parser ally-scope fix and the team-card editor/stats UI.

**Architecture:** Four zero-churn structural tasks first (per-actor accounting map + focusActorId; per-actor status-engine sides; `runPlayerTurn` parameterization; per-entry DoT applier plumbing), then the behavior tasks (walked team actors + team damage, ally routing, reactive parity), then parser ally-scope, golden scenario, UI, docs. The engine core ends with zero hardcoded `'attacker'` comparisons — the DPS adapter passes `focusActorId: 'attacker'`.

**Tech Stack:** TypeScript, Vitest (snapshot + unit), React (UI task).

**Spec:** `docs/superpowers/specs/2026-06-05-combat-engine-team-skills-walk-design.md` — READ IT FIRST, especially "End-state direction", "Status engine", "Turn pipeline", "Damage accounting", "DoT applier contexts", "Reactive parity". The spec is the authority on semantics; this plan is the authority on sequencing.

**Branch:** `feat/combat-engine-team-skills-walk` (Task 0 creates it from `main`).

**Golden discipline (every task):** `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (18 `snap()` scenarios). NEVER run vitest with `-u` (new scenarios self-write on first run; targeted regeneration = delete the entry + re-run). **Expected churn is ZERO for Tasks 1–7 and 9–11.** Every existing fixture is either attacker-only or uses the legacy team shape (no `shipSkills` on team actors), and the parser reclassification (Task 7) only changes `Ability.target` values, which the engine folds identically for the attacker (`self` and `all-allies` both land on the attacker's own side — it is a player actor and receives ally grants). Task 8 APPENDS one new scenario (a new snapshot entry is not churn). Any diff to an existing snapshot in any task = bug in your change.

**Hard constraints (from the spec — apply to every task):**

- Public API (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) additive only.
- Zero-RNG determinism: `makeRateGate` accumulators, per-actor gate instances, fixed listener/queue order.
- Listeners never mutate state; only the engine/executor mutates.
- No RegExp lookbehind anywhere in src/ (iOS Safari 15 in browserslist).
- Pre-commit hook runs the full suite (~2 min); NO `--no-verify` for code commits. `docs/` is gitignored — `git add -f` only for docs.
- Changelog: edit the ONE evolving DPS entry in `UNRELEASED_CHANGES` in place (Task 10) — no new per-PR DPS entry.

**Cross-cutting facts (verified against source on `main` @ post-PR-#83; trust these):**

- `src/utils/combat/engine.ts` is 882 lines. Round accumulator locals (`corrosionDamage`…`conditionalDamage`, `attackerTurns`, `pendingResisted`) at ~458–478; `drainIntents` ~486–537; turn dispatch `for (const actor of queue)` ~550–761 (attacker ~553–626, team ~627–688, enemy ~689–741, drain point (b) ~748, Post-Turn decrement ~753–758); post-round assembly ~763–867. `lastAttackerCtx` declared ~436. Hardcoded `'attacker'` strings today: `createActor({ id: 'attacker' … })` (fine — that's the adapter-chosen id), `statusEngine.sourceFired('attacker', …)` is inside `runAttackerTurn`.
- `src/utils/combat/attackerTurn.ts` is 1070 lines: `AttackerRoundCtx` (47), `AttackerTurnResult` (59), `AttackerTurnArgs` (78), module-private helpers (136–453), `runAttackerTurn` (463). Hardcoded `'attacker'` inside: `statusEngine.sourceFired('attacker', …)` (~555), `emitDebuffApplied('attacker', …)` (~559, ~680), `buff-applied` `actorId: 'attacker'` (~751). `actor.id` is already used for `skill-fired`/`ability-performed`/`bomb-detonated` emissions.
- `src/utils/combat/statusEngine.ts` is 678 lines. Player-side ("self") state: `alwaysSelf`/`timedSelf`/`accumSelf` (~235–239), `accumSelfMap` (~258), `selfMap` (~279), `persistentSelf` (~285), `auraSelf` (~321). API: `beginRound`, `sourceFired(sourceId, slot, round)`, `snapshot()`, `decrementSide(side)`, `registerAbilityStatuses`, `applyTimedAbilityStatus(round, status)`, `activeAbilityStatuses(side, ctx)`, `timedAbilityStatuses(side)`. `RegisteredAbilityStatus` discriminated union at ~61.
- `src/utils/combat/triggers.ts` is 352 lines. Listener guards hardcode `'attacker'` (~107, ~112, ~115, ~122); `executeIntent` mutates `ctx.attacker` for charge (~244) and emits `sourceId: 'attacker'` for debuff/dot (~287, ~341). The `on-ally-debuff-inflicted` FUTURE comment (the team `dot-applied` seam) is at ~124–127.
- `src/utils/combat/state.ts` (152 lines): `ActiveDoTStack { stacks, tier, remainingRounds }`, `PendingBomb { countdown, damagePerStack, stacks, tier }`, `PendingAccumulator { roundsRemaining, pct, accumulated }`, `createActor`, `buildTurnQueue` (sort: speed desc, sideRank asc, input order asc).
- Adapter: `src/utils/calculators/dpsSimulator.ts` (222 lines) derives `debuffLandingChance` from hacking (effectiveHacking = hacking × (1 + affinityDamageModifier/100), minus enemySecurity, clamped /100), `selfDotModifier`/`defensePenetrationBuff` via `toDotAndPenModifiers(selfBuffs, [])`, and `hasChargedSkill` (chargeCount ≥ 1 && charged slot has ≥1 ability). `RoundData` defined here (~79).
- Page: `src/pages/calculators/DPSCalculatorPage.tsx` — `teamShips` state ~131, `teamActors` memo ~175–186, `selectShipForTeamSlot` ~436–460 (stamps `buildSkillBuffAutoFill` + `detectFullyCharged` + `shipFinalStats` speed + `chargeSkillCharge`), affinity helper `computeAffinityModifiers(config.affinity, enemyAffinity)` ~252. Team card: `src/components/calculator/TeamShipRow.tsx` (160 lines, two `GameBuffPicker`s). The attacker's skill editor is `SkillSlotList` (`src/components/skills/SkillSlotList.tsx`, props `{ shipSkills, hasPassive, ship?, onChange }`) used by `ShipConfigCard.tsx:279` — directly reusable.
- Parser: `SkillEffect { …, target: 'self' | 'enemy' }` at `src/utils/skillTextParser.ts:922`. Builder: `buildShipAbilities.ts` `mergeBuff` (~878–904) stamps ALL selfBuffs `target: 'self'`; the modifier path already detects ally scope (`/friendly|all allies|allies/i`, ~286, ~355, ~389). `scripts/auditSkills.ts` mirrors classification (`npm run audit:skills`).
- `TeamActorInput` / `TeamShipConfig`: `src/types/calculator.ts:219–241`.
- `RoundData` round display: `src/components/calculator/DPSRoundChart.tsx` (264 lines); per-config summary: `ShipConfigCard.tsx` / `ShipConfigSummary.tsx`.
- Golden harness: 18 `snap()` scenarios; scenario 11 + the Phase-2 team scenario use the LEGACY team shape (no `shipSkills`) — they lock the old API and must stay byte-identical.

**File map (who owns what):**

| File | Responsibility in this plan |
|---|---|
| `src/utils/combat/engine.ts` | T1 per-actor accounting + focusActorId; T3 runtime construction; T4 walked team turns + teamDamage; T5 ally routing call sites; T6 reactive registration per owner |
| `src/utils/combat/playerTurn.ts` (renamed from `attackerTurn.ts`) | T3 `runPlayerTurn(runtime, …)` parameterization; T4/T5 target routing at application sites |
| `src/utils/combat/statusEngine.ts` | T2 per-actor player sides; T5 multi-recipient application + caster-gated auras |
| `src/utils/combat/state.ts` | T1 `ActorDamage`; T4 `sourceId` on DoT/bomb/accumulator entries |
| `src/utils/combat/triggers.ts` | T6 per-owner listener guards + owner-routed executor |
| `src/types/calculator.ts` | T4 `TeamActorInput` additive fields; `RoundData.teamDamage` lives in dpsSimulator.ts |
| `src/utils/calculators/dpsSimulator.ts` | T4 per-actor rate derivation + `teamDamage`/summary plumbing |
| `src/utils/skillTextParser.ts` + `src/utils/abilities/buildShipAbilities.ts` + `scripts/auditSkills.ts` | T7 ally-scope targets |
| `dpsGoldenParity.test.ts` | T8 one appended walked-team scenario |
| `DPSCalculatorPage.tsx`, `TeamShipRow.tsx`, `DPSRoundChart.tsx` | T9 UI |
| `docs/skill-model-coverage.md`, `DocumentationPage.tsx`, `src/constants/changelog.ts` | T10 |

---

## Task 0: Branch + baseline

- [ ] **Step 1: Create the branch and record the baseline**

```bash
git checkout main && git pull
git checkout -b feat/combat-engine-team-skills-walk
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
```

Expected: all golden tests pass, **zero snapshot writes**, 18 scenarios.

- [ ] **Step 2: Full suite green**

```bash
npx vitest run
```

Expected: PASS (~1214 tests / 80 files). This is the baseline every later task is judged against.

---

## Task 1: Per-actor damage accounting + `focusActorId` (zero churn)

**Files:**
- Modify: `src/utils/combat/state.ts` (add `ActorDamage`)
- Modify: `src/utils/combat/engine.ts` (~414–430 totals, ~458–478 round accumulator, ~617–620 fold, ~698–740 enemy turn writes, ~763–867 assembly)
- Test: `src/utils/combat/__tests__/engine.test.ts` (existing engine tests keep passing; no new tests — this is a pure internal restructure judged by goldens)

The round's scalar damage locals become a per-actor map; row fields derive from the focus entry. This is the simulator-page seam (spec "Damage accounting") and removes the first class of hardcoded-attacker logic.

- [ ] **Step 1: Add `ActorDamage` to state.ts**

```ts
/** Per-actor damage contributions within one round (spec: per-actor accounting —
 *  the simulator-page seam). secondary/conditional are sub-buckets of direct
 *  (mirroring rawTotals); corrosion/inferno/detonation are the enemy-turn channels
 *  attributed to the entry's applier. */
export interface ActorDamage {
    direct: number;
    secondary: number;
    conditional: number;
    corrosion: number;
    inferno: number;
    detonation: number;
}

export function emptyActorDamage(): ActorDamage {
    return { direct: 0, secondary: 0, conditional: 0, corrosion: 0, inferno: 0, detonation: 0 };
}
```

- [ ] **Step 2: Restructure engine.ts round accumulation**

In `runCombat`:
1. Add `const focusActorId = 'attacker';` next to the actor construction with a doc comment: *"The reported actor. Internal for now — the DPS adapter's attacker. The engine core keys on this, never on the literal 'attacker' (end-state rule, spec)."* (A later phase can lift it to an input; do NOT add it to `CombatEngineInput` yet — YAGNI.)
2. Replace the round-scoped locals `corrosionDamage/infernoDamage/detonationDamage/directDamage/secondaryDamage/conditionalDamage` with `const roundDamage = new Map<string, ActorDamage>();` plus a helper `const dmg = (id: string) => { let d = roundDamage.get(id); if (!d) { d = emptyActorDamage(); roundDamage.set(id, d); } return d; };`
3. Attacker-turn fold (~617–620): `const d = dmg(actor.id); d.direct += turn.directDamage; d.secondary += …; d.conditional += …; d.detonation += turn.detonationDamage;`
4. Enemy-turn writes (~721–739): ticks/bursts attribute to the applier — today every entry is the attacker's, so write to `dmg(focusActorId)`: `d.corrosion = ticks.corrosionDamage; d.inferno = ticks.infernoDamage; d.detonation += processBombs(…) + processAccumulators(…)`. (Per-entry `sourceId` attribution arrives in Task 4 — leave a one-line comment marking it.)
5. `drainIntents`'s `cumulativeDamage` arg (~519–524): sum the map — `cumulativeDamage + [...roundDamage.values()].reduce((s, d) => s + d.direct + d.corrosion + d.inferno + d.detonation, 0)`.
6. Post-round assembly: derive the row fields from the FOCUS entry — `const focus = dmg(focusActorId);` then `directDamage → focus.direct`, etc. `totalRoundDamage = focus.direct + focus.corrosion + focus.inferno + focus.detonation`. `cumulativeDamage += totalRoundDamage` (today the map has only the focus entry, so totals are unchanged). rawTotals accumulate from `focus`.
7. The row-assembly read `attackerTurns` keeps its name but add a comment: focus-actor turns (Task 3 renames it `focusTurns`).

- [ ] **Step 3: Goldens byte-identical + full suite**

```bash
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
npx vitest run
```

Expected: PASS, zero snapshot diffs.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/state.ts src/utils/combat/engine.ts
git commit -m "refactor: per-actor round damage accounting + internal focusActorId (zero golden churn)"
```

---

## Task 2: Status engine — per-actor player sides (zero churn)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts`
- Modify: call sites in `engine.ts`, `attackerTurn.ts`, `triggers.ts` (mechanical: pass `'attacker'`)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts` (adapt signatures; add multi-owner unit tests)

The single player side becomes per-owner maps. All existing call sites pass owner `'attacker'` → behavior identical.

- [ ] **Step 1: Write failing multi-owner unit tests** (in statusEngine.test.ts)

```ts
describe('per-actor player sides', () => {
    it('keeps owners isolated: a timed buff applied to team-1 is not in the attacker snapshot', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 2), 'team-1');
        expect(se.snapshot('team-1').activeSelfBuffs.map((b) => b.buffName)).toEqual(['Attack Up']);
        expect(se.snapshot('attacker').activeSelfBuffs).toEqual([]);
    });
    it('decrements per carrier: team-1 post-turn does not age attacker buffs', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 1), 'attacker');
        expect(se.decrementPlayer('team-1').expired).toEqual([]);
        expect(se.snapshot('attacker').activeSelfBuffs).toHaveLength(1);
        expect(se.decrementPlayer('attacker').expired).toEqual(['Attack Up']);
    });
});
```

(Write a small local `timedSelfStatus(buffName, duration)` helper returning a timed `RegisteredAbilityStatus`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/combat/__tests__/statusEngine.test.ts` → FAIL (signatures don't exist).

- [ ] **Step 3: Reshape statusEngine.ts**

API (keep names where possible; player-side methods gain an `ownerId` param **defaulting to `'attacker'`** so untouched call sites stay valid):

```ts
snapshot(ownerId?: string): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
decrementPlayer(ownerId: string): { expired: string[] };   // replaces decrementSide('self')
decrementEnemy(): { expired: string[] };                    // replaces decrementSide('enemy')
registerAbilityStatuses(statuses: RegisteredAbilityStatus[], ownerId?: string): void;
applyTimedAbilityStatus(round, status, recipientId?: string): void; // 'enemy' side ignores recipientId
activeAbilityStatuses(side, ctx, ownerId?: string): ActiveAbilityStatus[];
timedAbilityStatuses(side, ownerId?: string): ActiveAbilityStatus[];
```

Internals: `selfMap` → `Map<string /*ownerId*/, Map<string, BuffState>>` (lazy-create per owner); same for `persistentSelf`, `accumSelfMap`, `auraSelf`. Scheduled list categorization (`alwaysSelf`/`timedSelf`/`accumSelf` incl. team-source folds) is UNCHANGED and remains attacker-owned: those collections feed the `'attacker'` owner's maps/snapshot only (legacy semantics: manual + team-picker buffs are granted to the attacker). Enemy side singular and untouched. `sourceFired` unchanged.

`decrementSide` is removed — update the engine's Post-Turn block (engine.ts ~753–758) to call `decrementPlayer(actor.id)` for `actor.kind === 'attacker'` and `decrementEnemy()` for the enemy (team actors get their decrement call in Task 4 when they can carry statuses — add it now guarded as a no-op-by-construction: calling `decrementPlayer(teamId)` on an empty lazy map is safe and fine to wire immediately for all player kinds).

- [ ] **Step 4: Tests pass + goldens byte-identical + full suite**

```bash
npx vitest run src/utils/combat/__tests__/statusEngine.test.ts
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
npx vitest run
```

- [ ] **Step 5: Commit** — `git commit -m "refactor: status engine per-actor player sides (zero golden churn)"`

---

## Task 3: `runPlayerTurn` extraction — `PlayerActorRuntime` (zero churn, byte-identical)

**Files:**
- Rename: `src/utils/combat/attackerTurn.ts` → `src/utils/combat/playerTurn.ts` (`git mv`)
- Modify: `src/utils/combat/engine.ts` (runtime construction; turn dispatch)
- Test: existing suite + goldens only (pure parameterization)

Parameterize the pipeline by actor. ONLY the attacker uses it after this task — behavior byte-identical.

- [ ] **Step 1: Define `PlayerActorRuntime` in playerTurn.ts**

```ts
/** Everything one player actor's turns need. Built once at engine setup — the
 *  attacker's runtime comes from the top-level inputs; walked team runtimes (Task 4)
 *  from TeamActorInput. The engine core keys on runtime/actor ids, never 'attacker'. */
export interface PlayerActorRuntime {
    actor: CombatActor;
    /** actor.id === focusActorId — this runtime's turns feed the RoundData row. */
    focus: boolean;
    castSkills: ShipSkills;                  // reactive-partitioned (engine setup)
    reactiveAbilities: ReactiveAbility[];
    timedSelfBySlot: TimedStatus[];
    timedEnemyBySlot: TimedStatus[];
    hasChargedSkill: boolean;
    // Base stats
    attack: number; crit: number; critDamage: number; defensePenetration: number;
    defence: number; hp: number;
    // Per-actor adapter-derived rates
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    affinityDamageModifier: number; affinityCritCap: number; affinityCritPenalty: number;
    affinityDisadvantage: boolean;
    allyChargePerRound?: number;             // attacker-only manual input
    // Per-actor deterministic gates (own instances — determinism isolation)
    activeCritGate: RateGate; chargedCritGate: RateGate;
    debuffLandingGate: RateGate; extendChanceGate: RateGate;
    landsTimedEnemyApplication: (application?: 'inflict' | 'apply') => boolean;
    // Lookups: attacker carries the global merged lookups; team runtimes get empty maps
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
}
```

(`type RateGate = (rate: number) => boolean`; `TimedStatus = Extract<RegisteredAbilityStatus, { kind: 'timed' }>`.)

- [ ] **Step 2: Parameterize the turn function**

Rename `runAttackerTurn` → `runPlayerTurn`, `AttackerTurnArgs` → `PlayerTurnArgs { runtime: PlayerActorRuntime; enemy; statusEngine; corrosionEntries; infernoEntries; pendingBombs; pendingAccumulators; bus; round; cumulativeDamage; enemyDefense; enemyHp; enemyType? }`, `AttackerTurnResult` → `PlayerTurnResult` (same fields), `AttackerRoundCtx` → `PlayerRoundCtx`. Inside the body, replace every config/gate/stat read with `runtime.*` and every hardcoded `'attacker'` with `runtime.actor.id`:
- `statusEngine.sourceFired(runtime.actor.id, …)` — NOTE: `sourceFired('team-N', …)` is already meaningful (manual extras) — that's exactly what Task 4 wants.
- `emitDebuffApplied(runtime.actor.id, …)`, `buff-applied` `actorId: runtime.actor.id`.
- All statusEngine player-side calls pass `runtime.actor.id` as ownerId/recipientId.
- `attacker.charges` → `runtime.actor.charges`.

- [ ] **Step 3: Engine builds the attacker runtime**

In `runCombat`: construct `const attackerRuntime: PlayerActorRuntime = { actor: attacker, focus: attacker.id === focusActorId, … }` from the existing destructured inputs, the existing partition result, the existing gate instances, and the existing lookups. Replace the attacker turn block's call with `runPlayerTurn({ runtime: attackerRuntime, … })`. Rename `attackerTurns` → `focusTurns`, `lastAttackerCtx` → keep but see Task 4 (it becomes a per-actor map there; leave the single variable for now). Update the no-attacker-turn throw message to say "focus actor".

- [ ] **Step 4: Goldens byte-identical + full suite; fix imports** (engine.ts, dpsSimulator.ts re-export, any test importing attackerTurn)

```bash
npx vitest run
```

- [ ] **Step 5: Commit** — `git commit -m "refactor: runPlayerTurn + PlayerActorRuntime parameterization (zero golden churn)"`

---

## Task 4: Walked team actors — engine + adapter + team damage (behavioral)

**Files:**
- Modify: `src/types/calculator.ts` (TeamActorInput additive fields)
- Modify: `src/utils/combat/state.ts` (`sourceId` on entries)
- Modify: `src/utils/combat/engine.ts` (team runtimes; team turn dispatch; per-entry tick attribution; teamDamage)
- Modify: `src/utils/combat/playerTurn.ts` (entries stamped with `sourceId`; accumulators with caster)
- Modify: `src/utils/calculators/dpsSimulator.ts` (per-actor rate derivation; `RoundData.teamDamage`; summary)
- Test: `src/utils/combat/__tests__/teamWalk.test.ts` (new), goldens (zero churn — legacy fixtures carry no `shipSkills`)

- [ ] **Step 1: Types (additive)**

`TeamActorInput` gains (exact spec shape):

```ts
shipSkills?: ShipSkills;
stats?: { attack: number; crit: number; critDamage: number; defensePenetration: number;
          hacking: number; defence: number; hp: number };
affinity?: AffinityName;
```

`RoundData` gains `teamDamage?: number` (doc comment: all-channel non-focus player damage; `totalRoundDamage + teamDamage` = the round's enemy-HP delta). `DPSSimulationSummary` gains `teamTotalDamage?: number`. `ActiveDoTStack`/`PendingBomb`/`PendingAccumulator` gain `sourceId: string` (and `PendingBomb` an `affinityMult: number` snapshot).

- [ ] **Step 2: Write failing behavioral tests** (`teamWalk.test.ts`, driven through `simulateDPS` like dpsSimulator.test.ts — build a walked team actor with hand-built `ShipSkills`)

Test list (one `it` each):
1. **Team debuff walks:** team ship with a timed enemy-debuff ability → debuff active from its real turn; attacker damage reflects it; `debuff-applied` carries the team sourceId.
2. **Team damage reduces HP, excluded from totals:** team damage ability → `RoundData.teamDamage > 0`; `enemyHpPct` declines faster than `cumulativeDamage` alone explains; `totalRoundDamage`/summary unchanged vs the same run without team stats (assert exact equality of summary.totalDamage).
3. **HP-threshold gate flips earlier:** attacker ability gated `enemy-hp below 50%` switches on in an earlier round with a damaging team ship than without.
4. **Team inferno scales with the TEAM ship's attack:** team DoT ability (inferno) → tick damage uses team stats (assert exact tick value), attributed to `teamDamage`, NOT the row's `infernoDamage`.
5. **`teamDamage` = HP-delta complement:** for every round, `totalRoundDamage + teamDamage ===` the round's enemy-HP-pool delta (recompute from consecutive `enemyHpPct` is rounded — instead assert `cumulativeDamage_focus + cumulativeTeam` vs `enemyHp × (1 − hpPct/100)` within rounding, or expose the check through the adapter's existing assertion if present).
6. **Echoing Burst gathers team direct:** accumulator active + damaging team ship → larger burst than without (and exact expected value).
7. **No-double-count:** a walked team ship that ALSO has manual picker extras (legacy `selfBuffs`) applies each exactly once.
8. **Per-actor condition ctx:** a team ship's gated ability (`self-buff X` condition) reads its OWN buffs — give the buff to the attacker only → gate fails; to the team ship → gate passes.
9. **Determinism:** two identical walked-team runs are byte-equal (JSON.stringify).
10. **Legacy parity:** a team actor WITHOUT `shipSkills` behaves byte-identically to pre-task (compare against a pinned expected from the legacy path — simplest: run the same input on this test file before/after is not possible, so assert the legacy fixture shape still matches the golden — covered by goldens; here just assert no `teamDamage` field appears (undefined) for legacy runs).

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/utils/combat/__tests__/teamWalk.test.ts` → FAIL.

- [ ] **Step 4: Adapter derivation (dpsSimulator.ts)**

For each `teamActors[i]` with `shipSkills`: compute per-actor `debuffLandingChance` (its `stats.hacking` vs `enemySecurity`, with ITS affinity modifier), `selfDotModifier`/`defensePenetrationBuff` from its MANUAL lists via `toDotAndPenModifiers(t.selfBuffs, [])` (mirroring the attacker's static fold — note: manual lists are attacker-granted, so this static fold stays on the ATTACKER's rates exactly as today; the team actor's own rates take `0` for these unless its walked statuses produce them in-loop — match the attacker's in-loop ability fold semantics), and affinity modifiers via `computeAffinityModifiers(t.affinity, …)` — but `computeAffinityModifiers` lives page-side; the adapter takes pre-derived per-actor modifiers instead. **Decision (locked):** keep derivation split exactly like the attacker's: page computes affinity modifiers per team ship and passes them through new optional fields on `TeamActorInput`? NO — that breaks the spec's input shape. Instead the adapter imports the same `computeAffinityModifiers` helper the page uses (`src/utils/autogear/affinity.ts` or wherever it lives — grep `computeAffinityModifiers`; it needs `enemyAffinity`, which the page passes today only per-config). Add optional `enemyAffinity?: AffinityName` to `DPSSimulationInput` (additive) and derive per-team-actor modifiers in the adapter; when absent, team affinity modifiers default to 0/100/0. The page passes `enemyAffinity` (Task 9).
Engine input: extend the engine's `teamActors` entries with a resolved `walk?: { … }` bundle (internal type in engine.ts), carrying castSkills-ready `shipSkills`, stats, and the derived rates. The legacy fields pass through unchanged.

- [ ] **Step 5: Engine — team runtimes + walked team turns**

1. At setup, for each team input with `walk`: `partitionReactiveAbilities(walk.shipSkills)`, run the registration loop (the same classification block engine.ts ~339–397, extracted to a helper `registerActorAbilityStatuses(castSkills, statusEngine, ownerId)` returning the timed-by-slot arrays) with `ownerId = team id`, build its `PlayerActorRuntime` (own `makeRateGate` instances; `hasChargedSkill` = chargeCount ≥ 1 && charged slot non-empty; empty lookups; `focus: false`). Store `reactiveAbilities` for Task 6 (do NOT register listeners yet — drop them this task with a comment).
2. Turn dispatch: `actor.kind === 'team'` with a runtime → `runPlayerTurn({ runtime, … })` (the legacy block stays for no-runtime team actors). Fold its result: `const d = dmg(actor.id); d.direct += …` etc. `pendingResisted`/last-focus-turn resisted routing: team-turn resisted entries keep the existing staging semantics (resisted lists aggregate all sources — route through the same `recordResisted`-style logic the legacy team block uses; the `PlayerTurnResult.resistedEnemyDebuffs` of a NON-focus turn must be appended to the focus turn's list / `pendingResisted`, NOT kept on the team turn result).
3. Post-Turn decrement now runs for team actors too (Task 2 wired `decrementPlayer(actor.id)`); `buff-expired` emits with the team actorId.
4. `lastAttackerCtx` → `lastTurnCtxByActor = new Map<string, PlayerRoundCtx>()`; each player turn sets its own entry. Enemy tick: per entry, resolve the APPLIER's ctx — `tickDoTs`/`processBombs`/`processAccumulators` generalize to per-entry attribution:
   - `tickDoTs`: group by `entry.sourceId`; tick each entry with `lastTurnCtxByActor.get(entry.sourceId)` (skip entries whose applier has no ctx yet — impossible for player actors, see spec); write `dmg(sourceId).corrosion/inferno += …`. The `emitTicked` events keep firing per dotType with summed damage (existing event shape; do not change payloads).
   - `processBombs`: burst uses the entry's snapshot `damagePerStack` × its `affinityMult`; `dmg(entry.sourceId).detonation += burst`.
   - `processAccumulators`: `directDamage` input becomes THIS ROUND's summed player direct (`[...roundDamage.values()].reduce((s,d) => s + d.direct, 0)`) — spec: Echoing Burst gathers all direct. Burst attributes to `dmg(entry.sourceId).detonation`.
   - In `playerTurn.ts`, stamp `sourceId: runtime.actor.id` on every appended DoT/bomb/accumulator entry; bombs also snapshot `affinityMult`.
5. Post-round: `teamDamage` = sum over non-focus entries of all six channels (counting `secondary`/`conditional` ONLY via `direct` — they are sub-buckets; do not double-add). Concretely: `teamDamage = Σ_{id ≠ focus} (d.direct + d.corrosion + d.inferno + d.detonation)`. Enemy HP decline (`enemy.currentHp`, `hp-changed`, `ship-destroyed`, `enemyHpPct` for next round, the `drainIntents` cumulative) now uses focus + team cumulative; `cumulativeDamage` (the row/summary field) stays focus-only. Add a separate `cumulativeTeamDamage` running total. `RoundData.teamDamage` set (omit/undefined when no walked team actors). rawTotals gain a `team` total → `summary.teamTotalDamage`.
6. `enemyHpPct` entering each player turn and all gate contexts now derive from `cumulativeDamage + cumulativeTeamDamage` — make `runPlayerTurn` take the combined value via its existing `cumulativeDamage` arg (rename the arg `enemyHpDecline` for clarity).

- [ ] **Step 6: Tests pass + goldens byte-identical + full suite**

```bash
npx vitest run src/utils/combat/__tests__/teamWalk.test.ts
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
npx vitest run
```

- [ ] **Step 7: Commit** — `git commit -m "feat: walked team actors — team skills run the player pipeline, team damage reduces enemy HP (reported separately)"`

---

## Task 5: Ally-target routing — `ally`/`all-allies` → all player actors (behavioral)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (multi-recipient timed application; caster-gated aura/accum recipients)
- Modify: `src/utils/combat/playerTurn.ts` (routing at the timed-self application site; ally charge gains)
- Modify: `src/utils/combat/engine.ts` (registration routes ally-targeted statuses; ctx resolver)
- Test: extend `teamWalk.test.ts`

Routing rule (spec): `self` → caster only; `ally`/`all-allies` → EVERY player actor (attacker + team); debuffs/DoTs → enemy (unchanged). Conditions evaluate against the CASTER's context; the status lives on each RECIPIENT (decrements at the recipient's Post Turn; family rule per recipient side).

- [ ] **Step 1: Write failing tests**

1. **Team `all-allies` buff lands on attacker AND team ships:** walked team ship with an all-allies timed Attack Up → attacker damage buffed; the team ship's own snapshot also shows it.
2. **Team `self` buff stays on caster:** walked team ship with a self-only Attack Up → attacker damage UNCHANGED (the over-grant fix at engine level).
3. **Attacker `all-allies` buff reaches team ships:** attacker ability targeted all-allies → team ship's gated ability conditioned on that buff name passes.
4. **Ally charge grant:** team ship with an `all-allies` charge ability → attacker charges bump (capped at attacker chargeCount); a second team ship's charges bump too; coexists with `allyChargePerRound`.
5. **`buff-applied` per recipient:** one all-allies application emits one `buff-applied` per player recipient with the recipient's actorId.
6. **Caster-gated aura:** team ship's all-allies aura gated on a condition true only for the caster → folds into the attacker's totals (gate read from caster ctx).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

1. **Classification (engine registration helper):** the side computation becomes target routing — `enemy/all-enemies → 'enemy'`; `self → recipients: [ownerId]`; `ally/all-allies → recipients: ALL player ids`. `RegisteredAbilityStatus` base gains `casterId: string` and (player-side) `recipients: string[]`. For the ATTACKER-only case every historical status has `casterId: 'attacker'`, `recipients: ['attacker']` — zero churn.
2. **Timed application:** the timed-self application site in `runPlayerTurn` (status fires, gate passes vs the CASTER's post-debuff ctx) loops recipients: `for (const rid of status.recipients) { statusEngine.applyTimedAbilityStatus(r, status, rid); bus.emit({ type: 'buff-applied', actorId: rid, … }); }`.
3. **Aura/accumulating:** registration stores them per RECIPIENT owner map with their `casterId`. `activeAbilityStatuses(side, ctxFor, ownerId)` changes its second param to a resolver `(casterId: string) => ConditionContext`, memoized per call site. In `runPlayerTurn`, the call site builds: own ctx for self-cast statuses, and a caster drain-style ctx (caster's snapshot names + shared enemy state — reuse/extract `buildDrainContext` from triggers.ts into a shared helper `buildActorContext(statusEngine, ownerId, engineState)`) for foreign casters. For attacker-only runs the resolver always returns the local ctx → zero churn.
4. **Charge abilities:** `chargeGainFromSkill` results route by ability target — `self` → own charges; `ally`/`all-allies` → every player actor `min(charges + amount, its chargeCount)` (skip actors with chargeCount 0). Same for the executor's charge branch (Task 6 will pass owner; here keep the cast path only).
5. **Persistent stacking + family rule:** per-recipient maps already handle both (Task 2) — add a test-less assertion comment only.

- [ ] **Step 4: Tests pass + goldens byte-identical + full suite.**

- [ ] **Step 5: Commit** — `git commit -m "feat: ally-target routing — ally/all-allies abilities reach every player actor, self stays on caster"`

---

## Task 6: Reactive parity — per-owner listeners + owner-routed executor (behavioral)

**Files:**
- Modify: `src/utils/combat/triggers.ts`
- Modify: `src/utils/combat/engine.ts` (register team reactive abilities; executor ctx gains runtimes)
- Test: extend `teamWalk.test.ts`

- [ ] **Step 1: Write failing tests**

1. **Team Hemlock:** walked team ship with an `on-debuff-inflicted` charge ability + a debuff-inflicting active → its charge cadence accelerates (its charged buffs fire earlier).
2. **Team on-crit:** team ship with an `on-crit` debuff ability → debuff lands the round after ITS crit turns (its own crit gate), not the attacker's.
3. **Cross-actor ally infliction:** the ATTACKER inflicts a debuff → a team Oleander-style `on-ally-debuff-inflicted` charge ability on the team ship fires (+1 team charge); and the reverse (team infliction → attacker ally-listener) still works (existing Phase 3 behavior, now via the generalized guard).
4. **Team DoT feeds ally listener:** team `dot-applied` (Task 4 emits it) triggers the attacker's `on-ally-debuff-inflicted` ability — the marked seam goes live: add the `dot-applied` subscription to the ally guard.
5. **start-of-round on a team ship:** applies its timed self-buff at the round boundary onto the team ship's own side.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

1. `Intent` gains `ownerId: string`. `registerReactiveListeners` takes `(bus, perOwner: { ownerId, reactiveAbilities }[], enqueue)` — registration order: input order of player actors with the FOCUS actor's existing position preserved as today (attacker was the only one; new order = team actors in input order, then attacker? NO — keep **attacker-first** registration to preserve existing intent-order determinism for attacker-only fixtures, then team actors in input order; document the choice). Guards generalize:
   - `on-crit`: `e.didCrit && e.actorId === ownerId`
   - `on-debuff-inflicted`: `e.sourceId === ownerId`
   - `on-ally-debuff-inflicted`: `e.sourceId !== ownerId && e.sourceId !== enemyId` on BOTH `debuff-applied` and now `dot-applied` (replace the FUTURE comment)
   - `start-of-round` / `on-bomb-detonated`: unchanged (global)
2. `executeIntent`: `IntentExecContext` gains `runtimes: Map<string, PlayerActorRuntime>`; resolve `const owner = ctx.runtimes.get(intent.ownerId)`. Charge branch → route by ability target (self → owner actor; ally/all-allies → all player actors, per-actor caps). Buff branch → recipients per target rule, `applyTimedAbilityStatus(round, status, rid)` + per-recipient `buff-applied`. Debuff/dot branches → draw the OWNER's `landsTimedEnemyApplication`/`debuffLandingGate`/`debuffLandingChance`; emitted `sourceId` = ownerId; dot entries stamped `sourceId: ownerId`; bombs use the OWNER's last-turn effective attack (`lastTurnCtxByActor`). Drain ctx (`buildDrainContext`) becomes owner-aware: self-buff names from the OWNER's snapshot.
3. Engine: register all player runtimes' reactive abilities (Task 4 stored team `reactiveAbilities` unregistered — wire them now); pass `runtimes` + `lastTurnCtxByActor` into the executor ctx.

- [ ] **Step 4: Tests pass + goldens byte-identical (attacker-only intent order unchanged) + full suite.**

- [ ] **Step 5: Commit** — `git commit -m "feat: reactive trigger parity for team actors — per-owner listeners, owner-routed executor, team dot-applied seam live"`

---

## Task 7: Parser/builder ally-scope (zero churn lock)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`SkillEffect.target` granularity)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (`mergeBuff` target)
- Modify: `src/utils/calculators/skillBuffAutoFill.ts` (carry the scope through)
- Modify: `scripts/auditSkills.ts` (mirrored classification)
- Test: `src/utils/__tests__/skillTextParser.test.ts` + `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (or their existing equivalents — grep for the current parser test files)

- [ ] **Step 1: Write failing tests**

```ts
it('classifies "all allies gain Attack Up" as all-allies target', …);
it('classifies "allies gain X" (unscoped plural) as all-allies', …);
it('classifies "This Unit gains Attack Up" as self', …);
it('classifies "the ally with the highest Attack gains X" as ally', …);
it('keeps enemy-targeted debuffs enemy', …);
```

Builder test: a ship whose active text grants an all-allies buff produces a buff ability with `target: 'all-allies'`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`SkillEffect.target` widens to `'self' | 'ally' | 'all-allies' | 'enemy'`. In the buff-effect emission path, detect scope from the granting clause (REUSE the existing modifier-path pattern `/friendly|all allies|allies/i` and the clause-scoping helpers WITH the abbreviation-period masking — see `detectGrantConditions`'s masking; extract a shared helper if not already shared). Single-ally phrasings (`/the ally (?:with|in)/i`) → `'ally'`. Unscoped grant phrasings that name no receiver ("grants Attack Up" with no subject) → `'all-allies'` (user routing decision); "This Unit gains" → `'self'`. **No lookbehind.**
`buildSkillBuffAutoFill`: `selfBuffs` keeps meaning "player-side effects" (filter `target !== 'enemy'`) so the legacy picker path is unchanged; thread the granular target through `SkillEffect` → `mergeBuff(buff, effect.target)` (today hardcoded `'self'`). `auditSkills` mirrors.

- [ ] **Step 4: Audit run + enumerate reclassifications**

```bash
npm run audit:skills > /tmp/audit-after.txt
```

Diff against a pre-change run (generate `/tmp/audit-before.txt` from a stash or the base branch FIRST). Include the enumerated list of ships whose buff targets changed in the task report. Expected reclassifications include the ~30 "all allies"-phrased granters; spot-check Panon/Quixilver/Paracelsus (all-allies) and Pallas/Valkyrie/Chimei (ally).

- [ ] **Step 5: Tests pass + goldens byte-identical (fixtures are hand-built, parser changes can't touch them; attacker-only behavior also invariant since self ≡ all-allies for the attacker's own folds) + full suite.**

- [ ] **Step 6: Commit** — `git commit -m "feat: parser ally-scope — buff abilities carry real ally/all-allies targets"`

---

## Task 8: Golden scenario — walked team ship

**Files:**
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (append ONE scenario)

- [ ] **Step 1: Append scenario 19**: attacker (modest config) + one walked team actor whose hand-built `shipSkills` exercise: an all-allies timed buff, an enemy timed debuff, an inferno DoT, a damage ability, an `on-debuff-inflicted` charge ability, non-default speeds. Through `simulateDPS` with `teamActors: [{ …, shipSkills, stats, affinity }]` + `enemyAffinity`.

- [ ] **Step 2: First run self-writes the snapshot; hand-verify it round-by-round** (team buff timing vs speeds, teamDamage column, HP% decline including team damage, charge cadence acceleration). Document the verification in the task report.

- [ ] **Step 3: Re-run twice for stability; full suite; commit** — `git commit -m "test: golden scenario for walked team actors"`

---

## Task 9: Page/UI — team card stats grid + skill editor; auto-fill retirement; teamDamage display

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx`
- Modify: `src/components/calculator/TeamShipRow.tsx`
- Modify: `src/components/calculator/CombatSettingsPanel.tsx` (prop pass-through)
- Modify: `src/components/calculator/DPSRoundChart.tsx` (+ wherever the per-round table renders rows — follow `RoundData` consumers)
- Test: component tests if an existing pattern covers TeamShipRow; otherwise rely on lint + manual verification in Task 11

- [ ] **Step 1: `TeamShipConfig` gains** `shipSkills?: ShipSkills` and `stats?: { attack; crit; critDamage; defensePenetration; hacking; defence; hp }` and `affinity?: AffinityName`.

- [ ] **Step 2: `selectShipForTeamSlot`** builds `shipSkills: buildShipAbilities(ship)`, `stats` from `shipFinalStats(ship)`, `affinity: ship.affinity`; STOPS calling `buildSkillBuffAutoFill`/`mergeAutoFill` for pickers and instead CLEARS `autoFilled` entries: `buffs: t.buffs.filter((b) => !b.autoFilled)` (same for enemyDebuffs). Keep `detectFullyCharged`/speed/chargeCount auto-fill.

- [ ] **Step 3: `teamActors` memo** passes the new fields through; page passes `enemyAffinity` to `simulateDPS`.

- [ ] **Step 4: TeamShipRow**: add a stats grid (shared `Input` components: Attack/Crit/Crit Damage/Def Pen/Hacking; affinity via the same `Select` pattern the attacker card uses — check `ShipConfigCard` for the affinity control) auto-filled + editable; add `SkillSlotList` (`shipSkills`, `hasPassive` derived like the attacker's config does — grep its derivation in DPSCalculatorPage `addConfig`/ship-pick path, `ship` for skill-text reference, `onChange` → `updateTeamShip`); relabel the two pickers "Manual extra buffs (granted to attacker)" / "Manual extra enemy debuffs". UI conventions: shared components only, no raw buttons, `card` class.

- [ ] **Step 5: teamDamage display**: in the round detail (DPSRoundChart and/or the round table), when any round has `teamDamage`, show it as its own series/line item labeled "Team damage" — visually separate from the attacker's stack (do NOT add it into the attacker's stacked totals). Plain text + color classes, no emojis.

- [ ] **Step 6: Lint + full suite + commit**

```bash
npm run lint
npx vitest run
git commit -m "feat: team ship cards walk real skills — stats grid, skill editor, manual-extras pickers, team damage display"
```

---

## Task 10: Docs + coverage + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 team-walk semantics; §6 shipped note; §7 team inputs)
- Modify: `src/pages/DocumentationPage.tsx` (team-ship section: walked skills, routing semantics, team damage display)
- Modify: `src/constants/changelog.ts` (edit the ONE evolving DPS entry in place)

- [ ] **Step 1: Update the three docs.** Coverage doc §5 gains a "Team ShipSkills walk" block (routing table, per-actor statuses/contexts, teamDamage attribution model, reactive parity, parser ally-scope); §6 backlog updates (team-walk shipped; note the per-hit-crit divergence now also applies to team multi-hit ships).

- [ ] **Step 2: Commit** (docs/ needs `git add -f` for the coverage doc only)

```bash
git add -f docs/skill-model-coverage.md
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs: team ShipSkills walk — coverage doc, in-app docs, changelog entry update"
```

---

## Task 11: Live verification + PR

- [ ] **Step 1: Dev server + fleet** — `npm start` (localhost:3002), chrome MCP tools, imported fleet (212 ships; use `evaluate_script`, not snapshots, on big pages). Configs to verify on the DPS page:
  - Hermes as team ship → attacker charge cadence accelerates (ally charge grant); compare with `allyChargePerRound` 0.
  - Hemlock as team ship → its own charge cadence + its debuffs land on team turns; attacker Oleander-style ally-trigger fires.
  - Belladonna (or another DoT inflictor) as team ship → team DoT ticks visible in teamDamage, enemy HP% declines faster, attacker HP-gated abilities flip earlier.
  - Self-buff-only support → attacker totals UNCHANGED (over-grant fix visible vs old stamped lists).
  - Team card editor: pick ship → stats + skills auto-fill; edit an ability; manual extra picker still applies to attacker.
- [ ] **Step 2: Record findings, fix anything broken (golden discipline applies), commit fixes.**
- [ ] **Step 3: PR** — `gh pr create` targeting `main`, title `feat: combat engine — team ShipSkills walk`, body summarizing the spec decisions + KD analysis (zero churn on existing fixtures; one appended golden). Watch for CodeRabbit: triage → fix/skip-with-reason → reply in-thread → wait for re-review status → merge when clean (merge commit, branch kept).
