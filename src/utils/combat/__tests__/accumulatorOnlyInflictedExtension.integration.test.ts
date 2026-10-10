/**
 * The inflicted-scope extension gate opens when the cast landed ANYTHING for the extension to grow.
 * A cast whose DoT landing roll failed but whose Echoing Burst landed (the burst draws its own
 * landing decision) still extends that burst. With neither a DoT nor a burst landing the gate stays
 * shut.
 *
 * Harness: one direct `runPlayerTurn` cast with hand-built runtimes and a scripted landing gate
 * (the `debuffExtensionReachesDoTs` shape): draw 1 is the cast's shared DoT roll, draw 2 is the
 * burst's own.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs, RateGate } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability } from '../../../types/abilities';

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

/** A gate that answers `outcomes` in order, then lands. */
const scriptedGate =
    (outcomes: boolean[]): RateGate =>
    () =>
        outcomes.length > 0 ? outcomes.shift()! : true;

function makeRuntime(
    side: 'player' | 'enemy',
    abilities: Ability[],
    landingOutcomes: boolean[]
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
        castSkills: { slots: [{ slot: 'charged', abilities }] },
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
        debuffLandingGate: scriptedGate([...landingOutcomes]),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
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
const echoClause: Ability = {
    id: 'cast-echo',
    type: 'accumulate-detonate',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'accumulate-detonate', turns: 2, pct: 50 },
};
const inflictedDebuffExtend: Ability = {
    id: 'inflicted-extend',
    type: 'extend-status',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [{ subject: 'self-crit', derivable: true }],
    config: { type: 'extend-status', statusKind: 'debuff', turns: 1, scope: 'inflicted' },
};

const cast = (side: 'player' | 'enemy', abilities: Ability[], landingOutcomes: boolean[]) => {
    const runtime = makeRuntime(side, abilities, landingOutcomes);
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    const victim: CombatActor = createActor({
        id: 'victim',
        side: side === 'player' ? 'enemy' : 'player',
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
    });
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
        bus: createEventBus(),
        round: 1,
        targetId: victim.id,
        aoeVictimIds: [victim.id],
        opposingVictimById: new Map([[victim.id, victim]]),
    };
    runPlayerTurn(args);
    return victim;
};

beforeEach(() => setupKeyedRng(648));

describe.each(['player', 'enemy'] as const)('%s-side caster', (side) => {
    const FAIL_DOT_LAND_BURST = [false, true];

    it('control: with the DoT and the burst both landing, both are extended', () => {
        const v = cast(side, [corrosionClause, echoClause, inflictedDebuffExtend], [true, true]);
        expect(v.corrosionEntries.map((e) => e.remainingRounds)).toEqual([3]);
        expect(v.pendingAccumulators.map((a) => a.roundsRemaining)).toEqual([3]);
    });

    it('the DoT roll fails and the burst lands: the burst is still extended', () => {
        const v = cast(
            side,
            [corrosionClause, echoClause, inflictedDebuffExtend],
            FAIL_DOT_LAND_BURST
        );
        // Instrument: the Corrosion really failed and the burst really landed.
        expect(v.corrosionEntries).toEqual([]);
        expect(v.pendingAccumulators).toHaveLength(1);
        expect(v.pendingAccumulators[0].roundsRemaining).toBe(3);
    });

    it('control: the same cast without the extension leaves the burst at its written length', () => {
        const v = cast(side, [corrosionClause, echoClause], FAIL_DOT_LAND_BURST);
        expect(v.corrosionEntries).toEqual([]);
        expect(v.pendingAccumulators.map((a) => a.roundsRemaining)).toEqual([2]);
    });

    it('the DoT roll fails and the burst fails too: nothing lands, nothing is extended', () => {
        const v = cast(side, [corrosionClause, echoClause, inflictedDebuffExtend], [false, false]);
        expect(v.corrosionEntries).toEqual([]);
        expect(v.pendingAccumulators).toEqual([]);
    });
});
