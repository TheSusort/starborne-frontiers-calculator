/**
 * Asphyxiator's Overload (owner ruling 2026-10-22): "At the start of the round, if there are any
 * enemies with 3 or more debuffs, this Unit gains 1 stack of Overload and gains Marauder Rage II
 * for 3 turns. Upon destroying an enemy, this Unit removes Overload."
 *  - Overload is PERSISTENT: the "for 3 turns" belongs to Marauder Rage, and Overload is a
 *    persistent stacking buff by name (`persistentStackingBuffs.ts`), so it keeps stacking past
 *    round 3.
 *  - It is removed when he destroys an enemy.
 *
 * Real kit (docs/ship-skills.csv, refit 4) through the production parser, seeded RNG. The board:
 * the front enemy is the victim he hits every turn, with HP tuned so it dies on his round-5 turn;
 * a second enemy carries 3 permanent seeded Corrosion stacks (3 debuffs, no applier, so they never
 * tick) so his round-start condition holds every round, before and after the kill.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import { parsePattern, parseShipTargeting, parseTarget } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { setupKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HUGE_HP = 1_000_000_000;
const ROUNDS = 7;
const KILL_ROUND = 5;

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this worktree'
        );
    }
});
beforeEach(() => {
    setupKeyedRng(20261022);
});
afterEach(() => {
    resetRateGateRng();
});

const inertEnemy = (id: string, position: Position, hp: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const input = (victimHp: number): CombatEngineInput => {
    const ship = buildTraceShip('Asphyxiator');
    if (!ship) throw new Error('Asphyxiator is missing from the reference data');
    const { active, charged } = parseShipTargeting(ship);
    if (!active || !charged) throw new Error('Asphyxiator has no parsed targeting');
    return {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 1e6,
        chargeCount: 99,
        shipSkills: buildShipAbilities(ship),
        numRounds: ROUNDS,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: HUGE_HP,
        speed: 100,
        mode: 'battle',
        position: 'M4',
        target: active.target,
        pattern: active.pattern,
        chargedTarget: charged.target,
        chargedPattern: charged.pattern,
        enemyAttackers: [inertEnemy('victim', 'M4', victimHp), inertEnemy('holder', 'B1', HUGE_HP)],
    };
};

interface Trace {
    /** Asphyxiator's Overload stacks at the end of each of his turns, by round. */
    overloadAfterTurn: Record<number, number>;
    /** Damage the victim took, by round. */
    victimTaken: Record<number, number>;
    /** Round the victim was destroyed, and by whom. */
    destroyed?: { round: number; killerId?: string };
}

const run = (victimHp: number): Trace => {
    const bus = createEventBus();
    let engine: StatusEngine | undefined;
    const t: Trace = { overloadAfterTurn: {}, victimTaken: {} };
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        if (e.actorId === 'attacker' && engine)
            t.overloadAfterTurn[e.round] = selfBuffStacksForOwner(engine, 'attacker', 'Overload');
    });
    bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
        if (e.actorId === 'victim') t.destroyed = { round: e.round, killerId: e.killerId };
    });
    const result = runCombat({
        ...input(victimHp),
        bus,
        __testTapStatusEngine: (s) => {
            engine = s;
        },
        __testTapActors: (all: CombatActor[]) => {
            const holder = all.find((a) => a.id === 'holder');
            holder?.corrosionEntries.push({
                stacks: 3,
                tier: 1,
                remainingRounds: 99,
                sourceId: 'seed',
            });
        },
    });
    for (const r of result.rounds) t.victimTaken[r.round] = r.perTargetDamage?.victim ?? 0;
    return t;
};

describe("Asphyxiator's Overload is persistent and is removed when he destroys an enemy", () => {
    it('without a kill, Overload keeps stacking past round 3 — one stack every round', () => {
        const t = run(HUGE_HP);
        expect(t.destroyed).toBeUndefined();
        expect(t.overloadAfterTurn).toEqual({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 });
    });

    it('his round-5 kill removes it; the next round starts a fresh stack', () => {
        // Tune the victim to die to his round-5 hit: exactly what it took in rounds 1-4 (his
        // hits and his Inferno ticks, which land on the victim's own later turn), plus 1.
        const probe = run(HUGE_HP);
        let hp = 1;
        for (let r = 1; r < KILL_ROUND; r++) hp += probe.victimTaken[r];

        const t = run(hp);
        expect(t.destroyed).toEqual({ round: KILL_ROUND, killerId: 'attacker' });
        // Persisted past the parsed 3 turns, right up to the kill…
        expect(t.overloadAfterTurn[KILL_ROUND - 1]).toBe(KILL_ROUND - 1);
        // …gone after the turn that destroyed the victim…
        expect(t.overloadAfterTurn[KILL_ROUND]).toBe(0);
        // …and the holder still carries 3 debuffs, so the next round start grants a new stack.
        expect(t.overloadAfterTurn[KILL_ROUND + 1]).toBe(1);
    });
});
