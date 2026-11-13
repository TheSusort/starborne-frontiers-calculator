/**
 * An inflicted-scope extension (Valerian's crit-power chance to extend the DoT the cast inflicted)
 * takes no `extendChanceGate` draw and logs no duration change when the target is immune to every
 * DoT the cast carries (`immuneToDot`): nothing was attempted, so there is nothing to extend, and a
 * phantom draw would shift every later extension outcome on the same stream.
 *
 * Harness: one direct `runPlayerTurn` cast (the `accumulatorOnlyInflictedExtension` shape) with a
 * counting extension gate and a recorded event bus.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs, RateGate } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability } from '../../../types/abilities';

/** One cast as the engine runs it: `runPlayerTurn`, then the post-damage flush of the landings
 *  held for after the damage (engine.ts `flushDeferredEnemyApplications`) — where a DoT or Bomb
 *  clause written after the damage clause is written. */
const castAndLand = (args: PlayerTurnArgs): ReturnType<typeof runPlayerTurn> => {
    const turn = runPlayerTurn(args);
    for (const pending of turn.deferredEnemyApplications.splice(0)) {
        pending.applyState();
        pending.emitEvents();
    }
    return turn;
};

const baseStats = () => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 20_000,
    speed: 100,
});

const castHit: Ability = {
    id: 'cast-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

function makeRuntime(
    side: 'player' | 'enemy',
    abilities: Ability[],
    extendChanceGate: RateGate
): PlayerActorRuntime {
    const actor = createActor({
        id: 'caster',
        side,
        kind: 'attacker',
        stats: baseStats(),
        chargeCount: 1,
        startCharged: true,
    });
    return {
        actor,
        focus: true,
        // A damage clause, as the real cast has: a crit needs damage (owner ruling 2026-10-22).
        castSkills: { slots: [{ slot: 'charged', abilities: [castHit, ...abilities] }] },
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: true,
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
        healModifier: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: 'thermal',
        activeCritGate: () => false,
        chargedCritGate: () => true,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: () => true,
        extendChanceGate,
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        scheduledSelfBuffsBySource: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

const corrosionClause: Ability = {
    id: 'cast-corrosion',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 2 },
};
const valerianExtend: Ability = {
    id: 'inflicted-extend',
    type: 'extend-dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extend-dot', turns: 1, chanceFromCritPower: true, scope: 'inflicted' },
};

const cast = (side: 'player' | 'enemy', victimDotImmune: boolean) => {
    let draws = 0;
    const runtime = makeRuntime(side, [corrosionClause, valerianExtend], () => {
        draws++;
        return true;
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    const victim: CombatActor = createActor({
        id: 'victim',
        side: side === 'player' ? 'enemy' : 'player',
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        dotImmune: victimDotImmune,
    });
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    const args: PlayerTurnArgs = {
        runtime,
        enemy: victim,
        statusEngine,
        corrosionEntries: victim.corrosionEntries,
        infernoEntries: victim.infernoEntries,
        genericDoTEntries: victim.genericDoTEntries,
        pendingBombs: victim.pendingBombs,
        pendingAccumulators: victim.pendingAccumulators,
        enemyDefense: 0,
        enemyHp: victim.currentHp,
        enemyType: undefined,
        bus,
        round: 1,
        targetId: victim.id,
        aoeVictimIds: [victim.id],
        opposingVictimById: new Map([[victim.id, victim]]),
    };
    castAndLand(args);
    const durationChanges = events.filter((e) => e.type === 'status-duration-changed-log');
    return { victim, draws, durationChanges };
};

beforeEach(() => setupKeyedRng(792));

describe.each(['player', 'enemy'] as const)('%s-side caster', (side) => {
    it('control: against a DoT-susceptible target the extension draws once and extends', () => {
        const c = cast(side, false);
        expect(c.victim.corrosionEntries.map((e) => e.remainingRounds)).toEqual([3]);
        expect(c.draws).toBe(1);
        expect(c.durationChanges).toHaveLength(1);
    });

    it('against a DoT-immune target the extension draws nothing and logs no change', () => {
        const c = cast(side, true);
        expect(c.victim.corrosionEntries).toEqual([]);
        expect(c.draws).toBe(0);
        expect(c.durationChanges).toEqual([]);
    });
});
