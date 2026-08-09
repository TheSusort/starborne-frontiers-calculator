/**
 * Guards on playerTurn.ts's INLINE `ability-performed` emit loop (multi-hit full-walk epic, PR6).
 *
 * Deliberately DIRECT runPlayerTurn tests. The guards under test are unreachable through any
 * production cast today (see playerTurn.ts's R5 derivation at the emit loop), so an integration
 * test would pass whether the guard exists or not. Do NOT "upgrade" these to integration tests —
 * that silently removes the only coverage these guards have.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';

/** A damage-only active skill with the given hit count. multiplier=100 → 100 x hits. */
const damageSkill = (hits: number): ShipSkills => {
    const ability: Ability = {
        id: `mheg-dmg-${hits}`,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits },
    };
    return { slots: [{ slot: 'active', abilities: [ability] }] };
};

/** Minimal runtime: no crits (so `damage` is the plain pre-crit number and easy to divide). */
function makeRuntime(skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: neverFire,
        chargedCritGate: neverFire,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** Minimal PlayerTurnArgs bound to a single non-positional enemy. */
function makeArgs(runtime: PlayerActorRuntime, bus = createEventBus()): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
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
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus,
        round: 1,
    };
}

describe('R5 whiff guard on the inline ability-performed loop', () => {
    /**
     * Deliberately a DIRECT runPlayerTurn test. The guard is unreachable through any production
     * cast (playerTurn.ts's R5 derivation walks every mid-round HP producer and shows none can
     * decline a non-positional bound target's HP), so an integration test would pass whether the
     * guard exists or not. Do NOT "upgrade" this to an integration test — that silently removes
     * the only coverage this guard has.
     */
    it('emits NO ability-performed for a 3-hit cast whose bound target is already at 0 HP', () => {
        const bus = createEventBus();
        const performed: unknown[] = [];
        bus.on('ability-performed', (e) => performed.push(e));

        const args = makeArgs(makeRuntime(damageSkill(3)), bus);
        // The guard's exact condition. `currentHp` is the real field on CombatActor
        // (state.ts:136); createActor seeds it from stats.hp, so it is forced to 0 here.
        args.enemy.currentHp = 0;
        // `deferAbilityPerformedToEngine` is intentionally unset so the INLINE loop runs (the
        // engine's deferred path implements R5 separately, at positionalApply.ts's per-sub-attack
        // anchor re-resolution).
        expect(args.deferAbilityPerformedToEngine).toBeUndefined();

        runPlayerTurn(args);

        expect(performed).toHaveLength(0);
    });

    /** Control: the SAME cast against a living target still emits one event per sub-attack (PR5). */
    it('still emits one event per sub-attack when the bound target is alive', () => {
        const bus = createEventBus();
        const performed: unknown[] = [];
        bus.on('ability-performed', (e) => performed.push(e));

        runPlayerTurn(makeArgs(makeRuntime(damageSkill(3)), bus));

        expect(performed).toHaveLength(3);
    });
});
