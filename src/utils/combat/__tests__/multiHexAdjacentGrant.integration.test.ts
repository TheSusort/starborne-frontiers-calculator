/**
 * A two-hex unit's `adjacent-allies` grant reaches every ally touching EITHER of its hexes. The
 * grant is Centurion's charged "grants all adjacent allies 2 stacks" of Core Charge I, whose
 * recipients are narrowed at registration by the engine's static board adjacency and again
 * against the live roster when applied. Centurion stands on M1+M2 (anchor M1): an ally at M3
 * touches M2 only, so it is a neighbour; an ally at M4 touches neither hex. Mounted both ways for
 * team symmetry.
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

/** The ships other than Centurion that gain Core Charge I from Centurion's charged cast. */
const allyHoldersOfCoreCharge = (side: 'player' | 'enemy', allyAt: Position): string[] => {
    const ally: ShipSpec = { id: 'ally', position: allyAt, speed: 50, hp: 1e9 };
    const centurion: ShipSpec = {
        id: 'centurion',
        position: 'M1',
        footprint: ['M1', 'M2'],
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
    const bus = createEventBus();
    const holders: string[] = [];
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName !== 'Core Charge I' || e.granterId !== idOf('centurion')) return;
        if (e.actorId === idOf('ally')) holders.push('ally');
    });
    runCombat({ ...input, bus });
    return holders;
};

describe('a two-hex unit’s adjacent-allies grant', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: reaches an ally at M3, which touches only its M2 hex`, () => {
            expect(allyHoldersOfCoreCharge(side, 'M3')).toEqual(['ally']);
        });
        it(`${side}-side control: skips an ally at M4, which touches neither hex`, () => {
            expect(allyHoldersOfCoreCharge(side, 'M4')).toEqual([]);
        });
    }
});
