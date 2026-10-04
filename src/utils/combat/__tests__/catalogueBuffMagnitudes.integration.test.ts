/**
 * Real carriers grant the catalogue's tier magnitudes, with the carrier on either side.
 *
 * Each case reads the recipient's live stats at the start of its next turn (`stats-snapshot`):
 *  - Purifier's active grants Binderburg Resilience II: +20 Security AND +10% Defense.
 *  - Faust's charged grants Everliving Regeneration II: +15 Security.
 *  - Harvester gains Speed Up I when an ally is destroyed: +15% Speed.
 * Grant footprints are not under test, so grant carriers use a whole-side support pattern.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

type Snapshot = Extract<CombatEvent, { type: 'stats-snapshot' }>['stats'];

/** The FIRST `stats-snapshot` of every actor in each round, keyed `${actorId}@${round}`. */
const snapshots = (input: Parameters<typeof runCombat>[0]): Map<string, Snapshot> => {
    const bus = createEventBus();
    const out = new Map<string, Snapshot>();
    bus.on('stats-snapshot', (e: Extract<CombatEvent, { type: 'stats-snapshot' }>) => {
        const key = `${e.actorId}@${e.round}`;
        if (!out.has(key)) out.set(key, e.stats);
    });
    runCombat({ ...input, bus });
    return out;
};

const SUPPORT_ALL = parsePattern('Pattern-Support-All');
const idleOpponent = (): BoardUnit => ({
    id: 'opponent',
    kit: NO_KIT,
    position: 'M4',
    speed: 10,
});
const PLACEMENTS: Placement[] = ['player', 'enemy'];

describe.each(PLACEMENTS)('carrier on the %s side', (placement) => {
    it('Purifier active: Binderburg Resilience II gives an ally +20 Security and +10% Defense', () => {
        const carrier: BoardUnit = {
            id: 'carrier',
            kit: realKit('Purifier'),
            position: 'M3',
            speed: 300,
            chargeCount: 4,
            pattern: SUPPORT_ALL,
        };
        const ally: BoardUnit = {
            id: 'ally',
            kit: NO_KIT,
            position: 'M4',
            speed: 200,
            defence: 1000,
            security: 100,
        };
        const { input, id } = boardInput(placement, carrier, [ally], [idleOpponent()], 1);
        const s = snapshots(input).get(`${id(ally)}@1`)!;
        expect({ defence: s.defence, security: s.security }).toEqual({
            defence: 1100,
            security: 120,
        });
    });

    it('Faust charged: Everliving Regeneration II gives an ally +15 Security', () => {
        const carrier: BoardUnit = {
            id: 'carrier',
            kit: realKit('Faust'),
            position: 'M3',
            speed: 300,
            chargeCount: 1,
            startCharged: true,
            pattern: SUPPORT_ALL,
        };
        const ally: BoardUnit = {
            id: 'ally',
            kit: NO_KIT,
            position: 'M4',
            speed: 200,
            security: 100,
        };
        const { input, id } = boardInput(placement, carrier, [ally], [idleOpponent()], 1);
        expect(snapshots(input).get(`${id(ally)}@1`)!.security).toBe(115);
    });

    it('Harvester: Speed Up I after an ally is destroyed is +15% Speed', () => {
        const carrier: BoardUnit = {
            id: 'carrier',
            kit: realKit('Harvester'),
            position: 'M2',
            speed: 100,
            chargeCount: 4,
        };
        const fragile: BoardUnit = { id: 'fragile', kit: NO_KIT, position: 'M4', speed: 1, hp: 1 };
        // Slower than Harvester, so round 1's snapshot is the unbuffed baseline.
        const killer: BoardUnit = {
            id: 'killer',
            kit: hitKit(),
            position: 'M4',
            speed: 50,
            attack: 1000,
        };
        const { input, id } = boardInput(placement, carrier, [fragile], [killer], 2);
        const snaps = snapshots(input);
        expect(snaps.get(`${id(carrier)}@1`)!.speed).toBe(100);
        expect(snaps.get(`${id(carrier)}@2`)!.speed).toBeCloseTo(115, 9);
    });
});
