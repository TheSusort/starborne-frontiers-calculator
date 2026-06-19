# C2b-3 — Nayra `target-repaired-this-round` Condition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real `target-repaired-this-round` condition so Nayra's charged "if the target was repaired this round, purge all buffs" purge fires ONLY when its target was actually repaired this round — removing the dangerous unconditional `count:'all'` over-removal C2a shipped as a flagged stopgap.

**Architecture:** A new derivable `ConditionSubject` evaluated against a new `ConditionContext.targetRepairedThisRound` flag. The engine maintains one combat-scoped `Set<string>` of actor ids repaired this round, set inside the single `applyHealToTarget` closure (the one place ALL heal families funnel through), cleared at each round boundary, and threaded per-turn into the round context as `repairedThisRound.has(tgt.id)`. The parser attaches the condition to Nayra's purge (position-scoped) and to its co-sentence Stasis/Exposed inflicts (via `detectGrantConditions`). The existing `gateFiringAbilities` gate (plus an explicit gate at the C2a purge fire site) drops the purge when the condition fails.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; abilities under `src/utils/abilities/`; parser at `src/utils/skillTextParser.ts`; types at `src/types/abilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-19-purge-ecosystem-c2b-design.md` §6. This plan is the last item of sub-project C; C2b-1 (reactive ecosystem) and C2b-2 (conditional sources) shipped before it on the same branch.

---

## TWO REASONED DEVIATIONS FROM THE SPEC (flag for reviewer)

1. **`derivable: true`, NOT `derivable: false` (spec §6.1/§6.3 say false — that is a BUG).**
   `evaluateCondition` (`evaluateConditions.ts:30`) short-circuits: `if (!cond.derivable) return Math.max(0, cond.manualCount ?? 1)` → a non-derivable condition is **always met** (count 1). A `derivable:false` target-repaired condition would therefore fire the purge UNCONDITIONALLY — reproducing the exact C2a over-removal bug this PR exists to fix. The condition MUST be `derivable: true` so it routes to the `switch` and reads `ctx.targetRepairedThisRound`. This matches the cited `hpSubject:'target'` precedent, which is itself derivable (evaluated via `evalHpThreshold`).

2. **ONE engine flag-set site, not "enumerate both heal families" (spec §6.2).**
   The cast-path heal (`playerTurn.ts:1506/1582`), the reactive heal (`triggers.ts:1166`), the engine credit path (`engine.ts:2106`), AND the leech-heal path (`engine.ts:3922`) all call the SAME `healing.applyHealToTarget(raw)` — an engine closure over the single `healTarget` (`engine.ts:1908`). Setting the flag inside that closure when `consumed > 0` covers every family at one site (cannot drift). "Repaired" = HP repair → set on heal only, NOT on `grantShieldToTarget` (shields are not repairs — `triggers.ts:1111`).

   *Consequence of the single-`healTarget` model:* heals only ever land on `healTarget.id`, so `targetRepairedThisRound` can be true only when the acting attacker's target IS the heal target. The live-firing scenario is therefore **enemy** Nayra purging the player-side heal target after it was repaired (the test in Task 3). Player-Nayra-vs-enemy stays false (the engine never heals enemy ships today) — a safe under-fire, consistent with the C-series convention. Per-victim repair tracking for arbitrary actors is deferred to sub-project E (per-victim AoE accounting).

---

## File Structure

**Types / condition primitive**
- `src/types/abilities.ts` — add `'target-repaired-this-round'` to the `ConditionSubject` union.
- `src/utils/abilities/evaluateConditions.ts` — add `targetRepairedThisRound?: boolean` to `ConditionContext`; add the `switch` case.
- `src/utils/abilities/roundContext.ts` — accept + default the new field in `buildRoundContext`.
- `src/utils/combat/abilityStatusGating.ts` — add the subject to `LIVE_SUBJECTS` (so Nayra's Stasis/Exposed inflicts gate live, not neutralize-to-`always`).
- `src/components/skills/ConditionRow.tsx` — editor label (cosmetic; the condition is parser-autoFilled).

**Parser**
- `src/utils/skillTextParser.ts` — `REPAIRED_THIS_ROUND_RE`; a new rule in `detectGrantConditions`; a position-scoped `detectRepairedThisRoundCondition(text, anchorPos)`.
- `src/utils/abilities/buildShipAbilities.ts` — attach the detected condition to the purge ability at the C2a emit site (~`:1097`).

**Engine threading**
- `src/utils/combat/engine.ts` — combat-scoped `repairedThisRound` Set; set in `applyHealToTarget`; clear at round top; thread `targetRepairedThisRound` in `buildTurnArgs`; optional `__testTapRepairedThisRound` seam.
- `src/utils/combat/playerTurn.ts` — `targetRepairedThisRound?` on `PlayerTurnArgs`; destructure with default; thread into all four `buildRoundContext` calls; explicit gate at the on-cast purge fire (`:1384`).

**Tests**
- `src/utils/abilities/__tests__/evaluateConditions.test.ts`
- `src/utils/__tests__/skillTextParser.test.ts`
- `src/utils/abilities/__tests__/buildShipAbilities.test.ts`
- `src/utils/combat/__tests__/nayraRepairedPurge.test.ts` (new — engine flag + integration)

---

## Task 0: Baseline

- [ ] **Step 1: Confirm branch + clean tree**

Run: `git -C /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator status -sb && git rev-parse --abbrev-ref HEAD`
Expected: branch `feat/combat-sim-phase5-pr2`, clean working tree.

- [ ] **Step 2: Capture green baseline**

Run (NOT bare `npm test` — that is Vitest WATCH and hangs):
```bash
npx vitest run && npm run lint && npx tsc --noEmit && npm run audit:skills
```
Expected: all tests green (record the count, ~2654), lint 0 warnings, tsc clean, `audit:skills` 0/141. Record the numbers — every later task compares against them.

---

## Task 1: Condition primitive (unwired)

**Files:**
- Modify: `src/types/abilities.ts` (the `ConditionSubject` union, ~`:132`)
- Modify: `src/utils/abilities/evaluateConditions.ts` (`ConditionContext` ~`:25`, `evaluateCondition` switch ~`:72`)
- Modify: `src/utils/abilities/roundContext.ts` (~`:36`, `:56`)
- Modify: `src/utils/combat/abilityStatusGating.ts` (`LIVE_SUBJECTS` ~`:26`)
- Modify: `src/components/skills/ConditionRow.tsx` (`SUBJECT_VALUES` ~`:32`, `EXTRA_SUBJECT_LABELS` ~`:47`)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts`

This task adds the gate primitive but wires NO producer. With no condition attached to any ability and no engine flag, production is byte-identical.

- [ ] **Step 1: Write the failing test**

Add to `evaluateConditions.test.ts`:
```ts
import { evaluateCondition, conditionsMet } from '../evaluateConditions';
import type { ConditionContext } from '../evaluateConditions';

const baseCtx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    effectiveCritRate: 0,
    adjacentAllyCount: 0,
    enemyAdjacentCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
    ...over,
});

describe('target-repaired-this-round condition', () => {
    const cond = { subject: 'target-repaired-this-round' as const, derivable: true };

    it('is met when the target was repaired this round', () => {
        expect(evaluateCondition(cond, baseCtx({ targetRepairedThisRound: true }))).toBe(1);
        expect(conditionsMet([cond], baseCtx({ targetRepairedThisRound: true }))).toBe(true);
    });

    it('is NOT met when the target was not repaired (false or undefined)', () => {
        expect(evaluateCondition(cond, baseCtx({ targetRepairedThisRound: false }))).toBe(0);
        expect(evaluateCondition(cond, baseCtx())).toBe(0); // undefined defaults to not-met
        expect(conditionsMet([cond], baseCtx())).toBe(false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts`
Expected: FAIL — the `switch` has no case for the new subject (hits `default: return 0`), so the "met when repaired" assertion fails; also a TS error on the unknown union member until Step 3.

- [ ] **Step 3: Add the union member**

`src/types/abilities.ts` — extend `ConditionSubject` (after `'lowest-speed-ally'`, keeping it the last member's sibling):
```ts
    | 'lowest-speed-ally'
    // Binary gate: the acting attacker's TARGET was repaired (HP healed) earlier this
    // round. Live-derived by the engine (ConditionContext.targetRepairedThisRound);
    // defaults false (DPS mode / un-repaired target). Nayra's charged purge + Stasis/
    // Exposed inflicts. derivable:true — a derivable:false condition would always be met
    // (evaluateConditions.ts:30), defeating the gate.
    | 'target-repaired-this-round';
```

- [ ] **Step 4: Add the ConditionContext field + switch case**

`src/utils/abilities/evaluateConditions.ts` — in `ConditionContext` (after `targetHpPct`):
```ts
    /** True when the acting attacker's target was repaired (HP healed) earlier this
     *  round. Live-derived by the engine; defaults false (DPS / un-repaired). */
    targetRepairedThisRound?: boolean;
```
In the `evaluateCondition` switch (before `default:`):
```ts
        case 'target-repaired-this-round':
            return ctx.targetRepairedThisRound ? 1 : 0;
```

- [ ] **Step 5: Default it in buildRoundContext**

`src/utils/abilities/roundContext.ts` — add to the `state` param type (mirror `targetHpPct`):
```ts
    /** The acting attacker's target was repaired this round. Default false. */
    targetRepairedThisRound?: boolean;
```
…and in the returned object (mirror `targetHpPct: state.targetHpPct ?? 100`):
```ts
        targetRepairedThisRound: state.targetRepairedThisRound ?? false,
```

- [ ] **Step 6: Register in LIVE_SUBJECTS**

`src/utils/combat/abilityStatusGating.ts` — add `'target-repaired-this-round'` to the `LIVE_SUBJECTS` set. Rationale: without it, `liveGateConditions` neutralizes the (derivable) condition on Nayra's Stasis/Exposed timed-debuff inflicts to `'always'` (always-fire), defeating the gate for those inflicts. The purge does NOT route through `liveGateConditions` (it gates via `gateFiringAbilities`/the cast-path gate), so this is purely for the inflict ride-along (§6.4). No Nayra fixture exists → byte-identical.

- [ ] **Step 7: Editor label (cosmetic)**

`src/components/skills/ConditionRow.tsx` — add `'target-repaired-this-round'` to `SUBJECT_VALUES` and an entry to `EXTRA_SUBJECT_LABELS`:
```ts
    'target-repaired-this-round': 'when the target was repaired this round',
```
(If `ConditionRow.test.tsx` / `AbilityCard.test.tsx` assert an exhaustive option list, update those assertions — green, not a golden re-baseline.)

- [ ] **Step 8: Run tests + gates**

Run:
```bash
npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts src/components/skills && npm run lint && npx tsc --noEmit
```
Expected: PASS, lint 0, tsc clean.

- [ ] **Step 9: Full suite (byte-identical check)**

Run: `npx vitest run`
Expected: same green count as Task 0 (no `.snap` movement — nothing produces the condition or the flag yet).

- [ ] **Step 10: Commit**
```bash
git add -A && git commit -m "C2b-3 T1: target-repaired-this-round condition primitive (unwired)"
```

---

## Task 2: Parser — detect + attach the condition

**Files:**
- Modify: `src/utils/skillTextParser.ts` (near the C2b-2 detectors, ~`:1094`; new rule in `detectGrantConditions` ~`:577`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (purge emit, ~`:1097`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`, `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

The purge ability has no `buffName`, so `detectGrantConditions` (buff-keyed) cannot drive it — a position-scoped detector handles the purge; the `detectGrantConditions` rule handles the co-sentence Stasis/Exposed debuffs (which ARE buff-keyed). Both share one regex.

Nayra CSV (`docs/ship-skills.csv:97`): active "…170% damage…`<br />`If the target was repaired this round, inflict Stasis for 1 turn."; charged "…210% damage…`<br />`If the target was repaired this round, inflict Exposed for 1 turn and purge all buffs from the enemy." Only Nayra contains "repaired this round" corpus-wide (verified) → churn is fully Nayra-scoped.

- [ ] **Step 1: Write the failing parser tests**

Add to `skillTextParser.test.ts` (import `detectGrantConditions`, `detectRepairedThisRoundCondition`):
```ts
describe('target-repaired-this-round (Nayra)', () => {
    const activeText =
        'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Crit Rate Down III</unit-skill> for 2 turns, dealing <unit-damage>170% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its Defense.<br />If the target was repaired this round, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';
    const chargedText =
        'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns, dealing <unit-damage>210% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its defense.<br />If the target was repaired this round, inflict <unit-skill>Exposed</unit-skill> for 1 turn and purge all buffs from the enemy.';

    it('gates Stasis (active) on target-repaired-this-round', () => {
        expect(detectGrantConditions(activeText, 'Stasis')).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
    });
    it('gates Exposed (charged) on target-repaired-this-round', () => {
        expect(detectGrantConditions(chargedText, 'Exposed')).toEqual([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
    });
    it('does NOT gate first-sentence debuffs (no repaired phrase in their clause)', () => {
        expect(detectGrantConditions(activeText, 'Defense Down II')).toEqual([]);
        expect(detectGrantConditions(chargedText, 'Attack Down II')).toEqual([]);
    });
    it('detects the condition position-scoped at the purge anchor', () => {
        const purgePos = chargedText.search(/purge/i);
        expect(detectRepairedThisRoundCondition(chargedText, purgePos)).toEqual({
            subject: 'target-repaired-this-round',
            derivable: true,
        });
        // active text has no purge → its purge anchor is -1 → undefined
        expect(detectRepairedThisRoundCondition(activeText, activeText.search(/purge/i))).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t "target-repaired-this-round"`
Expected: FAIL — `detectGrantConditions` returns `[]` for Stasis/Exposed; `detectRepairedThisRoundCondition` is not exported (TS error).

- [ ] **Step 3: Add the shared regex + the detectGrantConditions rule**

`src/utils/skillTextParser.ts` — near the other phrase constants (e.g. just above `MOST_BUFFS_RE`, ~`:1094`):
```ts
// "repaired this round" — Nayra's charged purge + its Stasis/Exposed inflicts. The
// gate word ("if"/"when") is already verified by detectGrantConditions' conditional
// guard / by rawSentenceAround's sentence scoping, so the phrase alone is enough.
// Corpus-unique to Nayra (verified: 1 row). No <unit-…> tags intervene in the phrase.
const REPAIRED_THIS_ROUND_RE = /\brepaired\s+this\s+round\b/i;
```
In `detectGrantConditions`, immediately AFTER the conditional-gate guard `return []` block (the `if (!/\b(when|if|while|after)\b.../.test(low) && ...) return []`) and BEFORE the recurring-grant check — add:
```ts
    // target-repaired-this-round (Nayra). Live-derived gate; derivable:true (see
    // ConditionSubject note — derivable:false would always be met).
    if (REPAIRED_THIS_ROUND_RE.test(low)) {
        return [{ subject: 'target-repaired-this-round', derivable: true }];
    }
```
(`resolveBuffClause` converts `<br>` to `". "` and splits sentences, so the clause for "Stasis"/"Exposed" is exactly the conditional sentence containing the phrase; first-sentence debuffs resolve to a clause without it → no match.)

- [ ] **Step 4: Add the position-scoped purge detector**

`src/utils/skillTextParser.ts` — beside `detectMostBuffsTarget` (~`:1102`), using `Condition` (already imported) and `rawSentenceAround`:
```ts
/**
 * Returns a target-repaired-this-round Condition when `anchorPos` falls inside the
 * sentence carrying "repaired this round" (Nayra's charged purge); else undefined.
 * Position-scoped on RAW text (mirrors detectMostBuffsTarget). The purge ability has
 * no buffName, so detectGrantConditions cannot drive it — this is its condition source.
 */
export function detectRepairedThisRoundCondition(
    text: string | null | undefined,
    anchorPos: number
): Condition | undefined {
    if (!text) return undefined;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && REPAIRED_THIS_ROUND_RE.test(sentence)
        ? { subject: 'target-repaired-this-round', derivable: true }
        : undefined;
}
```

- [ ] **Step 5: Attach it to the purge ability in buildShipAbilities**

`src/utils/abilities/buildShipAbilities.ts` — import `detectRepairedThisRoundCondition` (the import block at ~`:29` already pulls parser helpers). In the purge emit loop (`for (const p of parsePurge(text))`, ~`:1080`), after `purgePos` is computed, add:
```ts
        const repairedCond = detectRepairedThisRoundCondition(text, purgePos);
```
…and change the pushed ability's `conditions: []` (~`:1103`) to:
```ts
                conditions: repairedCond ? [repairedCond] : [],
```
Update the stale C2a "NAYRA is the OVER-removal" comment block (~`:1071-1076`) to note the condition is now attached (gating handled in the engine cast path).

- [ ] **Step 6: Add a buildShipAbilities test**

Add to `buildShipAbilities.test.ts` — build abilities from Nayra's charged text (slot `'charged'`) and assert the emitted purge ability carries `conditions: [{ subject: 'target-repaired-this-round', derivable: true }]`, `config.count: 'all'`, `trigger: 'on-cast'`. (Mirror the existing purge-emit tests in that file.)

- [ ] **Step 7: Run tests + gates**

Run:
```bash
npx vitest run src/utils/__tests__/skillTextParser.test.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts && npm run lint && npx tsc --noEmit && npm run audit:skills
```
Expected: PASS, lint 0, tsc clean, `audit:skills` 0/141 (no skill-classification change).

- [ ] **Step 8: Full suite (byte-identical check)**

Run: `npx vitest run`
Expected: same green count, ZERO `.snap` movement. No Nayra fixture exists, so attaching the condition (which the engine flag does not yet populate → always evaluates false → `gateFiringAbilities` would drop a Nayra purge, but none is in any golden) is production byte-identical. If ANY `.snap` moves, STOP — a non-Nayra text is matching `REPAIRED_THIS_ROUND_RE`; re-audit the corpus.

- [ ] **Step 9: Commit**
```bash
git add -A && git commit -m "C2b-3 T2: parse target-repaired-this-round; attach to Nayra purge + Stasis/Exposed"
```

---

## Task 3: Engine flag tracking + threading + live gate

**Files:**
- Modify: `src/utils/combat/engine.ts` (declare Set ~`:1896`; set in `applyHealToTarget` ~`:1920`; clear at round top ~`:2129`; thread in `buildTurnArgs` ~`:2695`; optional test seam)
- Modify: `src/utils/combat/playerTurn.ts` (`PlayerTurnArgs` ~`:243`; destructure ~`:604`; four `buildRoundContext` calls ~`:850/:996/:1063/:1142`; explicit purge gate ~`:1384`)
- Test: `src/utils/combat/__tests__/nayraRepairedPurge.test.ts` (new)

After this task the chain is live: heal → flag set → threaded into the round ctx → `gateFiringAbilities` (and the explicit gate) drop the purge when the target was not repaired.

- [ ] **Step 1: Write the failing integration test**

New file `src/utils/combat/__tests__/nayraRepairedPurge.test.ts`. Use the two-team battle-sim harness from `purgeCastPath.test.ts` (copy its `ab`/`parsedTarget`/`basePattern` helpers + `__testTapStatusEngine` read). Scenario (enemy Nayra purges the player heal target):

- Player **focus** (= `healTargetId`): positioned, parsed target front, has a removable self-buff it applies to ITSELF each round ("Attack Up", duration 99), and starts BELOW max HP so a heal consumes > 0 (e.g. give it a low `hp` and let an early enemy hit, OR add a HoT/self-heal — pick the simplest deterministic mechanism; document it). It also runs a heal-on-self ability OR is healed by a fast player ally so that `applyHealToTarget` lands `consumed > 0` for the focus this round.
- Enemy **Nayra-like** attacker (SLOW — acts AFTER the heal lands): an `on-cast` purge ability with `target:'enemy'`, `config:{type:'purge',count:'all'}`, and `conditions:[{subject:'target-repaired-this-round',derivable:true}]`, plus a basic hit so `targetId` resolves to the focus.

Assert two runs:
1. **Repaired** → the focus's "Attack Up" self-buff is REMOVED (purge fired). Read via `statusEngine.timedAbilityStatuses('self', focusId)` through the tap.
2. **Not repaired** (remove the heal / start the focus at full HP so `consumed === 0`) → "Attack Up" REMAINS (purge did not fire).

```ts
it('enemy Nayra purges the heal target ONLY when it was repaired this round', () => {
    // ... build both scenarios, run, assert buff removed vs retained
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/nayraRepairedPurge.test.ts`
Expected: FAIL — `targetRepairedThisRound` is never threaded, so the condition is always false → `gateFiringAbilities` drops the purge in BOTH runs → "Attack Up" remains even in the repaired run.

- [ ] **Step 3: Declare + clear the engine Set**

`src/utils/combat/engine.ts`:
- Declare at `runCombat` scope BEFORE the `healingCtx` construction (~`:1896`, alongside the other combat-lifetime state):
```ts
  // Per-round set of actor ids that received a positive HP repair this round (C2b-3).
  // Cleared at each round top; read in buildTurnArgs for the target-repaired gate.
  const repairedThisRound = new Set<string>();
```
- Clear at the round loop top, right after `statusEngine.beginRound(r);` (~`:2129`):
```ts
        repairedThisRound.clear();
```
(Deliberately clear here, NOT at the `round-started` emit (`engine.ts:~3033`, which both spec and this plan stale-cite as `:2987`). Clearing before `round-started` means start-of-round reactive heals fired by that emit correctly count toward this round's repaired set; clearing at the emit would wrongly wipe them.)

- [ ] **Step 4: Set the flag inside applyHealToTarget**

`src/utils/combat/engine.ts` ~`:1920`, inside the `applyHealToTarget` closure, immediately after `healTarget.currentHp += consumed;`:
```ts
                  if (consumed > 0) repairedThisRound.add(healTarget.id);
```
(Single site — covers cast-path, reactive, and engine-credit heals, all of which call this closure. NOT added to `grantShieldToTarget`: shields are not repairs.)

- [ ] **Step 5: Thread into buildTurnArgs**

`src/utils/combat/engine.ts` ~`:2695`, in the object `buildTurnArgs` returns, beside `targetHpPct: healTargetHpPctNow(),`:
```ts
                // C2b-3: was the STRUCK victim (tgt) repaired this round? Per-actor-correct
                // (unlike targetHpPct, which always reports the heal target). DPS dummy / un-
                // repaired enemy → false → byte-identical (the purge block guards on targetId).
                targetRepairedThisRound: repairedThisRound.has(tgt.id),
```

- [ ] **Step 6: Add the arg to PlayerTurnArgs + destructure**

`src/utils/combat/playerTurn.ts`:
- In `PlayerTurnArgs` (~`:243`, beside `targetHpPct?: number;`):
```ts
    targetRepairedThisRound?: boolean;
```
- In the destructuring block (~`:604`, beside `targetHpPct: targetHpPctArg = 100,`):
```ts
        targetRepairedThisRound: targetRepairedThisRoundArg = false,
```

- [ ] **Step 7: Thread into all four buildRoundContext calls**

`src/utils/combat/playerTurn.ts` — at each `buildRoundContext({...})` call (~`:840` preDebuffGateCtx, ~`:986` postDebuffGateCtx, ~`:1053` modifierCtx, ~`:1131` ctx), beside the existing `targetHpPct: targetHpPctArg,` line, add:
```ts
        targetRepairedThisRound: targetRepairedThisRoundArg,
```
(Mirror exactly how `targetHpPctArg`/`selfHpPctArg` appear in all four. The `:1131` ctx feeds `gateFiringAbilities` (the purge + Stasis/Exposed gate); the others keep the gate ctxs consistent.)

- [ ] **Step 8: Explicit gate at the on-cast purge fire (defense-in-depth + contract)**

`src/utils/combat/playerTurn.ts` ~`:1384`, change the purge fire condition:
```ts
            if (
                ab.config.type === 'purge' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
```
`conditionsMet` is already imported (`:2`); `ctx` is the `:1131` round context, in scope. NOTE: `gateFiringAbilities` (`applyAbilities.ts:211`) already drops a failing-condition purge from `gatedSkill.abilities`, so this is belt-and-suspenders — but it makes the fire site self-documenting and is robust if the build path ever changes. Byte-identical for every existing purge (all carry `conditions: []` → `conditionsMet([], ctx) === true`).

- [ ] **Step 9: (Optional) test seam for the flag**

If the integration test cannot cleanly observe the flag, add a production-inert `__testTapRepairedThisRound?: (snapshot: Set<string>) => void` (mirror `__testTapStatusEngine`/`__testTapIsStasised`) invoked once per round after the turns, and assert in a small unit test that the focus id is present in the repaired run and the set is empty at the next round's top. Skip if the integration assertion suffices.

- [ ] **Step 10: Run the integration test**

Run: `npx vitest run src/utils/combat/__tests__/nayraRepairedPurge.test.ts`
Expected: PASS — buff removed in the repaired run, retained in the un-repaired run.

- [ ] **Step 11: Full suite + all gates (byte-identical check)**

Run:
```bash
npx vitest run && npm run lint && npx tsc --noEmit && npm run audit:skills
```
Expected: green (Task-0 count + the new test's assertions), lint 0, tsc clean, `audit:skills` 0/141, **ZERO `.snap` movement** (no Nayra fixture; the new field defaults false everywhere a golden runs; the purge gate only changes Nayra's behavior). If a golden moves, audit it line-by-line — do NOT `vitest -u`.

- [ ] **Step 12: Commit**
```bash
git add -A && git commit -m "C2b-3 T3: engine repaired-this-round tracking + thread + gate Nayra purge"
```

---

## Task 4: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Add the changelog entry**

Plain-English line in `UNRELEASED_CHANGES`, e.g.:
> Combat sim: Nayra's charged ability now purges enemy buffs only when its target was actually repaired that round (previously it stripped all buffs unconditionally).

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "C2b-3: changelog — Nayra target-repaired purge gating"
```

---

## Golden gate & honesty (whole PR)

- **Production BYTE-IDENTICAL expected** (zero `.snap` movement): only Nayra references the new subject, no Nayra fixture exists, and the new `ConditionContext` field defaults false everywhere a golden runs. DPS dummy is never repaired and the purge block guards on `targetId !== undefined`.
- The behavior change is exercised ONLY by the new `nayraRepairedPurge.test.ts`.
- Run every gate (`npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills`) at the end of EVERY task — `tsc` independently (esbuild-based Vitest passes despite type errors; B3 lesson).
- NEVER bare `npm test` (Vitest watch — hangs). NEVER blind `vitest -u`.

## Deferred / out of scope (carry the §6.4 + §7 notes)
- Per-victim repair tracking for arbitrary actors (so player-Nayra-vs-enemy can fire) → sub-project E (per-victim AoE accounting); today only the single heal target is tracked.
- Lodolite p3 shield-removal-on-purge → sub-project H. Amartya true multi-victim AoE purge + crit-power count-scaling → sub-project E.
- A future Nayra fixture MUST verify the Stasis/Exposed inflict gating (the §6.4 parser ride-along) behaves as intended once it can be observed.

## Workflow
- Branch `feat/combat-sim-phase5-pr2` (the open PR #117 chain). Subagent-driven; per-task spec+quality review, final holistic (opus) review before declaring ready.
- `gh auth switch --hostname github.com --user TheSusort` before any gh op. Docs are gitignored → `git add -f` if committing plan/spec; `--no-verify` as the campaign does.
