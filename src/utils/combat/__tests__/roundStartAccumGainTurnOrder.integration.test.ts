/**
 * A round-start stack gain (Overload, Blast — "gains 1 stack ... every turn") is announced holder
 * by holder in TURN ORDER (live speed, then board position, then the player side), both sides
 * interleaved, whichever side each holder stands on.
 *
 * Board: Ravager (speed 88) and Shashou (82) on one side, Butcher (83) on the other. Turn order is
 * Ravager, Butcher, Shashou. Mounted both ways.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(5));

const kit = (ship: string) => ({ slots: realSlots(ship, ['active', 'passive']) });

/** Round-start gains, as `<spec id>:<buff>`, in log order, keyed by round. */
const roundStartGains = (side: 'player' | 'enemy', speeds = { ravager: 88, shashou: 82 }) => {
    const ravager: ShipSpec = {
        id: 'ravager',
        position: 'M4',
        speed: speeds.ravager,
        skills: kit('Ravager'),
    };
    const shashou: ShipSpec = {
        id: 'shashou',
        position: 'T4',
        speed: speeds.shashou,
        skills: kit('Shashou'),
    };
    const butcher: ShipSpec = { id: 'butcher', position: 'M4', speed: 83, skills: kit('Butcher') };
    const { input, idOf } = mirrorBoard(
        { caster: [ravager, shashou], other: [butcher], numRounds: 2 },
        side
    );
    const specOf = (id: string) =>
        ['ravager', 'shashou', 'butcher'].find((s) => idOf(s) === id) ?? id;
    const bus = createEventBus();
    const byRound: Record<number, string[]> = {};
    let inRoundStart = false;
    bus.on('round-started', () => {
        inRoundStart = true;
    });
    bus.on('turn-started', () => {
        inRoundStart = false;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (!inRoundStart || e.duration !== 'recurring') return;
        (byRound[e.round] ??= []).push(`${specOf(e.actorId)}:${e.buffName}`);
    });
    runCombat({ ...input, bus });
    return byRound;
};

const holders = (gains: string[] | undefined) => gains?.map((g) => g.split(':')[0]);

describe('round-start stack gains resolve in turn order', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side caster: Ravager, Butcher, Shashou every round`, () => {
            const got = roundStartGains(side);
            expect(got[1]).toEqual(['ravager:Overload', 'butcher:Overload', 'shashou:Blast']);
            expect(holders(got[2])).toEqual(['ravager', 'butcher', 'shashou']);
        });
        it(`${side}-side caster: a faster Shashou gains first`, () => {
            const got = roundStartGains(side, { ravager: 80, shashou: 90 });
            expect(holders(got[1])).toEqual(['shashou', 'butcher', 'ravager']);
        });
    }
});
