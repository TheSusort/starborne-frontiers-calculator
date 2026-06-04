# Combat Engine Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `simulateDPS` into a combat-engine core (`src/utils/combat/`) with in-loop buff application and live condition gating, an emit-only event bus, and an unchanged public DPS API.

**Architecture:** New `src/utils/combat/` module: `events.ts` (typed bus), `state.ts` (actors + DoT containers), `chargeSchedule.ts` (relocated), `statusEngine.ts` (incremental per-round status machine replacing `computeBuffTimeline`), `engine.ts` (turn loop, ported from `runSinglePass`). `dpsSimulator.ts` becomes a thin adapter with identical input/output types. Behavior changes ONLY for condition-gated buff/debuff abilities (dynamic gating) — everything else must reproduce golden snapshots captured before the refactor.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md`

**Branch:** `feat/combat-engine-core` off `main` (independent of Phase 0's branch — no shared files).

---

## Critical invariants (read before every task)

1. **Golden parity.** Tasks 2–5 must not change any simulation number. The snapshot suite from Task 1 is the referee. Task 6 changes numbers ONLY for (a) condition-gated buff/debuff abilities, (b) ability-sourced buffs carrying `defensePenetration`/`dotDamage` effects (move from always-on static fold to per-round, which is more correct), and (c) buff-list ordering inside `RoundData` (set-equal, order may differ). Every other diff is a bug.
2. **Zero-RNG stays.** `makeRateGate` accumulator gates (`rateAccumulator.ts`) are used exactly as today: `activeCritGate`, `chargedCritGate`, `debuffLandingGate`, `extendChanceGate` — same creation order, same call sites, same call ORDER within a round (the schedules are stateful; reordering calls changes outcomes).
3. **Debuff landing stays per-round re-rolled** in Phase 1, for scheduled AND ability-sourced debuffs (today's semantics: timeline-active debuffs re-roll `debuffLandingGate` every round). Application-time-roll-with-persistence is a Phase 2 correctness item.
4. **Charge cadence quirk preserved:** the status engine's charge schedule (`computeChargeSchedule`) does NOT know about bonus charges from `charge` abilities, while the engine's real action cadence does — exactly as today (timeline vs. sim divergence). Do not "fix" this; note it in docs.
5. **Known pre-existing quirks to relocate verbatim, not fix:** corrosion base HP cap `Math.min(enemyHp, 500_000)`; modifier ctx uses probability-based crit while payload ctx uses binary crit; `noCrit` read from the ungated skill.
6. **Spec deviation (deliberate):** the spec's module table lists a `resolution.ts` for the deterministic schedules. The accumulator gates already live in their own module (`src/utils/calculators/rateAccumulator.ts`) and stay there as engine-locals — no `resolution.ts` is created. Don't go looking for one.

---

## Task 1: Branch + golden parity snapshot suite

**Files:**
- Create: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/combat-engine-core
```

- [ ] **Step 2: Write the snapshot suite**

Create `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`. Shared helpers first:

```typescript
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const damageSkills = (activeMult: number, chargedMult?: number, extra?: Partial<ShipSkills>): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: activeMult } })] },
        ...(chargedMult
            ? [{ slot: 'charged' as const, abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: chargedMult } })] }]
            : []),
        ...(extra?.slots ?? []),
    ],
});

const buff = (partial: Partial<SelectedGameBuff> & Pick<SelectedGameBuff, 'id' | 'buffName' | 'parsedEffects'>): SelectedGameBuff => ({
    stacks: 1,
    isStackable: false,
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    enemyDefense: 8000,
    enemyHp: 400000,
    rounds: 12,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 250,
    enemySecurity: 100,
    defence: 6000,
    hp: 30000,
};

const snap = (name: string, input: DPSSimulationInput) =>
    it(name, () => expect(simulateDPS(input)).toMatchSnapshot());
```

Then one `snap(...)` per scenario. Cover (use the exact numbers shown; invent similar magnitudes where unspecified):

1. `plain damage` — `damageSkills(150)`, `chargeCount: 0`.
2. `charged cadence + startCharged` — `damageSkills(120, 300)`, `startCharged: true`.
3. `multi-hit noCrit` — active damage `{ multiplier: 80, hits: 3, noCrit: true }`, charged `300`.
4. `dots all types` — active adds `dot` abilities: `{ type: 'dot', dotType: 'corrosion', tier: 5, stacks: 2, duration: 3 }` and `{ type: 'dot', dotType: 'bomb', tier: 120, stacks: 1, duration: 2 }`; charged adds `{ type: 'dot', dotType: 'inferno', tier: 8, stacks: 3, duration: 2 }`. (All scenario DoT shorthands below likewise need the full `{ type: 'dot', dotType: … }` config shape.)
5. `extend-dot passive with crit-power chance` — scenario 4's actives plus a passive slot with `extend-dot {turns: 1, chanceFromCritPower: true}`.
6. `detonate + reapply` — charged: `detonate-dot {dotType: 'inferno', powerPct: 150}` followed by inferno dot ability; active applies inferno.
7. `accumulate-detonate` — active adds `accumulate-detonate {turns: 2, pct: 50}`.
8. `charge gain + enemy-type condition` — active adds `charge {amount: 1}` with condition `{subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender'}`; input `enemyType: 'Defender'`, `allyChargePerRound: 0.5`. (Check `EnemyBaseClass` values in `src/types/calculator.ts` and use a real one.)
9. `modifiers flat + scaling + hp-threshold` — passive slot: modifier `{channel: 'outgoingDamage', value: 15, isMultiplicative: false}`; modifier `{channel: 'defensePenetration', value: 0, isMultiplicative: false}` with `scaling: {conditionIndex: 0, perUnit: 7.5, cap: 45}` and condition `{subject: 'enemy-debuff', derivable: true}`; modifier `{channel: 'attack', value: 20, isMultiplicative: false}` with condition `{subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 50}`. Active applies a corrosion dot so the debuff count is non-zero.
10. `ability buffs/debuffs unconditioned` — active: buff ability `{type: 'buff', buffName: 'Attack Up', parsedEffects: {attack: 30}, stacks: 1, isStackable: false, duration: 2}` (target `'self'`); charged: debuff ability `{type: 'debuff', buffName: 'Defense Down II', parsedEffects: {defense: -30}, stacks: 1, isStackable: false, application: 'inflict', duration: 2}`; passive: buff ability `{buffName: 'Focus', parsedEffects: {crit: 15}, stacks: 1, isStackable: false, duration: 'recurring'}` (target `'self'`); active also: accumulating self-buff `{buffName: 'Momentum', parsedEffects: {critDamage: 10}, stacks: 1, isStackable: true, maxStacks: 5, stackTrigger: 'per-active', duration: 'recurring'}`. **IMPORTANT:** mirror the page's wiring (DPSCalculatorPage.tsx:232-233): pass these through `configShipSkillsToSimInputs(shipSkills, enemyType)` and spread the result into `selfBuffs`/`enemyDebuffs` in addition to `shipSkills` — the sim currently receives ability buffs via conversion.
11. `manual + team buffs with static defPen/dot path` — `selfBuffs`: manual buff `{id: 'm1', buffName: 'Pen Up', parsedEffects: {defensePenetration: 20, dotDamage: 15}}` (no skillSource → always-active) and a timed one `{id: 'm2', buffName: 'Attack Up', parsedEffects: {attack: 25}, skillSource: 'active', skillDuration: 2}`; `enemyDebuffs`: team debuff `{id: 't1', buffName: 'Vulnerable', parsedEffects: {incomingDamage: 20}, skillSource: 'charge', skillDuration: 2, sourceChargeCount: 4, sourceStartCharged: true}`. Skills: scenario 4's.
12. `affinity disadvantage + apply debuff` — `affinityDamageModifier: -25, affinityCritCap: 75, affinityCritPenalty: 25`; enemy debuff via ability with `application: 'apply'` (converted as in scenario 10).
13. `judge passive gated damage` — passive slot damage ability `{multiplier: 60}` with condition `{subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 50}`; active `150`.
14. `KNOWN-DIFF conditional buff (updates in Task 6)` — active self-buff ability `{buffName: 'Attack Up', parsedEffects: {attack: 30}, duration: 2}` with condition `{subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3}`, active also applies corrosion `{tier: 5, stacks: 1, duration: 3}` per round (debuff count ramps 0→3+ as entries accumulate); converted via `configShipSkillsToSimInputs` like scenario 10. Today the static gate neutralizes the threshold → buff always on; after Task 6 it switches on only when the live count reaches 3.

- [ ] **Step 3: Generate and eyeball the snapshots**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: PASS, snapshot file written. Open the snapshot file and sanity-check a few rounds of scenario 1 by hand (damage = attack × 1.5 × (1 − DR) × …).

- [ ] **Step 4: Commit (snapshots included)**

```bash
git add src/utils/calculators/__tests__/dpsGoldenParity.test.ts src/utils/calculators/__tests__/__snapshots__/
git commit -m "test: golden parity snapshots for the DPS sim ahead of the combat-engine refactor"
```

---

## Task 2: Event bus

**Files:**
- Create: `src/utils/combat/events.ts`
- Test: `src/utils/combat/__tests__/events.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { createEventBus, CombatEvent } from '../events';

describe('createEventBus', () => {
    it('dispatches to listeners of the matching type in registration order', () => {
        const bus = createEventBus();
        const seen: string[] = [];
        bus.on('turn-started', () => seen.push('a'));
        bus.on('turn-started', () => seen.push('b'));
        bus.on('turn-ended', () => seen.push('x'));
        bus.emit({ type: 'turn-started', actorId: 'attacker', round: 1 });
        expect(seen).toEqual(['a', 'b']);
    });

    it('narrows the event type for listeners', () => {
        const bus = createEventBus();
        let dmg = 0;
        bus.on('ability-performed', (e) => {
            dmg = e.damage ?? 0;
        });
        bus.emit({
            type: 'ability-performed',
            actorId: 'attacker',
            targetId: 'enemy',
            round: 2,
            abilityType: 'damage',
            damage: 1234,
            didCrit: true,
            didHit: true,
        });
        expect(dmg).toBe(1234);
    });

    it('is a no-op with no listeners', () => {
        const bus = createEventBus();
        expect(() => bus.emit({ type: 'ship-destroyed', actorId: 'enemy', round: 3 })).not.toThrow();
    });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/combat/__tests__/events.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/combat/events.ts`**

```typescript
import { AbilityType } from '../../types/abilities';
import { DoTType } from '../../types/calculator';

/**
 * Engine-emitted combat events. Phase 1 is emit-only (the DPS adapter is the sole
 * consumer); Phase 3 maps reactive Ability.trigger values onto these. Contract:
 * listeners are synchronous, run in registration order, and never mutate combat
 * state — they produce intents (e.g. enqueued follow-up executions) only.
 */
export type CombatEvent =
    | { type: 'turn-started'; actorId: string; round: number }
    | { type: 'turn-ended'; actorId: string; round: number }
    | { type: 'skill-fired'; actorId: string; round: number; slot: 'active' | 'charged'; skillName?: string }
    | {
          type: 'ability-performed';
          actorId: string;
          targetId: string;
          round: number;
          abilityType: AbilityType;
          damage?: number;
          didCrit?: boolean;
          didHit?: boolean;
      }
    | { type: 'buff-applied'; actorId: string; round: number; buffName: string; duration: number | 'recurring' }
    | { type: 'buff-expired'; actorId: string; round: number; buffName: string }
    | { type: 'debuff-applied'; targetId: string; round: number; buffName: string }
    | { type: 'debuff-resisted'; targetId: string; round: number; buffName: string }
    | { type: 'dot-applied'; targetId: string; round: number; dotType: DoTType; stacks: number }
    | { type: 'dot-ticked'; targetId: string; round: number; dotType: 'corrosion' | 'inferno'; damage: number }
    | { type: 'dot-detonated'; targetId: string; round: number; damage: number }
    | { type: 'hp-changed'; targetId: string; round: number; oldPct: number; newPct: number }
    | { type: 'ship-destroyed'; actorId: string; round: number };

export type CombatEventType = CombatEvent['type'];

type Listener<T extends CombatEventType> = (event: Extract<CombatEvent, { type: T }>) => void;

export interface CombatEventBus {
    on<T extends CombatEventType>(type: T, listener: Listener<T>): void;
    emit(event: CombatEvent): void;
}

export function createEventBus(): CombatEventBus {
    const listeners = new Map<CombatEventType, Listener<CombatEventType>[]>();
    return {
        on(type, listener) {
            const existing = listeners.get(type) ?? [];
            listeners.set(type, [...existing, listener as Listener<CombatEventType>]);
        },
        emit(event) {
            for (const listener of listeners.get(event.type) ?? []) {
                listener(event as never);
            }
        },
    };
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/
git commit -m "feat: combat event bus (emit-only Phase 1 seam)"
```

---

## Task 3: Combat state types + chargeSchedule relocation

**Files:**
- Create: `src/utils/combat/state.ts`
- Create: `src/utils/combat/chargeSchedule.ts`
- Modify: `src/utils/calculators/buffTimeline.ts` (import `computeChargeSchedule` from the new home, delete the local copy)
- Modify: `src/utils/calculators/dpsSimulator.ts` (import the DoT-container interfaces from `state.ts`, delete local copies at lines 131-150)
- Test: `src/utils/combat/__tests__/chargeSchedule.test.ts`

- [ ] **Step 1: Move `computeChargeSchedule`**

Create `src/utils/combat/chargeSchedule.ts` containing `computeChargeSchedule` moved VERBATIM from `buffTimeline.ts:15-33` (with its doc comment). In `buffTimeline.ts`, delete the function and add `import { computeChargeSchedule } from '../combat/chargeSchedule';` plus `export { computeChargeSchedule };` (the existing `buffTimeline.test.ts` imports it from there until Task 5 deletes the module).

- [ ] **Step 2: Move the schedule tests**

Find the `computeChargeSchedule` describe-block in `src/utils/calculators/__tests__/buffTimeline.test.ts` and MOVE it to `src/utils/combat/__tests__/chargeSchedule.test.ts` (importing from `../chargeSchedule`).

- [ ] **Step 3: Create `src/utils/combat/state.ts`**

Move the three private interfaces from `dpsSimulator.ts:131-150` here, exported, plus the actor types:

```typescript
/** One applied DoT application (an "entry"): N stacks of one tier, ticking down. */
export interface ActiveDoTStack {
    stacks: number;
    tier: number;
    remainingRounds: number;
}

export interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
    tier: number;
}

// Echoing Burst-style debuff: gathers the direct damage dealt to the enemy each round it
// is active, then detonates for `pct`% of the accumulated total when it expires.
export interface PendingAccumulator {
    roundsRemaining: number;
    pct: number;
    accumulated: number;
}

export interface ActorStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    defence: number;
    hp: number;
    speed: number;
}

/**
 * A combat participant. Phase 1: exactly two actors — the attacker (acts every
 * turn) and the enemy dummy (speed 0, never acts; carries the DoT containers
 * that used to be loop-locals in runSinglePass). Phase 2 makes team ships and
 * the enemy real actors.
 */
export interface CombatActor {
    id: string;
    side: 'player' | 'enemy';
    stats: ActorStats;
    /** Remaining HP. Phase 1: meaningful for the enemy only (pool − cumulative damage, floored at 0 for HP%-derivation; the sim keeps hitting the dead dummy). */
    currentHp: number;
    turnMeter: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
}

export function createActor(partial: Pick<CombatActor, 'id' | 'side'> & { stats: ActorStats }): CombatActor {
    return {
        ...partial,
        currentHp: partial.stats.hp,
        turnMeter: 0,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
    };
}

/**
 * Turn-meter selection per docs/combat-system.md section 1: tick every actor's
 * meter by its speed until someone reaches 1000; highest meter acts. Phase 1
 * degenerates to "attacker acts every round" (enemy speed 0) — the scaffolding
 * exists so Phase 2 only has to add actors, not restructure the loop.
 */
export function selectNextActor(actors: CombatActor[]): CombatActor {
    const eligible = () => actors.filter((a) => a.turnMeter >= 1000);
    while (eligible().length === 0) {
        for (const a of actors) a.turnMeter += a.stats.speed;
    }
    return eligible().reduce((best, a) => (a.turnMeter > best.turnMeter ? a : best));
}
```

In `dpsSimulator.ts`, delete the local `ActiveDoTStack`/`PendingBomb`/`PendingAccumulator` interfaces (131-150) and import them from `../combat/state`. (`ActiveDoTState` at line 152 is a public reporting type — leave it.)

Guard against infinite loops: if all speeds are 0, `selectNextActor` would spin — add a unit test that an attacker with speed 100 is selected after 10 ticks, and a doc comment that callers must include at least one actor with speed > 0.

- [ ] **Step 4: Add a `state.test.ts`** covering `selectNextActor` (attacker speed 100 + enemy speed 0 → attacker selected, meter 1000; after manual reset to 0 it is selected again) and `createActor` defaults.

- [ ] **Step 5: Verify everything still passes (pure relocation)**

Run: `npx vitest run && npx tsc --noEmit`
Expected: ALL tests pass including the golden suite — no behavior change.

- [ ] **Step 6: Commit**

```bash
git add -A src/utils/combat src/utils/calculators
git commit -m "refactor: combat state types and chargeSchedule relocation (no behavior change)"
```

---

## Task 4: Status engine (incremental scheduled-status machine)

**Files:**
- Create: `src/utils/combat/statusEngine.ts`
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

The status engine replaces `computeBuffTimeline` with the SAME semantics, exposed as per-round stepping instead of a precomputed array. Port, don't rewrite: the family-key/tier-precedence logic (`deriveFamilyKey`, `ROMAN_SUFFIX`, `TIER_VALUES`, `DOT_PREFIXES`), `isAccumulating`, `isAlwaysActive`, accumulating maps, the source-schedule cache, the decrement→accumulate→apply→snapshot order, and the always-active dedup all move verbatim from `buffTimeline.ts:35-253`.

- [ ] **Step 1: Write the failing tests by porting `buffTimeline.test.ts`**

Create `statusEngine.test.ts`: copy every `computeBuffTimeline` test case from `src/utils/calculators/__tests__/buffTimeline.test.ts` and adapt to the stepping API via this helper so expectations stay identical:

```typescript
import { createStatusEngine } from '../statusEngine';

const runTimeline = (
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[],
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
) => {
    const eng = createStatusEngine({ selfBuffs, enemyDebuffs, chargeCount, startCharged, totalRounds });
    return Array.from({ length: totalRounds }, (_, i) => ({ round: i + 1, ...eng.step(i + 1) }));
};
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `src/utils/combat/statusEngine.ts`**

API (Task 6 extends it with ability statuses — design the internals so categorized collections are appendable):

```typescript
import { SelectedGameBuff } from '../../types/calculator';
import { computeChargeSchedule } from './chargeSchedule';

export interface ActiveBuff {
    buffName: string;
    turnsRemaining: number | 'recurring';
    stacks?: number; // defined for accumulating buffs; current stack count
}

export interface StatusEngineInput {
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    chargeCount: number;
    startCharged: boolean;
    totalRounds: number;
}

export interface StatusEngine {
    /** Advance to round r (1-based, strictly sequential) and return the round's
     *  active lists — same contents as the old computeBuffTimeline entry. */
    step(round: number): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
}

export function createStatusEngine(input: StatusEngineInput): StatusEngine { /* port */ }
```

Implementation: lift the body of `computeBuffTimeline` (`buffTimeline.ts:78-253`) into the factory — everything before the `for (let r = …)` loop becomes closure state, and the loop body becomes `step(r)` returning one entry. Throw if `step` is called out of order (`if (round !== lastRound + 1) throw new Error(...)`) — cheap insurance against engine bugs.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/utils/combat/__tests__/statusEngine.test.ts` → PASS, all ported cases.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat: incremental status engine (ports computeBuffTimeline semantics)"
```

---

## Task 5: Engine turn loop + DPS adapter (parity-locked relocation)

**Files:**
- Create: `src/utils/combat/engine.ts`
- Modify: `src/utils/calculators/dpsSimulator.ts` (becomes the adapter)
- Modify: `src/components/calculator/DPSBuffPanel.tsx:3` (ActiveBuff import → `../../utils/combat/statusEngine`)
- Delete: `src/utils/calculators/buffTimeline.ts`, `src/utils/calculators/__tests__/buffTimeline.test.ts`
- Test: `src/utils/combat/__tests__/engine.events.test.ts`

This is the riskiest task: relocate `runSinglePass` (`dpsSimulator.ts:194-717`) into `engine.ts` restructured as a turn loop, byte-identical math. Work mechanically; after every sub-step run the golden suite.

- [ ] **Step 1: Create `engine.ts` with the structure**

```typescript
// Imports: evaluateCondition/scaledBonus/conditionsMet, buildRoundContext,
// applyAbilities helpers, makeRateGate, dpsBuffHelpers converters, statusEngine,
// state, events — same modules dpsSimulator.ts imports today.

export interface CombatEngineInput {
    // every field of the old runSinglePass params EXCEPT timeline/selfBuffLookup/
    // enemyDebuffLookup, PLUS:
    selfBuffs: SelectedGameBuff[];      // scheduled (manual + team) — statusEngine input
    enemyDebuffs: SelectedGameBuff[];
    bus?: CombatEventBus;
}

export function runCombat(input: CombatEngineInput): {
    rounds: RoundData[];
    rawTotals: { direct: number; corrosion: number; inferno: number; detonation: number; cumulative: number; totalSecondary: number; totalConditional: number };
}
```

Internal shape (combat-system.md §10, attacker-only):

```typescript
const attacker = createActor({ id: 'attacker', side: 'player', stats: { ...derived from input, speed: 100 } });
const enemy = createActor({ id: 'enemy', side: 'enemy', stats: { ...enemy stats, speed: 0, hp: input.enemyHp } });
const statusEngine = createStatusEngine({ selfBuffs, enemyDebuffs, chargeCount: hasChargedSkill ? chargeCount : 0, startCharged, totalRounds: numRounds });
const lookups = buildLookups(selfBuffs, enemyDebuffs);   // moved from simulateDPS:763-772

for (let r = 1; r <= numRounds; r++) {
    const actor = selectNextActor([attacker, enemy]);     // Phase 1: always the attacker
    bus?.emit({ type: 'turn-started', actorId: actor.id, round: r });
    preTurn(...);        // action selection + charge consumption (old lines 283-293)
    const entry = statusEngine.step(r);                   // replaces timeline[r - 1]
    executeTurn(...);    // old lines 295-658, verbatim — enemy DoT containers now live on the enemy actor
    postTurn(...);       // turn-meter reset (attacker.turnMeter = 0); status decrement stays inside statusEngine.step (top-of-next-round ≡ post-turn — see note)
    bus?.emit({ type: 'turn-ended', actorId: actor.id, round: r });
}
```

Port rules:

- `corrosionEntries`/`infernoEntries`/`pendingBombs`/`pendingAccumulators` → `enemy.corrosionEntries` etc. Pure rename; the four rate gates, charge counter, and damage totals stay engine-locals.
- `cumulativeDamage`/`enemyHpPct` (old lines 295-297): also set `enemy.currentHp = Math.max(0, enemyHp - cumulativeDamage)` and emit `hp-changed` when the pct integer changes; emit `ship-destroyed` once when it first reaches 0.
- `calculateBuffTotals`, `tickDoTStacks`, `totalStacks`, `expireStacks` (old lines 159-192) move to `engine.ts` unchanged.
- **Do NOT restructure the status decrement into postTurn.** `statusEngine.step(r)` decrements at the top of round r exactly like the old timeline — equivalent to post-turn decrement of round r−1 and parity-identical. Add a comment noting Phase 2 moves this into the owner's Post Turn.
- Emit events at the natural points: `skill-fired` after action selection; `ability-performed` for the firing damage hit (damage = directDamage − passiveDamage portion is fiddly — emit ONE event with the full `directDamage`, `didCrit: roundCrit`); `debuff-applied`/`debuff-resisted` per landed/resisted entry in the Step-2 debuff loop; `dot-applied` per applied entry in Step 3; `dot-ticked` for corrosion and inferno totals (Steps 4-5); `dot-detonated` when `detonationDamage > 0` (after Step 6b). Emission must not read or change any sim value.

- [ ] **Step 2: Shrink `dpsSimulator.ts` to the adapter**

Keep: all exported interfaces (`DPSSimulationInput`, `RoundData`, `DPSSimulationSummary`, `DPSSimulationResult`, `ActiveDoTState`), the input-derivation logic from `simulateDPS` (old lines 719-772: hacking/landing chance, `toDotAndPenModifiers` static path, `flatInputToAbilities` fallback, `hasChargedSkill`), then call `runCombat` and build the summary (old lines 801-815). Delete `runSinglePass`, the timeline computation, and the lookup builders (now inside the engine). `RoundData.activeSelfBuffs` keeps the `ActiveBuff` type — re-export it: `export type { ActiveBuff } from '../combat/statusEngine';` and fix `DPSBuffPanel.tsx:3` to import from the new home (or keep importing from dpsSimulator — pick the direct statusEngine import).

- [ ] **Step 3: Delete `buffTimeline.ts` + its test** (`computeChargeSchedule` tests moved in Task 3; timeline tests were ported in Task 4).

- [ ] **Step 4: Golden parity — the referee step**

Run: `npx vitest run`
Expected: EVERYTHING passes, especially `dpsGoldenParity.test.ts` and the existing `dpsSimulator.test.ts` (2302 lines) — with ZERO snapshot updates. If a snapshot differs, the port has a bug: diff the failing scenario round-by-round against `main` (`git stash && npx vitest run …` to re-check old behavior) before touching anything. Use @superpowers:systematic-debugging if stuck.

- [ ] **Step 5: Event emission test**

`src/utils/combat/__tests__/engine.events.test.ts`: run a small scenario (scenario-4-like input, 4 rounds) through `simulateDPS`… — events need the bus, which `simulateDPS` doesn't expose. Test `runCombat` directly: build a `CombatEngineInput` by hand, attach a bus, collect events, assert: one `turn-started`/`turn-ended` pair per round in order; `skill-fired` slots match the charge cadence; `dot-applied` rounds match `appliedDoTs` in the returned rounds; `debuff-resisted` appears in an affinity-disadvantage scenario with an `apply` debuff.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint && npx tsc --noEmit
git add -A src/utils src/components/calculator/DPSBuffPanel.tsx
git commit -m "refactor: combat engine turn loop replaces runSinglePass; dpsSimulator becomes adapter (parity-locked)"
```

---

## Task 6: Ability-sourced statuses in-loop with live condition gating

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (ability-status registration + upsert API)
- Create: `src/utils/combat/abilityStatusGating.ts`
- Modify: `src/utils/combat/engine.ts` (apply ability statuses per turn; per-round defPen/dot fold for ability statuses)
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx:232-233` (stop feeding converted buffs into the sim)
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (scenarios 10/12/14 wiring + snapshot updates)
- Test: `src/utils/combat/__tests__/dynamicBuffGating.test.ts`

This is THE behavior change. Sub-steps are ordered so each diff is reviewable.

- [ ] **Step 1: Write `abilityStatusGating.ts` + unit tests**

```typescript
import { Condition, ConditionSubject } from '../../types/abilities';

/**
 * Subjects whose live per-round counts the Phase-1 sim can derive. Conditions on
 * these gate buff/debuff abilities dynamically. Derivable conditions on any OTHER
 * subject (ally counts, enemy-buff, self-debuff — hardcoded 0 in the round context)
 * are neutralized to 'always', preserving the old static gate's "satisfiable in
 * principle" semantics: without this they would flip from included to permanently
 * excluded. Manual (non-derivable) conditions keep literal gating via manualCount.
 */
const LIVE_SUBJECTS: ReadonlySet<ConditionSubject> = new Set([
    'always',
    'enemy-debuff',
    'enemy-type',
    'self-buff',
    'self-crit',
    'hp-threshold',
    'enemy-hp-pct',
    'enemy-hp-missing-pct',
]);

export function liveGateConditions(conditions: Condition[]): Condition[] {
    return conditions.map((c) =>
        c.derivable && !LIVE_SUBJECTS.has(c.subject)
            ? { subject: 'always' as const, derivable: true, ...(c.anyOf ? { anyOf: true } : {}) }
            : c
    );
}
```

Tests: live derivable condition passes through unchanged; derivable `adjacent-ally` neutralized (and keeps `anyOf`); manual condition untouched.

- [ ] **Step 2: Extend the status engine for ability statuses**

Classification of a buff/debuff ability (from the spec):
- **accumulating** (`stackTrigger && isStackable`): registered at creation into the accumulating maps (same machinery), AFTER scheduled entries (list-order parity). Stack accumulation is never condition-gated; per-round effect inclusion is (aura rule below).
- **aura** (`duration` is `'recurring'`/`undefined`, or slot is `passive`): held in an aura list with its conditions; included in the round's snapshot only when its (live-gated) conditions pass that round.
- **timed** (finite `duration`): applied when its source slot fires, gated at application; once applied it lives in the same selfMap/enemyMap (familyKey/tier upsert) and runs its window unconditionally.

API additions:

```typescript
export interface AbilityStatusPayload {
    buffName: string;
    stacks: number;
    parsedEffects: ParsedBuffEffects;
    application?: 'inflict' | 'apply';
}

interface RegisteredAbilityStatus {
    payload: AbilityStatusPayload;
    side: 'self' | 'enemy';
    sourceSlot: SkillSlot;
    duration: number | 'recurring' | undefined;
    conditions: Condition[];          // already live-gated by the caller
    kind: 'accumulating' | 'aura' | 'timed';
    maxStacks?: number;
    stackTrigger?: StackTrigger;
}

export interface StatusEngine {
    step(round: number): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
    /** Register all buff/debuff abilities once at creation (classification above). */
    registerAbilityStatuses(statuses: RegisteredAbilityStatus[]): void;
    /** Apply the firing skill's TIMED ability statuses for this round; the engine
     *  passes only those whose gate passed. Reuses the familyKey/tier upsert. */
    applyTimedAbilityStatus(round: number, status: RegisteredAbilityStatus): void;
    /** Aura + accumulating ability statuses whose conditions pass `ctx` this round,
     *  with payloads, for effect folding and snapshot inclusion. */
    activeAbilityStatuses(side: 'self' | 'enemy', ctx: ConditionContext): { payload: AbilityStatusPayload; active: ActiveBuff }[];
    /** Timed ability statuses currently in the maps (payload-carrying), for effect folding. */
    timedAbilityStatuses(side: 'self' | 'enemy'): { payload: AbilityStatusPayload; active: ActiveBuff }[];
}
```

Implementation notes: timed ability statuses share selfMap/enemyMap with scheduled ones but carry their payload on the `BuffState` (add optional `payload?: AbilityStatusPayload`); snapshot building appends ability-status entries AFTER scheduled ones in each category. Accumulating ability statuses join the accumulating maps with payloads attached.

TDD: extend `statusEngine.test.ts` — timed ability status applied round 2 with duration 2 visible rounds 2-3; tier precedence ("Attack Up" does not displace an applied "Attack Up II"); accumulating ability status stacks per-active.

- [ ] **Step 3: Wire the engine**

In `engine.ts`:

1. At creation: walk `shipSkills.slots`, collect buff/debuff abilities (`config.type === 'buff' | 'debuff'`), classify, `liveGateConditions(ability.conditions)`, route by `ability.target` (`enemy`/`all-enemies` → enemy side, else self — same routing as `buffAbilitiesToSelectedBuffs:120-124`), and `registerAbilityStatuses`.
2. Per round, AFTER `statusEngine.step(r)` and the action/firing-skill selection, in this exact order (single forward pass — spec's determinism rule):
   a. Build a pre-application gate context `gateCtx` via `buildRoundContext` with: scheduled self-buff names + aura/timed ability self statuses already active (from previous rounds), landed-debuff count from the SCHEDULED debuff list of this round (the existing Step-2 landing loop runs first, unchanged), DoT entry counts, `effectiveCritRate: cappedCrit(critBuff from scheduled buffs only)`, `enemyType`, `enemyHpPct`. No `roundCrit` (buff gates use the probability tier, like `modifierCtx` — document inline). Consequence worth a comment at the call site: a `self-crit`-gated buff resolves `effectiveCritRate/100 > 0`, i.e. passes whenever crit rate is non-zero — intended "live-subject, satisfiable" behavior, not a bug.
   b. Gate + apply the firing skill's TIMED enemy debuff abilities (`conditionsMet(status.conditions, gateCtx)`) → `applyTimedAbilityStatus`. Landing: ability debuff statuses join the same per-round landing re-roll the scheduled list uses (invariant 3) — i.e. they are appended to `roundEnemyDebuffs` candidates with `application` respected, NOT separately rolled.
   c. Rebuild the enemy-debuff count (scheduled landed + ability statuses that landed) → `gateCtx2`.
   d. Gate + apply the firing skill's TIMED self-buff abilities against `gateCtx2`.
   e. Collect this round's effective ability statuses: `activeAbilityStatuses('self', gateCtx2)` + `timedAbilityStatuses('self')`, same for enemy side; fold their payloads into the round's totals exactly where the lookup-expanded scheduled buffs fold today (`toSimBuffs`-equivalent on payloads — write a small `payloadToBuffs` mirroring `dpsBuffHelpers.toSimBuffs` semantics: effect × stacks), enemy payloads into `toEnemyModifiers`/`toEnemyDotModifier` equivalents.
   f. **Per-round defPen/dot fold:** ability-status payloads with `defensePenetration`/`dotDamage` add to `effectivePen`/`dotMult` THIS round (they no longer ride the static `toDotAndPenModifiers` path — the adapter only feeds manual+team buffs into that). KNOWN-DIFF (b).
   g. Include ability statuses in `RoundData.activeSelfBuffs`/`activeEnemyDebuffs` snapshots (appended after scheduled — KNOWN-DIFF (c) ordering).
3. Emit `buff-applied`/`debuff-applied` for ability-status applications.

- [ ] **Step 4: Cut the page over (no-double-count)**

`DPSCalculatorPage.tsx:232-233` becomes:

```typescript
selfBuffs: [...attackerBuffs, ...teamAttackerBuffs],
enemyDebuffs: [...enemyBuffs, ...teamEnemyDebuffs],
```

`convertedMap` STAYS (the `mergedAttackerBuffTotals` preview at lines 175-206 uses it). Update the comment at lines 165-166: conversion is now display-only; the sim reads buff/debuff abilities from `shipSkills` directly. Update golden scenarios 10/12/14 the same way (drop the converted spread, keep `shipSkills`).

- [ ] **Step 5: Update snapshots — hand-verify every diff**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected failures: scenarios 10, 12, 14 (wiring + gating), possibly 11 if an ability-status fixture carries defPen/dot. For each: verify the diff is explained by KNOWN-DIFFs (a)/(b)/(c) ONLY — e.g. scenario 14's buff must now be inactive exactly until the round the entry count reaches 3, and active after. Scenario 10's totals must be IDENTICAL to the old snapshot except buff-list ordering (unconditioned abilities, no defPen/dot effects — same windows, same numbers). Then `npx vitest run -u` for this file only, and re-run the FULL suite (`npx vitest run`) — `dpsSimulator.test.ts` must still pass untouched (it feeds buffs via `selfBuffs` input, not conversion).

- [ ] **Step 6: New dynamic-gating tests**

`src/utils/combat/__tests__/dynamicBuffGating.test.ts`, driving `simulateDPS` directly with `shipSkills` containing conditional buff/debuff abilities. Five scenarios from the spec:

1. **Ramping on:** Attack Up gated `enemy-debuff gte 3`; active applies 1 corrosion entry/round (duration 3) → assert via `rounds[i].activeSelfBuffs` that the buff is absent in early rounds and present from the first round entering with count ≥3; assert a later round's `directDamage` > the same round's damage in a control run without the buff ability.
2. **Declining off:** aura buff gated `hp-threshold above 50` (enemy) → present while `enemyHpPct > 50`, absent after the pool drops below (pick enemyHp so the flip happens mid-run).
3. **Aura flicker:** aura gated `enemy-debuff gte 1` with a 2-duration corrosion applied only by the charged skill → on/off follows entry presence.
4. **Timed window persists:** timed buff (duration 3) gated `hp-threshold above 80`; condition true at application round, false later within the window → buff stays in `activeSelfBuffs` for the full window.
5. **Skipped application, later re-application:** timed buff gated `enemy-debuff gte 2` on the active skill; first cast fails the gate (no debuffs yet), a later cast passes → absent after first cast, present after the passing one.

- [ ] **Step 7: Lint, full suite, commit**

```bash
npm run lint && npx tsc --noEmit && npx vitest run
git add -A src
git commit -m "feat: dynamic per-round condition gating for buff/debuff abilities (combat engine in-loop application)"
```

---

## Task 7: Docs + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md`
- Modify: `src/constants/changelog.ts`
- Modify: `src/utils/abilities/applyAbilities.ts:182-187` (stale comment), `src/utils/abilities/configToSimInputs.ts:27-31` (stale comment), `src/utils/abilities/buffAbilityConverters.ts:74-99` (note: static gate now display-only)

- [ ] **Step 1: Update `docs/skill-model-coverage.md`**

- Header: new audit date + "after the combat-engine Phase 1 ship".
- §1 buff/debuff rows: conditions gate is now ✅ dynamic (timed: at application; aura/accumulating: per-round) with the live-subject rule; sim consumption is via the combat engine's status engine, not `SelectedGameBuff` conversion.
- §5 rewritten: in-loop application semantics, no-double-count (abilities → engine direct; conversion is page-preview only), per-round landing re-roll retained, charge-cadence quirk retained.
- §6 backlog: items 1–2 shipped; add Phase-2 pointers (application-time landing roll, real actor turns, post-turn duration decrement on the owner).
- Pipeline diagram line: `buffTimeline.ts` → `src/utils/combat/*`.

- [ ] **Step 2: Changelog entry** (same single-line style, `git add -p` to avoid unrelated local edits):

```typescript
'DPS calculator: conditional buffs and debuffs from ship skills now switch on and off based on live combat state (enemy debuff count, enemy HP, and similar conditions) instead of being always-on or always-off.',
```

- [ ] **Step 3: Commit** — `git commit -m "docs: skill-model coverage + changelog for combat engine phase 1"`

---

## Task 8: Full verification + PR

- [ ] **Step 1: Full local verification**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all green, 0 lint warnings.

- [ ] **Step 2: Manual app check**

`npm start` → DPS calculator: load a ship with a charged skill + DoTs, confirm the per-round table/heatmap renders and totals look unchanged for an unconditional ship; build a conditional buff (enemy-debuff ≥ 3 gate) in the editor and confirm the buff appears mid-fight in the round detail. Use the verify skill if available.

- [ ] **Step 3: PR**

```bash
git push -u origin feat/combat-engine-core
gh pr create --title "feat: combat engine core (Phase 1) — in-loop buff application with dynamic condition gating" --body "$(cat <<'EOF'
Phase 1 of docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md.

- New src/utils/combat/ engine: turn loop (turn-meter scaffolding, attacker-only), incremental status engine, emit-only event bus, relocated deterministic schedules
- Buff/debuff abilities now apply in-loop with live condition gating (timed: gate at application; auras: re-evaluated per round; live-subject rule for non-derivable subjects)
- dpsSimulator.ts is a thin adapter — public API unchanged, UI untouched
- computeBuffTimeline + the sentinel static sim gate retired; conversion survives for the page preview only
- Golden parity suite: identical output everywhere except condition-gated buffs (the fix), per-round defPen/dot from ability buffs, and buff-list ordering

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
