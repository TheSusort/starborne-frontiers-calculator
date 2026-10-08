/**
 * Lionheart's two on-crit grants are slot-bound: his active's "If this critically hits, this Unit
 * grants Attack Up II to all adjacent allies for 1 turn" fires only when his ACTIVE crits, and his
 * charged's "... Attack Up III ..." only when his CHARGED crits. A crit by one slot never wakes the
 * other slot's grant.
 *
 * Real parsed kit (refit 4). Lionheart crits every hit; allies stand on both flanks; his charged
 * is ready from round 2 (charge 1). Run with Lionheart on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(5));

/** Attack Up grants the flank allies received, per round. */
const flankGrants = (placement: Placement, numRounds: number): Map<number, string[]> => {
    const lionheart: BoardUnit = {
        id: 'lionheart',
        kit: realKit('Lionheart'),
        position: 'M4',
        speed: 200,
        attack: 1000,
        crit: 100,
        critDamage: 50,
        hacking: 1e6,
        hp: 1e9,
        chargeCount: 1,
    };
    const flankT: BoardUnit = { id: 'flank-t', kit: NO_KIT, position: 'T4', speed: 1 };
    const flankB: BoardUnit = { id: 'flank-b', kit: NO_KIT, position: 'B4', speed: 1 };
    const dummy: BoardUnit = { id: 'dummy', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e10 };
    const { input, id } = boardInput(placement, lionheart, [flankT, flankB], [dummy], numRounds);
    const flanks = new Set([id(flankT), id(flankB)]);
    const bus = createEventBus();
    const byRound = new Map<number, string[]>();
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (!flanks.has(e.actorId) || !e.buffName.startsWith('Attack Up')) return;
        byRound.set(e.round, [...(byRound.get(e.round) ?? []), `${e.actorId}:${e.buffName}`]);
    });
    runCombat({ ...input, bus });
    return byRound;
};

describe.each<Placement>(['player', 'enemy'])('Lionheart on the %s side', (placement) => {
    it('his active crit grants Attack Up II to each flank, and his charged crit grants Attack Up III', () => {
        const grants = flankGrants(placement, 2);
        expect([...(grants.get(1) ?? [])].sort()).toEqual([
            'flank-b:Attack Up II',
            'flank-t:Attack Up II',
        ]);
        expect([...(grants.get(2) ?? [])].sort()).toEqual([
            'flank-b:Attack Up III',
            'flank-t:Attack Up III',
        ]);
    });
});
