# Stasis B2 — Stasis Status Model + Action-Only Turn-Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the combat engine SIMULATE Stasis as a real turn-skip control. B1 already lands a timed `Stasis` debuff on the victim's per-actor enemy-debuff store (the `{type:'debuff',buffName:'Stasis',application:'inflict',duration:N}` ability rides the inflict landing roll and lands via `applyTimedAbilityStatus` keyed by `targetId`). B2 adds: (1) a `stasisBuffs.ts` leaf module (`STASIS_BUFFS` + `isStasis`); (2) an engine-local `isStasised(actorId)` reader; (3) the ACTION-ONLY turn-skip — a stasised actor skips its active/charged skill + attack but STILL runs its DoT-tick prologue and the shared Post-Turn status decrement, so Stasis (and other timed statuses) tick on the skipped turn and duration N skips exactly N scheduled actions. Team-agnostic: works symmetrically for a player stasised by an enemy and an enemy stasised by a player. **NO break, NO reactive suppression** — those are B3.

**Architecture:** Three coupled-but-sequenced edits. (1) `stasisBuffs.ts` — a pure leaf module mirroring `barrierBuffs.ts`/`cheatDeathBuffs.ts`. (2) `isStasised(actorId)` — an engine-local closure inside `runCombat` reusing the existing `ownerDebuffNames(ownerId)` wrapper (which calls `ownerDebuffNamesFor(statusEngine, id)`, B1-confirmed to read all three per-victim debuff sources keyed by `targetId`/`id`) and testing names against `STASIS_BUFFS`. (3) **In-body `!isStasised(actor.id)` guards around the ACTION portion of the three ACTION branches** (`attacker`, walked-`team`, real-`enemy`) — NOT a shared helper, because the three branch bodies have materially different shapes (focus-turn synthesis, team-damage routing, enemy intake/positional apply) and a shared early-return helper cannot cleanly thread all three. The DoT-tick prologue (heal-target DoT tick at the top of the turn body; the dummy-`enemy` branch's `tickDoTs`/`processBombs`/`processAccumulators`) and the shared Post-Turn decrement (`decrementPlayer`/`decrementEnemy`) sit OUTSIDE these guards and always run. The dummy-`enemy` branch (`actor.id === enemy.id`) is NOT an action and is never gated. **Crux deviation from `handleDeadTargetSkip`:** the dead-target skip `continue`s past the ENTIRE turn body (including decrement); Stasis must NOT — it skips only the action and lets DoT-tick + decrement run.

**Tech Stack:** TypeScript, Vitest. Tests in `src/utils/combat/__tests__/`. Run with `npx vitest run <name>` (bare `npm test` = watch mode, hangs agents). Per-task gate: `npx vitest run` && `npm run lint` (max-warnings 0) && `npx tsc --noEmit` && `npm run audit:skills` (0/141). **NEVER `vitest -u`** — byte-identical goldens are the gate; no existing fixture lands a Stasis debuff, so the skip never triggers for them and every golden must stay byte-identical. If any golden moves, the gate leaked — fix the gate. Branch `feat/combat-sim-phase5-pr2` (already checked out). Docs are gitignored → `git add -f docs/...`, commit docs with `--no-verify`.

**Spec:** `docs/superpowers/specs/2026-06-18-stasis-design.md` (§2 locked rules, §4.1 status model, §4.3 turn-skip+tick, §7 PR split, §8 open items). Predecessor plan: `docs/superpowers/plans/2026-06-18-stasis-b1-per-victim-modifier-sourcing.md`.

> **Line numbers are 2026-06-18 snapshots and DRIFT as code is added. RELOCATE BY SYMBOL NAME or the verbatim code string below, never by raw offset.** Verbatim anchors are given for every edit site.

---

## Resolved spec §8 open items (decided during B2 investigation)

### `STASIS_BUFFS` contents = `{ 'Stasis' }` — CONFIRMED

- `src/constants/buffs.ts` carries exactly ONE Stasis entry: `{ name: 'Stasis', type: 'debuff', description: 'Prevents activation of passive and active skills. Charge skill charges do not generate. Effect removed upon taking damage' }` (relocate by `name: 'Stasis'`). There is **no `Stasis I`/`Stasis II`** entry.
- `docs/ship-skills.csv` (gitignored) was grepped for "Stasis": every occurrence is the bare token `<unit-skill>Stasis</unit-skill>` with duration encoded separately as "for N turns". **No numeral suffix ever appears on Stasis.** Duration is already parsed by `DURATION_RE` ("for N turns") and stamped onto the ability's `duration` (B1/§3.1) — it is NOT in the name. Therefore `STASIS_BUFFS = new Set(['Stasis'])`. (The "don't break Stasis" attacker phrasing is B3's `parseDoesntBreakStasis`, out of scope here.)

### Gate placement = in-body `!isStasised(actor.id)` guard per action branch — DECIDED

The turn body has FOUR kind-branches; only THREE are actions (relocate by the branch-head strings):

| Branch | Head string (engine.ts) | Action? | Gate it? |
|---|---|---|---|
| Attacker | `if (actor.kind === 'attacker') {` | YES — `runPlayerTurn` + positional apply + `focusTurns.push(turn)` | **YES** |
| Walked team | `} else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {` | YES — `runPlayerTurn` + positional apply + team-damage credit | **YES** |
| Dummy enemy | `} else if (actor.kind === 'enemy' && actor.id === enemy.id) {` | NO — `tickDoTs`/`processBombs`/`processAccumulators` (the enemy DoT prologue) | **NO — must always run** |
| Real enemy attacker | `} else if (actor.kind === 'enemy') {` | YES — `runPlayerTurn` + positional apply + `applyIncomingToTarget` | **YES** |

A **shared `handleStasisSkip(actor)` early-return helper was REJECTED** because: (a) the three action branches have incompatible shapes — the attacker branch MUST synthesize a `focusTurns.push` entry when the focus actor is skipped (else the `if (!focusTurns.length) throw` at round end fires), the team branch routes to its own credit, the enemy branch resolves a victim/intake; one helper cannot satisfy all three; (b) the DoT-tick prologue and Post-Turn decrement live OUTSIDE the branches and must keep running, so a helper that `continue`s the loop (like `handleDeadTargetSkip`) would WRONGLY skip the decrement — the exact §4.3 anti-pattern. An in-body guard wrapping only each branch's action body is the minimal, correct, three-shape-aware gate.

### Focus-turn synthesis when the FOCUS attacker is stasised — REQUIRED

`runCombat` throws `combat round R produced no focus actor turn` if `focusTurns.length === 0` at round end (relocate by `produced no focus actor turn`). `handleDeadTargetSkip` already handles the dead-focus case by pushing a synthesized minimal focus-turn (relocate by the `focusTurns.push({` block inside `handleDeadTargetSkip`). The stasised-focus skip MUST do the same when `actor.id === focusActorId`. This is why the attacker-branch guard is an `if/else`, not a bare skip.

---

## How a stasised actor reaches each branch (team-agnostic — VERIFIED)

- **Enemy stasised by a player** (player→enemy): B1 threads `targetId` for player→enemy in `buildTurnArgs` (relocate `...(a.side === 'enemy' || tgt.id !== enemy.id ? { targetId: tgt.id } : {}),`), so a player skill's `{debuff,Stasis,inflict,N}` lands via `applyTimedAbilityStatus` on the **enemy victim's** per-actor store keyed by `victim.id`. The enemy takes its turn through the real-`enemy` branch. `isStasised(enemyId)` → `ownerDebuffNamesFor(statusEngine, enemyId)` reads that store → finds `'Stasis'` → action gated.
- **Player stasised by an enemy** (enemy→player): the enemy-attacker turn already threads `targetId` unconditionally. Stasis lands on the **player victim's** per-actor store. `isStasised(playerId)` reads its store → gated.
- **Both directions read the SAME uniform per-victim store keyed by id** (B1's direction-agnostic read): `ownerDebuffNamesFor(statusEngine, id)` reads `snapshot(undefined, id).activeEnemyDebuffs` + `timedAbilityStatuses('enemy', undefined, id)` + `activeAbilityStatuses('enemy', …, id)`. Stasis is a timed `inflict` debuff → lands in the timed ability channel → read by the second source. Symmetric by construction.

## Duration decrement on the skipped turn — VERIFIED it is NOT bypassed

The Post-Turn decrement runs AFTER all kind-branches and AFTER `drainIntents()`/`drainEnemyIntents()` (relocate by `// Post Turn (combat-system.md section 4)`):

```
const debuffResult = isDummyEnemy
    ? statusEngine.decrementEnemy()          // sentinel '__enemy__' store
    : statusEngine.decrementEnemy(actor.id); // per-actor debuff store
```

Stasis lives in the victim's per-actor enemy-debuff store (timed ability channel keyed by `actor.id`). `decrementEnemy(actor.id)` ticks it down on the victim's OWN Post-Turn. Because the in-body action guard sits ABOVE this line (inside the kind-branch) and does NOT `continue` the loop, `decrementEnemy(actor.id)` ALWAYS runs on a skipped turn → Stasis decrements → duration N skips exactly N scheduled actions, and the actor acts again on turn N+1. `decrementPlayer(actor.id)` (self-buff store, one line above) also always runs → other timed statuses tick too (§2 locked rule). **The guard must NOT short-circuit the loop iteration — confirm in review that no guard adds a `continue` that jumps over the decrement.**

## DoT-tick prologue runs on the skipped turn — VERIFIED

Two DoT-tick sites sit OUTSIDE (above) the action branches and are never gated:
- **Heal-target DoT tick** (relocate by `if (healTarget && actor.id === healTarget.id) {` after the `turn-started` emit): a stasised heal target still takes its DoTs.
- **Dummy-enemy DoT tick** (the `actor.id === enemy.id` branch): `tickDoTs`/`processBombs`/`processAccumulators` — not an action, not gated.

The B2 guard wraps ONLY the `runPlayerTurn`-driven action + apply + credit, leaving every DoT path untouched.

---

## Task 0 — Pre-flight: pin current behavior (no code change)

- [ ] Run `npx vitest run` — confirm all green; record the count (expect ~2500).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run audit:skills` — confirm clean / 0 warnings / 0/141.
- [ ] Confirm B1 landed: `grep -n "victimEnemyModifiers\|tgt.id !== enemy.id" src/utils/combat/engine.ts`; `grep -n "victimEnemyBuffs\|ownerDebuffNamesFor\|ownerDebuffNames" src/utils/combat/{triggers,engine}.ts`.
- [ ] Confirm NO existing fixture lands a Stasis debuff: `grep -rn "inflicts Stasis\|buffName: 'Stasis'\|'Stasis'" src/utils/combat/__tests__/ src/utils/calculators/__tests__/` — confirm none route a Stasis `inflict` to a victim store and take a turn (verified during planning: none do). This is the golden invariant's foundation.
- [ ] No commit. If anything is red at baseline, STOP and report.

---

## Task 1 — `stasisBuffs.ts` leaf module (`STASIS_BUFFS` + `isStasis`)

Pure leaf module, mirrors `barrierBuffs.ts`/`cheatDeathBuffs.ts`. Zero engine wiring → goldens byte-identical.

**Files:** Create `src/utils/combat/stasisBuffs.ts`; Create `src/utils/combat/__tests__/stasisBuffs.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/utils/combat/__tests__/stasisBuffs.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { STASIS_BUFFS, isStasis } from '../stasisBuffs';

describe('stasisBuffs — Stasis status model (B2)', () => {
    it('STASIS_BUFFS contains exactly the bare "Stasis" name', () => {
        expect(STASIS_BUFFS.has('Stasis')).toBe(true);
        expect(STASIS_BUFFS.size).toBe(1);
    });
    it('isStasis recognizes "Stasis"', () => {
        expect(isStasis('Stasis')).toBe(true);
    });
    it('isStasis rejects non-Stasis names (no numeral variants exist)', () => {
        expect(isStasis('Stasis I')).toBe(false);
        expect(isStasis('Stasis II')).toBe(false);
        expect(isStasis('Disable')).toBe(false);
        expect(isStasis('Defense Down')).toBe(false);
        expect(isStasis('')).toBe(false);
    });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run stasisBuffs` → FAIL (module absent).
- [ ] **Step 3: Minimal implementation** (`src/utils/combat/stasisBuffs.ts`):

```ts
/** Named debuffs that mean STASIS — the game's only true turn-skip control. While a unit
 *  carries an active Stasis status it cannot take its scheduled ACTION (active/charged skill
 *  + attack); the unit's DoTs still tick on it and all its timed statuses (Stasis included)
 *  still decrement on the skipped turn, so duration N skips exactly N scheduled actions.
 *  Recognized by the engine's turn-loop action gate (`isStasised`); carried as a timed
 *  debuff in the victim's per-actor enemy-debuff store (decrements via decrementEnemy(id)).
 *  Stasis carries NO stat payload (empty parsedEffects) — duration is parsed from "for N
 *  turns", NOT from the name, so there are no "Stasis I/II" variants. Extend from game data
 *  as identified. */
export const STASIS_BUFFS: ReadonlySet<string> = new Set(['Stasis']);

/** True iff `buffName` is a Stasis turn-skip control. */
export function isStasis(buffName: string): boolean {
    return STASIS_BUFFS.has(buffName);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run stasisBuffs` → PASS.
- [ ] **Step 5: Full gate** — `npx vitest run` && `npm run lint` && `npx tsc --noEmit` && `npm run audit:skills`. Pure addition, no importers → byte-identical.
- [ ] **Step 6: Commit** — `B2 Task 1: add stasisBuffs.ts leaf module (STASIS_BUFFS + isStasis)`.

---

## Task 2 — Engine-local `isStasised(actorId)` reader (unwired)

Add the reader inside `runCombat`, reusing the existing `ownerDebuffNames(ownerId)` wrapper. Defined-but-unconsumed by any turn gate → byte-identical. Expose it through a test tap (mirror B1's `__testTapVictimEnemyModifiers`) so a unit test can assert it reads the right per-victim store for BOTH directions before any turn-skip wiring exists.

**Files:** Modify `src/utils/combat/engine.ts` (import `isStasis`; add `isStasised` closure + tap; add `CombatEngineInput` tap field); Create `src/utils/combat/__tests__/isStasised.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/utils/combat/__tests__/isStasised.test.ts`) — mirror `twoTeamBattle.test.ts`'s harness (reuse its `ab`/`basicAttack`/`parsedTarget`/`basePattern`/`teamAttackerAt`/`offensiveEnemyAt`/`battle`/`run` builders + the `stasisInflictAttack(N)` builder defined in Task 3 Step 1). Two cases:
  - **(a) enemy stasised by a player:** focus (position `M4`, target `front`) with `shipSkills.slots=[stasisInflictAttack(2)]` vs 2 positioned enemies. Via the tap assert `isStasised('enemy-front')===true` and `isStasised('enemy-back')===false`.
  - **(b) player stasised by an enemy:** an `offensiveEnemyAt` whose `shipSkills` is `stasisInflictAttack(2)` targeting `front` (the focus). Assert `isStasised('attacker')===true` and a non-targeted player `===false`.

  Capture the live `isStasised` via `__testTapIsStasised`. **Confirm the tap-invocation timing against `victimEnemyModifiers.test.ts`** (B1's precedent) and replicate it — the status store is live during the run, so match how that test captures-then-asserts. Use `numRounds: 2` + duration `2` so Stasis is still present at assert time. The goal of THIS test is only to prove `isStasised` reads the correct per-victim store for both directions; the full skip behavior is Task 3. If clean post-run assertion is awkward, assert `isStasised` at a fixed round via the tap; do NOT weaken Task 3's assertions.

- [ ] **Step 2: Run, verify fail** — `npx vitest run isStasised` → FAIL (tap/field absent).
- [ ] **Step 3: Minimal implementation** in `engine.ts`:
  - Add to the leaf-module import group (near the `barrierBuffs`/`cheatDeathBuffs` imports): `import { isStasis } from './stasisBuffs';`
  - Add the closure immediately after the existing `ownerDebuffNames` closure (relocate by `const ownerDebuffNames = (ownerId: string): string[] =>`):

```ts
// B2: an actor is STASISED iff its per-actor debuff store carries an active Stasis status.
// Reads the SAME three per-victim sources as ownerDebuffNames (snapshot enemy-debuffs +
// timed + active ability statuses, all keyed by actor.id), so it is direction-agnostic:
// a player stasised by an enemy AND an enemy stasised by a player both land Stasis in the
// victim's own id-keyed store (B1 routing) and are read identically here.
const isStasised = (actorId: string): boolean => ownerDebuffNames(actorId).some(isStasis);
```

  - Add the tap adjacent to the existing `input.__testTapVictimEnemyModifiers?.(...)` call: `input.__testTapIsStasised?.(isStasised);`
  - Add the tap field to `CombatEngineInput` adjacent to `__testTapVictimEnemyModifiers?:` (mirror its doc comment):

```ts
/** TEST TAP (inert in production): exposes the engine-local isStasised(actorId) reader so a
 *  test can assert per-victim Stasis detection for both directions. Mirrors
 *  __testTapVictimEnemyModifiers. Never set by production callers. */
__testTapIsStasised?: (fn: (actorId: string) => boolean) => void;
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run isStasised` → PASS.
- [ ] **Step 5: Full gate.** `isStasised` consumed only by the test tap → all goldens byte-identical. Confirm green, lint/tsc/audit clean.
- [ ] **Step 6: Commit** — `B2 Task 2: add engine isStasised per-victim reader (unwired) + test tap`.

---

## Task 3 — Action-only turn-skip wiring + full B2 behavioral test surface

Wire the `!isStasised(actor.id)` guard around the ACTION body of the three action branches (`attacker`, walked-`team`, real-`enemy`), leaving the DoT-tick prologue and Post-Turn decrement intact. The dummy-`enemy` branch (`actor.id === enemy.id`) is NOT gated. High-risk: the gate must skip ONLY the action.

**Files:** Modify `src/utils/combat/engine.ts` (three branch bodies); Create `src/utils/combat/__tests__/stasis.test.ts`.

### Step 1: Write the failing behavioral test (`src/utils/combat/__tests__/stasis.test.ts`)
Mirror `twoTeamBattle.test.ts` wholesale (copy its builders). Add the Stasis-inflict slot builder (also carries a damage ability so a NON-stasised turn is observable as a firing hit):

```ts
// A skill slot that inflicts Stasis for N turns AND deals a basic hit. The Stasis debuff
// ability registers as a timed enemy status (engine registration loop: type 'debuff',
// target 'enemy', application 'inflict', duration N), rides the inflict landing roll, and
// lands on the resolved victim's per-actor store keyed by targetId (B1). The damage ability
// gives the actor a firing hit so a NON-stasised turn is observable.
const stasisInflictAttack = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff', buffName: 'Stasis', application: 'inflict', duration: turns,
                stacks: 1, isStackable: false, parsedEffects: {},
            },
        }),
    ],
});
```

> IMPLEMENTER NOTE: confirm the exact `debuff` `config` shape against `src/types/abilities.ts` and B1's registration loop (relocate the loop that reads `cfg.application`/`cfg.duration`/`cfg.parsedEffects`). Confirm Stasis `inflict` lands deterministically: these fixtures use `enemyDefense:0`/`defence:0`, no security → the `liveDebuffLandingChance` neutral default lands it. If Stasis does NOT land, set hacking/security to force 100% (mirror twoTeamBattle landing setups).

Tests (fill in concrete builders/assertions against the live engine, mirroring how `twoTeamBattle.test.ts`/`barrier.test.ts` read `ability-performed` by `actorId`, `RoundData.perTargetDamage` by victim id, `dot-ticked`/`buff-expired` events, and the `__testTapIsStasised` capture). **Do NOT weaken assertions.**

- [ ] **(i) skips the action:** a stasised positioned actor deals NO damage / fires no `ability-performed` on the skipped turn.
- [ ] **(ii) DoTs still tick:** apply a corrosion/inferno DoT to the stasised victim, then Stasis it; assert a `dot-ticked` (or HP decline) for the victim still fires on the skipped turn (DoT prologue runs above the gate). Cleanest harness: `barrier.test.ts` healing shape (enemy attackers DoT the heal target) + Stasis on the heal target, OR a positioned enemy carrying a DoT.
- [ ] **(iii) Stasis decrements on the skipped turn:** inflict Stasis(2) ONCE; via `__testTapIsStasised` assert stasised on turns 1 and 2, NOT on turn 3, and the actor's action fires on turn 3.
- [ ] **(iv) other timed statuses still tick:** land a second timed debuff (e.g. 2-turn Defense Down) on the same victim alongside Stasis; assert it expires on schedule (`buff-expired`) even though the victim never acted — proving `decrementEnemy(actor.id)` ran on the skip.
- [ ] **(v) non-stasised actor unaffected:** same battle, no Stasis → acting actor fires/deals normal damage every round.
- [ ] **(vi) symmetry — player stasised by an enemy:** an `offensiveEnemyAt` with `stasisInflictAttack(2)` targeting the focus; assert the focus deals no firing damage on the stasised turn AND the round still assembles (focus-synthesis path exercised).

> For "exactly N turns": prefer inflicting Stasis ONCE (round 1 only — e.g. give later rounds a non-Stasis skill or gate the inflict to round 1) so the decrement is observable; if re-applied every round, assert the decrement directly via `__testTapIsStasised` (test iii) and assert "skipped while stasised" for the symmetry tests.

### Step 2: Run, verify fail — `npx vitest run stasis` → FAIL (no gate yet: stasised actor still acts).

### Step 3: Minimal implementation — the three in-body guards

**(a) Attacker branch** — relocate by `if (actor.kind === 'attacker') {`. Wrap the ENTIRE action body in `if (!isStasised(actor.id)) { …existing body… } else { …synthesize focus turn when focus… }`:

```ts
if (actor.kind === 'attacker') {
    if (!isStasised(actor.id)) {
        // ── existing attacker action body, UNCHANGED ──
        // … runPlayerTurn, positional apply, credit, focusTurns.push(turn),
        //   healTargetBuffs, lastTurnCtxByActor.set, processExtraActionGrants …
    } else {
        // B2: STASIS skip — the focus attacker skips its ACTION (no runPlayerTurn, no damage,
        // no extra-action grants). DoT-tick prologue (above) and Post-Turn decrement (below)
        // STILL run — the §4.3 deviation from handleDeadTargetSkip (which skips the whole body).
        // The focus actor MUST still contribute a focusTurns entry or the round-end
        // `if (!focusTurns.length) throw` fires; synthesize a minimal no-action turn exactly as
        // handleDeadTargetSkip does for a dead focus (sourceFired NOT set — it did not act).
        if (actor.id === focusActorId) {
            // COPY the synthesized focus-turn object VERBATIM from handleDeadTargetSkip's
            // focusTurns.push({...}) — do not hand-retype field names (PlayerTurnResult shape).
        }
    }
}
```

> IMPLEMENTER NOTE: copy the synthesized-turn object VERBATIM from `handleDeadTargetSkip` (relocate by the `focusTurns.push({` inside it) so the field set matches exactly. OPTIONAL cleanup: extract a `synthesizeSkippedFocusTurn()` local shared by both sites IF it stays byte-identical and keeps the gate readable; else duplicate with a comment pointing at the source. (handleDeadTargetSkip's synthesized turn carries the entering-round `enemyHpPct` + last-known ctx and an empty action — replicate its exact values.)

**(b) Walked-team branch** — relocate by `} else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {`. Wrap the action body in `if (!isStasised(actor.id)) { … }`. **No else** — a walked team actor is never the focus, so it contributes no `focusTurns` entry:

```ts
} else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {
    if (!isStasised(actor.id)) {
        // ── existing walked-team action body, UNCHANGED ──
    }
    // B2: a stasised walked-team actor skips its action (no runPlayerTurn, no team-damage
    // credit, no extras). Never the focus → no synthesis. DoT-tick prologue + decrement still run.
}
```

**(c) Real-enemy branch** — relocate by `} else if (actor.kind === 'enemy') {` (the LAST branch, NOT the `actor.id === enemy.id` dummy). Wrap its action body in `if (!isStasised(actor.id)) { … }`:

```ts
} else if (actor.kind === 'enemy') {
    if (!isStasised(actor.id)) {
        // ── existing enemy-attacker action body, UNCHANGED ──
    }
    // B2: a stasised enemy attacker skips its action (no attack, no debuffs/DoTs applied, no
    // intake on the player victim, no extras, NO charge banked — Stasis: "Charge skill charges
    // do not generate"). Its own DoT-tick prologue + Post-Turn decrement still run.
}
```

> IMPLEMENTER NOTE (charge banking): skipping the whole action body (where the charge/cadence step runs) correctly banks NO charge for a stasised actor (matches the in-game Stasis text). DO NOT add a cadence-advance in the skip path. Confirm the `advanceChargeCadence(...)` dead-target cadence-only path is INSIDE the `!isStasised` block — a stasised-AND-dead actor skips everything, which is correct.

> CRITICAL — do NOT gate the dummy-enemy branch `} else if (actor.kind === 'enemy' && actor.id === enemy.id) {` (the `tickDoTs`/`processBombs`/`processAccumulators` DoT prologue). Gating it would break DoT goldens.
> CRITICAL — do NOT add any `continue`: the guards wrap branch bodies only. The loop must fall through to `drainIntents()`/`drainEnemyIntents()` and the Post-Turn `decrementPlayer`/`decrementEnemy`. (B2 leaves the drains running — a stasised actor's reactions are NOT yet suppressed; that's B3.)

### Step 4: Run, verify pass — `npx vitest run stasis` → PASS.

### Step 5: Full gate — GOLDENS MUST BE BYTE-IDENTICAL
- [ ] `npx vitest run` — all green.
- [ ] **DPS goldens byte-identical:** no DPS fixture applies Stasis → `isStasised` always false → guard always true → every action body runs unchanged.
- [ ] **Healing goldens byte-identical:** same.
- [ ] **Two-team/positional goldens (`twoTeamBattle`, `dpsSimulator` multi-actor, `positionalDamage.integration`, `positionalApply`, `positionalSelection`) byte-identical:** no fixture lands Stasis, guard never fires, synthesis else never reached. **If ANY golden moves, the gate leaked (it wrapped the DoT prologue or the decrement, or `isStasised` false-positived) — fix the gate, NEVER `vitest -u`.**
- [ ] `npm run lint && npx tsc --noEmit && npm run audit:skills` (0/141).

### Step 6: Commit — `B2 Task 3: action-only Stasis turn-skip (3 action branches gated; DoT-tick + decrement preserved)`.

---

## Task 4 — Spec close-out + holistic review

**Files:** Modify `docs/superpowers/specs/2026-06-18-stasis-design.md`.

- [ ] **Step 1:** Mark the two B2 §8 open items resolved: (a) `STASIS_BUFFS = {'Stasis'}` (confirmed against `buffs.ts` single bare entry + `docs/ship-skills.csv` bare token, duration via "for N turns"); (b) gate placement = in-body `!isStasised(actor.id)` guard per action branch (not a shared helper), with focus-attacker synthesis required (the `focusTurns.length` throw).
- [ ] **Step 2:** Update §7 to mark B2 done; note B2 deliberately leaves `drainIntents`/`drainEnemyIntents` running (no reactive suppression) and does not break Stasis on damage — both B3.
- [ ] **Step 3: Final full gate** — `npx vitest run` then `npx vitest run src/utils/combat`. Confirm green + every golden byte-identical (no `-u` anywhere in B2 history).
- [ ] **Step 4: Commit docs** — `git add -f docs/superpowers/specs/2026-06-18-stasis-design.md && git commit --no-verify -m "B2: mark §8 open items resolved (STASIS_BUFFS, gate placement)"`.
- [ ] **Step 5: Holistic review** — final holistic review (opus) over the B2 diff confirming: (i) guard wraps ONLY the action in all three branches; (ii) DoT-tick prologue + `decrementPlayer`/`decrementEnemy` outside every guard; (iii) dummy-enemy branch ungated; (iv) focus-synthesis else matches `handleDeadTargetSkip`; (v) no `continue` skips the decrement; (vi) `isStasised` reads per-victim store symmetrically; (vii) `STASIS_BUFFS = {'Stasis'}`; (viii) all goldens byte-identical.

---

## Sequencing rationale
- **Task 1** — pure leaf module, no importers → byte-identical; isolates the `STASIS_BUFFS={'Stasis'}` decision.
- **Task 2** — `isStasised` tested via tap but UNWIRED → byte-identical; proves the per-victim read is symmetric BEFORE the behavioral change.
- **Task 3** — the only behavior change: three in-body action guards + focus-turn synthesis. No golden lands Stasis → all byte-identical; `stasis.test.ts` is the sole exerciser. Any golden movement = the gate leaked.
- **Task 4** — docs + holistic review.

## Golden-invariant summary
ALL existing DPS / healing / two-team / positional goldens MUST stay byte-identical across every task. No existing fixture lands a `'Stasis'` debuff (verified Task 0), so `isStasised` is always false for them, the guard is always true, every action body runs unchanged. Any movement = the gate leaked. **Fix the gate; NEVER `vitest -u`.**

---

### Critical files
- `src/utils/combat/stasisBuffs.ts` (NEW — `STASIS_BUFFS` + `isStasis`)
- `src/utils/combat/engine.ts` (`isStasised` near `ownerDebuffNames`; three action-branch guards: `if (actor.kind === 'attacker')`, walked-team `&& teamRuntimeById.has(actor.id)`, real-enemy `} else if (actor.kind === 'enemy') {`; the dummy-enemy `&& actor.id === enemy.id` branch stays UNGATED; Post-Turn `decrementPlayer`/`decrementEnemy` + `produced no focus actor turn` throw stay outside the gate; `handleDeadTargetSkip` is the focus-synthesis template; `CombatEngineInput` tap field)
- `src/utils/combat/triggers.ts` (`ownerDebuffNamesFor` — the per-victim three-source reader `isStasised` rides on)
- `src/utils/combat/__tests__/stasis.test.ts` (NEW — B2 behavioral surface; mirror `twoTeamBattle.test.ts`/`barrier.test.ts`)
- `src/constants/buffs.ts` (the single `{ name: 'Stasis', type: 'debuff' }` entry)
