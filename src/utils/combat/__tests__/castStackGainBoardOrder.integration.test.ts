/**
 * The stacks a cast banks on several ships of the caster's side (Centurion's charged "gains 4
 * stacks of Core Charge I and grants all adjacent allies 2 stacks") are announced in board
 * position order (`positionTurnRank`), whichever side the caster stands on.
 *
 * Two boards, each mounted both ways, so a roster-order announcement is wrong on one side of each:
 * - Centurion at T2 beside an ally at M2: Centurion's own gain is announced first.
 * - Centurion at M2 beside an ally at T1: the ally's gain is announced first.
 * The ally is the caster team's first ship, so on the player mount it is the focus actor.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(5));

/** Holders of each Core Charge I gain Centurion's charged cast announces, in log order. */
const coreChargeHolders = (
    side: 'player' | 'enemy',
    centurionAt: Position,
    allyAt: Position
): string[] => {
    const ally: ShipSpec = { id: 'ally', position: allyAt, speed: 50, hp: 1e9 };
    const centurion: ShipSpec = {
        id: 'centurion',
        position: centurionAt,
        speed: 90,
        attack: 1000,
        hp: 1e9,
        chargeCount: 2,
        startCharged: true,
        hasChargedSkill: true,
        skills: { slots: realSlots('Centurion', ['active', 'charged', 'passive']) },
    };
    const dummy: ShipSpec = { id: 'dummy', position: 'M4', speed: 10, hp: 1e9 };
    const { input, idOf } = mirrorBoard(
        { caster: [ally, centurion], other: [dummy], numRounds: 1 },
        side
    );
    const specOf = (id: string) => ['ally', 'centurion', 'dummy'].find((s) => idOf(s) === id) ?? id;
    const bus = createEventBus();
    const holders: string[] = [];
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName !== 'Core Charge I' || e.granterId !== idOf('centurion')) return;
        holders.push(specOf(e.actorId));
    });
    runCombat({ ...input, bus });
    return holders;
};

describe("a cast's stack gains on several ships are announced in board order", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Centurion at T2, ally at M2: Centurion first`, () => {
            expect(coreChargeHolders(side, 'T2', 'M2')).toEqual(['centurion', 'ally']);
        });
        it(`${side}-side Centurion at M2, ally at T1: the ally first`, () => {
            expect(coreChargeHolders(side, 'M2', 'T1')).toEqual(['ally', 'centurion']);
        });
        it(`${side}-side control: a non-adjacent ally gets no Core Charge I`, () => {
            expect(coreChargeHolders(side, 'T2', 'B4')).toEqual(['centurion']);
        });
    }
});
