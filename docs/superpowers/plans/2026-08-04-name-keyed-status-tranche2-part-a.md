# Name-Keyed Status Tranche 2, Part A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Shield Converter` (Quixilver) and `Charged Overdrive II` (Sentinel) do something — the last two cheap name-keyed one-shots from the tranche-1 triage.

**Architecture:** Both statuses already land as genuine statuses with correct target; only `parsedEffects` is empty, so no parser or status-delivery work is needed. Each becomes a **name-keyed read at one site**, plus a shared "persistent until consumed" routing channel that makes the parsed duration irrelevant. Shield Converter intercepts a direct hit in `applyVictimDamage` and converts it to Shield; Charged Overdrive II adds +20 Defense Penetration to one charged cast in `playerTurn`.

**Tech Stack:** TypeScript, Vitest, React (untouched here — this is engine-only).

**Spec:** `docs/superpowers/specs/2026-08-04-name-keyed-status-tranche2-design.md`
**Branch:** `fix/name-keyed-status-tranche2` (already exists, spec committed at `1dec763e`)

## Global Constraints

- **The one-shot invariant (non-negotiable):** a one-shot status must read ONLY channels its consume call can spend. Both modules read `statusEngine.timedAbilityStatuses('self', actorId)` and consume with `statusEngine.removeSelfBuffByName(actorId, NAME)`. **Never** `selfBuffNamesForOwners` — that union includes always-active entries `removeSelfBuffByName` cannot reach, which makes a hand-picked instance permanent.
- **`Charged Overdrive II` is NOT `Charge Overdrive II`.** Both exist in `src/constants/buffs.ts` (~:697 and ~:812) with the same +20% magnitude. The former is one-shot and charged-only; the latter is standing. Do not merge, alias, or "deduplicate" them.
- **Accounting invariant (from #293):** `Σ perTargetDealt == Σ perTargetDamage == Σ perActorIncoming[].incoming`. Shield Converter must NOT reverse `.incoming`.
- Run the FULL `npm test` before any commit — the golden audit spans the whole run. **Never** `vitest -u`.
- Percentage stats are stored as integers (`20` means 20%, not `0.20`).
- No emojis in any UI or log text.
- Every `UNRELEASED_CHANGES` entry starts with a category prefix — here `'Combat simulator: '`.

---

### Task 1: One-shot persistent channel

Routes named one-shots into the existing persistent status store so their parsed duration is ignored and they survive until consumed. That store is already surfaced by `timedAbilityStatuses` and already cleared by `removeSelfBuffByName` — exactly the read/consume pair the invariant needs.

**Files:**
- Create: `src/constants/oneShotPersistentBuffs.ts`
- Modify: `src/utils/combat/statusEngine.ts` (three consult sites: ~610, ~739, ~1408)
- Test: `src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts`

**Interfaces:**
- Consumes: `PERSISTENT_STACKING_BUFFS` from `src/constants/persistentStackingBuffs.ts`
- Produces:
  - `ONE_SHOT_PERSISTENT_BUFFS: ReadonlySet<string>`
  - `isPersistentByName(buffName: string): boolean`
  - `persistentCapFor(buffName: string): number | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    ONE_SHOT_PERSISTENT_BUFFS,
    isPersistentByName,
    persistentCapFor,
} from '../../../constants/oneShotPersistentBuffs';
import { PERSISTENT_STACKING_BUFFS } from '../../../constants/persistentStackingBuffs';

describe('one-shot persistent buff names', () => {
    it('holds exactly the two tranche-2 statuses', () => {
        expect([...ONE_SHOT_PERSISTENT_BUFFS].sort()).toEqual([
            'Charged Overdrive II',
            'Shield Converter',
        ]);
    });

    it('does NOT contain the standing Charge Overdrive II — different mechanic, same magnitude', () => {
        expect(ONE_SHOT_PERSISTENT_BUFFS.has('Charge Overdrive II')).toBe(false);
    });

    it('treats both one-shot and stacking names as persistent', () => {
        expect(isPersistentByName('Shield Converter')).toBe(true);
        expect(isPersistentByName('Charged Overdrive II')).toBe(true);
        expect(isPersistentByName('Overload')).toBe(true);
        expect(isPersistentByName('Attack Up III')).toBe(false);
    });

    it('caps a one-shot at exactly 1 stack', () => {
        expect(persistentCapFor('Shield Converter')).toBe(1);
        expect(persistentCapFor('Charged Overdrive II')).toBe(1);
    });

    it('preserves the existing stacking caps unchanged', () => {
        for (const [name, cap] of PERSISTENT_STACKING_BUFFS) {
            expect(persistentCapFor(name)).toBe(cap);
        }
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest --run src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts`
Expected: FAIL — `Failed to resolve import "../../../constants/oneShotPersistentBuffs"`.

- [ ] **Step 3: Create the constants module**

Create `src/constants/oneShotPersistentBuffs.ts`:

```ts
import { PERSISTENT_STACKING_BUFFS } from './persistentStackingBuffs';

/**
 * ONE-SHOT statuses that persist until CONSUMED rather than expiring on a timer.
 *
 * These route to the same persistent status store as PERSISTENT_STACKING_BUFFS, which means
 * their parsed duration is deliberately ignored — the buff-name rule overrides it, exactly as
 * it already does for the stacking family (statusEngine's persistent routing).
 *
 * Why that matters here: neither status states a duration in its own game text. Sentinel's
 * `Charged Overdrive II` only LOOKS like it has one because the parser's backward duration scan
 * leaks the preceding clause's "for 3 turns" onto it ("grants Out. Damage Up III for 3 turns and
 * Charged Overdrive II"). Name-keying makes that leak irrelevant without touching the parser —
 * see the design doc for why the parser fix is deferred (the naive positional rule regresses
 * Oleander).
 *
 * The store this routes to is surfaced by `timedAbilityStatuses` and cleared by
 * `removeSelfBuffByName`, which is precisely the read/consume pair a one-shot requires: every
 * channel the read can see, the consume call can spend.
 *
 * Lives here rather than in src/constants/buffs.ts because that file is regenerated by
 * `npm run fetch-buffs` and would clobber hand-authored entries — same reason as
 * persistentStackingBuffs.ts.
 *
 * NOT a member, deliberately: `Charge Overdrive II` (buffs.ts). Despite the near-identical name
 * and the identical +20% Defense Penetration magnitude, that one is a STANDING buff. This one is
 * scoped to "the next Charged Skill activation". Do not normalize them together.
 */
export const ONE_SHOT_PERSISTENT_BUFFS: ReadonlySet<string> = new Set([
    'Shield Converter',
    'Charged Overdrive II',
]);

/**
 * Membership test for the persistent store — true for BOTH the stacking family and the one-shot
 * family. This is the predicate every routing site should use; it is the union, not a replacement.
 */
export function isPersistentByName(buffName: string): boolean {
    return PERSISTENT_STACKING_BUFFS.has(buffName) || ONE_SHOT_PERSISTENT_BUFFS.has(buffName);
}

/**
 * Stack cap for a persistent name. One-shots cap at 1 (a second application must not let a single
 * consume call leave a residue behind).
 *
 * Returns `undefined` for BOTH "uncapped stacking name" and "not persistent at all" — same
 * ambiguity `PERSISTENT_STACKING_BUFFS.get` already has. Callers must gate on
 * {@link isPersistentByName} first, exactly as the existing code gates on `.has`.
 */
export function persistentCapFor(buffName: string): number | undefined {
    if (ONE_SHOT_PERSISTENT_BUFFS.has(buffName)) return 1;
    return PERSISTENT_STACKING_BUFFS.get(buffName);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Route the three statusEngine consult sites**

In `src/utils/combat/statusEngine.ts`, add to the imports near the top (beside the existing `PERSISTENT_STACKING_BUFFS` import at ~line 4):

```ts
import { isPersistentByName, persistentCapFor } from '../../constants/oneShotPersistentBuffs';
```

Then make three replacements.

**(a)** Inside `addPersistentStack` (~line 610) — the cap lookup:

```ts
        const maxStacks = PERSISTENT_STACKING_BUFFS.get(buffName);
```
becomes
```ts
        const maxStacks = persistentCapFor(buffName);
```

**(b)** Inside `upsertBuff` (~line 739) — scheduled/manual buff routing:

```ts
        if (PERSISTENT_STACKING_BUFFS.has(buff.buffName)) {
```
becomes
```ts
        if (isPersistentByName(buff.buffName)) {
```

**(c)** Inside `applyTimedAbilityStatus` (~line 1408) — ability-status routing:

```ts
        if (PERSISTENT_STACKING_BUFFS.has(status.payload.buffName)) {
```
becomes
```ts
        if (isPersistentByName(status.payload.buffName)) {
```

**Do NOT change `src/utils/combat/shared.ts:19`.** `synthesizeResisted` builds display rows for DEBUFFS that failed to land; both new names are self-granted buffs that are never rolled against, so adding them there would be dead code.

After the edits, the `PERSISTENT_STACKING_BUFFS` import in `statusEngine.ts` may become unused — if lint flags it, remove it.

- [ ] **Step 6: Add the routing test**

Append to `src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts`:

```ts
import { createStatusEngine } from '../statusEngine';
import type { Ability } from '../../../types/abilities';

const oneShotAbility = (buffName: string, duration?: number): Ability => ({
    id: `grant-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        ...(duration === undefined ? {} : { duration }),
    },
});

describe('one-shot routing through the status engine', () => {
    it('a one-shot with a leaked duration is visible to the narrowed read and is spendable', () => {
        const engine = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            abilities: [oneShotAbility('Charged Overdrive II', 3)],
            ownerId: 'attacker',
        });
        engine.beginRound(1);

        const held = () =>
            engine
                .timedAbilityStatuses('self', 'attacker')
                .some((s) => s.active.buffName === 'Charged Overdrive II');

        expect(held()).toBe(true);
        engine.removeSelfBuffByName('attacker', 'Charged Overdrive II');
        expect(held()).toBe(false);
    });
});
```

**Note for the implementer:** `createStatusEngine`'s exact constructor signature and the helper needed to get an ability status registered may differ from the sketch above — read `src/utils/combat/statusEngine.ts` and mirror how `src/utils/combat/__tests__/abilityStatusGating.test.ts` builds an engine. The ASSERTIONS are what matter and must not be weakened: the status is visible via `timedAbilityStatuses` and gone after `removeSelfBuffByName`. If wiring an engine directly proves awkward, promote this to an integration test using `runCombat` in the style of `hitMitigation.integration.test.ts` instead — but do not delete it.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all green, no golden snapshot moves. If a golden moved, STOP — a one-shot name is reaching a path it should not; investigate before proceeding.

- [ ] **Step 8: Run tsc and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/constants/oneShotPersistentBuffs.ts src/utils/combat/statusEngine.ts src/utils/combat/__tests__/oneShotPersistentBuffs.test.ts
git commit -m "feat(sim): route named one-shot statuses to the persistent store

A one-shot has no honest expiry, so its parsed duration must not govern it.
Reuses the persistent channel the stacking family already uses - surfaced by
timedAbilityStatuses, cleared by removeSelfBuffByName, which is exactly the
read/consume pair a one-shot needs."
```

---

### Task 2: `shieldConverter.ts` — read and consume

The name-keyed status module. No engine wiring yet, so this task is pure and fast to review.

**Files:**
- Create: `src/utils/combat/shieldConverter.ts`
- Test: `src/utils/combat/__tests__/shieldConverter.test.ts`

**Interfaces:**
- Consumes: `StatusEngine` from `./statusEngine`
- Produces:
  - `SHIELD_CONVERTER: string` (the literal `'Shield Converter'`)
  - `holdsShieldConverter(statusEngine: StatusEngine, actorId: string): boolean`
  - `consumeShieldConverter(statusEngine: StatusEngine, actorId: string): void`

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/shieldConverter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    SHIELD_CONVERTER,
    holdsShieldConverter,
    consumeShieldConverter,
} from '../shieldConverter';
import type { StatusEngine } from '../statusEngine';

/** Minimal StatusEngine stub exposing only what the module is allowed to touch. A stub this
 *  narrow is the point: if the module ever reaches for selfBuffNamesForOwners, this test throws
 *  instead of silently passing. */
const stubEngine = (timedNames: string[]) => {
    const names = [...timedNames];
    const removed: string[] = [];
    const engine = {
        timedAbilityStatuses: (side: 'self' | 'enemy', actorId?: string) => {
            expect(side).toBe('self');
            expect(actorId).toBe('victim-1');
            return names.map((buffName) => ({ active: { buffName } }));
        },
        removeSelfBuffByName: (actorId: string, buffName: string) => {
            removed.push(`${actorId}:${buffName}`);
            const i = names.indexOf(buffName);
            if (i >= 0) names.splice(i, 1);
        },
        selfBuffNamesForOwners: () => {
            throw new Error(
                'shieldConverter must NOT read the broad name union - see the one-shot invariant'
            );
        },
    } as unknown as StatusEngine;
    return { engine, removed };
};

describe('Shield Converter read/consume', () => {
    it('reports held when the timed/persistent channel carries it', () => {
        const { engine } = stubEngine([SHIELD_CONVERTER]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(true);
    });

    it('reports not held when the channel is empty', () => {
        const { engine } = stubEngine([]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('ignores unrelated statuses on the same channel', () => {
        const { engine } = stubEngine(['Hit Mitigation', 'Barrier']);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('consume clears it, so a second read is false', () => {
        const { engine, removed } = stubEngine([SHIELD_CONVERTER]);
        consumeShieldConverter(engine, 'victim-1');
        expect(removed).toEqual([`victim-1:${SHIELD_CONVERTER}`]);
        expect(holdsShieldConverter(engine, 'victim-1')).toBe(false);
    });

    it('consume is a safe no-op when the actor holds none', () => {
        const { engine } = stubEngine([]);
        expect(() => consumeShieldConverter(engine, 'victim-1')).not.toThrow();
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest --run src/utils/combat/__tests__/shieldConverter.test.ts`
Expected: FAIL — cannot resolve `../shieldConverter`.

- [ ] **Step 3: Write the module**

Create `src/utils/combat/shieldConverter.ts`:

```ts
import type { StatusEngine } from './statusEngine';

/**
 * `Shield Converter` — "Nullifies the damage of the next direct hit, turning it into a Shield
 * instead." (constants/buffs.ts). Granted by Quixilver's charged skill, to itself.
 *
 * NAME-KEYED, like Hit Mitigation / Exposed / Barrier, rather than a `parsedEffects` entry: a
 * one-shot nullify has no honest standing value, so folding it into an incoming channel would leak
 * permanent damage immunity into every non-consuming reader (effective-HP, the DPS-mode aggregate
 * scalars, the buff-display UI).
 *
 * NOT the same thing as Quixilver's R2 passive, which also produces Shield. That passive converts
 * a fraction of damage the ship ACTUALLY TOOK into Shield; this status nullifies the hit outright
 * and turns it into Shield. They are separate mechanics that happen to share a resource.
 *
 * Consumption follows the Exposed/Hit Mitigation invariant — consume only on a hit that actually
 * READ the block. A Barrier-nullified hit, a bomb/detonation portion (the funnel's own definition
 * of direct is `byDirectDamage === true && bombPortion === 0`), and a hit already converted by an
 * earlier transform step must all leave the status intact.
 *
 * ORDERING: Hit Mitigation takes priority. A victim holding both spends only Hit Mitigation on a
 * given hit and keeps this one armed for the next. One hit spends exactly one block.
 */
export const SHIELD_CONVERTER = 'Shield Converter';

/**
 * True when the actor carries a Shield Converter that {@link consumeShieldConverter} can SPEND.
 *
 * Deliberately NOT `selfBuffNamesForOwners`. That union also surfaces ALWAYS-ACTIVE entries, which
 * `removeSelfBuffByName` cannot reach — and `isAlwaysActive` returns true for anything without a
 * `skillSource`, which every manual buff-picker selection lacks. Reading the broad union would make
 * a hand-picked Shield Converter an unspendable, permanent nullifier of every direct hit.
 *
 * Narrowed to the timed + persistent ability-status channel instead, so a hand-picked selection is
 * INERT. Inert is the faithful rendering: there is no standing value for "nullifies the next hit",
 * which is the same reason this is name-keyed rather than a `parsedEffects` entry.
 */
export function holdsShieldConverter(statusEngine: StatusEngine, actorId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('self', actorId)
        .some((s) => s.active.buffName === SHIELD_CONVERTER);
}

/**
 * Consume the holder's Shield Converter after it nullifies a direct hit. Clears the actor's own
 * self stores, which STRICTLY CONTAINS what {@link holdsShieldConverter} reads — every channel the
 * read can see, this can spend. That containment is what makes the status a genuine one-shot.
 * A no-op when the actor carries none, so it is safe to call unconditionally.
 */
export function consumeShieldConverter(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, SHIELD_CONVERTER);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/__tests__/shieldConverter.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/shieldConverter.ts src/utils/combat/__tests__/shieldConverter.test.ts
git commit -m "feat(sim): add the Shield Converter name-keyed status module

Read narrowed to the spendable channel so a hand-picked selection is inert
rather than a permanent nullifier - the defect class from #291."
```

---

### Task 3: `convertedToShield` intake channel + the engine branch

Wires Shield Converter into `applyVictimDamage` and adds the accounting channel that explains where the nullified damage went.

**Files:**
- Modify: `src/utils/combat/engine.ts`
  - `ActorIntake` (~:1441)
  - `intakeFor` (~:3709)
  - `DamageAccountingSink` (~:1483)
  - the sink object (~:4810)
  - the block step (insert after the Hit Mitigation `if`, ~:4225)
  - round assembly (~:9110)
- Test: `src/utils/combat/__tests__/shieldConverter.integration.test.ts`

**Interfaces:**
- Consumes: `holdsShieldConverter`, `consumeShieldConverter`, `SHIELD_CONVERTER` (Task 2)
- Produces: `ActorIntake.convertedToShield: number`; `DamageAccountingSink.addConvertedToShield(amount, victimId)`; `RoundData.perActorIncoming[id].convertedToShield`

- [ ] **Step 1: Write the failing integration test**

Create `src/utils/combat/__tests__/shieldConverter.integration.test.ts`. Model the harness on `src/utils/combat/__tests__/hitMitigation.integration.test.ts` — read that file first and reuse its fixture builders (`namedSelfBuff`, `basicAttack`, `parsedTarget`, `basePattern`, the `EnemyAttacker`/`TeamActor` aliases).

Critical harness facts, all learned the hard way and each capable of making a fixture silently vacuous:

- Grant the status from the victim's **active** slot, not its passive slot — a passive-slot `on-cast` self-buff does not reliably apply in this engine.
- Use a **positional** fixture for any per-victim row assertion. `emitHit` is positional-only; in non-positional mode a victim gets NO `perTargetDamage` entry at all, so the assertion passes vacuously.
- Column 4 is the FRONT of the board (M4, not M1).
- Give the victim far higher speed than the attacker so its own turn-start DoT tick runs before the incoming hit.

Required cases:

```ts
it('nullifies the next direct hit and converts it to Shield', () => {
    // victim holds Shield Converter, shieldPool starts 0, maxHp far above DIRECT_HIT
    // EXPECT: victim HP unchanged; shieldPool === DIRECT_HIT;
    //         perActorIncoming[victim].incoming === DIRECT_HIT;
    //         perActorIncoming[victim].convertedToShield === DIRECT_HIT
});

it('is spent - the SECOND direct hit lands normally', () => {
    // two hits in the same battle
    // EXPECT: hit 1 nullified; hit 2 reduces HP by the normal mitigated amount
});

it('clamps the shield gain at max HP but still nullifies the hit in full', () => {
    // maxHp small relative to the hit, shieldPool already partly full
    // EXPECT: shieldPool === maxHp; HP unchanged (full nullification);
    //         convertedToShield === the FULL nullified amount, not the clamped gain
});

it('Hit Mitigation wins when the victim holds both, and Shield Converter survives', () => {
    // victim granted BOTH statuses
    // EXPECT after hit 1: damage went to a self-DoT (Hit Mitigation's path), shieldPool === 0,
    //         and Shield Converter is still held - proven by hit 2 being nullified into Shield
});

it('a Barrier-nullified hit does NOT spend it', () => {
    // victim holds Barrier + Shield Converter
    // EXPECT: barrierAbsorbed > 0, shieldPool === 0, and a later post-Barrier hit is nullified
});

it('a bomb/detonation portion does NOT spend it', () => {
    // hit carries bombPortion > 0
    // EXPECT: damage lands normally, shieldPool === 0, status still held
});

it('a DoT tick does NOT spend it', () => {
    // EXPECT: DoT damage lands on HP, shieldPool === 0, status still held
});

it('preserves the accounting identity across a converted hit', () => {
    // POSITIONAL fixture
    // EXPECT: sum(perTargetDealt[attacker]) === sum(perTargetDamage)
    //                                       === sum(perActorIncoming[].incoming)
});
```

Write these as real assertions on concrete numbers, not `toBeGreaterThan(0)`. Assert exact amounts and exact row counts — a loose "more than zero" assertion is what let the Insidiousness per-victim bug ship.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest --run src/utils/combat/__tests__/shieldConverter.integration.test.ts`
Expected: FAIL — the victim takes normal damage and `convertedToShield` does not exist.

- [ ] **Step 3: Add the accounting channel**

In `src/utils/combat/engine.ts`:

`ActorIntake` (~:1441):
```ts
interface ActorIntake {
    incoming: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    /** Direct-hit damage nullified by `Shield Converter` and turned into Shield. Netted against
     *  `.incoming` for display the same way `barrierAbsorbed` is: the hit still ARRIVED (so the
     *  attacker keeps its damage-dealt credit and the #293 identity holds), but its effect was
     *  converted rather than applied. Records the FULL nullified amount even when the resulting
     *  shield gain was clamped at max HP — this figure explains the missing HP damage, not the
     *  shield delta. */
    convertedToShield: number;
}
```

`intakeFor` (~:3709) — add the field to the initialiser:
```ts
                entry = { incoming: 0, shieldAbsorbed: 0, barrierAbsorbed: 0, convertedToShield: 0 };
```

`DamageAccountingSink` (~:1483):
```ts
    /** today: intakeFor(victimId).convertedToShield += amount */
    addConvertedToShield: (amount: number, victimId: string) => void;
```

The sink object (~:4810), after `addBarrierAbsorbed`:
```ts
            addConvertedToShield: (amount, victimId) => {
                intakeFor(victimId).convertedToShield += amount;
            },
```

Round assembly (~:9110) — **the guard must test the new field too**, or a round whose only intake was a conversion is dropped from `RoundData` entirely:
```ts
                const out: Record<
                    string,
                    {
                        incoming: number;
                        shieldAbsorbed: number;
                        barrierAbsorbed: number;
                        convertedToShield: number;
                    }
                > = {};
                for (const [id, v] of perActorIncoming) {
                    if (
                        v.incoming === 0 &&
                        v.shieldAbsorbed === 0 &&
                        v.barrierAbsorbed === 0 &&
                        v.convertedToShield === 0
                    )
                        continue;
                    out[id] = {
                        incoming: v.incoming,
                        shieldAbsorbed: v.shieldAbsorbed,
                        barrierAbsorbed: v.barrierAbsorbed,
                        convertedToShield: v.convertedToShield,
                    };
                }
                return Object.keys(out).length > 0 ? { perActorIncoming: out } : {};
```

Downstream consumers (`dpsSimulator.ts:182`, `battleSimulator.ts:287`, `battleSimulator.ts:1087`) declare their own narrower inline record types. TypeScript's structural typing accepts the wider object passed through a variable, so they should need no change — but run `tsc` in Step 6 to confirm rather than assume.

- [ ] **Step 4: Add the engine branch**

In `applyVictimDamage`, the Hit Mitigation step currently ends at ~:4225 with a closing `}` before the `const immediateDamage = damage;` line. Convert the following into an `else if` chained onto that existing `if`:

```ts
            } else if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0 &&
                transformedToDot === 0 &&
                holdsShieldConverter(statusEngine, victim.id)
            ) {
                // `Shield Converter` — nullify this direct hit and turn it into Shield.
                //
                // Chained as `else if` onto the Hit Mitigation step above, which is what makes the
                // ordering rule true: ONE HIT SPENDS EXACTLY ONE BLOCK. A victim holding both keeps
                // this one armed for the next hit. The guard is otherwise IDENTICAL to that step's,
                // deliberately - same definition of a direct hit (`byDirectDamage && bombPortion
                // === 0`), same Barrier exclusion, same already-transformed exclusion.
                //
                // ACCOUNTING: `.incoming` is NOT reversed. Hit Mitigation reverses via
                // addIncoming(-damage) only because its damage is DEFERRED and re-books on each DoT
                // tick; a converted hit re-books nowhere, so reversing here would erase the
                // attacker's damage-dealt credit for a hit that genuinely landed. This follows
                // Barrier instead (#293: "Barrier changes the EFFECT, not the accounting"), which
                // keeps the #293 identity holding by construction.
                const nullified = damage;
                const shieldCap = recipientMaxHp(victim.id);
                victim.shieldPool = Math.min(victim.shieldPool + nullified, shieldCap);
                sink.addConvertedToShield(nullified, victim.id);
                damage = 0;
                consumeShieldConverter(statusEngine, victim.id);
            }
```

Add the import beside the existing `holdsHitMitigation` import (~:112):
```ts
import { holdsShieldConverter, consumeShieldConverter } from './shieldConverter';
```

**Note:** the shield gain is clamped at `recipientMaxHp` but `nullified` is booked in full and `damage` is zeroed unconditionally — the hit is nullified even when the shield cannot absorb the whole amount. That asymmetry is intentional and is asserted by the clamp test.

- [ ] **Step 5: Run the integration test**

Run: `npx vitest --run src/utils/combat/__tests__/shieldConverter.integration.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Run the full suite, tsc and lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green. A golden move here means a fixture is unexpectedly holding Shield Converter — investigate, do not re-baseline.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/shieldConverter.integration.test.ts
git commit -m "fix(sim): Shield Converter nullifies the next direct hit into Shield

Chained as else-if onto the Hit Mitigation step, so one hit spends exactly
one block. Books Barrier-style via a new convertedToShield channel rather
than reversing .incoming - a converted hit never re-books, so reversing
would erase the attacker's credit and break the #293 identity."
```

---

### Task 4: `chargedOverdrive.ts` — read and consume

**Files:**
- Create: `src/utils/combat/chargedOverdrive.ts`
- Test: `src/utils/combat/__tests__/chargedOverdrive.test.ts`

**Interfaces:**
- Consumes: `StatusEngine` from `./statusEngine`
- Produces:
  - `CHARGED_OVERDRIVE_II: string`
  - `CHARGED_OVERDRIVE_II_PEN: number` (the literal `20`, percentage POINTS)
  - `holdsChargedOverdriveII(statusEngine: StatusEngine, actorId: string): boolean`
  - `consumeChargedOverdriveII(statusEngine: StatusEngine, actorId: string): void`

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/chargedOverdrive.test.ts` — same stub shape as Task 2's test (including the `selfBuffNamesForOwners` throwing guard), with these cases:

```ts
describe('Charged Overdrive II read/consume', () => {
    it('exposes 20 percentage points of Defense Penetration', () => {
        expect(CHARGED_OVERDRIVE_II_PEN).toBe(20);
    });

    it('reports held when the timed/persistent channel carries it', () => { /* ... */ });
    it('reports not held when the channel is empty', () => { /* ... */ });

    it('does NOT match the standing Charge Overdrive II', () => {
        const { engine } = stubEngine(['Charge Overdrive II']);
        expect(holdsChargedOverdriveII(engine, 'victim-1')).toBe(false);
    });

    it('consume clears it, so a second read is false', () => { /* ... */ });
    it('consume is a safe no-op when the actor holds none', () => { /* ... */ });
});
```

Write the elided bodies out in full, mirroring Task 2's test file — do not leave them as comments.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest --run src/utils/combat/__tests__/chargedOverdrive.test.ts`
Expected: FAIL — cannot resolve `../chargedOverdrive`.

- [ ] **Step 3: Write the module**

Create `src/utils/combat/chargedOverdrive.ts`:

```ts
import type { StatusEngine } from './statusEngine';

/**
 * `Charged Overdrive II` — "Grants the next Charged Skill activation 20% Defense Penetration"
 * (constants/buffs.ts). Granted by Sentinel's charged skill to ALL ALLIES.
 *
 * DISTINCT FROM `Charge Overdrive II`, which also lives in buffs.ts and also grants +20% Defense
 * Penetration. That one is STANDING; this one is scoped to a single charged activation. The names
 * differ by one letter and the magnitudes are identical, which makes them very easy to
 * "deduplicate" by mistake. Do not.
 *
 * NAME-KEYED rather than a `parsedEffects` entry, for the usual reason: a one-shot per-cast bonus
 * has no standing value, and folding +20% pen into an incoming/outgoing channel would leak it into
 * every non-consuming reader.
 *
 * DURATION: none. Sentinel's parsed `duration: 3` is an artifact of the parser's backward scan
 * leaking the preceding clause's "for 3 turns"; `ONE_SHOT_PERSISTENT_BUFFS` membership makes that
 * irrelevant by routing the status to the persistent store.
 */
export const CHARGED_OVERDRIVE_II = 'Charged Overdrive II';

/** Percentage POINTS added to the cast's effective Defense Penetration. Percentage stats are
 *  stored as integers throughout this codebase (20 means 20%, not 0.20). */
export const CHARGED_OVERDRIVE_II_PEN = 20;

/**
 * True when the actor carries a Charged Overdrive II that {@link consumeChargedOverdriveII} can
 * SPEND. Narrowed to the timed + persistent channel for the same reason as every other one-shot —
 * see shieldConverter.ts for the full argument. A hand-picked selection is INERT.
 */
export function holdsChargedOverdriveII(statusEngine: StatusEngine, actorId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('self', actorId)
        .some((s) => s.active.buffName === CHARGED_OVERDRIVE_II);
}

/**
 * Consume the holder's Charged Overdrive II. Called on ANY charged activation, damaging or not —
 * the game text is "the next Charged Skill activation", with no damage qualifier.
 *
 * Accepted consequence: Sentinel grants this to `all-allies` INCLUDING ITSELF, and Sentinel's own
 * charged skill deals no damage, so Sentinel spends its own copy for nothing. That is the literal
 * reading, and the alternatives (a post-damage consume point, or inspecting each recipient's kit
 * at grant time) both introduce machinery with no precedent in this engine.
 */
export function consumeChargedOverdriveII(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, CHARGED_OVERDRIVE_II);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/__tests__/chargedOverdrive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/chargedOverdrive.ts src/utils/combat/__tests__/chargedOverdrive.test.ts
git commit -m "feat(sim): add the Charged Overdrive II name-keyed status module

Kept explicitly distinct from the standing Charge Overdrive II, which has the
same +20% magnitude and a near-identical name."
```

---

### Task 5: Fold Charged Overdrive II into the charged cast

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (~:1847, the `effectiveDamageStatsOf` call)
- Test: `src/utils/combat/__tests__/chargedOverdrive.integration.test.ts`

**Interfaces:**
- Consumes: `holdsChargedOverdriveII`, `consumeChargedOverdriveII`, `CHARGED_OVERDRIVE_II_PEN` (Task 4)
- Produces: nothing new — this is the wiring task.

**Why this seam.** `dmgStats` is rebuilt once per actor turn at `playerTurn.ts:1847`, and `action` (`'active' | 'charged'`) is already resolved at ~:1035-1045. Folding the bonus into `base.defensePenetrationBuff` at that single call site scopes it to this cast **by construction** — `dmgStats` is a local that never outlives the turn. `effectiveStats.ts` is NOT touched, so the standing stat, the DPS aggregate scalars and the buff-display UI are all unaffected.

- [ ] **Step 1: Write the failing integration test**

Create `src/utils/combat/__tests__/chargedOverdrive.integration.test.ts`, harness modelled on `hitMitigation.integration.test.ts`. Give the enemy a NON-ZERO defence — with `defence: 0` the penetration term cancels and every assertion is vacuous.

```ts
it('adds 20 points of Defense Penetration to a charged cast', () => {
    // Two runs, identical except the attacker holds Charged Overdrive II in one.
    // EXPECT: the charged cast's damage is higher by exactly the ratio implied by
    //         effectiveDefense = enemyDefense * (1 - pen/100) at pen 0 vs pen 20.
    //         Assert the concrete numbers, not just "greater than".
});

it('does not persist into the following cast', () => {
    // Run long enough for a second charged cast with no re-grant.
    // EXPECT: cast 1 boosted, cast 2 back to baseline damage exactly.
});

it('an ACTIVE cast does not spend it', () => {
    // Attacker holds the status, fires active first, then charged.
    // EXPECT: the active cast is baseline AND the later charged cast is still boosted.
});

it('is spent by a charged cast that deals no damage', () => {
    // Sentinel's own shape: a charged skill with no damage ability.
    // EXPECT: the status is gone afterwards - proven by a subsequent damaging charged
    //         cast coming out at baseline.
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest --run src/utils/combat/__tests__/chargedOverdrive.integration.test.ts`
Expected: FAIL — boosted and baseline damage are identical.

- [ ] **Step 3: Wire the injection**

Add the import near the other combat-status imports at the top of `src/utils/combat/playerTurn.ts`:

```ts
import {
    holdsChargedOverdriveII,
    consumeChargedOverdriveII,
    CHARGED_OVERDRIVE_II_PEN,
} from './chargedOverdrive';
```

Immediately BEFORE the `const dmgStats = effectiveDamageStatsOf({` call (~:1847), insert:

```ts
    // `Charged Overdrive II` — one-shot +20 points of Defense Penetration on the next CHARGED
    // activation. Read and consumed here, at the single per-turn point where `action` is known and
    // `dmgStats` has not yet been built.
    //
    // Folded into base.defensePenetrationBuff rather than into effectiveStats.ts: `dmgStats` is a
    // turn-local rebuilt every turn, so the bonus cannot outlive this cast. Pushing it into the
    // standing stat instead would leak +20% pen into every later hit AND into the DPS-mode
    // aggregate scalars and the buff-display UI, which is exactly what name-keying exists to avoid.
    //
    // Consumed UNCONDITIONALLY on a charged activation - the game text has no damage qualifier, so
    // a pure-buff charged skill (Sentinel's own) still spends it.
    const chargedOverdrivePen =
        action === 'charged' && holdsChargedOverdriveII(statusEngine, actor.id)
            ? CHARGED_OVERDRIVE_II_PEN
            : 0;
    if (chargedOverdrivePen > 0) consumeChargedOverdriveII(statusEngine, actor.id);
```

Then change the `base` argument of that call from:
```ts
        base: { attack, defence, crit, critDamage, hp, defensePenetration, defensePenetrationBuff },
```
to:
```ts
        base: {
            attack,
            defence,
            crit,
            critDamage,
            hp,
            defensePenetration,
            defensePenetrationBuff: defensePenetrationBuff + chargedOverdrivePen,
        },
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest --run src/utils/combat/__tests__/chargedOverdrive.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite, tsc and lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/chargedOverdrive.integration.test.ts
git commit -m "fix(sim): Charged Overdrive II boosts the next charged cast

Folded into the turn-local dmgStats rather than the standing stat, so the
one-shot cannot leak into later hits or the DPS/UI scalars."
```

---

### Task 6: Corpus verification and changelog

Proves the two ships actually changed, and that nothing else did.

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Confirm both statuses now register on the real corpus**

Run:
```bash
npx tsx scripts/traceShip.ts Quixilver
npx tsx scripts/traceShip.ts Sentinel
```

Then inspect `docs/kit-bundles/Quixilver.json` and `docs/kit-bundles/Sentinel.json`.

Expected: `Shield Converter` (Quixilver, `slot: charged`, `target: self`) and `Charged Overdrive II` (Sentinel, `slot: charged`, `target: all-allies`) are both present.

`observed` may legitimately remain `false` for Quixilver's — its grant rides a charged skill the trace harness may never reach (charge 2). That is a pre-existing harness property, NOT a regression, and was already `false` before this work. Do not chase it.

- [ ] **Step 2: Confirm the parser was not disturbed**

Run: `npm run audit:skills`
Expected: zero non-allowlisted findings — identical to the pre-change baseline. This work touches no parser code, so any movement here means something unintended happened.

- [ ] **Step 3: Add the changelog entries**

In `src/constants/changelog.ts`, append to `UNRELEASED_CHANGES`:

```ts
'Combat simulator: Quixilver\'s charged skill now grants a working Shield Converter - the next direct hit taken is nullified and turned into Shield instead of damaging the ship.',
'Combat simulator: Sentinel\'s charged skill now grants a working Charged Overdrive II - the next charged skill each ally casts gains 20% Defense Penetration.',
```

Match the surrounding entries' quoting and formatting style exactly.

- [ ] **Step 4: Full verification sweep**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green, no golden snapshot moves.

- [ ] **Step 5: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs: changelog for name-keyed status tranche 2"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin fix/name-keyed-status-tranche2
gh pr create --title "fix(sim): Shield Converter and Charged Overdrive II do something" --body "$(cat <<'BODY'
Tranche 2 of the name-keyed statuses left over from #290/#291/#292. Both already landed as
genuine statuses with correct target; only `parsedEffects` was empty, so nothing read them.

- **Shield Converter** (Quixilver, charged, self) nullifies the next direct hit and turns it
  into Shield. Chained as `else if` onto the Hit Mitigation step, so one hit spends exactly one
  block and Hit Mitigation keeps priority.
- **Charged Overdrive II** (Sentinel, charged, all allies) adds 20 points of Defense Penetration
  to one charged cast.

Both read only `timedAbilityStatuses` and consume via `removeSelfBuffByName`, so a hand-picked
selection is inert rather than permanent — the defect class #291 found.

A shared `ONE_SHOT_PERSISTENT_BUFFS` set routes both to the persistent store, making the parsed
duration irrelevant. That avoids a parser change: Sentinel's `duration: 3` is leaked from the
preceding clause, but the obvious positional fix would regress Oleander, whose shared duration
also sits after a preceding tag. Deferred with reasons recorded in the spec.

A shield-converted hit books Barrier-style — `.incoming` intact, netted out by a new
`convertedToShield` channel — rather than reversing like Hit Mitigation, which reverses only
because it re-books on tick. Keeps the #293 identity holding by construction.

Spec: `docs/superpowers/specs/2026-08-04-name-keyed-status-tranche2-design.md`

Part B (Quixilver's R2 passive: hit-counted Barrier, `self-shield-full` condition, enforced
Barrier Recharging lockout) is deliberately a separate PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01JSGWjgR1PAY61kCDSqFywz
BODY
)"
```

---

## Self-review notes

**Spec coverage.** §3 one-shot channel → Task 1. §4 Shield Converter (module, engine site, cap, accounting, new intake field, round-assembly guard) → Tasks 2-3. §5 Charged Overdrive II (module, seam, unconditional consume) → Tasks 4-5. §8 testing → the test steps in Tasks 1-5 plus Task 6's sweep. §6 (Quixilver R2) and §7 (backlog) are deliberately out of scope for Part A.

**Naming consistency.** `holdsShieldConverter` / `consumeShieldConverter` / `SHIELD_CONVERTER`; `holdsChargedOverdriveII` / `consumeChargedOverdriveII` / `CHARGED_OVERDRIVE_II` / `CHARGED_OVERDRIVE_II_PEN`; `isPersistentByName` / `persistentCapFor` / `ONE_SHOT_PERSISTENT_BUFFS`; `addConvertedToShield` / `convertedToShield`. Each is used identically everywhere it appears.

**Known soft spot.** Task 1 Step 6's `createStatusEngine` construction is a sketch — the real signature must be read from source. The step says so explicitly and pins the assertions that matter, with an integration-test fallback if direct construction is awkward.
