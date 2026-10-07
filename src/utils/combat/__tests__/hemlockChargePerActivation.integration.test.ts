/**
 * Hemlock's "This Unit adds 1 charge to its charged skill after it inflicts a debuff" grants one
 * charge per ACTIVATION, not one per debuff or stack landed (owner ruling, measured in game
 * 2026-10-07):
 *  - her own skill cast: at most +1, however many debuffs and stacks it lands;
 *  - Toxic Overflow's end-of-round Corrosion spread: at most +1, however many neighbours it lands
 *    on, and nothing when every neighbour resists.
 *
 * Board: Hemlock (M4, hacking 1000, real passive) casts an active landing Toxic Overflow AND her
 * real Corrosion II on A (M4), which also holds a seeded Corrosion. At the round end the spread
 * reaches A's neighbours B (M3) and C (T3); their security decides whether it lands. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { TOXIC_OVERFLOW } from '../../../constants/toxicOverflow';
import type { Ability } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const noop: Ability = {
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
};

const toxicOverflow = (): Ability => {
    const found = realSlots('Hemlock', ['charged'])[0].abilities.find(
        (a) => a.config.type === 'debuff' && a.config.buffName.startsWith(TOXIC_OVERFLOW)
    );
    if (!found) throw new Error('Hemlock charged carries no Toxic Overflow');
    return found;
};

const corrosionII = (): Ability => {
    const found = realSlots('Hemlock', ['active'])[0].abilities.find(
        (a) => a.config.type === 'dot'
    );
    if (!found) throw new Error('Hemlock active carries no Corrosion');
    return found;
};

interface Measured {
    /** Charge Hemlock's passive granted during her own turn. */
    castCharges: number;
    /** Charge Hemlock's passive granted at the round end (the spread). */
    spreadCharges: number;
    /** Debuffs + DoT stacks Hemlock's cast landed. */
    castInflictions: number;
    /** Corrosion stacks the spread landed. */
    spreadLanded: number;
    /** The spread's resists that drew a landing roll. */
    spreadRolledResists: number;
}

const measure = (side: 'player' | 'enemy', neighbourSecurity: number): Measured => {
    const hemlock: ShipSpec = {
        id: 'hemlock',
        position: 'M4',
        speed: 1000,
        hp: 1_000_000,
        hacking: 1000,
        // A charge cap far above the grants under test, so no charged cast muddies the count.
        chargeCount: 99,
        skills: {
            slots: [
                { slot: 'active', abilities: [noop, toxicOverflow(), corrosionII()] },
                ...realSlots('Hemlock', ['passive']),
            ],
        },
    };
    const a: ShipSpec = { id: 'a', position: 'M4', speed: 1, hp: 1e9, security: 0 };
    const b: ShipSpec = {
        id: 'b',
        position: 'M3',
        speed: 1,
        hp: 1e9,
        security: neighbourSecurity,
    };
    const c: ShipSpec = {
        id: 'c',
        position: 'T3',
        speed: 1,
        hp: 1e9,
        security: neighbourSecurity,
    };
    const { input, idOf } = mirrorBoard(
        { caster: [hemlock], other: [a, b, c], numRounds: 1 },
        side
    );
    const bus = createEventBus();
    const out: Measured = {
        castCharges: 0,
        spreadCharges: 0,
        castInflictions: 0,
        spreadLanded: 0,
        spreadRolledResists: 0,
    };
    let roundEnding = false;
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        // Every ship has acted once A's (the last) turn ends: what lands after is the spread.
        if (e.actorId === idOf('a')) roundEnding = true;
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId !== idOf('hemlock') || e.reason !== 'manip') return;
        if (roundEnding) out.spreadCharges += e.newCharge - e.oldCharge;
        else out.castCharges += e.newCharge - e.oldCharge;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (!roundEnding && e.sourceId === idOf('hemlock')) out.castInflictions++;
    });
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId !== idOf('hemlock')) return;
        if (roundEnding) out.spreadLanded += e.stacks;
        else out.castInflictions += e.stacks;
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (roundEnding && e.sourceId === idOf('hemlock') && e.viaLandingRoll)
            out.spreadRolledResists++;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            all.find((x) => x.id === idOf('a'))!.corrosionEntries.push({
                stacks: 1,
                tier: 6,
                remainingRounds: 9,
                sourceId: idOf('a'),
            });
        },
    });
    return out;
};

describe('Hemlock gains one charge per skill cast or spread, not per debuff', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a cast landing Toxic Overflow and Corrosion II gives +1`, () => {
            const m = measure(side, 0);
            // Instrument: the cast landed more than one infliction.
            expect(m.castInflictions).toBeGreaterThanOrEqual(2);
            expect(m.castCharges).toBe(1);
        });

        it(`${side}-side: a spread landing on two neighbours gives +1`, () => {
            const m = measure(side, 0);
            // Instrument: the spread landed a stack on each of B and C.
            expect(m.spreadLanded).toBe(2);
            expect(m.spreadCharges).toBe(1);
        });

        it(`${side}-side: a spread every neighbour resists gives nothing`, () => {
            const m = measure(side, 1e9);
            expect(m.spreadLanded).toBe(0);
            expect(m.spreadRolledResists).toBe(2);
            expect(m.spreadCharges).toBe(0);
        });

        it(`${side}-side: the cast and the spread in one round give +2 in total`, () => {
            const m = measure(side, 0);
            expect(m.castCharges + m.spreadCharges).toBe(2);
        });
    }
});
