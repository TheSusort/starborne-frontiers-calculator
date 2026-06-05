# Combat Engine Phase 3 Implementation Plan — Reactive Triggers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine consumes reactive `Ability.trigger` values via bus listeners producing intents (enqueued follow-up ability executions): `start-of-round`, `on-crit`, `on-debuff-inflicted`, `on-ally-debuff-inflicted`, `on-bomb-detonated` go live; the parser reclassifies the matching phrasings (fixing the Hemlock charge-on-inflict cadence bug); the editor exposes the trigger field.

**Architecture:** Restructure the round loop first (attacker turn extracted, 0..N-attacker-turns-tolerant round accumulator, zero golden churn), then retime/extend events (`debuff-applied` = infliction-only + `sourceId`, new `round-started`/`bomb-detonated`), then add the listener/intent machinery (engine-internal bus, FIFO intent queue, two drain points, chaining with a generation cap), then the parser/editor/docs layers on top.

**Tech Stack:** TypeScript, Vitest (snapshot + unit), React (editor task).

**Spec:** `docs/superpowers/specs/2026-06-05-combat-engine-phase3-design.md` — READ IT FIRST, especially "Trigger model", "Engine flow", and "Events". The spec is the authority on semantics; this plan is the authority on sequencing.

**Branch:** `feat/combat-engine-phase3` (Task 0 creates it from `main`; the spec commit is on `main`).

**Golden discipline (every task):** `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (17 `snap()` scenarios). NEVER run vitest with `-u`. **Expected churn is ZERO for every task** — plan-level refinement of the spec's KD list: the fixture audit is already done; every golden scenario feeds hand-built ability objects, all `trigger: 'on-cast'`, so neither the parser reclassification nor the trigger machinery can touch them. The spec's KD-1/2/3 manifest only on the live DPS page for real parsed ships (covered by Task 6 parser tests + Task 9 live verification). Task 5 APPENDS one new scenario (a new snapshot entry is not churn). Any diff to an existing snapshot = bug in your change.

**Cross-cutting facts (verified against source; trust these):**

- `engine.ts` is 1579 lines. The attacker turn block is lines ~806–1374 inside the `for (const actor of queue)` loop; team turn ~1375–1423; enemy turn ~1424–1465; owner Post-Turn decrement ~1470–1475; post-round row assembly ~1480–1563. Round-scoped definite-assignment locals (`action!`, `roundCrit!`, etc.) are declared at ~776–801 with the `attackerHasActed` flag and `teamResistedEnemyDebuffs` staging.
- The attacker's charge state is a **loop-local** `let charges` (engine.ts:739) while `CombatActor` already carries `charges`/`chargeCount` (state.ts) — team actors use the actor fields (engine.ts:1385–1393). Task 1 unifies the attacker onto its actor fields.
- `statusEngine.sourceFired(sourceId, slot, round)` (statusEngine.ts:318) returns `{ resistedEnemy: string[] }`; landed timed-enemy upserts happen inside it (`upsertBuff(buff, enemyMap)`). Task 3 adds `appliedEnemy: string[]` to the return. The `timedBySource`/landing-hook seams have doc comments — read them before touching.
- `debuff-applied` is emitted today from ONE engine site (engine.ts:894, the shared `emitDebuffApplied` closure) used by: `resolveEnemyDebuffs` (recurring re-roll fold), `foldTimedEnemyDebuffs` (per-round timed re-emission — the pre-Phase-3 semantics being retimed away), and the ability timed/recurring folds (~1011, ~1025). After Task 3 it fires only at discrete infliction sites.
- `buff-applied` for ability self-buffs is emitted at the application site already (engine.ts:1061–1067) — that one is correctly timed; leave it.
- The internal bus: `runCombat` takes `bus?: CombatEventBus` (write-only tap). Task 4 makes the engine ALWAYS create an internal bus, forwards every emit to `input.bus` if provided (or registers the external tap listeners first — pick the forward approach: wrap `emit`), and registers reactive listeners on the internal bus.
- Golden fixtures: 17 `snap()` calls in dpsGoldenParity.test.ts (grep `snap(` to list). All inputs are hand-built `ShipSkills`/buff arrays — no parser involvement.
- Parser: `classifyChargeCondition` (skillTextParser.ts:341–375); its `inflict + debuff` branch is lines 354–355. `parseChargeGain` (skillTextParser.ts:760) returns `ChargeGain`. `ALLY_INFLICTS_DEBUFF_RE` exists at line ~340. `detectGrantConditions` (skillTextParser.ts:472) classifies buff-grant clauses (self-crit at the `/critically (?:hits|damag)/i` rule) and contains the Inc./Out. abbreviation-period clause masking — REUSE that masking for any new clause-scoped detection (extract a shared helper).
- `buildShipAbilities.ts`: charge abilities built at line ~743 (`parseChargeGain` → ability with `toCondition(...)`); buff/debuff abilities at `mergeBuff` (~863–880, conditions from `detectGrantConditions`); every ability is born `trigger: 'on-cast'`.
- Audit script: `scripts/auditSkills.ts` (306 lines, `npm run audit:skills`) mirrors parser classification — update it in the same task as the parser or the audit output lies.
- Editor: `src/components/skills/AbilityCard.tsx` (598 lines) — option-list consts at top (e.g. `TARGET_OPTIONS` line 54), shared `Select` from `../ui/Select`. The Target select rendering (~line 230) is the pattern to copy for the Trigger select.
- Changelog: `src/constants/changelog.ts` — `UNRELEASED_CHANGES` currently has 1 Autogear entry + 6 DPS entries (lines 8–16). Task 8 merges the 6 DPS entries into ONE.
- Commits: the pre-commit hook runs lint-staged + the full suite (~2 min). Let it run; do NOT use `--no-verify` for code commits. `docs/` is gitignored — use `git add -f` for the plan/spec/coverage doc only.

**File map (who owns what):**

| File | Phase 3 responsibility |
|---|---|
| `src/utils/combat/engine.ts` | Task 1 charge unification; Task 2 turn extraction + round accumulator; Task 3 emission retiming; Task 4 listener registry + intent queue + drains + executor |
| `src/utils/combat/attackerTurn.ts` (new) | Task 2: extracted attacker turn body (`runAttackerTurn`) |
| `src/utils/combat/triggers.ts` (new) | Task 4: live-trigger set, listener registration, intent queue types, executor dispatch |
| `src/utils/combat/events.ts` | Task 3: `sourceId` fields, `round-started`, `bomb-detonated`, retiming doc notes |
| `src/utils/combat/statusEngine.ts` | Task 3: `sourceFired` returns `appliedEnemy` |
| `src/types/abilities.ts` | Task 4: three new `AbilityTrigger` values |
| `src/utils/skillTextParser.ts` | Task 6: `ChargeGain.trigger`, `detectReactiveTrigger`, classify fixes |
| `src/utils/abilities/buildShipAbilities.ts` | Task 6: thread trigger onto built abilities |
| `scripts/auditSkills.ts` | Task 6: mirrored classification |
| `src/components/skills/AbilityCard.tsx` | Task 7: Trigger select |
| `dpsGoldenParity.test.ts` | Task 5: one appended reactive scenario |
| `docs/skill-model-coverage.md`, `DocumentationPage`, `changelog.ts` | Task 8 |

---

## Task 0: Branch + baseline

- [ ] **Step 1: Create the branch and record the baseline**

```bash
git checkout main && git pull
git checkout -b feat/combat-engine-phase3
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
```

Expected: all golden tests pass, **zero snapshot writes**. Note the exact scenario count in the task report (expected 17).

- [ ] **Step 2: Full suite green**

```bash
npx vitest run
```

Expected: PASS. This is the baseline every later task is judged against.

---

## Task 1: Unify attacker charge state onto the actor (zero churn)

**Files:**
- Modify: `src/utils/combat/engine.ts` (~739, ~814–822, ~1237–1249, ~1525)

The attacker's `let charges = startCharged ? chargeCount : 0` loop-local duplicates state the `attacker` actor already has (`createActor` seeds `charges` from `startCharged`). The intent executor (Task 4) needs ONE mutation point.

- [ ] **Step 1: Replace the loop-local with the actor field**

Create the attacker actor with `chargeCount` and `startCharged` (it currently gets neither — check `createActor` call at ~581 and add them), delete the `let charges` local, and rewrite every read/write (`charges` in preTurn ~814–822, bonus-charge gain ~1237–1249, `RoundData.charges` ~1525) as `attacker.charges`. Pure rename — no logic change.

- [ ] **Step 2: Verify zero churn**

```bash
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts && npx vitest run src/utils/combat
```

Expected: PASS, zero snapshot writes.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor: attacker charge state lives on the actor (combat engine phase 3 prep)"
```

---

## Task 2: Extract the attacker turn; make the round loop turn-count-agnostic (zero churn)

**Files:**
- Create: `src/utils/combat/attackerTurn.ts`
- Modify: `src/utils/combat/engine.ts`
- Test: existing suites are the referee (no new tests; this is a behavior-preserving extraction)

This is the spec's structural Task 1. The round loop currently definite-assigns row fields (`action!`, `roundCrit!`, …) set exactly once by the inline attacker block, with `attackerHasActed` + `teamResistedEnemyDebuffs` staging. Replace with:

- [ ] **Step 1: Define the round-accumulator shape and the attacker-turn result**

In `attackerTurn.ts`, define (names indicative — keep doc comments):

```ts
/** Everything one attacker turn contributes to the round's RoundData row. */
export interface AttackerTurnResult {
    action: 'active' | 'charged';
    roundCrit: boolean;
    enemyHpPct: number;
    dotsConfig: DoTApplicationConfig;
    dotsLanded: boolean;
    activeSelfBuffs: ActiveBuff[];
    landedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    directDamage: number;
    secondaryDamage: number;
    conditionalDamage: number;
    detonationDamage: number; // the attacker-turn detonate() portion
    attackerCtx: AttackerRoundCtx; // moves here from engine.ts
}
```

In `engine.ts`, the round body keeps a `RoundAccumulator`: numeric damage fields (+=), `attackerTurns: AttackerTurnResult[]`, and a `pendingResisted: ActiveBuff[]` list that team turns append to when no attacker turn has happened yet this round (replaces `attackerHasActed` + `teamResistedEnemyDebuffs`: on each attacker turn, drain `pendingResisted` into that turn's `resistedEnemyDebuffs` head; team turns after an attacker turn append to the LAST attacker turn's list — same observable order as today).

- [ ] **Step 2: Move the attacker block into `runAttackerTurn(...)`** *(the single highest-effort step in this plan — budget accordingly; the zero-churn gate below is the safety net)*

Move lines ~806–1374 verbatim into `runAttackerTurn` in `attackerTurn.ts`, parameters = everything the block closes over (attacker/enemy actors, statusEngine, gates, lookups, config consts, bus emit closures, round number — derive the exact list by compiling: move first, let tsc enumerate the free variables, then group them into one params object). Move the module-private helpers it exclusively uses (`payloadToSelectedBuff`, `synthesizeResisted` stays shared — keep shared helpers in engine.ts or a small `shared.ts`, your judgment, no behavior change). Return `AttackerTurnResult`. The row assembly (~1480–1563) reads from the accumulator: `last(attackerTurns)` supplies the attacker fields (rounds always have exactly one attacker turn today), damage totals from the accumulator. If `attackerTurns` is empty the row fields fall back to the same definite-assignment crash semantics as today — add an explicit `if (!attackerTurns.length) throw` with a comment naming the Phase-3+ seam (extra turns append, zero turns impossible while the attacker is in every queue).

- [ ] **Step 3: Verify zero churn + full suite**

```bash
npx vitest run
```

Expected: PASS, zero snapshot writes. Diff `RoundData` semantics in your head: identical field-by-field provenance.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/
git commit -m "refactor: extract attacker turn body; round loop tolerates 0..N attacker turns (zero golden churn)"
```

---

## Task 3: Events groundwork — retime `debuff-applied`, add `sourceId`/`round-started`/`bomb-detonated`, `sourceFired.appliedEnemy` (zero churn)

**Files:**
- Modify: `src/utils/combat/events.ts`, `src/utils/combat/statusEngine.ts`, `src/utils/combat/engine.ts`, `src/utils/combat/attackerTurn.ts`
- Test: `src/utils/combat/__tests__/engine.events.test.ts`, `src/utils/combat/__tests__/statusEngine.test.ts`

- [ ] **Step 1: Write failing event tests** (TDD — update `engine.events.test.ts` expectations first):

1. A timed enemy debuff active 3 rounds emits `debuff-applied` ONCE (round of infliction), with `sourceId: 'attacker'` — not 3×.
2. A recurring/aura enemy debuff emits NO `debuff-applied` (and still emits `debuff-resisted` on per-round resist — unchanged).
3. `dot-applied` carries `sourceId: 'attacker'`.
4. `round-started` fires once per round, before any `turn-started` of that round.
5. A bomb with countdown 2 emits `bomb-detonated` (actorId `'attacker'`, correct round, stacks, damage > 0) when it bursts on the enemy turn; a `detonate-dot` bomb ability emits it from the attacker turn.
6. A team actor's landed timed debuff emits `debuff-applied` with `sourceId` = the team actor id, on its application round only.

Run: `npx vitest run src/utils/combat/__tests__/engine.events.test.ts` — expected FAIL (current per-round semantics).

- [ ] **Step 2: Implement**

- `events.ts`: add `sourceId: string` to `debuff-applied` and `dot-applied`; add `{ type: 'round-started'; round: number }` and `{ type: 'bomb-detonated'; actorId: string; round: number; stacks: number; damage: number }`. Doc notes: `debuff-applied` = discrete infliction events only (retimed Phase 3); `round-started` is the `start-of-round` trigger key — a documented deviation from the Phase 1 contract's `turn-started` mapping (multi-actor rounds make `turn-started` fire several times per round).
- `statusEngine.ts`: `sourceFired` returns `{ resistedEnemy, appliedEnemy: string[] }` — collect each landed timed-enemy upsert's buffName (push next to the `upsertBuff(buff, enemyMap)` call). Family-blocked-but-landed applications COUNT as applied (spec: the unit did inflict) — note `upsertBuff` applies the family rule internally; collect the name BEFORE the upsert call, i.e. landed = passed the landing hook, regardless of family absorption.
- `engine.ts`/`attackerTurn.ts`: emit `round-started` right after `statusEngine.beginRound(r)`; emit `debuff-applied` (with sourceId) ONLY at: attacker ability timed applications (the `applyTimedAbilityStatus` site, ~982), `sourceFired().appliedEnemy` for attacker and team turns; DELETE the emissions in `foldTimedEnemyDebuffs`, `resolveEnemyDebuffs` (landed recurring), and the per-round ability timed/recurring folds. Update the stale comment block on `foldTimedEnemyDebuffs` (the "revisit if a listener ever needs first-application-only" note is now resolved). Add `sourceId` to `dot-applied` emission. Emit `bomb-detonated` per burst inside `processBombs` (needs an emit closure param) and in `detonate()`'s `dotType === 'bomb'` branch.

- [ ] **Step 3: Verify**

```bash
npx vitest run src/utils/combat && npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
```

Expected: PASS, zero snapshot writes (events are not snapshotted).

- [ ] **Step 4: Full suite + commit**

```bash
npx vitest run
git add src/utils/combat/
git commit -m "feat: retime debuff-applied to infliction events; add round-started/bomb-detonated/sourceId (combat engine phase 3)"
```

---

## Task 4: Trigger machinery — union values, listeners, intent queue, drains, executor

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union, line 24)
- Create: `src/utils/combat/triggers.ts`
- Modify: `src/utils/combat/engine.ts`, `src/utils/combat/attackerTurn.ts`
- Test: `src/utils/combat/__tests__/triggers.test.ts` (new)

- [ ] **Step 1: Union + live set**

`types/abilities.ts`: `AbilityTrigger` gains `'on-debuff-inflicted' | 'on-ally-debuff-inflicted' | 'on-bomb-detonated'`. In `triggers.ts`:

```ts
/** Triggers the Phase 3 engine consumes via listeners. Everything else (on-attacked,
 *  on-ally-destroyed, on-destroyed) is annotation-only: those abilities stay in the
 *  normal on-cast pipelines with manual assume-active conditions. */
export const LIVE_TRIGGERS = new Set<AbilityTrigger>([
    'start-of-round', 'on-crit', 'on-debuff-inflicted', 'on-ally-debuff-inflicted', 'on-bomb-detonated',
]);
/** Safety backstop far above any real follow-up chain — not a tuned value. */
export const MAX_INTENT_GENERATIONS = 10;
```

- [ ] **Step 2: Write failing engine-level tests** in `triggers.test.ts`, driving `runCombat` with hand-built `ShipSkills` (copy fixture-building patterns from `dpsGoldenParity.test.ts` / `engine.events.test.ts`):

1. **on-debuff-inflicted charge (Hemlock shape):** active slot = damage + ONE timed enemy debuff; passive slot = charge ability `{ amount: 1, trigger: 'on-debuff-inflicted', conditions: [] }`, `chargeCount: 3`, 100% landing. Expect `RoundData.charges` to climb +1 per *active* round beyond the normal +1 bank (i.e. effective +2/active round), reaching charged on the right round — assert the exact `action` sequence.
2. **Two inflictions = +2:** same but active slot carries TWO timed enemy debuffs → +2/cast from the trigger.
3. **Standing aura grants nothing:** replace the timed debuff with a recurring (`duration: 'recurring'`) debuff → trigger never fires (charges follow the plain bank only).
4. **Resisted application grants nothing:** landing chance 0 (`debuffLandingChance: 0`) → no trigger fire.
5. **DoT applications count:** active slot applies a corrosion DoT → `dot-applied` fires the trigger (+1/cast while landing).
6. **on-crit debuff (Enforcer shape):** passive slot = timed enemy debuff `{ trigger: 'on-crit' }`; crit 100 → debuff present in `activeEnemyDebuffs` from the round AFTER the first crit turn onward (it lands post-hit, persists its window); crit 0 → never present. Assert this round's `directDamage` is unaffected by the triggered debuff's own modifiers on the crit round itself.
7. **start-of-round buff:** passive slot = self buff `{ trigger: 'start-of-round', duration: 1, parsedEffects: attack-up }` → buff active during every round's attacker turn (applied at round start, expires at the attacker's Post Turn, re-applied next round start); `buff-applied` emitted each round.
8. **on-ally-debuff-inflicted (Oleander shape):** charge ability with that trigger + `teamActors: [{ enemyDebuffs: [timed debuff, skillSource 'active'] }]` → +1 on each round the team turn lands the application; without `teamActors` → no gains.
9. **on-bomb-detonated:** active slot applies a bomb (countdown 2) + passive buff `{ trigger: 'on-bomb-detonated', duration: 2 }` → buff becomes active after the burst round.
10. **Chaining:** active slot = damage + timed enemy debuff; passive = charge `{ trigger: 'on-debuff-inflicted' }` AND a timed enemy debuff `{ trigger: 'on-crit' }`; crit 100 → the on-crit-inflicted debuff ALSO feeds the charge listener in the same drain (assert the extra +1 on crit rounds).
11. **Generation cap:** a timed enemy debuff ability with `trigger: 'on-debuff-inflicted'` (self-amplifying: its own application emits `debuff-applied`, re-triggering itself; the family rule absorbs the re-apply but family-blocked-landed still counts) → expect `runCombat` to throw the `MAX_INTENT_GENERATIONS` error, not hang.
12. **Determinism:** run scenario 10 twice; `JSON.stringify` of both results identical.
13. **Exclusion:** an ability with a live trigger does NOT also act on-cast — e.g. scenario 1's charge ability must not be double-counted by `chargeGainFromSkill`; scenario 6's debuff must not apply on cast.

Run: `npx vitest run src/utils/combat/__tests__/triggers.test.ts` — expected FAIL.

- [ ] **Step 3: Implement the machinery**

In `triggers.ts` + wiring in `engine.ts`:

- **Cast/reactive split at setup:** partition `shipSkills` once into `castSkills` (abilities with non-live triggers — feeds ALL existing pipelines: status registration, `selectFiringSkill`, passive sourcing, `chargeAbilitiesFromSkill`, `dotsFromSkill`, modifiers) and a `reactive: { ability, sourceSlot }[]` list in slot/text order. Engine pipelines switch from `shipSkills` to `castSkills` — one substitution point.
- **Internal bus:** `const internalBus = createEventBus()`; if `input.bus` is provided, wrap emit to forward (`emit(e) { external?.emit(e); internal.emit(e); }` — external taps stay write-only, run first, contract-documented). All existing `bus?.emit` become unconditional `bus.emit` on the wrapper.
- **Listener registration:** for each reactive ability, `internalBus.on(eventKey(trigger), …)` per the spec's mapping table. Match guards: `on-crit` → `e.type === 'ability-performed' && e.didCrit && e.actorId === 'attacker'`; `on-debuff-inflicted` → `debuff-applied`/`dot-applied` with `sourceId === 'attacker'`; `on-ally-debuff-inflicted` → `debuff-applied` with `sourceId !== 'attacker'` (team ids); `start-of-round` → `round-started`; `on-bomb-detonated` → `bomb-detonated`. Listener body: `intentQueue.push({ ability, sourceSlot })` — nothing else.
- **Drain points:** (a) after the `round-started` emission; (b) after each actor's turn body, BEFORE that actor's Post-Turn decrement. `drainIntents()` loops FIFO; each executed intent may enqueue more (chaining); a generation counter per drain call throws past `MAX_INTENT_GENERATIONS`.
- **Executor:** dispatch on `ability.config.type`:
  - `charge` → `attacker.charges = Math.min(attacker.charges + amount, attacker.chargeCount)` (no-op if `chargeCount === 0`).
  - `buff` → build the `AbilityStatusPayload` and `statusEngine.applyTimedAbilityStatus(r, …)` as a timed status — duration = `cfg.duration` if numeric, else 1 (spec: edge-case fallback). Emit `buff-applied`.
  - `debuff` → conditions gate (reuse `conditionsMet` against a `buildRoundContext(...)` call — the same builder the attacker turn uses at the `preDebuffGateCtx` site; feed it the current round's snapshot names/counts/HP%, which the round scope already has), then `landsTimedEnemyApplication(cfg.application)`; landed → `applyTimedAbilityStatus` + emit `debuff-applied` (sourceId 'attacker' — chainable); resisted → record in the CURRENT round's resisted list (the accumulator's pending/last-turn mechanism from Task 2) + emit `debuff-resisted`.
  - `dot` → landing draw (`debuffLandingGate(debuffLandingChance)`), then append entries per the `applyNewDoTs` shapes; bombs need `effectiveAttack` — use the latest `AttackerRoundCtx` (`lastAttackerCtx`; if undefined — triggered before any attacker turn — skip bombs, document). Emit `dot-applied`.
  - anything else → if it's a `buff` with empty `parsedEffects` it already applies above (DPS-neutral named buff); non-simulated types (`heal`/`control`/…) skip silently.
- **RoundData provenance:** triggered statuses surface through the existing snapshot/fold mechanics next round; triggered charge changes surface via `attacker.charges` in the row. No RoundData shape change.

- [ ] **Step 4: Verify**

```bash
npx vitest run src/utils/combat && npx vitest run src/utils/calculators
```

Expected: triggers.test.ts PASS; goldens zero churn (no fixture carries a live trigger); full combat suite green.

- [ ] **Step 5: Full suite + commit**

```bash
npx vitest run
git add src/types/abilities.ts src/utils/combat/
git commit -m "feat: reactive trigger consumption — listeners, intent queue, follow-up executor (combat engine phase 3)"
```

---

## Task 5: Golden lock — one appended reactive scenario

**Files:**
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`

- [ ] **Step 1: Append one `snap()` scenario** named `'reactive triggers (charge on inflict + crit-inflicted debuff)'`: active slot damage + timed enemy debuff; passive slot charge `{ trigger: 'on-debuff-inflicted' }` + timed enemy debuff `{ trigger: 'on-crit', parsedEffects with a defense-down }`; crit ~50, chargeCount 3, 100% landing, 10 rounds. This locks cadence + post-crit landing + window semantics in one snapshot.

- [ ] **Step 2: Run, eyeball the NEW snapshot by hand** (charges sequence, debuff first appears the round after the first crit, charged rounds correct), then run the whole golden file:

```bash
npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts
```

Expected: 18 scenarios; ONLY the new snapshot written; 17 existing byte-identical.

- [ ] **Step 3: Commit**

```bash
git add src/utils/calculators/__tests__/
git commit -m "test: golden scenario locking reactive trigger behavior"
```

---

## Task 6: Parser reclassification + audit script

**Files:**
- Modify: `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`, `scripts/auditSkills.ts`
- Test: `src/utils/__tests__/skillTextParser.test.ts`, `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

Boundary (spec-tight, no creep): trigger assignment covers (a) charge gains with inflict phrasings, (b) buff/debuff/dot abilities with self-crit/start-of-round/bomb-detonate phrasings. Buff GRANTS gated on "ally inflicts" (Provider-style `ally-inflicts-debuff` subject) keep their manual condition — only charge abilities get `on-ally-debuff-inflicted` this phase.

- [ ] **Step 1: Write failing parser tests** (use real CSV texts, copied inline as fixtures):

1. Hemlock passive ("gains 1 charge to its charged skill after it inflicts a debuff") → charge ability with `trigger: 'on-debuff-inflicted'`, amount 1, NO `enemy-debuff` condition.
2. Oleander passive ("When an ally inflicts a debuff, this Unit adds 1 charge…") → `trigger: 'on-ally-debuff-inflicted'` (today this wrongly hits the same `enemy-debuff` count branch — both fixed by the same reclassification).
3. Rhodium per-buff form and a count-threshold text → UNCHANGED (per-standing scaling preserved).
4. Hermes ally-crit charge → UNCHANGED (`always`, non-derivable, `trigger: 'on-cast'`).
5. Enforcer ("When this Unit critically hits an enemy it inflicts Defense Shred for…") → the Defense Shred debuff ability gets `trigger: 'on-crit'` and NO `self-crit` condition.
6. Wusheng ("gains Stealth for 1 turn after critically damaging an enemy") → Stealth buff `trigger: 'on-crit'`.
7. Valkyrie ("gains Speed Up II for 1 turn at the start of the round") → `trigger: 'start-of-round'`, duration 1 kept.
8. Lingshe ("When this Unit detonates a Bomb it gains Stealth for 1 turn") → `trigger: 'on-bomb-detonated'`.
9. Passive-voice guard: "is critically hit" does NOT classify as on-crit (existing active-voice regex semantics — keep a regression test).

Run and confirm FAIL.

- [ ] **Step 2: Implement**

- `ChargeGain` gains optional `trigger?: 'on-debuff-inflicted' | 'on-ally-debuff-inflicted'`. In `parseChargeGain`: check `ALLY_INFLICTS_DEBUFF_RE` first → ally trigger; then a self-inflict check (the phrasing `classifyChargeCondition` line 354 currently catches) → self trigger; in both cases `condition: 'always', derivable: true`. Remove/bypass the `inflict + debuff` branch in `classifyChargeCondition` accordingly.
- New `detectReactiveTrigger(skillText, buffName): AbilityTrigger | undefined` — clause-scoped using the SAME Inc./Out. abbreviation masking as `detectGrantConditions` (extract the clause-resolution into a shared helper rather than duplicating — the memory-documented pitfall). Rules: active-voice `/critically (?:hits|damag)/i` → `'on-crit'`; `/at the start of (?:the|each|every) round/i` → `'start-of-round'`; `/(?:detonates? a bomb|bomb explodes)/i` → `'on-bomb-detonated'`.
- `buildShipAbilities`: charge site (~743) — when `charge.trigger` is set, build the ability with that trigger and `conditions: []`. `mergeBuff` (~863) — call `detectReactiveTrigger(rowText, buff.buffName)`; when set, assign `ability.trigger` and drop the now-redundant condition (`self-crit` for on-crit; others produce none). DoT abilities (`dotAbility` merge): same `detectReactiveTrigger` on the DoT's clause for the crit-inflicted-DoT form.
- `scripts/auditSkills.ts`: mirror every classification change so `npm run audit:skills` agrees; run it and capture the list of reclassified ships in the task report (expect at minimum Hemlock, Oleander, Enforcer, Valkyrie, Wusheng, Lingshe).

- [ ] **Step 3: Verify**

```bash
npx vitest run src/utils/__tests__/skillTextParser.test.ts src/utils/abilities && npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts && npm run audit:skills
```

Expected: parser tests PASS; goldens zero churn (fixtures bypass the parser); audit output clean, reclassified-ship list captured.

- [ ] **Step 4: Full suite + commit**

```bash
npx vitest run
git add src/utils/ scripts/
git commit -m "feat: parser classifies reactive triggers — charge-on-inflict per event, crit/round-start/bomb-detonate reactions"
```

---

## Task 7: Editor — Trigger select on AbilityCard

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx`
- Test: `src/components/skills/__tests__/AbilityCard.test.tsx`

- [ ] **Step 1: Write failing tests:** the card renders a "Trigger" select with the ability's trigger value; changing it calls the update callback with the new trigger; a non-live trigger (`on-attacked`) shows the note "Not simulated — treated as assume-active"; a live trigger shows no note.

- [ ] **Step 2: Implement:** `TRIGGER_OPTIONS` const (all nine values, plain-language labels: "On cast (default)", "Start of round", "On critical hit", "When attacked", "On ally destroyed", "On destroyed", "After inflicting a debuff", "After an ally inflicts a debuff", "When a Bomb detonates"); a `NON_LIVE_TRIGGERS` set for the note (import `LIVE_TRIGGERS` from `src/utils/combat/triggers.ts` and invert, or mirror — prefer the import). Render via the shared `Select` next to the Target select (copy the `TARGET_OPTIONS` pattern at ~line 230), note via the existing `text-xs text-theme-text-secondary` pattern (no emojis). Show the select for `buff`/`debuff`/`dot`/`charge` ability types (the executor's supported set); other types keep their current layout untouched.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/components/skills
git add src/components/skills/
git commit -m "feat: ability trigger select in the skill editor"
```

---

## Task 8: Docs + changelog consolidation

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5, §6), `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`

- [ ] **Step 1: Coverage doc** — §5: add a "Reactive triggers (Phase 3)" bullet block (live set, event keys, intent/drain semantics, infliction-event definition, non-live = annotation-only); §6: mark backlog item 5 partially shipped (live set listed; on-attacked/cleanse/on-kill family still manual), add the Phase 3 shipped block mirroring the Phase 1/2 entries.

- [ ] **Step 2: DocumentationPage** — short paragraph in the DPS section: reactive skill effects (crit-triggered inflictions, charge-on-inflict, start-of-round buffs) now fire from real combat events; the Trigger field in the ability editor controls this; triggers the simulator can't derive are treated as assume-active.

- [ ] **Step 3: Changelog consolidation (user directive)** — merge the 6 DPS-related `UNRELEASED_CHANGES` strings into ONE evolving entry (keep the Autogear Effective HP entry separate), folding in Phase 3, e.g.: "Major DPS Calculator engine upgrade: ship skills are auto-parsed into an editable ability model, and the simulation now runs a real combat engine — speed-ordered turns for team ships and the enemy, live conditional gates, application-time debuff landing with persistent windows, buff-family tier rules, charge cadences with passive auras, and reactive triggers (charge-on-inflict, crit-triggered effects, start-of-round buffs) firing from real combat events. Includes a per-config Turn Order strip and numerous accuracy fixes (Valerian, Hemlock, Oleander, Enforcer)." Future DPS work edits this entry in place.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/constants 2>/dev/null; npm run lint
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git add -f docs/skill-model-coverage.md
git commit -m "docs: phase 3 reactive triggers — coverage doc, in-app docs, consolidated DPS changelog entry"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full suite + lint**

```bash
npx vitest run && npm run lint
```

Expected: all green, zero warnings.

- [ ] **Step 2: Live verification with the user's fleet** (dev server already on localhost:3002 or `npm start`; the fleet — 212 ships — lives in that origin's localStorage; use chrome MCP tools):

- Hemlock as attacker: DPS page → charge cadence reaches charged at +2/active-round (1 bank + 1 per inflicted debuff/DoT), NOT the old per-standing-debuff acceleration. Check the editor shows its charge ability with trigger "After inflicting a debuff".
- Oleander as attacker + a debuffing team ship configured: charge gains on team-turn applications.
- Enforcer: Defense Shred appears in round details only after crit rounds.
- Valkyrie: Speed Up II shows as a 1-turn window each round.
- Editor: change a trigger value, confirm the sim responds; set `on-attacked`, confirm the "not simulated" note.

- [ ] **Step 3: Report** — summarize KD observations (page-level behavior changes for reclassified ships), confirm goldens untouched except the Task 5 addition, hand off for PR via superpowers:finishing-a-development-branch.
