# Stasis B3 — Reactive Suppression + Direct-Damage Break + Akula Don't-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Stasis turn-skip control. B2 shipped the status model (`stasisBuffs.ts`: `STASIS_BUFFS={'Stasis'}` + `isStasis`), the engine-local `isStasised(actorId)` reader, and the action-only turn-skip. B3 adds the remaining three behaviors (spec §2/§4.4/§4.5):
1. **Reactive suppression (TOTAL lockout):** drop every queued reactive intent whose owner is stasised — on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round self-buffs (Chakara via `round-started`). Filtered in ONE place: the shared `drainQueue` loop, before `executeIntent`. Covers both `drainIntents` (player) and `drainEnemyIntents` (enemy). Incoming effects untouched.
2. **Direct-damage break (side-symmetric):** when a DIRECT-channel firing hit lands on a stasised victim, remove the Stasis status AFTER damage is applied — UNLESS the attacker carries `doesntBreakStasis` (Akula). DoT/detonation NEVER break. ANY landed direct attack breaks regardless of shield/Barrier absorb.
3. **Akula don't-break flag:** new `parseDoesntBreakStasis(text): boolean` → a `doesntBreakStasis?: boolean` flag threaded from ship data onto the attacker `CombatActor`, read at the break hook.

**Architecture:** (1) Reactive suppression = a single guard at the top of `drainQueue`'s per-intent loop, inside `runCombat` where `isStasised` is already in scope — covers all reactive types for both sides because both drains share `drainQueue`. (2) The break = a new targeted statusEngine removal API (`removeTimedEnemyStatus(targetId, buffName)`) + a `breakStasisOnDirectHit(victim, attackerId)` engine helper invoked at the DIRECT-channel apply boundary: the positional per-victim `emitHit` callback (after `applyToVictim`) and the single non-positional firing hit `applyIncomingToTarget(damage, tgt)`. DoT ticks call `applyIncomingToTarget` directly (separate call, no break) and detonation goes through `processBombs`/`creditDamage` — neither touches the break. (3) The Akula flag mirrors `ignoresForcedTargeting`'s plumbing exactly: parser → engine-input field → `createActor` → `CombatActor.doesntBreakStasis` → resolved at the hook via `allActorsById.get(attackerId)`.

**Tech Stack:** TypeScript, Vitest. Tests in `src/utils/combat/__tests__/` (extend `stasis.test.ts`) and `src/utils/__tests__/skillTextParser.test.ts`. `npx vitest run <name>` (bare `npm test` = watch, hangs). Per-task gate: `npx vitest run` && `npm run lint` (0 warnings) && `npx tsc --noEmit` && `npm run audit:skills` (0/141). **NEVER `vitest -u`.** Branch `feat/combat-sim-phase5-pr2`. Docs gitignored → `git add -f`, commit docs `--no-verify`.

**Spec:** `docs/superpowers/specs/2026-06-18-stasis-design.md` (§2, §4.4, §4.5, §7). Predecessors: `…stasis-b2-status-and-turn-skip.md`, `…stasis-b1-per-victim-modifier-sourcing.md`.

> **Line numbers are 2026-06-18 snapshots and DRIFT. RELOCATE BY SYMBOL NAME or the verbatim code string, never by raw offset.**

---

## GOLDEN INVARIANT (the gate for every task)
ALL existing DPS / healing / two-team / positional goldens MUST stay **byte-identical**:
- **Suppression:** no fixture lands Stasis (B2 Task 0 verified) → `isStasised(intent.ownerId)` always false → no intent ever dropped.
- **Break:** no fixture lands Stasis → no victim ever stasised at a direct hit → break never fires (`breakStasisOnDirectHit` early-returns on `!isStasised`).
- **Akula flag:** `parseDoesntBreakStasis` flips a boolean only on 2 ships (the don't-break ships) that do NOT appear in any golden. `audit:skills` stays 0/141.
If ANY golden moves, the gate leaked — fix the gate, NEVER `vitest -u`.

---

## Investigation findings (verified against live code — trust these anchors)

### Reactive suppression — the single drain site
- `drainQueue(queue, sideCtx)` is defined INSIDE `runCombat` (~engine.ts:2777). Its per-generation loop is `for (const intent of batch) { executeIntent(intent, {...}); }` (~2788). ONE place to filter.
- Both drains route through it: `drainIntents` (player) and `drainEnemyIntents` (enemy) both call `drainQueue`. A guard here covers BOTH sides.
- `Intent.ownerId` EXISTS (triggers.ts:84), set on every enqueued intent (triggers.ts:217). All reactive types carry it incl. **start-of-round** (`round-started` → `enqueue(intent)`) → the single filter catches Chakara's start-of-round self-buff.
- `isStasised(actorId)` (engine.ts:1658) is in scope at the `drainQueue` site.
- **Dropping an intent is clean:** listeners ONLY enqueue (pure, no state mutation); `executeIntent` is where all mutation happens. Skipping `executeIntent` leaves NO partial state; generation/`MAX_INTENT_GENERATIONS` machinery unaffected.

### Break mechanism — storage + the removal API to add
- Stasis lands as a timed debuff in the victim's per-actor enemy store via `applyTimedAbilityStatus(round, status, recipientId, enemyTargetId)` → `getEnemyMap(targetId)` keyed by `deriveFamilyKey('Stasis').familyKey` = `'Stasis'` (bare name, no roman suffix; statusEngine.ts:213).
- **No targeted-removal API exists.** `clearRemovable(id)` sweeps ALL removable entries (too broad — would wipe co-applied Defense Down). So **add** `removeTimedEnemyStatus(targetId, buffName)` deleting exactly the `deriveFamilyKey(buffName).familyKey` entry from `enemyMaps.get(targetId)`. Lazy-empty map → safe no-op.

### The two apply sites + the DIRECT-channel boundary
- `applyIncomingToTarget(damage, victim=healTarget!)` (engine.ts:2374) and `applyOutgoingToEnemy(damage, enemyVictim)` (engine.ts:2393) are thin wrappers over `applyVictimDamage(damage, victim, sink)`. Victim id = `victim.id`.
- `applyVictimDamage` gets NO channel/attacker. DoT damage on the heal target ALSO flows through `applyIncomingToTarget(tankDotDamage)` (engine.ts:3052) — so the break CANNOT live inside `applyVictimDamage`/`applyIncomingToTarget` unconditionally (would wrongly break on DoT).
- **DIRECT-channel boundary = `TurnBindings.applyToVictim`** (player→enemy `(victim,damage)=>applyOutgoingToEnemy(damage,victim)`; enemy→player `(victim,damage)=>applyIncomingToTarget(damage,victim)`) **plus the single non-positional firing hit** `applyIncomingToTarget(damage, tgt)` (engine.ts:3626, enemy branch).
  - Positional firing hit calls `applyToVictim(victim, dmg)` per victim inside `applyPositionalDamage` (positionalApply.ts:133), driven via `drivePositionalApply` from all three action branches, each passing `actingId: actor.id`. The per-victim `emitHit(victim, damage)` callback (positionalApply.ts:134) runs RIGHT AFTER `applyToVictim` — the clean per-direct-hit seam.
  - DoT ticks (3052) and detonation (`processBombs`/`creditDamage(…, 'detonation', …)`) NEVER call `applyToVictim`/`applyPositionalDamage` → never break. Confirmed.
- **Both directions reached in two-team sim.** The break helper is team-agnostic (keyed by victim id + attacker id).
- **Reactive direct damage (Grif) OUT of scope:** `creditReactiveDamage` (triggers.ts:1139) only credits a damage map (accounting approximation) — never routes through `applyVictimDamage`/`applyToVictim`, never mutates victim HP or a victim store → never triggers the break. Matches spec §4.5. Do NOT add a break there; document the boundary.

### Attacker-flag plumbing (mirrors `ignoresForcedTargeting` exactly)
- `CombatActor` (state.ts:99) carries `ignoresForcedTargeting?: boolean`; `createActor` threads it; the 3 `createActor` sites read it from inputs (focus `input.*` ~1165, team `t.*` ~1238, enemy `e.*` ~470); the 3 engine-input interfaces declare it (~374 + others). `doesntBreakStasis` follows the IDENTICAL path.
- **Resolved at the hook by id:** `allActorsById` (engine.ts:1639) maps id → `CombatActor`, in scope at all apply sites. Helper takes `attackerId`, reads `allActorsById.get(attackerId)?.doesntBreakStasis`.
- **Parser landing:** `parseDoesntBreakStasis` in `skillTextParser.ts` (near `parseNoCrit`); attach a ship-level `doesntBreakStasis?: boolean` to `ShipSkills` (types/abilities.ts:279), set it in `buildShipAbilities`, thread into the engine-input field in the adapter that builds inputs from `buildShipAbilities` output. (If no production adapter currently populates `ignoresForcedTargeting`, the test surface drives the flag via the input field directly and the parser + `ShipSkills` flag are unit-tested standalone — production wiring is then a one-line adapter read.)

### Second don't-break ship's OTHER clauses stay OUT of scope (CONFIRMED)
- ships.ts:2529/2531: `"...do not break Stasis and deal 20% more damage to enemies under Stasis or Disable."` + `"...After dealing damage to an enemy affected by stasis once per round, this unit is granted one extra action."`
- The "extra action after damaging a stasised enemy" is ALREADY parsed by `parseExtraAction`; the "+20% damage vs stasised" is a separate unparsed concern. The new regex `/\b(?:don'?t|does not|doesn'?t)\s+break\s+stasis\b/i` matches ONLY "do/don't/does not break stasis" — NOT "affected by stasis", "extra action", or "deal 20% more damage". Parser test asserts the negatives explicitly.

---

## Task 0 — Pre-flight (no code change)
- [ ] `npx vitest run` — all green; record count (expect ~2511).
- [ ] `npm run lint && npx tsc --noEmit && npm run audit:skills` — clean / 0 / 0/141.
- [ ] Confirm B2 shipped: `grep -n "const isStasised" src/utils/combat/engine.ts`; `grep -c "it(" src/utils/combat/__tests__/stasis.test.ts` (expect 6).
- [ ] Confirm drain site: `grep -n "const drainQueue\|for (const intent of batch)\|executeIntent(intent" src/utils/combat/engine.ts`.
- [ ] Confirm apply boundary: `grep -n "applyToVictim: (victim, damage)\|emitHit:\|applyIncomingToTarget(damage, tgt)" src/utils/combat/engine.ts`.
- [ ] Confirm NO existing fixture lands Stasis: `grep -rn "buffName: 'Stasis'\|inflicts Stasis\|'Stasis'" src/utils/combat/__tests__/ src/utils/calculators/__tests__/` — only stasis/isStasised/stasisBuffs tests match.
- [ ] No commit. If red at baseline, STOP.

---

## Task 1 — Reactive suppression (total lockout) at the drain

**Files:** Modify `src/utils/combat/engine.ts` (one guard in `drainQueue`); extend `src/utils/combat/__tests__/stasis.test.ts`.

### Step 1: Write failing tests (extend `stasis.test.ts`, new `describe('B3 — reactive suppression', …)`)
Reuse the existing harness + add a reactive-skill builder (on-attacked counter; start-of-round self-buff). Do NOT weaken:
- [ ] **(a) on-attacked counter suppressed while stasised:** victim with an `on-attacked` reactive counter; Stasis it, attack it → assert NO counter fires (no `ability-performed` for the stasised owner, no reactive damage credited) on the stasised turn.
- [ ] **(b) start-of-round self-buff (Chakara) suppressed:** stasised ship with a `start-of-round`/`round-started` self-buff grant → assert the self-buff is NOT applied while stasised. (Confirm the exact trigger string against `detectReactiveTrigger`/triggers.ts.)
- [ ] **(c) incoming effects UNTOUCHED:** an ally heal/buff (or DoT tick) on the stasised victim STILL applies. (Reuse barrier.test.ts healing shape if cleaner.)
- [ ] **(d) non-stasised owner unaffected:** same battle, no Stasis → the reactive fires normally.

### Step 2: Run, verify fail — `npx vitest run stasis` → suppression cases FAIL.

### Step 3: Implement — the drain-time guard
In `drainQueue`'s loop (relocate by `for (const intent of batch) {` preceding `executeIntent(intent, {`), add as the FIRST loop statement:
```ts
// §4.4 STASIS reactive suppression (B3): a stasised unit's reactives are FULLY locked out.
// Drop every queued intent whose OWNER is currently stasised — on-attacked, on-ally-attacked,
// on-crit, on-enemy-destroyed, AND start-of-round self-buffs (Chakara via round-started) all
// carry intent.ownerId, so this ONE filter covers every reactive type for BOTH sides
// (drainIntents and drainEnemyIntents share this drainQueue). Filtered at the DRAIN, before
// executeIntent. Listeners only ENQUEUE (pure), so dropping an intent leaves NO partial state.
// Incoming effects (damage/heals/ally buffs/DoT ticks) are UNTOUCHED — only the stasised
// unit's OWN outgoing intents drop.
if (isStasised(intent.ownerId)) continue;
```
> CRITICAL: `continue` skips ONLY this intent's `executeIntent`; it does NOT exit the loop or skip the Post-Turn decrement (which runs OUTSIDE `drainQueue`). `MAX_INTENT_GENERATIONS` machinery unaffected.

### Step 4: Run, verify pass — `npx vitest run stasis` → PASS.
### Step 5: Full gate — GOLDENS BYTE-IDENTICAL (no fixture lands Stasis → filter never fires). `npm run lint && npx tsc --noEmit && npm run audit:skills` (0/141). If any golden moves, the gate leaked — fix it, NEVER `-u`.
### Step 6: Commit — `B3 Task 1: drain-time reactive suppression for stasised owners (both sides, one filter)`.

---

## Task 2 — Targeted Stasis-removal API + direct-damage break hook (side-symmetric)

The Akula flag is wired in Task 3 — in Task 2 the break ALWAYS fires on a direct hit (a `void attackerId` placeholder); Task 3 adds the exception.

**Files:** Modify `src/utils/combat/statusEngine.ts` (method + interface); Modify `src/utils/combat/engine.ts` (helper + call sites); extend `stasis.test.ts` + a statusEngine unit test.

### Task 2a — `removeTimedEnemyStatus`
- [ ] **Failing test** (locate the nearest existing statusEngine unit test and extend/mirror it): `beginRound(1)`, apply a Stasis timed status to `'victim-1'` PLUS a co-applied `Defense Down`, then `removeTimedEnemyStatus('victim-1','Stasis')` → assert `timedAbilityStatuses('enemy', undefined, 'victim-1')` no longer has `'Stasis'` but STILL has `'Defense Down'` (targeted, not a sweep); unknown id/name → safe no-op.
- [ ] **Run, verify FAIL.**
- [ ] **Implement** in `statusEngine.ts` near `clearRemovable` (relocate by `const clearRemovable = (id: string): void => {`):
```ts
/** Remove a SINGLE named timed enemy status from `targetId`'s per-actor enemy store (the
 *  channel applyTimedAbilityStatus writes, keyed by familyKey). Targeted — unlike
 *  clearRemovable's broad sweep, deletes ONLY the named family, preserving co-applied
 *  debuffs on the same victim. Used by the engine's §4.5 direct-damage Stasis break.
 *  Lazy-empty / unknown id / unknown name → safe no-op. */
const removeTimedEnemyStatus = (targetId: string, buffName: string): void => {
    const map = enemyMaps.get(targetId);
    if (!map) return;
    map.delete(deriveFamilyKey(buffName).familyKey);
};
```
  Add `removeTimedEnemyStatus` to the returned object (relocate by the `return {` listing `clearRemovable`) and to the `StatusEngine` interface (sibling of `clearRemovable(id: string): void;`).
- [ ] **Run, verify PASS.** Full gate (byte-identical — unused in production yet). Commit — `B3 Task 2a: add removeTimedEnemyStatus targeted enemy-status removal API`.

### Task 2b — break hook + wire the direct-hit sites
- [ ] **Failing tests** (extend `stasis.test.ts`, `describe('B3 — direct-damage break', …)`). Do NOT weaken:
  - **(i) direct hit breaks Stasis:** Stasis(2) a victim, land a DIRECT firing hit → assert NO LONGER stasised after (via `__testTapIsStasised` or it acts next turn instead of skipping the full 2).
  - **(ii) DoT does NOT break:** Stasis(2) + a DoT, let the DoT tick (no direct hit) → assert STAYS stasised (channel discrimination).
  - **(iii) breaking hit's on-attacked reaction stays suppressed:** victim has an on-attacked counter AND is stasised; land the breaking hit → assert NO counter on the breaking hit (drain filtered it while still stasised; removal is AFTER apply). Must hold with NO explicit ordering code.
  - **(iv) LIVING-applier (B2 gap):** an applier that SURVIVES Stasises a victim; a later DIFFERENT direct hit breaks it → victim acts next scheduled turn.
  - **(v) any-direct-attack-breaks-regardless-of-absorb:** Stasis a victim with a shield pool and/or active Barrier (full absorb, 0 HP loss); land a direct hit fully absorbed → assert Stasis STILL breaks. (Reuse barrier.test.ts shield/Barrier harness.)
  - **(vi) symmetry:** one player→enemy break (`applyOutgoingToEnemy` path) + one enemy→player break (`applyIncomingToTarget`/non-positional path).
- [ ] **Run, verify FAIL.**
- [ ] **Implement the helper** in `engine.ts` near the apply wrappers (relocate by `const applyOutgoingToEnemy = (`). Task 2 = unconditional break; Task 3 activates the exception:
```ts
// §4.5 STASIS direct-damage break (B3). Called by the DIRECT-channel apply boundary AFTER
// damage is applied. If the victim is stasised, remove the Stasis status — freeing the unit
// early. ANY landed direct attack breaks it regardless of shield/Barrier absorb (about the
// attack connecting, not HP loss). DoT/detonation never call this. Side-symmetric (keyed by
// victim id). (Task 3 adds the Akula doesntBreakStasis exception via allActorsById.)
const breakStasisOnDirectHit = (victim: CombatActor, attackerId: string): void => {
    if (!isStasised(victim.id)) return;
    // Task 3: if (allActorsById.get(attackerId)?.doesntBreakStasis) return;
    void attackerId;
    for (const name of STASIS_BUFFS) statusEngine.removeTimedEnemyStatus(victim.id, name);
};
```
  Add `STASIS_BUFFS` to the existing `./stasisBuffs` import (B2 imports `isStasis`).
- [ ] **Wire the positional sites** via `drivePositionalApply`'s `emitHit` wrapper (relocate by `emitHit: (victim, damage) => {` inside `drivePositionalApply`; `args.actingId` in scope). Add after the `roundPerTargetDamage.set(...)`:
```ts
// §4.5: a positional firing hit is DIRECT-channel → break the victim's Stasis (after damage;
// emitHit runs right after applyToVictim per victim).
breakStasisOnDirectHit(victim, args.actingId);
```
- [ ] **Wire the non-positional firing hit** (relocate by `({ shieldBefore, hpDamage, barriered } = applyIncomingToTarget(`, engine.ts ~3626, `actor` in scope). Immediately after:
```ts
// §4.5: the non-positional firing hit is DIRECT-channel → break the victim's Stasis.
breakStasisOnDirectHit(tgt, actor.id);
```
- [ ] **Enumerate every production call** of `applyOutgoingToEnemy`/`applyIncomingToTarget` (`grep -n "applyOutgoingToEnemy(\|applyIncomingToTarget("`) and classify each as firing-direct (gets the break — but positional ones are covered by `emitHit`, so only the non-positional firing hit needs an explicit call), DoT (3052 — EXCLUDED), or positional-driven. Document the classification in the commit. If a distinct non-positional player→enemy firing hit exists, add `breakStasisOnDirectHit(victim, actor.id)` after it too (dummy `enemy` never stasised in goldens → byte-identical regardless).
- [ ] **Run, verify PASS.** Full gate — GOLDENS BYTE-IDENTICAL (no golden lands Stasis → helper early-returns). If any moves, the break fired on a non-firing/DoT path — fix the gate, NEVER `-u`. Commit — `B3 Task 2b: side-symmetric direct-damage Stasis break (positional emitHit + non-positional firing hit; DoT/detonation excluded)`.

---

## Task 3 — `parseDoesntBreakStasis` + Akula flag plumbing + activate the exception

**Files:** `src/utils/skillTextParser.ts` (+ its test `src/utils/__tests__/skillTextParser.test.ts`); `src/utils/combat/state.ts`; `src/utils/combat/engine.ts`; `src/types/abilities.ts` + `src/utils/abilities/buildShipAbilities.ts` (+ its test) + the input-building adapter; extend `stasis.test.ts`.

### Task 3a — parser
- [ ] **Failing test** (`skillTextParser.test.ts`, `describe('parseDoesntBreakStasis', …)`, mirror `parseNoCrit`): matches Akula `"...attacks don't break Stasis..."` → true; matches the second ship `"...do not break Stasis and deal 20% more damage..."` → true; **negatives:** `"...affected by Stasis ... extra action"` → false, `"deal 20% more damage to enemies under Stasis"` → false, `"inflicts Stasis for 2 turns"` → false, ``/null/undefined → false.
- [ ] **Run, verify FAIL.**
- [ ] **Implement** near `parseNoCrit`:
```ts
const DOESNT_BREAK_STASIS_RE = /\b(?:don['’]?t|does not|doesn['’]?t)\s+break\s+stasis\b/i;
/** True iff this skill text declares the unit's attacks don't break Stasis (Akula + the second
 *  don't-break ship). Boolean only — the second ship's other clauses (extra-action,
 *  +damage-vs-stasised) are parsed elsewhere and untouched here. */
export function parseDoesntBreakStasis(text: string | null | undefined): boolean {
    if (!text) return false;
    return DOESNT_BREAK_STASIS_RE.test(text);
}
```
  (The `['’]?` tolerates straight/curly apostrophes; test both forms.)
- [ ] **Run, verify PASS.** Full gate. Commit — `B3 Task 3a: add parseDoesntBreakStasis (matches don't-break-stasis clause only)`.

### Task 3b — thread `doesntBreakStasis` onto `CombatActor`
- [ ] `src/utils/combat/state.ts`: add `doesntBreakStasis?: boolean` to `CombatActor` (after `ignoresForcedTargeting`), to the `createActor` partial, and `doesntBreakStasis: partial.doesntBreakStasis,` to the returned object (mirror `ignoresForcedTargeting` at both spots).
- [ ] `src/utils/combat/engine.ts`: add `doesntBreakStasis?: boolean` to the THREE engine-input interfaces (relocate each by its `ignoresForcedTargeting?: boolean;`); at the THREE `createActor` sites add `doesntBreakStasis: <source>,` next to `ignoresForcedTargeting`: focus `input.doesntBreakStasis`, team `t.doesntBreakStasis`, enemy `e.doesntBreakStasis`.
- [ ] Pure additions (optional, undefined for existing inputs) → byte-identical. Full gate. Commit — `B3 Task 3b: thread doesntBreakStasis from engine inputs onto CombatActor`.

### Task 3c — activate the exception + production wiring + tests
- [ ] In `breakStasisOnDirectHit`, replace `void attackerId;` with: `if (allActorsById.get(attackerId)?.doesntBreakStasis) return;`
- [ ] `src/types/abilities.ts`: add `doesntBreakStasis?: boolean;` to `ShipSkills` (jsdoc).
- [ ] `src/utils/abilities/buildShipAbilities.ts`: in `buildShipAbilities(ship)`, OR `parseDoesntBreakStasis` over the ship's skill-row texts and set it on the returned `ShipSkills`. Add a `buildShipAbilities.test.ts` case: the 2 don't-break ships → true, an unrelated ship → false.
- [ ] Thread `ShipSkills.doesntBreakStasis` into the engine-input field in the adapter that builds inputs from `buildShipAbilities` output (mirror wherever `ignoresForcedTargeting`/`shipSkills` flow). If no adapter populates `ignoresForcedTargeting`, add the single read at the focus/team/enemy input-construction site.
- [ ] **Failing tests** (extend `stasis.test.ts`, `describe("B3 — Akula don't-break", …)`): Akula direct hit does NOT break (drive `doesntBreakStasis: true` via the engine-input field) → victim stays stasised full duration, action stays skipped. Control: same fixture WITHOUT the flag DOES break (the flag is the discriminator).
- [ ] **Run** → FAIL before activation, PASS after.
- [ ] Full gate — GOLDENS BYTE-IDENTICAL + **`audit:skills` 0/141** (the new parser must not regress auditing; the 2 flagged ships don't appear in goldens). `npm run lint && npx tsc --noEmit`. Commit — `B3 Task 3c: wire Akula doesntBreakStasis flag (parser → ShipSkills → input → CombatActor → break hook)`.

---

## Task 4 — Spec close-out + holistic review
**Files:** `docs/superpowers/specs/2026-06-18-stasis-design.md`.
- [ ] Mark §7 B3 done; record the resolved decisions (single `drainQueue` `continue` filter; targeted `removeTimedEnemyStatus` via `breakStasisOnDirectHit` at the positional `emitHit` + non-positional firing hit, DoT/detonation/reactive-damage excluded; Akula flag mirrors `ignoresForcedTargeting`; second ship's other clauses untouched).
- [ ] Final full gate — `npx vitest run` then `npx vitest run src/utils/combat`; every golden byte-identical; `audit:skills` 0/141.
- [ ] Commit docs — `git add -f docs/... && git commit --no-verify -m "B3: mark §7 done; record suppression/break/flag design decisions"`.
- [ ] **Holistic review (opus)** over the full B3 diff confirming: (i) suppression is the ONLY drain change, uses `continue`; (ii) break removal is TARGETED (`removeTimedEnemyStatus`, not `clearRemovable`), fires AFTER damage; (iii) break attached to firing-direct sites ONLY (positional `emitHit` + non-positional firing hit), NOT the DoT-tick `applyIncomingToTarget(3052)` or detonation; (iv) `breakStasisOnDirectHit` side-symmetric, reached both directions; (v) breaking hit's on-attacked stays suppressed with no explicit ordering code; (vi) Akula flag threads parser → `ShipSkills` → input → `CombatActor` → hook; (vii) regex matches the don't-break clause ONLY; (viii) all goldens byte-identical, `audit:skills` 0/141.

---

## Sequencing rationale
- **Task 1** — one drain-time guard; no fixture lands Stasis → byte-identical; `stasis.test.ts` sole exerciser.
- **Task 2** — 2a (targeted API, unused → byte-identical) then 2b (break hook, gated by `isStasised` → byte-identical for non-stasised goldens; Akula exception a no-op until Task 3).
- **Task 3** — parser → `CombatActor` plumbing → activate + production wiring; each sub-step byte-identical (optional fields default undefined; flag flips only on 2 non-golden ships).
- **Task 4** — docs + holistic review.

## Critical files
- `src/utils/combat/engine.ts` (`drainQueue` suppression `continue`; `breakStasisOnDirectHit` near the apply wrappers; `drivePositionalApply.emitHit` break call; non-positional firing-hit break call ~3626; 3 input `doesntBreakStasis` fields; 3 `createActor` wirings; `isStasised`/`allActorsById`/`STASIS_BUFFS` import in scope)
- `src/utils/combat/statusEngine.ts` (`removeTimedEnemyStatus` near `clearRemovable`, `deriveFamilyKey`, `enemyMaps`; interface entry; `return {…}` export)
- `src/utils/skillTextParser.ts` (`parseDoesntBreakStasis` + `DOESNT_BREAK_STASIS_RE` near `parseNoCrit`)
- `src/utils/combat/state.ts` (`CombatActor.doesntBreakStasis` + `createActor`, mirror `ignoresForcedTargeting`)
- `src/types/abilities.ts` + `src/utils/abilities/buildShipAbilities.ts` (`ShipSkills.doesntBreakStasis` production wiring)
- `src/utils/combat/__tests__/stasis.test.ts` (B3 suppression/break/Akula blocks) + `src/utils/__tests__/skillTextParser.test.ts` (parser test) + a statusEngine unit test (removeTimedEnemyStatus)
