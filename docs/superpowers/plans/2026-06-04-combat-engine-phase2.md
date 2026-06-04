# Combat Engine Phase 2 Implementation Plan — Ships Act in Order

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team ships and the enemy become real actors with speed-ordered once-per-round turns; debuffs land at application and persist; durations decrement in the owner's Post Turn; scheduled buffs follow real cadences; `buff-expired` emits; `hasChargedSkill` widens; `teamActors` joins the public API.

**Architecture:** Generalize `runCombat`'s round loop into a per-round turn queue (speed desc; tiebreak team → attacker → enemy) dispatching on actor kind. The attacker's turn keeps the Phase 1 pipeline verbatim; enemy turns host DoT processing; team turns apply re-timed buff lists. The status engine becomes action-fed (`sourceFired`) instead of schedule-predicting. Strict parity discipline: tasks are ordered so each commit is either zero-golden-churn or has exactly one named KNOWN-DIFF.

**Tech Stack:** TypeScript, Vitest (snapshot + unit), React (page/UI task).

**Spec:** `docs/superpowers/specs/2026-06-04-combat-engine-phase2-design.md` — READ IT FIRST, especially "Turn model", "Same-turn decrement rule", and "Testing". The spec is the authority on semantics; this plan is the authority on sequencing.

**Branch:** `feat/combat-engine-phase2` (already exists, holds the spec commit).

**Golden discipline (every task):** `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (16 snapshots). NEVER run vitest with `-u`. Tasks below state their expected churn: most are ZERO; Task 5 churns exactly scenario 11 (KD-1, hand-verified); Task 8 appends one new snapshot. Any other diff = bug in your change.

**Cross-cutting facts (verified against source; trust these):**

- `engine.ts` round loop today: `selectNextActor` (line ~564) → preTurn action selection → `statusEngine.step(r)` → scheduled/ability status resolution → modifier fold → damage pipeline → `extendDoTs` → `detonate` → `applyNewDoTs`/`applyAccumulators` → `tickDoTs` → `processBombs` → `processAccumulators` → RoundData push → turn-meter reset. The DoT processing block (`tickDoTs` + `processBombs` + `processAccumulators` + their damage accumulation) is what moves to the enemy's turn.
- `tickDoTs`/`processBombs`/`processAccumulators` consume the ATTACKER-round context: `effectiveAttack`, `dotMult`, `affinityMult`, `enemyHp`, and (for accumulators) `directDamage`. When they move to the enemy's turn, that context must be carried over from the attacker's turn **of the same round** (default order: attacker before enemy). For a FASTER enemy (acts before the attacker), use the **previous round's** attacker context; in round 1 with no prior attacker turn the DoT containers are necessarily empty (only the attacker applies DoTs), so the value of the context is irrelevant — guard with `if (lastAttackerCtx)` and skip.
- `statusEngine.step(r)` (statusEngine.ts:196) currently does: (1) decrement+expire selfMap/enemyMap, (2) `skillFired` from `chargedSet`, (2b) accumulating increments, (3) timed upserts (self via `chargedSet`, enemy via `getSourceChargedSet`), (4) snapshot. Tasks 4–5 dismantle this: decrement → owner post-turns; chargedSet/source schedules → `sourceFired` notifications.
- Same-turn decrement rule (spec, corrected): owner post-turn decrements ALL statuses on the owner including ones applied during that same turn. This reproduces Phase 1 windows exactly (2-turn buff applied round r → present r, r+1). Do NOT add a same-turn skip — that ADDS a round.
- `engine.events.test.ts` asserts event emission shapes/counts. `turn-started`/`turn-ended` go from 1×/round to once per ACTOR turn (2×/round in Task 2, more with team actors). That test updates in Task 2 — events are write-only taps, allowed to change; `RoundData` is not.
- `hasChargedSkill` lives in `dpsSimulator.ts:161`: `chargeCount >= 1 && chargedDamage.multiplier > 0`.
- The DPS page (`src/pages/calculators/DPSCalculatorPage.tsx`) is the only production caller of `simulateDPS`. Today it merges team buffs into `selfBuffs`/`enemyDebuffs` (lines ~140–147, ~234–235). Task 10 moves it to `teamActors`.
- `buildSkillBuffAutoFill` (skillBuffAutoFill.ts:20) stamps `sourceChargeCount = ship.chargeSkillCharge ?? 0` on parsed team buffs; the page stamps `sourceStartCharged` (line ~145). These become dead fields after Task 5; Task 10 removes the page-side stamping. Leave the `SelectedGameBuff` type fields in place (deprecating doc comment) — other readers may exist.
- Attacker speed source: `calculateTotalStats(...).final.speed` (the page's existing stats pattern, lines ~52–61 and ~326–335). Team ship speed: same call in `selectShipForTeamSlot`. `BaseStats` includes `speed` (types/stats.ts:63).
- Commits: the pre-commit hook runs lint-staged + the full suite (~2 min). Let it run; do not use `--no-verify` for code commits.

**File map (who owns what):**

| File | Phase 2 responsibility |
|---|---|
| `src/utils/combat/state.ts` | `CombatActor.kind` + per-actor charge state; `buildTurnQueue` |
| `src/utils/combat/engine.ts` | Turn-queue rounds; attacker/team/enemy turn functions; post-turn owner decrement; `teamActors` |
| `src/utils/combat/statusEngine.ts` | Action-fed API (`beginRound`/`sourceFired`/`snapshot`/`decrementSide`); discriminated `RegisteredAbilityStatus`; landing-persistence storage |
| `src/utils/combat/chargeSchedule.ts` | DELETED in Task 5 (with its test file) |
| `src/utils/calculators/dpsSimulator.ts` | Additive inputs (`speed`, `enemySpeed`, `teamActors`); widened `hasChargedSkill` |
| `src/types/calculator.ts` | `TeamShipConfig` gains `speed`/`chargeCount`; `TeamActorInput` export; `DPSShipConfig.speed` |
| Page + `CombatSettingsPanel` + `ShipConfigCard` | Speed inputs; `teamActors` wiring |
| `docs/skill-model-coverage.md`, `DocumentationPage`, changelog | Task 11 |

---

### Task 0: Baseline

- [ ] **Step 1: Confirm branch and baseline**

```bash
git -C /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator checkout feat/combat-engine-phase2
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
```

Expected: 16 tests pass, zero snapshot writes. HEAD is the spec commit.

---

### Task 1: Actor kinds + turn queue (state.ts)

**Files:**
- Modify: `src/utils/combat/state.ts`
- Test: `src/utils/combat/__tests__/state.test.ts`

- [ ] **Step 1: Write failing tests** for `buildTurnQueue` in `state.test.ts`:

```ts
describe('buildTurnQueue', () => {
    const actor = (id: string, kind: CombatActor['kind'], speed: number): CombatActor =>
        createActor({
            id,
            side: kind === 'enemy' ? 'enemy' : 'player',
            kind,
            stats: { attack: 0, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1, speed },
        });

    it('orders by speed descending', () => {
        const q = buildTurnQueue([actor('attacker', 'attacker', 100), actor('t1', 'team', 140), actor('enemy', 'enemy', 120)]);
        expect(q.map((a) => a.id)).toEqual(['t1', 'enemy', 'attacker']);
    });

    it('breaks ties: player side before enemy, then input order (team before attacker by list position)', () => {
        const q = buildTurnQueue([actor('t1', 'team', 100), actor('t2', 'team', 100), actor('attacker', 'attacker', 100), actor('enemy', 'enemy', 100)]);
        expect(q.map((a) => a.id)).toEqual(['t1', 't2', 'attacker', 'enemy']);
    });

    it('default speeds (team 100, attacker 100, enemy 50) yield team → attacker → enemy', () => {
        const q = buildTurnQueue([actor('t1', 'team', 100), actor('attacker', 'attacker', 100), actor('enemy', 'enemy', 50)]);
        expect(q.map((a) => a.id)).toEqual(['t1', 'attacker', 'enemy']);
    });

    it('does not mutate the input array', () => {
        const input = [actor('attacker', 'attacker', 100), actor('t1', 'team', 140)];
        buildTurnQueue(input);
        expect(input[0].id).toBe('attacker');
    });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/combat/__tests__/state.test.ts` → FAIL (`buildTurnQueue` / `kind` not defined).

- [ ] **Step 3: Implement.** In `state.ts`:

Add to `CombatActor`:

```ts
    /** Dispatch role in the Phase 2 turn loop. */
    kind: 'attacker' | 'team' | 'enemy';
    /** Banked charges toward this actor's charged skill (attacker + team). */
    charges: number;
    /** Charges required to fire this actor's charged skill; 0 = no charged skill. */
    chargeCount: number;
```

Extend `createActor` to accept `kind` (required) and optional `chargeCount`/`startCharged`:

```ts
export function createActor(
    partial: Pick<CombatActor, 'id' | 'side' | 'kind'> & {
        stats: ActorStats;
        chargeCount?: number;
        startCharged?: boolean;
    }
): CombatActor {
    const { chargeCount = 0, startCharged = false, ...rest } = partial;
    return {
        ...rest,
        currentHp: partial.stats.hp,
        turnMeter: 0,
        charges: startCharged ? chargeCount : 0,
        chargeCount,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
    };
}
```

Add below `selectNextActor` (which stays, with a doc-note that it is reserved for future turn-meter manipulation and unused by the Phase 2 loop):

```ts
/**
 * Phase 2 turn order: each game round every living actor acts exactly once,
 * sorted by speed DESC. Tiebreak (game rule unknown — documented assumption):
 * player side before enemy, then input order. With the calculator's input order
 * (team 1..4, attacker, enemy) equal speeds yield team → attacker → enemy —
 * buffers act before the attacker. Speed affects ORDER, not frequency (spec:
 * "once per round, speed = order"); extra-turn effects are a later-phase seam.
 */
export function buildTurnQueue(actors: CombatActor[]): CombatActor[] {
    return [...actors]
        .map((a, i) => ({ a, i }))
        .sort((x, y) => {
            if (y.a.stats.speed !== x.a.stats.speed) return y.a.stats.speed - x.a.stats.speed;
            const sideRank = (s: CombatActor) => (s.side === 'player' ? 0 : 1);
            if (sideRank(x.a) !== sideRank(y.a)) return sideRank(x.a) - sideRank(y.a);
            return x.i - y.i;
        })
        .map((x) => x.a);
}
```

Then fix the two `createActor` call sites in `engine.ts` (add `kind: 'attacker'` / `kind: 'enemy'`) so the build compiles. No other engine change yet.

- [ ] **Step 4: Run** `npx vitest run src/utils/combat/ src/utils/calculators/` → ALL pass, zero snapshot writes.

- [ ] **Step 5: Commit** — `git add src/utils/combat/state.ts src/utils/combat/__tests__/state.test.ts src/utils/combat/engine.ts && git commit -m "feat: actor kinds and speed-ordered turn queue"`

---

### Task 2: Engine restructure — turn-queue rounds (the big move; ZERO churn)

**Files:**
- Modify: `src/utils/combat/engine.ts`
- Modify: `src/utils/combat/__tests__/engine.events.test.ts` (turn-started/ended now per actor turn)

This is a pure structural relocation. The attacker's math does not change; the DoT-processing block moves from the attacker's segment to the enemy's turn; the RoundData row is assembled after all turns of the round. At default order (attacker before enemy) every number is computed from identical inputs in identical sequence → byte-identical snapshots.

- [ ] **Step 1: Restructure the round loop.** Shape after the change (names matter — reviewers check them):

```ts
// Round-scoped context the enemy's DoT processing needs from the attacker's turn.
// Carried across turns; for a faster enemy this is the PREVIOUS round's context
// (round 1: undefined — only the attacker applies DoTs, so containers are empty).
interface AttackerRoundCtx {
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    /** The attacker turn's directDamage — consumed by processAccumulators. With a
     *  FASTER enemy this is the PREVIOUS round's value (the accumulator gathers the
     *  last direct hit dealt before its countdown step) — a documented approximation
     *  in the fast-enemy KNOWN-DIFF; no golden fixture combines the two. */
    directDamage: number;
}

let lastAttackerCtx: AttackerRoundCtx | undefined;

for (let r = 1; r <= numRounds; r++) {
    const queue = buildTurnQueue(actors); // [attacker, enemy] this task; teams join in Task 8
    // Per-round accumulator for the RoundData row (assembled after the round).
    const row = { /* corrosionDamage: 0, infernoDamage: 0, detonationBurst: 0, ... */ };
    for (const actor of queue) {
        bus?.emit({ type: 'turn-started', actorId: actor.id, round: r });
        if (actor.kind === 'attacker') {
            attackerTurn(r, row); // the existing block, minus tickDoTs/processBombs/processAccumulators
        } else if (actor.kind === 'enemy') {
            enemyTurn(r, row); // DoT processing using lastAttackerCtx; no-op action
        }
        bus?.emit({ type: 'turn-ended', actorId: actor.id, round: r });
    }
    pushRoundData(r, row);
}
```

Mechanics (do these as careful cut-and-paste, no math edits):

1. Wrap the current round body (everything between `selectNextActor` and the turn-meter reset) in a closure-style `attackerTurn` section inside the loop (a local function or inline block — match the file's existing flat style; closures over the loop locals are fine since everything stays inside `runCombat`).
2. Delete the `selectNextActor([attacker, enemy])` call (replaced by the queue); keep the import only if still used — otherwise remove it.
3. Move the `tickDoTs(...)`, `detonationDamage += processBombs(...)`, `detonationDamage += processAccumulators(...)` calls into the enemy's turn. They need `lastAttackerCtx` (set at the end of the attacker's turn: `lastAttackerCtx = { effectiveAttack, dotMult, affinityMult, directDamage }`) and `enemyHp` (outer scope). `processAccumulators` reads `lastAttackerCtx.directDamage` — at default order that is THIS round's direct hit (identical to today); with a faster enemy it is the previous round's (documented approximation, see the AttackerRoundCtx comment).
4. `totalRoundDamage`/`cumulativeDamage`/raw totals/`hp-changed`/`ship-destroyed` and the `roundData.push` move AFTER the turn loop (the row needs the enemy turn's tick damage). The `enemy.currentHp` update and destruction events use the same expressions, just relocated. CAREFUL: `enemyHpPct` (entering-round value) is computed at the START of the attacker's turn from `cumulativeDamage` — keep that exactly where it is (inside the attacker's turn).
5. The per-round snapshot fields (`activeSelfBuffs`, `appliedDoTs`, `dotsLanded`, `charges`, `didCrit`, etc.) are produced during the attacker's turn — write them into `row` and read them in `pushRoundData`. `activeDoTStates`/`activeCorrosionStacks` etc. are read AFTER the enemy's turn (post-tick state, same as today since today they're read after tickDoTs).
6. `if (lastAttackerCtx === undefined)` the enemy turn skips tick processing entirely (containers empty by construction).

- [ ] **Step 2: Update `engine.events.test.ts`** — `turn-started`/`turn-ended` now fire once per actor turn: with two actors, 2 per round, attacker first at default speeds, enemy id `'enemy'`. Adjust count/order assertions accordingly (read the test, update expectations precisely — do not loosen them to `toBeGreaterThan`).

- [ ] **Step 3: Run the full combat + calculators suites:**

`npx vitest run src/utils/combat/ src/utils/calculators/`
Expected: ALL pass. Golden: 16 pass, ZERO snapshot writes. If any golden diff appears, your relocation changed evaluation order — fix the code.

- [ ] **Step 4: Run the whole suite** — `npx vitest run` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "refactor: per-round turn queue; DoT processing moves to the enemy's turn"`

---

### Task 3: Speed inputs (engine + adapter, additive; ZERO churn)

**Files:**
- Modify: `src/utils/combat/engine.ts` (`CombatEngineInput` gains `speed?`, `enemySpeed?`)
- Modify: `src/utils/calculators/dpsSimulator.ts` (`DPSSimulationInput` gains `speed?`, `enemySpeed?`; pass-through)
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Write failing tests** (new `describe('actor speeds')` in dpsSimulator.test.ts):

```ts
    it('a faster enemy ticks DoTs before the attacker acts — first tick lands in round 2', () => {
        // Attacker applies 1 corrosion stack each active round. Enemy speed 150 > attacker 100:
        // the enemy's round-1 turn precedes the attacker's first DoT application, so the
        // first corrosion tick happens on the enemy's round-2 turn (with round-1's context).
        const result = simulateDPS({
            ...baseInput,
            enemySpeed: 150,
            rounds: 3,
            enemyHp: 500000,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            { id: 'd', type: 'damage', target: 'enemy', trigger: 'on-cast', conditions: [], config: { type: 'damage', multiplier: 100 } },
                            { id: 'c', type: 'dot', target: 'enemy', trigger: 'on-cast', conditions: [], config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 3 } },
                        ],
                    },
                ],
            },
        });
        expect(result.rounds[0].corrosionDamage).toBe(0); // enemy acted before the DoT existed
        expect(result.rounds[1].corrosionDamage).toBeGreaterThan(0);
    });

    it('default speeds reproduce the slow-enemy ordering (round-1 tick present)', () => {
        const result = simulateDPS({ /* same input, no enemySpeed */ });
        expect(result.rounds[0].corrosionDamage).toBeGreaterThan(0);
    });
```

(Adapt the second test to reuse the first's input via a helper. Exact corrosion math is already locked by other tests — these assert ordering only.)

- [ ] **Step 2: Verify failure** — first test fails (round-1 tick present regardless of `enemySpeed`, which doesn't exist yet).

- [ ] **Step 3: Implement.** `CombatEngineInput` gains `speed?: number` / `enemySpeed?: number`; `runCombat` uses `speed ?? 100` for the attacker and `enemySpeed ?? 50` for the enemy actor's `stats.speed`. Adapter: add both fields to `DPSSimulationInput` with the JSDoc defaults (`/** Attacker speed (turn order). Default 100. */`, `/** Enemy speed. Default 50 — the enemy acts last at default speeds. */`) and pass through.

- [ ] **Step 4: Run** combat + calculators suites → all pass, golden zero writes. **Step 5: Commit** — `feat: attacker and enemy speed inputs order the turn queue`.

---

### Task 4: Owner Post-Turn decrement + `buff-expired` (ZERO churn at defaults)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (decrement leaves `step`; new `decrementSide`)
- Modify: `src/utils/combat/engine.ts` (post-turn calls per owner)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`, `src/utils/combat/__tests__/engine.events.test.ts`

- [ ] **Step 1: Write failing statusEngine tests:**

```ts
    it('decrementSide expires statuses and reports expired names', () => {
        // seed a 1-turn timed buff via step/apply, then:
        const { expired } = engine.decrementSide('self');
        expect(expired).toContain('Attack Up II');
    });

    it('step no longer decrements (window controlled by decrementSide only)', () => {
        // a 1-turn buff applied in round 1 is still present in the round-2 snapshot
        // if decrementSide was never called between steps
    });
```

(Write them against the real current API — seed via the same calls the existing tests in this file use; read those tests first and mirror their setup.)

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement.**

statusEngine.ts: remove Step 1 (decrement+expire) from `step`; add:

```ts
    /** Owner Post-Turn: decrement ALL timed statuses on this side — including ones
     *  applied earlier in this same turn (spec: same-turn decrement rule; skipping
     *  same-turn applications would ADD a round). Returns expired buff names so the
     *  engine can emit buff-expired. */
    decrementSide(side: 'self' | 'enemy'): { expired: string[] };
```

implemented as the moved decrement loop over `selfMap`/`enemyMap`, collecting expired `buffName`s.

engine.ts: after each actor's turn (before `turn-ended`):

```ts
        // Post Turn (combat-system.md section 4): the status CARRIER decrements.
        // Self statuses live on the attacker; enemy debuffs on the enemy. Team
        // actors carry no statuses in Phase 2 (their grants sit on the attacker).
        if (actor.kind === 'attacker' || actor.kind === 'enemy') {
            const side = actor.kind === 'attacker' ? 'self' : 'enemy';
            for (const buffName of statusEngine.decrementSide(side).expired) {
                bus?.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
            }
        }
```

Update the `events.ts` doc comment on `buff-expired` (no longer "declared but unemitted"). Update the engine.ts comment at the old decrement site (the "Phase 2 moves this decrement into the owner's Post Turn" notes — they're done now).

- [ ] **Step 4: Add engine-level tests** (engine.events.test.ts or dynamicBuffGating.test.ts, wherever buff windows are asserted — read both first):
  - 2-turn buff applied round 1 → active rounds 1–2, `buff-expired` emitted at the attacker's round-2 post-turn (window identical to Phase 1 — this is the parity lock for the same-turn rule).
  - duration-1 buff re-applied every round → `buff-expired` each round.
  - fast enemy (`enemySpeed: 150`): 2-turn debuff applied round 1 lives rounds 1–3 (enemy's post-turn passed before the application; first decrement round 2) — the documented fast-enemy window KD.

- [ ] **Step 5: Run** combat + calculators suites → all pass; golden 16, ZERO writes (default-speed windows are equivalent — any churn means the same-turn rule was implemented wrong). **Step 6: Commit** — `feat: durations decrement in the owner's post turn; emit buff-expired`.

---

### Task 5: Action-fed status engine (KD-1: scenario 11 churns, hand-verified)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (chargedSet/source schedules → `sourceFired`)
- Modify: `src/utils/combat/engine.ts` (notify on each firing)
- Delete: `src/utils/combat/chargeSchedule.ts`, `src/utils/combat/__tests__/chargeSchedule.test.ts`
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`, `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Write the KD-2 lock test first** (dpsSimulator.test.ts, named exactly):

```ts
    it('scheduled charge-slot buff follows the real bonus-charge cadence', () => {
        // Active skill carries a charge ability (+1/round) → charged fires rounds 3/6/9
        // (not computeChargeSchedule's 4/8/12). A picker buff with skillSource 'charge'
        // must apply on the REAL charged rounds.
        // selfBuffs: [{ id: 'b', buffName: 'Attack Up II', stacks: 1, isStackable: false,
        //               parsedEffects: { attack: 20 }, skillSource: 'charge', skillDuration: 1 }]
        // assert rounds[2].activeSelfBuffs contains 'Attack Up II' and rounds[3] does not.
    });
```

(Flesh out with the file's existing buff-fixture helpers; the charge-ability ShipSkills shape exists in the `passive charge abilities` describe — reuse.)

- [ ] **Step 2: Verify failure** (buff applies on rounds 4/8 — the synthetic schedule).

- [ ] **Step 3: Reshape the status engine.**

`StatusEngineInput` loses `chargeCount`/`startCharged`/`totalRounds` (keep `totalRounds` ONLY if a residual guard wants it — prefer dropping; the out-of-sequence guard keys off `lastRound` alone). New surface:

```ts
export interface StatusEngine {
    /** Advance the round counter (strictly sequential). Increments per-round accumulating stacks. */
    beginRound(round: number): void;
    /** Notification that a source fired a slot this round. 'attacker' covers legacy/merged
     *  buffs and the attacker's own scheduled effects; team actor ids arrive in Task 8.
     *  Applies timed scheduled buffs keyed to (sourceId, slot) and increments
     *  per-active/per-charge accumulating stacks when sourceId === 'attacker'. */
    sourceFired(sourceId: string, slot: 'active' | 'charge', round: number): void;
    /** The round's active lists (was step()'s return). Pure read. */
    snapshot(): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
    decrementSide(side: 'self' | 'enemy'): { expired: string[] };
    // ability-status APIs unchanged
}
```

Mechanics:
- `chargedSet`, `sourceScheduleCache`, `getSourceChargedSet`, and the `computeChargeSchedule` import die. Delete `chargeSchedule.ts` + its test file.
- Scheduled buff keying: every `SelectedGameBuff` in `selfBuffs`/`enemyDebuffs` is keyed to source `'attacker'` (legacy rule: merged arrays ride the attacker's cadence; `sourceChargeCount`/`sourceStartCharged` are ignored — add a doc comment). `skillSource: 'active'` buffs upsert on `sourceFired('attacker','active')`; `'charge'` on `('attacker','charge')`; `'passiveN'` stay in the always-active sets (unchanged).
- Accumulating triggers: `per-round` increments in `beginRound`; `per-active`/`per-charge` in `sourceFired('attacker', ...)` matching the slot.
- `step(r)` is replaced: engine calls `beginRound(r)` at the top of the round (before any turns), `sourceFired('attacker', action === 'charged' ? 'charge' : 'active', r)` inside the attacker's turn at the exact point `step(r)` used to be called, then `snapshot()` where the old return value was read.

- [ ] **Step 4: Update statusEngine.test.ts** to the new API (read the whole file; translate each scenario: `step(r)` setups become `beginRound(r)` + `sourceFired` + `snapshot()`). Keep every behavioral expectation that still applies; the source-schedule tests (sourceChargeCount-driven) become legacy-rule tests (attacker cadence).

- [ ] **Step 5: Run golden suite and hand-verify KD-1:**

`npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: scenario 11 ("manual + team buffs with static defPen/dot path") FAILS its old snapshot — every other scenario passes unchanged. Inspect the diff: the `sourceChargeCount: 4`/`sourceStartCharged: true` team debuff previously applied on synthetic charged rounds 1/6/11 (`computeChargeSchedule(4, true, 12)`: fire round 1, then 4 banking rounds → 6, → 11); it must now apply on the attacker's real charged rounds (chargeCount 3, startCharged false → rounds 4/8/12). Hand-verify the per-round `activeEnemyDebuffs`/damage changes line up with exactly that re-timing, then — and only then — delete scenario 11's stale snapshot entry from the `.snap` file by hand (NOT `-u`) and re-run so vitest writes the new one. Confirm `git diff` on the `.snap` touches ONLY scenario 11.

- [ ] **Step 6: Full suite** → green. **Step 7: Commit** — `feat: action-fed status engine; scheduled buffs follow real cadences (KD-1: legacy team buffs ride the attacker's cadence)`.

---

### Task 6: `hasChargedSkill` widening (ZERO churn)

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts:160-161`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Failing test:**

```ts
    it('a damage-less charged skill still fires on cadence and applies its buffs', () => {
        // charged slot: ONLY a buff ability (no damage). chargeCount 2.
        // rounds[2].action === 'charged', rounds[2].directDamage from active=0 charged... 
        // assert: action cadence active/active/charged and the charged-slot buff
        // (skillSource 'charge' scheduled path or buff ability on charged slot)
        // is present in rounds[2].activeSelfBuffs.
    });
```

Build the charged slot with a single buff ability (`type: 'buff'`, finite duration) via the file's ability fixtures. Also assert the old guard still holds: `chargeCount: 0` → never charged (existing test covers it — just don't break it).

- [ ] **Step 2: Verify failure** (all rounds `active` today). 

- [ ] **Step 3: Implement** in dpsSimulator.ts:

```ts
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    // A charged skill "exists" when the slot carries ANY ability — damage or pure
    // utility (buffs/debuffs). Utility charged skills bank charges and fire
    // zero-damage charged turns whose statuses apply (spec: hasChargedSkill widening).
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;
```

(The old `chargedDamage` derivation drops; `damageInputsFromSkill` import may become unused here — remove if so.)

- [ ] **Step 4: Run** calculators suite + golden → zero churn (KD-4: no fixture has a utility-only charged slot). Check the three `charged skill guard` tests still pass — the multiplier-0 EXPLICIT-damage-ability case (`skips charging when an explicit charged damage ability has multiplier 0`) now CHANGES meaning: a charged slot with a 0-multiplier damage ability DOES have an ability → fires charged turns dealing 0. Read that test; per the spec's widening it must be updated to assert the new behavior (cadence fires, damage 0) — this is a deliberate, documented semantics change, confirm it doesn't ripple into golden (it doesn't: no fixture).

- [ ] **Step 5: Commit** — `feat: charged skills with no damage fire on cadence`.

---

### Task 7: Application-time debuff landing with persistence (ZERO churn at 100% landing)

**Files:**
- Modify: `src/utils/combat/engine.ts` + `src/utils/combat/statusEngine.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Failing tests** (50% landing: `hacking: 150, enemySecurity: 100`):

```ts
    describe('debuff landing persistence', () => {
        // timed 2-turn inflicted debuff applied every active round at 50% landing.
        it('a landed timed debuff persists its full window without re-rolling', () => {
            // With the deterministic gate at 0.5, applications alternate land/resist
            // (back-loaded accumulator: first draw resists, second lands — verify
            // against makeRateGate semantics in rateAccumulator.ts and assert the
            // actual deterministic pattern, then assert the landed window spans its
            // full duration with activeEnemyDebuffs present BOTH rounds).
        });
        it('a resisted application leaves no status and re-rolls on the next application', () => {
            // resistedEnemyDebuffs lists the application-round resistance only;
            // the debuff is absent that round, then lands on a later application.
        });
    });
```

(Author these by first reading `rateAccumulator.ts` to predict the exact land/resist sequence at 0.5 — the assertions must be exact rounds, not "eventually".)

- [ ] **Step 2: Verify failure** (today the window re-rolls each round: a "landed" status can blink off mid-window).

- [ ] **Step 3: Implement.** In the engine:
- TIMED applications (scheduled via `sourceFired` upserts + ability-status `applyTimedAbilityStatus`): draw the gate ONCE at application. Resisted → skip the upsert, emit `debuff-resisted`, record in the round's `resistedEnemyDebuffs`. Landed → upsert; the per-round fold includes ALL stored enemy timed statuses WITHOUT re-rolling (delete their participation in the per-round `roundDebuffLanded` partition).
- The plumbing: `sourceFired` needs a landing callback for enemy-side timed buffs — pass a `landsTimedDebuff(buff) => boolean` hook into `createStatusEngine` (the engine owns the gate and the affinity rule: `application === 'apply'` → `!affinityDisadvantage`, else `debuffLandingGate(debuffLandingChance)`); statusEngine calls it per enemy-side timed upsert attempt and reports skipped names so the engine can emit events.
- RECURRING/aura enemy statuses (alwaysEnemy, aura ability statuses, accumulating): keep the existing per-round roll exactly as is (`resolveEnemyDebuffs` / the ability-status block) — they are conceptually re-applied each round.
- DoTs: already application-time (`dotsLanded` gates `applyNewDoTs`) — unchanged.

- [ ] **Step 4: Run** full combat+calculators suites + golden → ZERO churn (all fixtures land at 100%, and at 100% the gate lands every draw regardless of how many draws happen). NOTE: one existing snapshot is literally named `KNOWN-DIFF conditional buff (updates in Task 7)` — that name is a PHASE 1 plan-numbering artifact (kept verbatim because it's the snapshot key). It has nothing to do with this task and must NOT churn. **Step 5: Commit** — `feat: debuff landing rolls once at application and persists`.

---

### Task 8: `teamActors` (new input + team turns + golden scenario 17)

**Files:**
- Modify: `src/utils/combat/engine.ts`, `src/utils/calculators/dpsSimulator.ts`, `src/types/calculator.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`, `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`

- [ ] **Step 1: Add the type** (types/calculator.ts, near `TeamShipConfig`):

```ts
/** A team ship as a real combat actor (Phase 2). Buff lists are the existing
 *  parsed SelectedGameBuff shapes, re-timed onto this actor's real turns. */
export interface TeamActorInput {
    id: string;
    /** Turn-order speed. Default 100. */
    speed: number;
    chargeCount: number;
    startCharged: boolean;
    /** Buffs granted to the attacker, keyed by skillSource to this actor's turns. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
}
```

- [ ] **Step 2: Failing tests:**

```ts
    describe('teamActors', () => {
        it('a faster team actor applies its active-slot buff before the attacker round 1', () => {
            // teamActors: [{ id: 't1', speed: 140, chargeCount: 0, startCharged: false,
            //   selfBuffs: [chargeSlotlessActiveBuff], enemyDebuffs: [] }]
            // assert rounds[0].activeSelfBuffs contains the buff name AND round-1
            // directDamage reflects it (compare vs a run without teamActors).
        });
        it("a slower team actor's first buff benefits round 2", () => { /* speed 80 < attacker 100... 
            NOTE: enemy default 50 still last. assert rounds[0] lacks the buff, rounds[1] has it */ });
        it('charge-slot team buffs land on the team actor\'s true charged turns', () => {
            // chargeCount: 2, startCharged: true → charged turns rounds 1/4/7 (wait: charged
            // consumes, then 2 actives rebank: 1,4,7 with the engine's preTurn rule — verify
            // by tracing engine cadence and assert those rounds).
        });
        it('no-double-count: a buff passed via teamActors contributes exactly once', () => {
            // identical buff in teamActors[0].selfBuffs only; assert round damage equals
            // the single-application expectation (NOT doubled vs the legacy-merged run).
        });
    });
```

- [ ] **Step 3: Implement.**
- `CombatEngineInput.teamActors?: TeamActorInput[]`; `runCombat` creates team `CombatActor`s (`kind: 'team'`, side player, dummy combat stats, real `speed`/`chargeCount`/`startCharged`), inserted between attacker construction and queue use, input order preserved (team before attacker in the actors array for the tiebreak).
- statusEngine: scheduled-buff keying generalizes — `createStatusEngine` input becomes `{ scheduledBuffs: { sourceId: string; side: 'self' | 'enemy'; buffs: SelectedGameBuff[] }[] , ... }` (or equivalent): legacy `selfBuffs`/`enemyDebuffs` register under `'attacker'`; each team actor's lists under its id. `sourceFired(teamId, slot, r)` upserts that team's timed buffs (enemy-side ones through the Task 7 landing hook).
- Team turn in the engine: pre-turn cadence (charged when `charges >= chargeCount`, else bank +1 — reuse the actor fields from Task 1; `hasCharged` for a team actor = `chargeCount > 0`), then `statusEngine.sourceFired(actor.id, action, r)`, then post-turn (no statuses carried — no decrement call). Emit `skill-fired` for team turns too.
- Adapter: pass `teamActors` through; when present, do NOT merge their buffs into the global arrays (the page change is Task 10; the adapter just forwards).

- [ ] **Step 4: New golden scenario 17** (dpsGoldenParity.test.ts):

```ts
    // Scenario 17: team actor with real turns — fast support (speed 140) applies an
    // active-slot 2-turn attack buff each of its turns; charged-slot debuff on its
    // chargeCount-2 cadence; enemy speed 50. Locks the multi-actor round shape.
    snap('team actor re-timed buffs (multi-actor rounds)', () => ({ ...BASE, teamActors: [ /* as above */ ] }));
```

Run WITHOUT `-u`: 1 written, existing 16 untouched (verify additions-only diff like Phase 1's Task 3).

- [ ] **Step 5: Full suite** → green. **Step 6: Commit** — `feat: team ships act as real speed-ordered actors (teamActors input)`.

---

### Task 9: `RegisteredAbilityStatus` discriminated union (type-only; ZERO behavior change)

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (+ the constructor block in `engine.ts` that builds statuses, ~lines 476–517)
- Test: compile-level — existing suites prove behavior unchanged

- [ ] **Step 1: Reshape the type:**

```ts
interface AbilityStatusBase {
    payload: AbilityStatusPayload;
    side: 'self' | 'enemy';
    sourceSlot: SkillSlot;
    /** Already live-gated by the caller (see abilityStatusGating.liveGateConditions). */
    conditions: Condition[];
}
export type RegisteredAbilityStatus =
    | (AbilityStatusBase & { kind: 'timed'; duration: number })
    | (AbilityStatusBase & { kind: 'aura' })
    | (AbilityStatusBase & { kind: 'accumulating'; stackTrigger: StackTrigger; maxStacks?: number });
```

Update the engine's registration block to build the correct variant (the existing `accumulating`/`isAura` classification logic maps 1:1; the `duration` runtime guard in `applyTimedAbilityStatus` becomes a type guarantee — keep a narrowed signature `applyTimedAbilityStatus(round, status: Extract<RegisteredAbilityStatus, {kind:'timed'}>)`).

- [ ] **Step 2: Run** `npx tsc --noEmit` + full combat/calculators suites → green, golden zero writes. **Step 3: Commit** — `refactor: RegisteredAbilityStatus as a discriminated union`.

---

### Task 10: Page + UI wiring (speeds everywhere; page moves to `teamActors`)

**Files:**
- Modify: `src/types/calculator.ts` (`DPSShipConfig.speed: number`; `TeamShipConfig` gains `speed: number; chargeCount: number`; deprecation comments on `sourceChargeCount`/`sourceStartCharged`)
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx`
- Modify: `src/components/calculator/CombatSettingsPanel.tsx`
- Modify: `src/components/calculator/ShipConfigCard.tsx`
- Test: existing page/component tests if any exist for these (check `src/components/calculator/__tests__/` — none existed at planning time); otherwise this task is verified by tsc + lint + manual checklist

- [ ] **Step 1: Types.** Add fields; every `TeamShipConfig` literal in the page (initial state ~line 125, add ~line 379, remove-reset ~line 385) gains `speed: 100, chargeCount: 0`. `DPSShipConfig` literals (~lines 64–110) gain `speed: Math.round(final.speed ?? 100)` / `speed: 100` (default config). `DPSShipConfigUpdateableField` union gains `'speed'`.

- [ ] **Step 2: Page wiring.**
- `selectShipForConfig` (~line 324): add `speed: Math.round(final.speed ?? 100)`.
- `selectShipForTeamSlot` (~line 390): compute the same `calculateTotalStats` breakdown as `selectShipForConfig` (same args pattern) and set `speed: Math.round(final.speed ?? 100)`, `chargeCount: ship.chargeSkillCharge ?? 0` alongside the existing fields. Drop the `sourceStartCharged` stamping memo (`teamEnemyDebuffs`, ~line 142) — replaced below.
- New `enemySpeed` state: `const [enemySpeed, setEnemySpeed] = useState(50);`
- Build `teamActors` and feed the sim:

```ts
    const teamActors = useMemo(
        () =>
            teamShips.map((t) => ({
                id: t.id,
                speed: t.speed,
                chargeCount: t.chargeCount,
                startCharged: t.startCharged,
                selfBuffs: t.buffs,
                enemyDebuffs: t.enemyDebuffs,
            })),
        [teamShips]
    );
```

In `simulateDPS(...)` (~line 220): add `speed: config.speed`, `enemySpeed`, `teamActors`; CHANGE `selfBuffs: [...attackerBuffs, ...teamAttackerBuffs]` → `selfBuffs: attackerBuffs` and `enemyDebuffs: [...enemyBuffs, ...teamEnemyDebuffs]` → `enemyDebuffs: enemyBuffs` (team buffs now enter via `teamActors` ONLY — the no-double-count door). KEEP `teamAttackerBuffs` for the display-only `globalAttackerBuffTotals` preview (it merges for display, not simulation).

- [ ] **Step 3: UI controls.**
- `ShipConfigCard`: "Speed" `Input` in the stats grid (`label="Speed"`, numeric, `onUpdate('speed', ...)` — mirror the Attack input at lines ~123–128).
- `CombatSettingsPanel`: enemy section gains `label="Enemy Speed"` input (props `enemySpeed`/`onEnemySpeedChange`, placed after Enemy Security ~line 96); each team-ship card gains `label="Speed"` and `label="Charge count"` inputs (props `onTeamShipSpeedChange`/`onTeamShipChargeCountChange` following the existing `onTeamShipStartChargedChange` pattern, page handlers via `updateTeamShip`).

- [ ] **Step 4: Verify** — `npm run lint && npx tsc --noEmit && npx vitest run` all green (goldens untouched — the page isn't under test fixtures). Then a quick manual smoke if a dev server is available: team card shows Speed/Charge count; enemy speed defaults 50; numbers change when a fast support is configured. **Step 5: Commit** — `feat: speed inputs and teamActors wiring on the DPS page`.

---

### Task 11: Docs + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 in-loop semantics: re-timed team buffs, owner post-turn decrement, landing persistence, action-fed cadence — rewrite the stale bullets; §6 Phase 2 pointers → shipped notes)
- Modify: `src/pages/DocumentationPage.tsx` (DPS section: short "Turn order" paragraph — speed-ordered once-per-round turns, buffers before attacker at equal speed, enemy default 50 acts last, team buffs timed to real turns)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Coverage doc** — update §5's "Per-round landing re-roll retained" bullet (now application-time + persistence), the "Charge-cadence quirk retained" bullet (fixed — action-fed), the Phase-2 pointers block (shipped, date, branch). §4's buff/debuff row note about `skillSource` routing scheduled buffs gets the action-fed wording.
- [ ] **Step 2: DocumentationPage** — add the turn-order paragraph to the DPS calculator section (find the existing DPS docs block; match its prose style; no emojis).
- [ ] **Step 3: Changelog** — append: `'DPS Calculator: team support ships and the enemy now take real speed-ordered turns — team buffs land when the ship actually acts (set each ship\'s Speed in Combat Settings), debuffs that land persist their full duration, and charged skills without damage now fire and apply their effects.'`
- [ ] **Step 4: Commit** — `git add -f docs/skill-model-coverage.md && git add src/pages/DocumentationPage.tsx src/constants/changelog.ts && git commit -m "docs: Phase 2 turn-order docs and changelog"`.

---

### Task 12: Full verification + PR

- [ ] **Step 1:** `npm run lint && npx tsc --noEmit && npx vitest run` — all green; vitest writes no snapshots.
- [ ] **Step 2: Snapshot audit vs the branch base:** `git diff $(git merge-base main HEAD) --stat -- src/utils/calculators/__tests__/__snapshots__/` — expect: scenario 11 modified (KD-1, hand-verified in Task 5), scenario 17 added, nothing else. Re-verify scenario 11's diff one final time against the KD-1 description.
- [ ] **Step 3: Memory/spec hygiene:** confirm the spec file is committed on the branch; update `docs/skill-model-coverage.md` already done in Task 11.
- [ ] **Step 4: Push + PR:**

```bash
git push -u origin feat/combat-engine-phase2
gh pr create --title "feat: combat engine Phase 2 — ships act in order" --body "$(cat <<'EOF'
## Summary
Phase 2 of the combat engine (spec: docs/superpowers/specs/2026-06-04-combat-engine-phase2-design.md):

- Team ships and the enemy are real actors: once-per-round, speed-ordered turns (tiebreak team → attacker → enemy; enemy defaults to speed 50). New `speed`/`enemySpeed`/`teamActors` inputs (additive); Speed inputs on the page.
- Team buffs/debuffs apply on their ship's REAL turns (own chargeCount/startCharged cadence) — the synthetic `computeChargeSchedule` path is retired (KD-1: legacy merged team buffs ride the attacker's cadence; golden scenario 11 re-pinned, hand-verified).
- DoTs tick at the start of the afflicted (enemy's) turn; durations decrement in the owner's Post Turn; `buff-expired` now emits.
- Debuff landing rolls once at application and persists its window (resisted applications skip).
- Scheduled charge-slot buffs follow the attacker's real bonus-charge cadence (Phase 1 invariant-4 quirk fixed).
- `hasChargedSkill` widened: damage-less charged skills fire and apply their effects.
- `RegisteredAbilityStatus` is now a discriminated union.

Zero-RNG determinism preserved. Public DPS API unchanged except additive inputs.

## Test plan
- [ ] lint + tsc + full vitest green
- [ ] Golden suite: only scenario 11 re-pinned (KD-1) + scenario 17 added
- [ ] New behavioral tests: speed ordering, fast-enemy timing, landing persistence, owner decrement windows, utility charged, team cadence, no-double-count

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5:** `gh pr checks --watch` → all green.
