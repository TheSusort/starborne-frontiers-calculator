/**
 * Oleander R4: "When an ally inflicts a debuff, this Unit adds 1 charge to its own charged skill
 * and then, once per ally per round, grants Repair Over Time II to that ally for 2 turns."
 * Measured in game: an ally Curator's active landing two debuffs on each of three enemies gave
 * Oleander ONE charge.
 *
 * The charge is `oncePerRootCast: 'cast'`: one per skill cast however many debuffs and enemies
 * it reached; a second cast is a second charge. The Repair Over Time grant keeps its own
 * once-per-ally-per-round cap and is not asserted here.
 *
 * Real parsed kits (buildTraceShip, refit 4). Curator fires Pattern-Circle-Range-1, striking M4,
 * M3 and T4. Run with Oleander on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern } from '../../targetingParser';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(3));

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    const narrowed = full.slots.filter((s) => slots.includes(s.slot));
    return {
        ...full,
        slots: narrowed.some((s) => s.slot === 'active')
            ? narrowed
            : [{ slot: 'active', abilities: [] }, ...narrowed],
    };
};

const oleander = (): BoardUnit => ({
    id: 'oleander',
    kit: kit('Oleander', ['passive']),
    position: 'M4',
    speed: 1,
    // A charge cap far above the grants under test, so no charged cast muddies the count.
    chargeCount: 99,
});
const curator = (): BoardUnit => ({
    id: 'curator',
    kit: kit('Curator', ['active']),
    position: 'M3',
    speed: 200,
    attack: 1000,
    hacking: 1e6,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});
const enemies = (n: number): BoardUnit[] =>
    (['M4', 'M3', 'T4'] as const).slice(0, n).map((position, i) => ({
        id: `enemy-${'abc'[i]}`,
        kit: NO_KIT,
        position,
        speed: 1,
    }));

/** Charges Oleander gained from abilities (not the per-turn +1), and the debuffs Curator landed. */
const run = (placement: Placement, enemyCount: number, rounds: number) => {
    const carrier = oleander();
    const { input, id } = boardInput(placement, carrier, [curator()], enemies(enemyCount), rounds);
    let gained = 0;
    let landed = 0;
    const bus = createEventBus();
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === id(carrier) && e.reason === 'manip') gained += e.newCharge - e.oldCharge;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === 'curator') landed++;
    });
    runCombat({ ...input, bus });
    return { gained, landed };
};

describe.each<Placement>(['player', 'enemy'])('Oleander on the %s side', (placement) => {
    it("an ally's cast landing two debuffs on each of three enemies: +1 charge", () => {
        const { gained, landed } = run(placement, 3, 1);
        // Instrument: the cast really landed six debuffs.
        expect(landed).toBe(6);
        expect(gained).toBe(1);
    });

    it('a cast landing two debuffs on one enemy: +1 charge', () => {
        const { gained, landed } = run(placement, 1, 1);
        expect(landed).toBeGreaterThanOrEqual(2);
        expect(gained).toBe(1);
    });

    it('two casts: +2 charges', () => {
        const { gained, landed } = run(placement, 3, 2);
        expect(landed).toBe(12);
        expect(gained).toBe(2);
    });
});
