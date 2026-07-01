/**
 * Anchor crit at real affinity (Strategy A): when deferAbilityPerformedToEngine is true,
 * hitCrits[] rolls use the bound anchor's affinity cap/penalty, not the representative
 * affinityCritCap/affinityCritPenalty scalars.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';
import { computeAffinityModifiers } from '../../calculators/affinityUtils';

const damageSkill: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'dmg-anchor-crit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, hits: 1 },
                },
            ],
        },
    ],
};

function makeRuntime(crit: number): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit,
            critDamage: 100,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
        affinity: 'chemical',
    });

    return {
        actor,
        focus: true,
        castSkills: damageSkill,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        // Representative matchup scalars (neutral — as if enemy[0] were same-affinity).
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: 'chemical',
        activeCritGate: makeRateGate(),
        chargedCritGate: makeRateGate(),
        activeHealCritGate: makeRateGate(),
        chargedHealCritGate: makeRateGate(),
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    deferAbilityPerformedToEngine: boolean
): PlayerTurnArgs {
    // Anchor at affinity disadvantage vs chemical attacker (thermal > chemical).
    const enemy = createActor({
        id: 'anchor',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
        affinity: 'thermal',
    });

    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        deferAbilityPerformedToEngine,
    };
}

describe('anchor crit at real affinity (deferAbilityPerformedToEngine)', () => {
    afterEach(() => resetRateGateRng());

    it('positional cast rolls hitCrits at anchor affinity, not representative cap', () => {
        const crit = 80;
        const runtime = makeRuntime(crit);

        const repRate =
            Math.min(runtime.affinityCritCap, Math.max(0, crit - runtime.affinityCritPenalty)) /
            100;
        const anchorMods = computeAffinityModifiers('chemical', 'thermal');
        const anchorRate =
            Math.min(anchorMods.critCap, Math.max(0, crit - anchorMods.critPenalty)) / 100;

        // Straddle: crits at representative rate, fails at anchor rate.
        expect(repRate).toBeGreaterThan(anchorRate);
        const draw = (repRate + anchorRate) / 2;
        expect(draw).toBeLessThan(repRate);
        expect(draw).toBeGreaterThanOrEqual(anchorRate);

        setRateGateRng(() => draw);

        const positional = runPlayerTurn(makeArgs(runtime, true));
        expect(positional.hitCrits).toEqual([false]);

        setRateGateRng(() => draw);

        const nonPositional = runPlayerTurn(makeArgs(runtime, false));
        expect(nonPositional.hitCrits).toEqual([true]);
    });
});
