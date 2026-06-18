# Stasis B1 — Per-Victim Debuff Modifier Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player-applied debuffs land on, and be read from, the *specific victim's* per-actor enemy-debuff store (keyed by `victim.id`) instead of the shared `__enemy__` sentinel — pure plumbing, no Stasis behavior. (Sub-project E's PR7b, pulled forward as the foundation for Stasis B2/B3.)

**Architecture:** Three coupled edits that ship in lockstep so no other debuff's effect drops: (1) write-routing — thread `targetId` for player→enemy in `buildTurnArgs`, guarded against the DPS dummy; (2) scheduled-reader move — `snapshot(actor.id)` → `snapshot(actor.id, targetId)` in `playerTurn`; (3) per-victim defense + incoming-damage in the positional apply (`defenseProfileOf` + a `victimHitDamage` per-victim override). A victim's enemy-debuffs live in its own store keyed by `victim.id` regardless of side, so a single uniform per-victim read is direction-agnostic.

**Tech Stack:** TypeScript, Vitest. Tests in `src/utils/combat/__tests__/`. Run with `npx vitest run <name>` (bare `npm test` = watch, hangs). Per-task gate: `npx vitest run` && `npm run lint` (max-warnings 0) && `npx tsc --noEmit` && `npm run audit:skills` (0/141). **NEVER `vitest -u`** — byte-identical goldens are the gate except where churn is explicitly audited and explained. Branch `feat/combat-sim-phase5-pr2` (checked out). Docs gitignored → `git add -f`, commit docs `--no-verify`.

**Spec:** `docs/superpowers/specs/2026-06-18-stasis-design.md` (§3.1, §4.6 define B1).

> **Line numbers are pre-Task-3 snapshots and DRIFT as tasks add code — RELOCATE BY SYMBOL NAME or the verbatim code string, never by offset.** Known current anchors (post Tasks 1-2): the `buildTurnArgs` `targetId` ternary `...(a.side === 'enemy' ? { targetId: tgt.id } : {}),` is ~`engine.ts:2580`; `defenseProfileOf`'s `defenceModifierPct: 0` is ~`engine.ts:2460-2464`; the per-victim "Phase-5 refinement" comment block is ~`engine.ts:2396-2434`. The verbatim `old_string`s in the steps below still match — search for them.

---

## How the final damage number is produced (verified by trace)

Two damage paths exist in `runPlayerTurn` → engine:

- **Aggregate (legacy) path** — `runPlayerTurn` computes `directDamage` from `effectiveDefense = enemyDefense * (1 + enemyDefenseModifier/100) * (1 - effectivePen/100)` (`playerTurn.ts:1098-1099`) and a fold `* (1 + incomingDamageModifier/100)` (`playerTurn.ts:1257`); credited via `creditDamage(actor.id, 'direct', turn.directDamage)`.
- **Positional per-victim path** — `drivePositionalApply` → `applyPositionalDamage` → `victimHitDamage(scalars, defenseProfileOf(victim), didCrit, roleScale)` (`positionalApply.ts:132`); `scalars = turn.positionalScalars` (`playerTurn.ts:1628-1640`).

**The positional path wins in the two-team sim.** `battleSimulator.ts` threads `position`/`target`/`pattern` for focus + every team/enemy actor (`battleSimulator.ts:613-615, 643-645, 692-694, 716-723`); each attack site computes `positional = isPositional(...) && target != null && pattern != null && turn.positionalScalars != null` (`engine.ts:3081-3085`). When true, the per-victim apply runs (`engine.ts:3086-3101`) and the aggregate credit is **suppressed** (`if (!positional) { ...; creditDamage(...) }`, `engine.ts:3120-3124`). So the landed number is `victimHitDamage`'s output, reading `defenseProfileOf(victim).defenceModifierPct` and `scalars.incomingDamageModifierPct`. In **DPS/healing mode** no positions/patterns are threaded → `positional` is false → aggregate path produces the number and `defenseProfileOf` never runs. This is why the dummy guard preserves DPS/healing goldens byte-for-byte.

Per-victim damage-taken surface = `RoundData.perTargetDamage`, populated by `drivePositionalApply`'s `emitHit` (`engine.ts:2441-2446`).

## Direction-agnostic per-victim read — CONFIRMED

The engine comment at `engine.ts:2397-2400` worried the per-victim defense lookup "splits into two lookups by direction." **Refuted by the store model:** enemy-applied debuffs (the `enemyDebuffs`/`inflict` path) all land in the status engine's enemy-side per-target store **keyed by the victim's id, not by side** (`statusEngine.ts:758, 773-774, 789-800`; `ownerDebuffNamesFor` at `triggers.ts:674-682` already reads any `targetId`). The ability enemy-debuff half already routes by `targetId` (`playerTurn.ts:872, 927-932`); only the **scheduled** half (`snapshot(actor.id)` at 733) and the positional `defenseProfileOf` still read `__enemy__`. Once write-routing is general and the read keys on `victim.id`, a single uniform `defenseProfileOf(v) = toEnemyModifiers(<debuffs on v.id>)` is correct for all three sites (focus→enemy, team→enemy, enemy→player). No per-direction branch.

## TWO-CHANNEL DEBUFF MODEL — CORRECTED 2026-06-18 (mid-execution finding)

A code trace during Task 2 revealed enemy debuffs live in **two channels** with different keys and read paths. The original plan conflated them; this corrects Tasks 3-4.

| Channel | Writer | Key | `payload`? | What flows through | Read by |
|---|---|---|---|---|---|
| **Ability** | `applyTimedAbilityStatus` (`statusEngine.ts:917-977`) | `enemyTargetId` arg (**per-victim**) | yes | **skill-parsed `{type:'debuff'}` debuffs** (Defense Down, Vulnerability, etc. — the dominant player-applied case) + ability auras/accum | `timedAbilityStatuses('enemy',_,id)` + `activeAbilityStatuses('enemy',_,_,id)` |
| **Scheduled** | `upsertBuff` (`statusEngine.ts:589-608`) | **`__enemy__` hardcoded** | no | manual-config debuffs, always/aura-source enemy debuffs (`alwaysEnemy`), scheduled accum/persistent | `snapshot(_,id).activeEnemyDebuffs` |

**Critical facts (cited):**
- `snapshot().activeEnemyDebuffs` **excludes payload entries** — `.filter((s) => !s.payload)` (`statusEngine.ts:794`). So it reads ONLY the scheduled channel.
- A player skill that "applies Defense Down for N turns" is a `{type:'debuff'}` ability → `timedEnemyBySlot` loop → `statusEngine.applyTimedAbilityStatus(r, status, actor.id, targetId)` (`playerTurn.ts:884`) = the **ability/payload/per-victim channel**, keyed by `targetId`.
- The aggregate `roundEnemyDebuffs` (`playerTurn.ts`) already reads BOTH channels: scheduled via `snapshot(actor.id)` (→`__enemy__`, line ~745) + ability via `timedAbilityStatuses/activeAbilityStatuses('enemy', actor.id, targetId)` (~939) → `toEnemyModifiers(union)` (~978). It is **discarded for positional hits** (positional path wins, aggregate credit suppressed) — so its modifiers never reach positional damage.
- `ownerDebuffNamesFor` (`triggers.ts:674-692`) reads ALL THREE sources (snapshot + timed + active ability statuses), all keyed to one `targetId` — the template for a complete per-victim read.

**Two corrections to the original plan:**
1. **`victimEnemyModifiers` must read BOTH channels** — scheduled (`snapshot(undefined, '__enemy__')` for global auras/manual, applied to every victim, matching the aggregate's `__enemy__` default) + ability (`timedAbilityStatuses`/`activeAbilityStatuses` for `victimId`, converted via `payloadToSelectedBuff`) — folded together through `toEnemyModifiers`. Snapshot-only (Task 2's version) misses the per-victim skill debuffs.
2. **DROP the snapshot-reader move (old Task 3 "Edit B").** Scheduled debuffs are written to `__enemy__` (upsertBuff hardcoded), so moving `snapshot(actor.id)` → `snapshot(actor.id, targetId)` would read EMPTY per-victim and DROP scheduled effects. Threading `targetId` (Edit A) ALONE moves the ability channel per-victim (its write AND its aggregate-read both key off `targetId`); the scheduled channel stays global `__enemy__`, which is correct (auras/manual apply to the engaged target as before). Edit B is unnecessary and harmful.

## Key helpers

- `toEnemyModifiers(selected: SelectedGameBuff[]): { enemyDefenseModifier; incomingDamageModifier }` — `dpsBuffHelpers.ts:71-85` (sums `parsedEffects.defense*stacks` and `parsedEffects.incomingDamage*stacks`).
- `statusEngine.snapshot(ownerId?, enemyTargetId?)` — `statusEngine.ts:133-136, 697-803`; `enemyTargetId` selects the per-target enemy-debuff store, defaults to `DEFAULT_ENEMY_TARGET = '__enemy__'` (`statusEngine.ts:356`). Returns `ActiveBuff[]` (not `SelectedGameBuff[]`).
- `enemyDebuffLookup: Map<string, SelectedGameBuff[]>` — built `engine.ts:1342-1346`, in scope at `drivePositionalApply`.
- `expandBuffs(ab, bufs)` — `playerTurn.ts:265-270`, module-private; applies the per-round stack override. Exported wrapper `expandEnemyDebuffs` shipped in Task 1.
- `timedAbilityStatuses('enemy', ownerId?, enemyTargetId?)` + `activeAbilityStatuses('enemy', resolveCtx, ownerId?, enemyTargetId?)` — `statusEngine.ts:1030-1073` / `979-1027`; the per-victim ability/payload reads (keyed by `enemyTargetId`). Each returned entry carries `.active.payload` (the ability config with `parsedEffects`).
- `payloadToSelectedBuff` — converts an ability-status payload to a `SelectedGameBuff` (extracted to `buffTotals.ts`, re-exported from `playerTurn.ts`; confirm import path during impl). Use to turn ability-channel payloads into the `SelectedGameBuff[]` that `toEnemyModifiers` folds. Mirror how `playerTurn.ts` builds `abilityEnemyEffects` (~952-969) so the helper's fold matches the aggregate exactly.

## Guard condition for write-routing (spec §8 resolved)

The `isDummyEnemy` flag (`engine.ts:2947`) is `actor.kind === 'enemy' && actor.id === enemy.id`, but the B1 guard does NOT reuse it — it keys off the resolved *target*, not the acting actor. `selectTurnTarget` returns `selected ?? tb.legacyVictim`; for the player side `tb.legacyVictim === enemy` (`engine.ts:2488`). So the guard "real positioned actor vs dummy" at the `buildTurnArgs` site is simply **`tgt.id !== enemy.id`** (independent of `isDummyEnemy`). The enemy side already threads `targetId` unconditionally (its victim is always a real player actor).

---

## Task 0 — Pre-flight: pin current behavior (no code change)

- [ ] Run `npx vitest run` — confirm all green; record the count.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run audit:skills` — confirm clean / 0 warnings / 0/141.
- [ ] No commit (read-only baseline). If anything is red at baseline, STOP and report.

---

## Task 1 — Export a shared `expandEnemyDebuffs` helper from `playerTurn.ts`

**Files:** Modify `src/utils/combat/playerTurn.ts`; Create `src/utils/combat/__tests__/expandEnemyDebuffs.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/utils/combat/__tests__/expandEnemyDebuffs.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { expandEnemyDebuffs } from '../playerTurn';
import type { ActiveBuff } from '../statusEngine';
import type { SelectedGameBuff } from '../../../types/calculator';

const mk = (name: string, parsedEffects: Record<string, number>): SelectedGameBuff =>
    ({ buffName: name, stacks: 1, parsedEffects } as unknown as SelectedGameBuff);

describe('expandEnemyDebuffs', () => {
    it('maps active debuff names through the lookup to SelectedGameBuff effects', () => {
        const lookup = new Map<string, SelectedGameBuff[]>([
            ['Defense Down', [mk('Defense Down', { defense: -30 })]],
        ]);
        const active: ActiveBuff[] = [{ buffName: 'Defense Down', turnsRemaining: 2 }];
        expect(expandEnemyDebuffs(active, lookup)).toEqual([
            expect.objectContaining({ buffName: 'Defense Down', parsedEffects: { defense: -30 } }),
        ]);
    });

    it('applies the per-round stack override and drops zero-stack entries', () => {
        const lookup = new Map<string, SelectedGameBuff[]>([
            ['Stacking Down', [mk('Stacking Down', { defense: -10 })]],
        ]);
        expect(expandEnemyDebuffs([{ buffName: 'Stacking Down', turnsRemaining: 'recurring', stacks: 3 }], lookup)).toEqual([
            expect.objectContaining({ stacks: 3 }),
        ]);
        expect(expandEnemyDebuffs([{ buffName: 'Stacking Down', turnsRemaining: 'recurring', stacks: 0 }], lookup)).toEqual([]);
    });

    it('drops unknown names (no lookup entry) → empty', () => {
        expect(expandEnemyDebuffs([{ buffName: 'Unknown', turnsRemaining: 1 }], new Map())).toEqual([]);
    });
});
```

  NOTE for implementer: verify the exact `expandBuffs` signature and stack/zero-stack semantics at `playerTurn.ts:265-270`; adjust the test's expected shape to match the real `expandBuffs` output (the assertions above are the intended contract — align them to reality, don't weaken them).

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run expandEnemyDebuffs` → FAIL (`expandEnemyDebuffs` not exported).

- [ ] **Step 3: Minimal implementation** in `playerTurn.ts` (reuse the existing private `expandBuffs`, do NOT change it):

```ts
/** Expand a victim's active enemy-debuff snapshot into SelectedGameBuff effects via the
 *  enemy-debuff lookup (applies the per-round stack override; drops zero-stack and unknown
 *  names). Shared by the engine's per-victim defense/incoming-damage sourcing (B1). */
export function expandEnemyDebuffs(
    activeEnemyDebuffs: ActiveBuff[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    return activeEnemyDebuffs.flatMap((ab) =>
        expandBuffs(ab, enemyDebuffLookup.get(ab.buffName) ?? [])
    );
}
```

- [ ] **Step 4: Run test, verify it passes** — `npx vitest run expandEnemyDebuffs` → PASS.
- [ ] **Step 5: Full gate** — `npx vitest run` && `npm run lint` && `npx tsc --noEmit` && `npm run audit:skills`. Pure addition → goldens byte-identical.
- [ ] **Step 6: Commit** — `B1 Task 1: export expandEnemyDebuffs helper from playerTurn`.

---

## Task 2 — Add engine-local `victimEnemyModifiers(victimId)` reader (unwired) — DONE (PARTIAL)

**STATUS: committed (`e3be23ef`) but PARTIAL** — the shipped helper reads ONLY the scheduled channel (`snapshot(undefined, victimId).activeEnemyDebuffs`), which the Task-2 trace revealed misses the ability/payload channel where player-applied skill debuffs live (see "TWO-CHANNEL DEBUFF MODEL" above). Task 3 COMPLETES the helper to read both channels and updates its test. The shipped helper is unwired (consumed only by its test tap) so the partial version is harmless until Task 3.

Build + test the per-victim reader BEFORE wiring it into damage. Defined-but-unused → goldens byte-identical.

**Files:** Modify `src/utils/combat/engine.ts` (+ `CombatEngineInput` tap field); Create `src/utils/combat/__tests__/victimEnemyModifiers.test.ts`.

- [ ] **Step 1: Write the failing test** — mirror `twoTeamBattle.test.ts` builders. A 1-attacker vs 2-enemy positioned `runCombat` where the focus attacker carries a scheduled `enemyDebuffs` Defense-Down (`parsedEffects.defense: -30`) on `enemy-front` only. Expose the engine-internal reader through a test tap (mirror `input.__testTapApplyOutgoingToEnemy?.(...)` at `engine.ts:2383`): assert the tapped fn returns `{ enemyDefenseModifier: -30, incomingDamageModifier: 0 }` for `enemy-front` and `{ 0, 0 }` for `enemy-back`. (NOTE: the helper's `snapshot(undefined, victimId)` passes `ownerId=undefined` → defaults to `'attacker'`; this is irrelevant for the enemy-debuff read, which keys solely off `enemyTargetId` — add a test comment so a future reader doesn't think `ownerId` is load-bearing.)
- [ ] **Step 2: Run test, verify it fails** — `npx vitest run victimEnemyModifiers` → FAIL (tap/field absent).
- [ ] **Step 3: Minimal implementation** in `engine.ts`, inside `runCombat`'s round-loop scope near `drivePositionalApply` (both `statusEngine` and `enemyDebuffLookup` in scope):

```ts
// Per-victim enemy-debuff-derived modifiers (B1/PR7b). Reads the victim's OWN per-actor
// enemy-debuff store (keyed by victim.id — direction-agnostic), expands names → effects via
// the global enemyDebuffLookup, folds to the two victim-debuff-derived modifiers. Attacker-
// sourced modifiers (outgoing buff, pen) stay attacker-sourced and are NOT read here.
const victimEnemyModifiers = (
    victimId: string
): { enemyDefenseModifier: number; incomingDamageModifier: number } =>
    toEnemyModifiers(
        expandEnemyDebuffs(
            statusEngine.snapshot(undefined, victimId).activeEnemyDebuffs,
            enemyDebuffLookup
        )
    );
```

  - Import `toEnemyModifiers` from `../calculators/dpsBuffHelpers` and add `expandEnemyDebuffs` to the existing `./playerTurn` import (`engine.ts:55-57`).
  - Add `input.__testTapVictimEnemyModifiers?.(victimEnemyModifiers);` adjacent to the existing `__testTapApplyOutgoingToEnemy` call.
  - Add `__testTapVictimEnemyModifiers?: (fn: (victimId: string) => { enemyDefenseModifier: number; incomingDamageModifier: number }) => void;` to `CombatEngineInput` (mirror the `__testTapApplyOutgoingToEnemy` doc comment).

- [ ] **Step 4: Run test, verify it passes** — `npx vitest run victimEnemyModifiers` → PASS.
- [ ] **Step 5: Full gate.** `victimEnemyModifiers` defined but unconsumed by any damage path → all goldens byte-identical (DPS, healing, two-team, positional). Confirm `npx vitest run` fully green.
- [ ] **Step 6: Commit** — `B1 Task 2: add engine victimEnemyModifiers per-victim reader (unwired)`.

---

## Task 3 — Complete `victimEnemyModifiers` (both channels) + thread `targetId` for player→enemy (Edit A)

Two coupled changes that ship together: (1) COMPLETE the helper so it reads the ability channel (where player skill debuffs live), and (2) thread `targetId` so player-applied ability debuffs actually ROUTE to the victim's per-actor store. Together a player skill Defense Down lands on, and is read from, the specific victim. **Edit B (snapshot-reader move) is DROPPED** — see the two-channel model: it would empty the scheduled channel per-victim.

**Files:** Modify `src/utils/combat/engine.ts` (`victimEnemyModifiers` + `buildTurnArgs:2552`); Modify `src/utils/combat/__tests__/victimEnemyModifiers.test.ts` (extend) and Create `src/utils/combat/__tests__/perVictimDebuffRouting.test.ts`.

- [ ] **Step 1a: Extract a shared `victimEnemyBuffs` in `triggers.ts`, then complete the engine helper.**
  To read all three per-victim sources correctly AND keep this in lockstep with `ownerDebuffNamesFor`
  (which reads the same three sources), add a sibling helper IN `triggers.ts` (where the module-private
  `NEUTRAL_NAMES_CTX` at `triggers.ts:629` IS in scope — it is NOT exported, so a helper in `engine.ts`
  cannot use it). The scheduled channel needs the engine's `enemyDebuffLookup`, so pass it in:

```ts
// triggers.ts — sibling of ownerDebuffNamesFor (triggers.ts:674-692). Returns the full per-victim
// enemy-debuff SET as SelectedGameBuff effects, folding BOTH channels: scheduled (__enemy__ global
// auras/manual) + ability (payload, per-victim). Mirrors ownerDebuffNamesFor's three-source read so
// the modifier-read and name-read stay in lockstep.
export function victimEnemyBuffs(
    statusEngine: StatusEngine,
    targetId: string,
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    const scheduled = expandEnemyDebuffs(
        statusEngine.snapshot(undefined, DEFAULT_ENEMY_TARGET).activeEnemyDebuffs,
        enemyDebuffLookup
    );
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, targetId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const active = statusEngine
        .activeAbilityStatuses('enemy', () => NEUTRAL_NAMES_CTX, undefined, targetId)
        .map((s) => payloadToSelectedBuff(s.payload));
    return [...scheduled, ...timed, ...active];
}
```

  Then in `engine.ts` simplify `victimEnemyModifiers` to delegate:

```ts
const victimEnemyModifiers = (
    victimId: string
): { enemyDefenseModifier: number; incomingDamageModifier: number } =>
    toEnemyModifiers(victimEnemyBuffs(statusEngine, victimId, enemyDebuffLookup));
```

  **Confirm during impl:** (1) the ability statuses expose `.payload` (use `s.payload`, NOT `s.active` — `s.active` is just `{buffName,turnsRemaining}`; and `activeAbilityStatuses` returns `payload: {...s.payload, stacks: s.stacks}` so `.payload` carries the live stack count — `statusEngine.ts:1022`). (2) `payloadToSelectedBuff` import (`buffTotals.ts:63`, re-exported from `playerTurn.ts:45`). (3) `expandEnemyDebuffs` import (from `playerTurn`). (4) `DEFAULT_ENEMY_TARGET` — reuse the `statusEngine.ts` export or the in-scope sentinel. Match `playerTurn`'s `abilityEnemyEffects` fold (~952-969) so the helper's modifiers EQUAL the aggregate's for the same victim. Co-locate `victimEnemyBuffs.test.ts` unit coverage in triggers' test dir if one exists, else assert through the engine test below.

- [ ] **Step 1b: Update the Task-2 test** (`victimEnemyModifiers.test.ts`) — keep the scheduled-channel case but STRENGTHEN it: a scheduled `__enemy__` debuff must read NON-ZERO for BOTH victims (locks the "scheduled auras apply to every positioned victim" decision by test, not implicitly). ADD an ability-channel case: a player skill applies a Defense Down (`parsedEffects.defense: -30`) to the FRONT enemy (with `targetId` threaded by Edit A so it routes there); assert `victimEnemyModifiers('front-id')` returns `enemyDefenseModifier: -30` and `victimEnemyModifiers('back-id')` returns `0` for the ability portion (back still gets any scheduled global modifier). This proves the helper reads BOTH the per-victim ability channel and the global scheduled channel.

- [ ] **Step 2: Write the routing failing test** (`perVictimDebuffRouting.test.ts`) — mirror `twoTeamBattle.test.ts`. 1-attacker vs 2-enemy positioned `runCombat`; focus applies an **ability** `enemyDebuffs` Defense-Down (`parsedEffects.defense: -50`) onto `enemy-front` only; via the test tap assert `victimEnemyModifiers('enemy-front')` = `-50` and `victimEnemyModifiers('enemy-back')` = `0` (debuff routed to front's store, not leaked to back or stuck on `__enemy__`). (Damage-number assertions belong to Task 4; here assert the per-victim READ via the tap.)

- [ ] **Step 3: Run both tests, verify they fail** — `npx vitest run victimEnemyModifiers perVictimDebuffRouting`. Confirm they fail for the right reason (before Edit A the debuff sits on `__enemy__`; before the helper completion the ability channel is unread).

- [ ] **Step 4: Edit A — thread `targetId` for player→enemy.** `engine.ts:2552` in `buildTurnArgs`, replace `...(a.side === 'enemy' ? { targetId: tgt.id } : {}),` with:

```ts
// B1/PR7b: thread targetId for BOTH directions so player-applied ABILITY debuffs route to the
// resolved victim's per-actor store (applyTimedAbilityStatus keys off targetId; the aggregate
// ability-read timedAbilityStatuses('enemy',actor.id,targetId) follows automatically). GUARDED
// for the player side: when selectTurnTarget fell back to the dummy `enemy` sink
// (tgt.id === enemy.id), leave targetId unset so the __enemy__ path (DPS/healing) is byte-
// identical. The scheduled channel stays global __enemy__ (upsertBuff hardcoded — correct for
// auras). The enemy side is unchanged (its victim is always a real player actor).
...(a.side === 'enemy' || tgt.id !== enemy.id ? { targetId: tgt.id } : {}),
```

  **Do NOT touch `playerTurn.ts:733`** (the dropped Edit B). The scheduled `snapshot(actor.id)` stays `__enemy__`.

- [ ] **Step 5: Run the tests, verify they pass** — `npx vitest run victimEnemyModifiers perVictimDebuffRouting` → PASS.

- [ ] **Step 6: Full gate — AUDITED CHURN expected.**
  - DPS goldens byte-identical (no positions → `tgt === enemy` → `targetId` unset → `__enemy__` write+read).
  - Healing goldens byte-identical (same guard).
  - **Two-team-sim goldens (`twoTeamBattle`, `dpsSimulator` multi-actor, `positionalDamage.integration`):** single-enemy fixtures byte-identical (one victim store ≡ the old `__enemy__` re-key, consistent write+read). Multi-enemy fixtures with player-applied ability debuffs: numbers may move because the ability debuff no longer pools on the shared `__enemy__` (the aggregate `roundEnemyDebuffs` ability-half now reads per-victim → `positionalScalars.incomingDamageModifier` reflects the anchor victim's own store). **Audit each moved value line-by-line** ("debuff stopped leaking across enemies"), explain in the commit. **Never `vitest -u`.**
  - `npm run lint && npx tsc --noEmit && npm run audit:skills`.

- [ ] **Step 7: Commit** — `B1 Task 3: complete victimEnemyModifiers (both channels) + thread player→enemy targetId`. List audited golden movements or state none.

---

## Task 4 — Per-victim defense + incoming-damage in the positional apply

Consume the now-complete `victimEnemyModifiers` (both channels, from Task 3) inside `drivePositionalApply` so per-victim damage carries the victim's OWN defense debuff and incoming-damage debuff — replacing hardcoded `defenceModifierPct: 0` (`engine.ts:2434`) and the attacker-fixed `scalars.incomingDamageModifierPct`. (This is the task that makes the per-victim sourcing actually reach the positional damage number — Task 3's helper+routing were unwired into damage.)

**Files:** Modify `src/utils/combat/engine.ts:2432-2436`, `src/utils/combat/victimDamage.ts` (`VictimDefenseProfile` + `victimHitDamage`); Create `src/utils/combat/__tests__/perVictimDefenseDebuff.test.ts`.

- [ ] **Step 1: Write the failing test** — mirror `twoTeamBattle.test.ts`. 1-attacker vs 2-enemy positioned battle; pattern hits both (origin + covered); attacker applies a defense-down (`parsedEffects.defense: -50`) AND an incoming-damage-up onto `enemy-front` only. Assert on `RoundData.perTargetDamage`: `enemy-front` takes MORE than `enemy-back`; `enemy-back` takes the baseline (no leak). Compute exact expected front/back values from `victimHitDamage`'s formula (attack, multiplier, `defenceModifierPct = -50`/`0`, `incomingDamageModifierPct = +X`/`0`, `roleScale`) and assert exact numbers.
- [ ] **Step 2: Run test, verify it fails** — `npx vitest run perVictimDefenseDebuff` → FAIL (today `defenceModifierPct: 0` for all; `incomingDamageModifierPct` is attacker-fixed from the anchor → covered victim wrong).
- [ ] **Step 3: Minimal implementation.**

  In `engine.ts` `drivePositionalApply`, edit `defenseProfileOf` (`engine.ts:2432-2436`):

```ts
defenseProfileOf: (v) => {
    const m = victimEnemyModifiers(v.id);
    return {
        defence: v.stats.defence,
        // B1/PR7b: per-victim defense-debuff sourcing (was hardcoded 0). Direction-agnostic —
        // v.id keys the victim's own enemy-debuff store regardless of side.
        defenceModifierPct: m.enemyDefenseModifier,
        // B1/PR7b: per-victim incoming-damage debuff; overrides the attacker-fixed scalar in
        // victimHitDamage. Attacker-sourced scalars (outgoing buff, pen) stay attacker-fixed.
        incomingDamageModifierPct: m.incomingDamageModifier,
        affinity: v.affinity ?? 'antimatter',
    };
},
```

  In `victimDamage.ts`:
  - Add to `VictimDefenseProfile` (`victimDamage.ts:54-59`): `/** per-victim incoming-damage debuff; when present, overrides the attacker-fixed scalar — B1/PR7b */ incomingDamageModifierPct?: number;`
  - In `victimHitDamage` (`victimDamage.ts:91-95`): `const incoming = v.incomingDamageModifierPct ?? s.incomingDamageModifierPct;` and substitute `(1 + incoming / 100)` in `nonCritFactor`. The `?? s.incomingDamageModifierPct` fallback keeps every existing caller byte-identical.

- [ ] **Step 4: Run test, verify it passes** — `npx vitest run perVictimDefenseDebuff` → PASS. Re-run `perVictimDebuffRouting` and tighten its back-victim assertion (covered-victim incoming-damage now exact).
- [ ] **Step 5: Full gate — AUDITED CHURN.**
  - `victimDamage.test.ts`: override defaults to the scalar via `??`; existing per-victim unit tests don't set `incomingDamageModifierPct` → byte-identical. Confirm.
  - DPS/healing goldens byte-identical (positional path never runs in DPS/healing).
  - **Two-team-sim goldens:** existing fixtures use `defence: 0`, no defense/incoming debuffs → `0`/absent → byte-identical. Any fixture with a defense/incoming debuff across multiple positioned enemies moves (covered victims no longer inherit the anchor's debuff; targeted victim reflects its own). **Behavior note for the audit/commit:** scheduled `__enemy__` debuffs (global auras/manual) now apply to EVERY positioned victim uniformly (previously they reached only the aggregate's single anchor victim, and were dropped entirely from positional damage since `defenceModifierPct` was 0). This is the intended team-wide-aura semantics — call it out explicitly. **Audit line-by-line, explain, never `-u`.**
  - `npm run lint && npx tsc --noEmit && npm run audit:skills`.
- [ ] **Step 6: Commit** — `B1 Task 4: per-victim defense + incoming-damage in positional apply`. List audited golden movements with explanation, or state none.

---

## Task 5 — Refresh engine comment + resolve spec open items + final holistic review

**Files:** Modify `src/utils/combat/engine.ts:2395-2404`; Modify `docs/superpowers/specs/2026-06-18-stasis-design.md`.

- [ ] **Step 1:** Update the `engine.ts:2395-2404` comment to reflect the resolved design: per-victim defense + incoming-damage are now sourced from the victim's own store via `victimEnemyModifiers`, **uniform across all three sites (direction-agnostic)**. Strike the "two lookups by direction" sentence; replace with the single-lookup rationale (victim's enemy-debuff store keyed by victim id regardless of side). Keep the `outgoingDamageBuffPct`/pen "attacker-fixed" note.
- [ ] **Step 2:** Keep the Task-2 test tap (`__testTapVictimEnemyModifiers`) — mirrors the existing `__testTapApplyOutgoingToEnemy` precedent, inert in production, documents the per-victim contract.
- [ ] **Step 3: Final full gate** — `npx vitest run` then explicitly `npx vitest run src/utils/combat`. Confirm green and that every Task 3-4 golden movement is documented.
- [ ] **Step 4: Commit** — `B1 Task 5: refresh per-victim sourcing comment (direction-agnostic, resolved)`.
- [ ] **Step 5:** Update spec `docs/superpowers/specs/2026-06-18-stasis-design.md` §4.6/§8 to mark B1 open items resolved (guard = `tgt.id !== enemy.id`; reader set = defense + incoming-damage, both per-victim, direction-agnostic; confirmed no other reader silently reads `__enemy__` for a victim-debuff effect). `git add -f docs/...` then `git commit --no-verify -m "B1: mark §4.6/§8 open items resolved"`.

---

## Sequencing rationale

- **Tasks 1, 2** — pure additions (expand helper + partial unwired reader) → zero golden movement.
- **Task 3** — completes the helper to read BOTH channels + threads `targetId` (Edit A) so player ability debuffs route per-victim. The ability channel's write (`applyTimedAbilityStatus`) and aggregate-read (`timedAbilityStatuses(...,targetId)`) BOTH key off `targetId`, so they move together — no drop. The scheduled channel stays global `__enemy__` (Edit B dropped). Helper still unwired into the positional damage path.
- **Task 4** — wires the complete helper into the positional apply (`defenseProfileOf` + `victimHitDamage` override). This is where per-victim sourcing reaches the damage number.
- The `??` fallback in `victimHitDamage` keeps every non-B1 caller byte-identical.

## Audited-churn summary

- **DPS goldens, healing goldens:** MUST stay byte-identical across ALL tasks (no positions → `tgt === enemy` → `targetId` unset → `__enemy__` write+read). If any move, the dummy guard leaked — fix the guard, do NOT `-u`.
- **Two-team-sim goldens (`twoTeamBattle`, `dpsSimulator` multi-actor, `positionalDamage.integration`):** Tasks 1-2 byte-identical. Task 3 (targetId threading) and Task 4 (positional per-victim sourcing) may move MULTI-enemy fixtures that apply player ability debuffs — the debuff stops pooling on the shared `__enemy__` and each victim reflects its own defense+incoming debuff. Single-enemy fixtures stay byte-identical (one victim store ≡ old `__enemy__` re-key). Audit each moved value line-by-line and explain in the commit. Never `-u`.

## Critical files

- `src/utils/combat/engine.ts` — `buildTurnArgs` ~2545-2575 (write-routing guard); `drivePositionalApply`/`defenseProfileOf` ~2407-2448; `victimEnemyModifiers` + `enemyDebuffLookup` ~1342; `CombatEngineInput` tap field.
- `src/utils/combat/playerTurn.ts` — `snapshot` reader at 733; `positionalScalars` 1628-1640; `expandBuffs` at 265 → new exported `expandEnemyDebuffs`.
- `src/utils/combat/victimDamage.ts` — `VictimDefenseProfile` + `victimHitDamage` incoming-damage override.
- `src/utils/calculators/dpsBuffHelpers.ts` — `toEnemyModifiers`.
- `src/utils/combat/statusEngine.ts` — `snapshot(ownerId, enemyTargetId)` per-target store; `DEFAULT_ENEMY_TARGET`.
