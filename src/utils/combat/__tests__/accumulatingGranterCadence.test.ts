import { describe, it, expect } from 'vitest';
import { createStatusEngine, type RegisteredAbilityStatus } from '../statusEngine';
import type { ConditionContext } from '../../../types/combat';

// #436. Two owner rulings (2026-09-01), both posed with real kits:
//
//  A — a granted accumulating stack keeps accruing on the GRANTER's cadence. Centurion next to
//      an idle ally, charging and casting on round 2 and again on round 4: the ally reads 4
//      stacks of Core Charge I, not 2.
//  B — two same-named grants on one owner BOTH land. Two adjacent fully-charged Centurions
//      casting in the same round each read 6 (own self 4 + the other's adjacent 2).
//
// Both collisions are reachable in the real corpus (measured 2026-09-01, all 149 ships):
// Core Charge I (Centurion self 4 per-charge + Centurion adjacent-allies 2 per-charge + Nuqtu
// self 1 per-round) and Blast (Howler `ally` 1 per-round + LUXX/Lev/Shashou/Sokol self 1
// per-round). The Blast pair is live on the per-round path TODAY — it needs no cadence fix,
// only the summing fix.

const baseCtx: ConditionContext = {
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    effectiveCritRate: 50,
    enemyAdjacentCount: 0,
    adjacentAllyCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
};

const coreCharge = (casterId: string, stacks: number): RegisteredAbilityStatus => ({
    payload: {
        buffName: 'Core Charge I',
        stacks,
        isStackable: true,
        parsedEffects: { outgoingDamage: 4, defensePenetration: 1 },
    },
    side: 'self',
    sourceSlot: 'charged',
    conditions: [],
    casterId,
    kind: 'accumulating',
    maxStacks: 10,
    stackTrigger: 'per-charge',
});

const blast = (casterId: string): RegisteredAbilityStatus => ({
    payload: {
        buffName: 'Blast',
        stacks: 1,
        isStackable: true,
        parsedEffects: { outgoingDamage: 15 },
    },
    side: 'self',
    sourceSlot: 'passive',
    conditions: [],
    casterId,
    kind: 'accumulating',
    maxStacks: 4,
    stackTrigger: 'per-round',
});

const newEngine = () => createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

const stacksOf = (
    eng: ReturnType<typeof createStatusEngine>,
    ownerId: string,
    buffName: string
): number | undefined =>
    eng
        .activeAbilityStatuses('self', () => baseCtx, ownerId)
        .find((s) => s.active.buffName === buffName)?.active.stacks;

describe('#436 accumulating statuses — granter cadence and per-granter summing', () => {
    it("ruling A: an ally keeps accruing on the granting Centurion's charges", () => {
        const eng = newEngine();
        // Centurion ('cent') grants his neighbour ('ally') 2 stacks per charged cast. The grant
        // lives on the ALLY's store, carrying the CENTURION as casterId.
        eng.registerAbilityStatuses([coreCharge('cent', 2)], 'ally');

        eng.beginRound(1);
        eng.sourceFired('cent', 'charge', 1);
        expect(stacksOf(eng, 'ally', 'Core Charge I')).toBe(2);

        eng.beginRound(2);
        eng.sourceFired('cent', 'charge', 2);
        expect(stacksOf(eng, 'ally', 'Core Charge I')).toBe(4);
    });

    it("ruling A: the ally's OWN cast does not tick a stack granted by someone else", () => {
        const eng = newEngine();
        eng.registerAbilityStatuses([coreCharge('cent', 2)], 'ally');

        eng.beginRound(1);
        eng.sourceFired('ally', 'charge', 1);
        // The grant rides the granter's cadence, so the holder charging is not the trigger.
        expect(stacksOf(eng, 'ally', 'Core Charge I')).toBeUndefined();
    });

    it('ruling B: two adjacent Centurions each read 6 after both charge', () => {
        const eng = newEngine();
        // Centurion B's store holds his own self grant (rate 4, riding HIS charge) and
        // Centurion A's adjacent grant (rate 2, riding A's charge).
        eng.registerAbilityStatuses([coreCharge('centB', 4)], 'centB');
        eng.registerAbilityStatuses([coreCharge('centA', 2)], 'centB');

        eng.beginRound(1);
        eng.sourceFired('centB', 'charge', 1);
        eng.sourceFired('centA', 'charge', 1);
        expect(stacksOf(eng, 'centB', 'Core Charge I')).toBe(6);
    });

    it('ruling B: the total clamps at the buff cap, not per granter', () => {
        const eng = newEngine();
        eng.registerAbilityStatuses([coreCharge('centB', 4)], 'centB');
        eng.registerAbilityStatuses([coreCharge('centA', 2)], 'centB');

        for (const r of [1, 2]) {
            eng.beginRound(r);
            eng.sourceFired('centB', 'charge', r);
            eng.sourceFired('centA', 'charge', r);
        }
        // 6 + 6 = 12, clamped to Core Charge I's cap of 10.
        expect(stacksOf(eng, 'centB', 'Core Charge I')).toBe(10);
    });

    it("ruling B on the per-round path: Howler's ally Blast adds to Lev's own Blast", () => {
        const eng = newEngine();
        eng.registerAbilityStatuses([blast('lev')], 'lev');
        eng.registerAbilityStatuses([blast('howler')], 'lev');

        eng.beginRound(1);
        // Two granters, one stack each, both per-round: 2 per round, not 1.
        expect(stacksOf(eng, 'lev', 'Blast')).toBe(2);

        eng.beginRound(2);
        eng.beginRound(3);
        // 2/round would reach 6; the cap is 4.
        expect(stacksOf(eng, 'lev', 'Blast')).toBe(4);
    });

    it("mixed triggers on one owner: Nuqtu's per-round self grant and Centurion's per-charge adjacent grant both accrue", () => {
        const eng = newEngine();
        const nuqtuSelf: RegisteredAbilityStatus = {
            ...coreCharge('nuqtu', 1),
            sourceSlot: 'passive',
            kind: 'accumulating',
            maxStacks: 10,
            stackTrigger: 'per-round',
        };
        eng.registerAbilityStatuses([nuqtuSelf], 'nuqtu');
        eng.registerAbilityStatuses([coreCharge('cent', 2)], 'nuqtu');

        eng.beginRound(1);
        // The per-round contribution ticked at round top; the per-charge one has not fired.
        expect(stacksOf(eng, 'nuqtu', 'Core Charge I')).toBe(1);
        eng.sourceFired('cent', 'charge', 1);
        expect(stacksOf(eng, 'nuqtu', 'Core Charge I')).toBe(3);
    });
});
