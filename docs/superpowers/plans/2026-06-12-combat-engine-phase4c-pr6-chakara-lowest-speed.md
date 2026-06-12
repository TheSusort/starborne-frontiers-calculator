# Phase 4c PR 6 — Chakara lowest-speed buffs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Chakara's start-of-round Attack Up II + Defense Up II self-buffs, gated live on Chakara having the lowest Speed among its player team. Closes `docs/skill-model-coverage.md` §6 item 10.

**Architecture:** A new `lowest-speed-ally` condition subject. The buff abilities carry `trigger: 'start-of-round'`, so they partition into the reactive executor and are gated each round at `executeIntent` → `buildDrainContext` — fed by a new `IntentExecContext.isLowestSpeedAllyFor` delegate the engine computes once from the static player-team speeds. Parser changes extract the `"starts each round with X and Y"` phrasing (Gap A) and classify the lowest-speed condition (Gap B). Default-`true` (in `buildRoundContext`) preserves single-ship DPS behaviour.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, parser in `src/utils/skillTextParser.ts`, condition model in `src/types/abilities.ts` + `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-12-combat-engine-phase4c-pr6-chakara-lowest-speed-design.md`

---

## Critical context (read before starting)

- **Why the reactive path, not the seed:** `start-of-round` is in `LIVE_TRIGGERS`. After Gap A stamps the buffs with `trigger: 'start-of-round'`, `partitionReactiveAbilities` routes them into `reactiveAbilities` (NOT `castSkills`). So `registerActorAbilityStatuses` and the round-1-only `seedPassiveTimedStatuses` (`engine.ts:1671`, `if (r === 1)`) **never see them**. They fire every round via the `round-started` event and are gated at `executeIntent` (`triggers.ts:748`) against `buildDrainContext`. **`buildDrainContext` is the only gate site that matters.**
- **Goldens are synthetic & hand-built** (`dpsGoldenParity.test.ts`, `healingGoldenParity.test.ts`) — they import no parser and contain no Chakara / no `lowest-speed-ally`. They MUST stay byte-identical. **Never run `vitest -u`.**
- **`docs/` is gitignored** → use `git add -f` for the spec/plan; `--no-verify` only for docs-only commits (the pre-commit hook runs the full suite).
- **Before any PR/merge/gh-api op:** `gh auth switch --hostname github.com --user TheSusort`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/abilities.ts` | Condition model | Add `'lowest-speed-ally'` to `ConditionSubject` |
| `src/utils/abilities/evaluateConditions.ts` | Condition eval + `ConditionContext` | Add `isLowestSpeedAlly` field + eval case |
| `src/utils/abilities/roundContext.ts` | `ConditionContext` constructor | Add param + `?? true` default |
| `src/utils/combat/abilityStatusGating.ts` | Live-subject set | Add `'lowest-speed-ally'` to `LIVE_SUBJECTS` |
| `src/utils/skillTextParser.ts` | Skill-text parsing | Gap A (extraction + trigger) + Gap B (condition) |
| `src/utils/combat/triggers.ts` | Reactive executor + ctx builders | `IntentExecContext` delegate + `buildDrainContext` + `buildActorConditionContext` shared bag |
| `src/utils/combat/engine.ts` | Combat loop | Compute `lowestSpeedAllyIds`; provide delegate |
| `src/components/skills/ConditionRow.tsx` | Editor condition picker | Add subject value + label |
| `src/constants/changelog.ts` | Changelog | Fold into the evolving DPS/combat entry |
| `docs/skill-model-coverage.md` | Coverage doc | Mark §6 item 10 shipped + §5 PR6 entry |

---

## Task 1: Condition subject + evaluation + roundContext default

**Files:**
- Modify: `src/types/abilities.ts` (the `ConditionSubject` union, ~line 89-113)
- Modify: `src/utils/abilities/evaluateConditions.ts` (`ConditionContext` ~line 4-21; `evaluateCondition` switch ~line 27-68)
- Modify: `src/utils/abilities/roundContext.ts` (`buildRoundContext` param + return)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `evaluateConditions.test.ts`. **Add the import** `import { buildRoundContext } from '../roundContext';` (the test file currently imports only from `../evaluateConditions`):

```typescript
describe('lowest-speed-ally', () => {
    it('returns 1 when isLowestSpeedAlly is true', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [], landedEnemyDebuffCount: 0, corrosionEntryCount: 0,
            infernoEntryCount: 0, bombCount: 0, effectiveCritRate: 0,
            isLowestSpeedAlly: true,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(1);
    });

    it('returns 0 when isLowestSpeedAlly is false', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [], landedEnemyDebuffCount: 0, corrosionEntryCount: 0,
            infernoEntryCount: 0, bombCount: 0, effectiveCritRate: 0,
            isLowestSpeedAlly: false,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(0);
    });

    it('defaults to 1 (lone-actor DPS assumption) when the field is omitted', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [], landedEnemyDebuffCount: 0, corrosionEntryCount: 0,
            infernoEntryCount: 0, bombCount: 0, effectiveCritRate: 0,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(1);
    });
});
```

Ensure `buildRoundContext` and `evaluateCondition` are imported in the test file (they may already be).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts -t lowest-speed-ally`
Expected: FAIL — TypeScript error (`'lowest-speed-ally'` not in `ConditionSubject`) and/or `isLowestSpeedAlly` not a known property.

- [ ] **Step 3: Implement**

In `src/types/abilities.ts`, add to the `ConditionSubject` union (place after `'enemy-adjacent'` or near the other binary gates):

```typescript
    | 'lowest-speed-ally'
```

In `src/utils/abilities/evaluateConditions.ts`, add to `ConditionContext` (after `targetHpPct`).
**MUST be OPTIONAL** — `buildRoundContext` is NOT the only `ConditionContext` constructor (direct
literals exist in `buffAbilityConverters.ts` `buildStaticBuffContext` and several test helpers); a
required field would break `tsc`. The default-true contract still holds via `buildRoundContext`'s
`?? true`; the inline/static constructors never use the `lowest-speed-ally` subject, so an
`undefined → 0` there is inert.

```typescript
    /** True when the condition owner has the lowest Speed among its (player) team
     *  (ties → all tied qualify). Optional; defaults to true via buildRoundContext (a lone
     *  actor — single-ship DPS, drain default — is trivially slowest). Populated live by the
     *  engine via buildDrainContext. */
    isLowestSpeedAlly?: boolean;
```

Add the switch case (after `'enemy-hp-missing-pct'`):

```typescript
        case 'lowest-speed-ally':
            return ctx.isLowestSpeedAlly ? 1 : 0;
```

In `src/utils/abilities/roundContext.ts`, add to the `state` param (after `selfDebuffNames`):

```typescript
    /** Owner has the lowest Speed among its (player) team. Default true (lone-actor /
     *  DPS assumption: a single attacker is trivially the slowest). Populated live by the
     *  engine drain context (Phase 4c PR 6). */
    isLowestSpeedAlly?: boolean;
```

And to the returned object (after `enemyHpPct`):

```typescript
        isLowestSpeedAlly: state.isLowestSpeedAlly ?? true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts -t lowest-speed-ally`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/abilities.ts src/utils/abilities/evaluateConditions.ts src/utils/abilities/roundContext.ts src/utils/abilities/__tests__/evaluateConditions.test.ts
git commit -m "feat(combat): add lowest-speed-ally condition subject + eval (PR6 task 1)"
```

---

## Task 2: Register `lowest-speed-ally` as a live subject

**Files:**
- Modify: `src/utils/combat/abilityStatusGating.ts` (`LIVE_SUBJECTS` set ~line 14-25)
- Test: `src/utils/combat/__tests__/abilityStatusGating.test.ts` (if it exists; otherwise add a small new test file)

- [ ] **Step 1: Write the failing test**

If `abilityStatusGating.test.ts` exists, add; else create it:

```typescript
import { describe, it, expect } from 'vitest';
import { liveGateConditions } from '../abilityStatusGating';

describe('liveGateConditions — lowest-speed-ally', () => {
    it('keeps a derivable lowest-speed-ally condition (does NOT neutralize to always)', () => {
        const out = liveGateConditions([{ subject: 'lowest-speed-ally', derivable: true }]);
        expect(out).toEqual([{ subject: 'lowest-speed-ally', derivable: true }]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/abilityStatusGating.test.ts`
Expected: FAIL — the condition is rewritten to `{ subject: 'always', derivable: true }` (not in `LIVE_SUBJECTS`).

- [ ] **Step 3: Implement**

In `src/utils/combat/abilityStatusGating.ts`, add to `LIVE_SUBJECTS`:

```typescript
    'lowest-speed-ally',
```

Update the doc comment above the set to mention `lowest-speed-ally` (live-derived from player-team speeds, PR 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/abilityStatusGating.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/abilityStatusGating.ts src/utils/combat/__tests__/abilityStatusGating.test.ts
git commit -m "feat(combat): register lowest-speed-ally in LIVE_SUBJECTS (PR6 task 2)"
```

---

## Task 3: Parser Gap B — classify the lowest-speed condition

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`detectGrantConditions`, after the "at full HP" rule ~line 612-622, before the count-gate rule ~line 624)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `skillTextParser.test.ts` (in the `detectGrantConditions` describe block):

```typescript
it('classifies "lowest speed among all allies" as a derivable lowest-speed-ally gate', () => {
    const text =
        'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';
    expect(detectGrantConditions(text, 'Attack Up II')).toEqual([
        { subject: 'lowest-speed-ally', derivable: true },
    ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t "lowest speed among all allies"`
Expected: FAIL — returns `[]` (no rule).

- [ ] **Step 3: Implement**

In `detectGrantConditions`, immediately after the `at full HP` block (the one returning an `hp-threshold` condition), add:

```typescript
    // Chakara: "if it has the lowest Speed among all allies" — a derivable team-speed gate.
    // Live-derived in the engine from the player team's static speeds (lone actor → true).
    if (/\blowest\s+speed\s+among\s+(?:all\s+)?allies\b/i.test(low)) {
        return [{ subject: 'lowest-speed-ally', derivable: true }];
    }
```

(`low` is the lowercased clause already in scope. The early keyword gate at the top of the function passes because the clause contains "if".)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t "lowest speed among all allies"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(parser): classify lowest-speed-among-allies gate (PR6 task 3)"
```

---

## Task 4: Parser Gap A — extract "starts each round with X and Y" + start-of-round trigger

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`findVerb` ~line 2066-2105; `START_OF_ROUND_RE` ~line 700)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe('Chakara "starts each round with" extraction (Gap A)', () => {
    const txt =
        'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';

    it('extracts BOTH self-buffs with duration 1', () => {
        const effects = parseSkillEffects(txt, 'passive2');
        const buffs = effects.filter((e) => e.target === 'self').map((e) => e.buffName).sort();
        expect(buffs).toEqual(['Attack Up II', 'Defense Up II']);
        for (const e of effects.filter((e) => e.target === 'self')) {
            expect(e.duration).toBe(1);
        }
    });

    it('maps the phrasing to the start-of-round trigger', () => {
        expect(detectReactiveTrigger(txt, 'Attack Up II')).toBe('start-of-round');
    });
});
```

Confirm `parseSkillEffects` and `detectReactiveTrigger` are exported and imported in the test file (both are exported from `skillTextParser.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t "starts each round with"`
Expected: FAIL — `parseSkillEffects` returns `[]` for the self-buffs (no application verb); `detectReactiveTrigger` returns `undefined`.

- [ ] **Step 3: Implement**

(a) In `skillTextParser.ts`, add a module-level regex near `START_OF_ROUND_RE`:

```typescript
// "starts (each|every|the) round with <buff>" — a start-of-round self-grant whose governing
// phrase uses no application verb (Chakara's R2 passive; unique in the corpus). findVerb treats
// it as a self-receive ('gains') so the buff segments extract.
const STARTS_ROUND_WITH_RE = /\bstarts?\s+(?:each|every|the)\s+round\s+with\b/i;
```

(b) In `findVerb`, replace the final `return undefined;` (after the word-scan loop) with:

```typescript
    // "starts each round with <buff>" carries no application verb in the scanned text — treat
    // the construct as a self-receive so the segment loop extracts the conjoined buffs.
    if (STARTS_ROUND_WITH_RE.test(accumulatedText)) return 'gains';
    return undefined;
```

(`'gains'` is in `SELF_VERBS`, so `verbToTarget` returns `'self'`. The shared-duration scan then attaches "for 1 turn" to both conjoined buffs.)

(c) Extend `START_OF_ROUND_RE` to also match the "starts … round" phrasing:

```typescript
const START_OF_ROUND_RE =
    /at the start of (?:the|each|every) round|starts? (?:the|each|every) round/i;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t "starts each round with"`
Expected: PASS (2 tests).

- [ ] **Step 5: Guard against corpus false-positives**

Run: `grep -inP "starts? (each|every|the) round" docs/ship-skills.csv`
Expected: only the Chakara row. If any OTHER ship matches, manually verify the broadened `START_OF_ROUND_RE` / `STARTS_ROUND_WITH_RE` does not mis-stamp it (a start-of-round trigger or a phantom self-grant). Note any in the PR description. (As of 2026-06-12 grep, Chakara is the sole `"starts … round with"` user.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(parser): extract 'starts each round with' self-grant + start-of-round trigger (PR6 task 4)"
```

---

## Task 5: buildShipAbilities — Chakara end-to-end

**Files:**
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (the existing Chakara passive test ~line 1043)

This task wires Tasks 3 + 4 together (no new production code expected — `mergeBuff` already runs `detectGrantConditions` + `detectReactiveTrigger` per buff). It LOCKS the integrated output.

- [ ] **Step 1: Extend the existing Chakara test**

Replace the body of `it('Chakara third passive: round-start damage proc parses as a passive damage ability', …)` (or add a sibling test) so it asserts the buffs too:

```typescript
it('Chakara passive: round-start damage proc + both self-buffs gated on lowest-speed', () => {
    const s = ship({
        thirdPassiveSkillText:
            'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
    });
    const passive = buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive');
    // 60% damage proc still parses.
    expect(passive?.abilities.find((a) => a.type === 'damage')).toMatchObject({
        config: { type: 'damage', multiplier: 60 },
    });
    // Both self-buffs now emit, with start-of-round trigger + lowest-speed-ally gate.
    const buffs = (passive?.abilities ?? []).filter((a) => a.type === 'buff');
    expect(buffs.map((b) => b.config.type === 'buff' && b.config.buffName).sort()).toEqual([
        'Attack Up II',
        'Defense Up II',
    ]);
    for (const b of buffs) {
        expect(b.trigger).toBe('start-of-round');
        expect(b.target).toBe('self');
        expect(b.conditions).toEqual([{ subject: 'lowest-speed-ally', derivable: true }]);
    }
});
```

Note: the test uses `thirdPassiveSkillText` with the `ship()` helper (which produces a fixture whose refit-active passive resolves to this text — matching the existing test). If `ship()` defaults to few refits and resolves a different passive column, set the text on the column the existing line-1043 test used (it used `thirdPassiveSkillText` and worked, so keep that).

- [ ] **Step 2: Run test to verify it fails (then passes)**

Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts -t "Chakara"`
Expected: with Tasks 3+4 implemented, PASS. If it FAILS on the buffs, debug the `mergeBuff` wiring (Tasks 3/4 outputs). The `.coverage.test.ts` Chakara test (active skill) should be unaffected — run it too:
`npx vitest run src/utils/abilities/__tests__/buildShipAbilities.coverage.test.ts -t "Chakara"`

- [ ] **Step 3: Commit**

```bash
git add src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "test(combat): lock Chakara passive buffs + lowest-speed gate end-to-end (PR6 task 5)"
```

---

## Task 6: Engine plumbing — live `lowest-speed-ally` via IntentExecContext delegate

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` ~line 419; `buildActorConditionContext` shared bag ~line 517 + forward ~line 544; `buildDrainContext` ~line 559-585)
- Modify: `src/utils/combat/engine.ts` (compute set after `runtimesById` ~line 1551; provide delegate at `IntentExecContext` assembly ~line 2046, alongside `selfHpPctFor`)
- Test: `src/utils/combat/__tests__/lowestSpeedAlly.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/lowestSpeedAlly.test.ts`. Model on `enemyBuffSelfDebuffGate.test.ts`'s `GRANT_BASE` / `grantGatedSelfBuffSkill` pattern, but the gated buff fires on `start-of-round` and the gate is `lowest-speed-ally`; vary focus vs team speed:

```typescript
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ls${++idc}`, target: 'self', trigger: 'on-cast', conditions: [], ...p,
});

// Focus deals 100% damage and gains a +100% Attack start-of-round self-buff GATED on
// lowest-speed-ally. The buff couples into the same round's outgoing damage, so directDamage
// doubles (20000) only on rounds the gate passes; otherwise it stays at base 10000.
const skill = (): ShipSkills => ({
    slots: [{
        slot: 'active',
        abilities: [
            ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
            ab({
                type: 'buff', target: 'self', trigger: 'start-of-round',
                conditions: [{ subject: 'lowest-speed-ally', derivable: true }],
                config: { type: 'buff', buffName: 'Attack Up', parsedEffects: { attack: 100 },
                    stacks: 1, isStackable: false, duration: 99 },
            }),
        ],
    }],
});

const BASE = (o: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10000, crit: 0, critDamage: 0, defensePenetration: 0, chargeCount: 0,
    shipSkills: skill(), enemyDefense: 0, enemyHp: 1_000_000_000, numRounds: 2,
    selfBuffs: [], enemyDebuffs: [], debuffLandingChance: 1, selfDotModifier: 0,
    defensePenetrationBuff: 0, hasChargedSkill: false, startCharged: false,
    affinityDamageModifier: 0, affinityCritCap: 100, affinityCritPenalty: 0,
    defence: 2000, hp: 1_000_000, ...o,
});

describe('lowest-speed-ally live gate', () => {
    it('single attacker (no team) → focus is trivially slowest → buff fires (damage doubles)', () => {
        idc = 0;
        const r = runCombat(BASE({ speed: 100 }));
        expect(r.rounds[0].directDamage).toBe(20000);
    });

    it('focus is the slowest on the team → buff fires', () => {
        idc = 0;
        const r = runCombat(BASE({
            speed: 10,
            teamActors: [{ id: 't1', speed: 100, chargeCount: 0, startCharged: false,
                selfBuffs: [], enemyDebuffs: [] }],
        }));
        expect(r.rounds[0].directDamage).toBe(20000);
    });

    it('a teammate is slower than focus → focus is NOT lowest → buff gated off (base damage)', () => {
        idc = 0;
        const r = runCombat(BASE({
            speed: 100,
            teamActors: [{ id: 't1', speed: 10, chargeCount: 0, startCharged: false,
                selfBuffs: [], enemyDebuffs: [] }],
        }));
        expect(r.rounds[0].directDamage).toBe(10000);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/lowestSpeedAlly.test.ts`
Expected: FAIL — without the engine delegate, `buildDrainContext` defaults `isLowestSpeedAlly` to `true` for ALL owners, so the third test (gated-off) wrongly doubles to 20000.

- [ ] **Step 3: Implement — triggers.ts**

(a) `IntentExecContext` (after `selfHpPctFor`):

```typescript
    /** Whether `ownerId` has the lowest Speed among the player team (ties → all qualify),
     *  feeding the `lowest-speed-ally` gate at drain time. Computed once by the engine (Speed
     *  is static turn-order in this sim). Absent → buildDrainContext defaults the gate to true
     *  (lone-actor DPS assumption). */
    isLowestSpeedAllyFor?: (ownerId: string) => boolean;
```

(b) `buildActorConditionContext` `shared` bag (after `selfDebuffNames?`):

```typescript
        /** Owner has the lowest Speed among its player team. Default true (lone-actor /
         *  DPS assumption). Populated by buildDrainContext (Phase 4c PR 6). */
        isLowestSpeedAlly?: boolean;
```

And forward it in the `buildRoundContext({...})` call inside `buildActorConditionContext`:

```typescript
        isLowestSpeedAlly: shared.isLowestSpeedAlly,
```

(c) `buildDrainContext` — add to the `buildActorConditionContext` shared bag:

```typescript
        // Phase 4c PR 6: live lowest-speed-ally gate (Chakara). Default true → DPS / no-delegate
        // paths keep the lone-actor assumption and stay byte-identical.
        isLowestSpeedAlly: ctx.isLowestSpeedAllyFor?.(ownerId) ?? true,
```

- [ ] **Step 4: Implement — engine.ts**

(a) **Source the speeds from `allPlayerActors`, NOT `runtimesById`.** `runtimesById`
(`engine.ts:1548`) only contains WALKED team actors — the team-runtime builder skips non-walked
actors (`engine.ts:1135` `if (!t.walk) return;`), so a legacy/non-walked teammate's Speed would be
invisible and the gate would wrongly treat the focus as slowest. `allPlayerActors`
(`engine.ts:1219` = `[attacker, ...teamCombatActors]`) includes EVERY player actor with a real
`stats.speed` and `side: 'player'`. Add immediately after the `allPlayerActors` definition (~line 1219,
outside the round loop — still in closure scope at the `IntentExecContext` assembly ~2046):

```typescript
    // Phase 4c PR 6: player-team actors sharing the minimum Speed (ties → all). Speed is static
    // turn-ORDER in this sim, so compute once. Feeds the lowest-speed-ally gate (Chakara).
    // Sourced from allPlayerActors (NOT runtimesById, which omits non-walked team actors).
    const minPlayerSpeed = Math.min(...allPlayerActors.map((a) => a.stats.speed));
    const lowestSpeedAllyIds = new Set(
        allPlayerActors.filter((a) => a.stats.speed === minPlayerSpeed).map((a) => a.id)
    );
```

(b) At the `IntentExecContext` object literal inside `drainIntents` (~line 2046), add as an
**UNCONDITIONAL top-level property** (e.g. next to `oncePerCombatFired` at ~line 2097). **Do NOT
place it inside the `...(healTarget ? { selfHpPctFor: … } : {})` conditional spread** (lines
~2103-2118) — that spread is healing-mode-only, and Chakara's DPS gate needs the delegate in DPS
mode too:

```typescript
                        // Phase 4c PR 6: live lowest-speed-ally gate. UNCONDITIONAL (unlike the
                        // healing-only selfHpPctFor spread) — in DPS mode the set is {attacker}, so
                        // the lone attacker resolves true and DPS gating stays byte-identical.
                        isLowestSpeedAllyFor: (ownerId: string): boolean =>
                            lowestSpeedAllyIds.has(ownerId),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/lowestSpeedAlly.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/lowestSpeedAlly.test.ts
git commit -m "feat(combat): live lowest-speed-ally gate via IntentExecContext delegate (PR6 task 6)"
```

---

## Task 7: Editor — expose the new subject in ConditionRow

**Files:**
- Modify: `src/components/skills/ConditionRow.tsx` (`SUBJECT_VALUES` ~line 15-33; `EXTRA_SUBJECT_LABELS` ~line 36-46)

- [ ] **Step 1: Implement**

Add `'lowest-speed-ally'` to `SUBJECT_VALUES` (e.g. after `'ally-on-team'`):

```typescript
    'lowest-speed-ally',
```

Add a label to `EXTRA_SUBJECT_LABELS`:

```typescript
    'lowest-speed-ally': 'when this unit has the lowest Speed among allies',
```

- [ ] **Step 2: Verify type + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (0 errors, 0 warnings). The `ConditionRow` `<Select>` now lists the new subject.

- [ ] **Step 3: Commit**

```bash
git add src/components/skills/ConditionRow.tsx
git commit -m "feat(editor): expose lowest-speed-ally condition subject (PR6 task 7)"
```

---

## Task 8: Golden parity, audit, docs, changelog

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `docs/skill-model-coverage.md` (§6 item 10; §5 PR6 entry; the "4c PR 6 — pending" pointer line ~1380)

- [ ] **Step 1: Confirm goldens byte-identical**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: PASS, unchanged. If ANY golden diffs, STOP — investigate (a real regression). Do NOT `-u`.

- [ ] **Step 2: Skill audit clean**

Run: `npm run audit:skills` (or the project's audit script)
Expected: 0 findings (Chakara now fully parses; no new orphan). If Chakara is flagged, reconcile.

- [ ] **Step 3: Full suite + lint + types**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all green, 0 warnings.

- [ ] **Step 4: Changelog**

In `src/constants/changelog.ts`, fold a note into the SINGLE evolving DPS/combat `UNRELEASED_CHANGES` entry (do not add a separate entry):

> Chakara's start-of-round Attack Up / Defense Up self-buffs are now simulated when it has the lowest Speed on its team.

- [ ] **Step 5: Coverage doc**

In `docs/skill-model-coverage.md`:
- Mark §6 item 10 as **SHIPPED 2026-06-12 (Phase 4c PR 6)** with a one-line summary (new `lowest-speed-ally` subject; `"starts each round with"` extraction; live-derived from player-team speed via `buildDrainContext`).
- Add a `§5 PHASE 4c PR 6` entry mirroring the PR4/PR5 style.
- Update the "**4c PR 6 — pending**" pointer line (~1380) to "SHIPPED".

- [ ] **Step 6: Commit (docs are gitignored → -f; code changelog is tracked)**

```bash
git add src/constants/changelog.ts
git commit -m "docs(changelog): Chakara lowest-speed buffs (PR6 task 8)"
git add -f docs/skill-model-coverage.md
git commit --no-verify -m "docs(coverage): mark §6 item 10 (Chakara lowest-speed) shipped — PR6"
```

---

## Final verification before PR

- [ ] `npm test` — full suite green (incl. new `lowestSpeedAlly.test.ts`, extended Chakara test, parser + eval tests).
- [ ] `npm run lint && npx tsc --noEmit` — 0 warnings, 0 type errors.
- [ ] `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts src/utils/calculators/__tests__/healingGoldenParity.test.ts` — byte-identical.
- [ ] `npm run audit:skills` — 0 findings.
- [ ] Request code review (superpowers:requesting-code-review). Then `gh auth switch --hostname github.com --user TheSusort` and open the PR.

## Notes / gotchas

- **DPS-mode shift (intended, no golden churn):** Chakara's real-data DPS now includes Attack Up II each round (lone attacker = slowest). No synthetic golden locks Chakara, so goldens don't move. Offer to verify on the user's real fleet.
- **`'gains'` synthetic verb (Task 4b):** scoped by `STARTS_ROUND_WITH_RE`; Chakara is the only corpus match. Don't broaden the regex.
- **Default-`true` invariant:** every `ConditionContext` flows through `buildRoundContext`, which applies `?? true`. Only `buildDrainContext` overrides it with a live value. Do NOT add `isLowestSpeedAlly` to the seed or foreign-caster sites — Chakara's buff never rides those paths (it's a reactive start-of-round intent).
