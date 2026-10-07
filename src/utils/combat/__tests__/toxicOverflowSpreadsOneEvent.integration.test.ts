/**
 * Every Toxic Overflow spread of one round's end-of-round pass is ONE event for once-per-root-cast
 * reactions (owner ruling, measured in game 2026-10-07): two enemies that each hold Toxic Overflow
 * and Corrosion both spread at the round end, and Hemlock and Oleander each gain one charge for
 * the two spreads together. Hemlock's 5% repair still counts every enemy each spread landed on.
 * Spreads in different rounds are separate events.
 *
 * Board: Hemlock (M4, hacking 1000, real passive) and Oleander (M3, real passive). Hemlock's
 * active lands Toxic Overflow on every enemy. X (T4) and Y (B1) hold a seeded Corrosion; their
 * neighbours — P (T3) and Q (M4) for X, R (B2) and S (M1) for Y — are disjoint and hold none, so
 * only X and Y spread in round 1. Hemlock's `Pattern-All` lands her Toxic Overflow on every
 * enemy each cast. Both sides.
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
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(11));

const HEMLOCK_HP = 1_000_000;
const SHIP_COUNT = 8;

const noop: Ability = {
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
};

/** Hemlock's real Toxic Overflow; the board-wide pattern below lands it on every enemy. */
const toxicOverflow = (): Ability => {
    const found = realSlots('Hemlock', ['charged'])[0].abilities.find(
        (a) => a.config.type === 'debuff' && a.config.buffName.startsWith(TOXIC_OVERFLOW)
    );
    if (!found) throw new Error('Hemlock charged carries no Toxic Overflow');
    return found;
};

interface PerRound {
    hemlockSpreadCharges: number;
    oleanderSpreadCharges: number;
    /** Corrosion stacks Hemlock's spreads landed at this round's end. */
    spreadLanded: number;
    /** Holders that spread at this round's end. */
    spreaders: number;
}

const measure = (
    side: 'player' | 'enemy',
    seeded: string[],
    numRounds: number
): { rounds: Map<number, PerRound>; hemlockRepair: number } => {
    const hemlock: ShipSpec = {
        id: 'hemlock',
        position: 'M4',
        speed: 1000,
        hp: HEMLOCK_HP,
        hacking: 1000,
        pattern: 'Pattern-All',
        // A charge cap far above the grants under test, so no charged cast muddies the count.
        chargeCount: 99,
        skills: {
            slots: [
                { slot: 'active', abilities: [noop, toxicOverflow()] },
                ...realSlots('Hemlock', ['passive']),
            ],
        },
    };
    const oleander: ShipSpec = {
        id: 'oleander',
        position: 'M3',
        speed: 2,
        chargeCount: 99,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Oleander', ['passive'])],
        },
    };
    const enemy = (id: string, position: Position): ShipSpec => ({
        id,
        position,
        speed: 1,
        hp: 1e9,
        security: 0,
    });
    const { input, idOf } = mirrorBoard(
        {
            caster: [hemlock, oleander],
            other: [
                enemy('x', 'T4'),
                enemy('p', 'T3'),
                enemy('q', 'M4'),
                enemy('y', 'B1'),
                enemy('r', 'B2'),
                enemy('s', 'M1'),
            ],
            numRounds,
        },
        side
    );
    const bus = createEventBus();
    const rounds = new Map<number, PerRound>();
    const at = (round: number): PerRound => {
        let row = rounds.get(round);
        if (!row) {
            row = {
                hemlockSpreadCharges: 0,
                oleanderSpreadCharges: 0,
                spreadLanded: 0,
                spreaders: 0,
            };
            rounds.set(round, row);
        }
        return row;
    };
    let hemlockRepair = 0;
    // Every ship has acted once SHIP_COUNT turns have ended: what lands after is the spread.
    let turnsEnded = 0;
    const roundEnding = () => turnsEnded >= SHIP_COUNT;
    bus.on('round-started', () => {
        turnsEnded = 0;
    });
    bus.on('turn-ended', () => {
        turnsEnded++;
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (!roundEnding() || e.reason !== 'manip') return;
        if (e.actorId === idOf('hemlock'))
            at(e.round).hemlockSpreadCharges += e.newCharge - e.oldCharge;
        if (e.actorId === idOf('oleander'))
            at(e.round).oleanderSpreadCharges += e.newCharge - e.oldCharge;
    });
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (roundEnding() && e.sourceId === idOf('hemlock')) at(e.round).spreadLanded += e.stacks;
    });
    bus.on('corrosion-spread', (e: Extract<CombatEvent, { type: 'corrosion-spread' }>) => {
        at(e.round).spreaders++;
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === idOf('hemlock')) hemlockRepair += e.amount;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const id of seeded)
                all.find((a) => a.id === idOf(id))!.corrosionEntries.push({
                    stacks: 1,
                    tier: 6,
                    remainingRounds: 9,
                    sourceId: idOf(id),
                });
        },
    });
    return { rounds, hemlockRepair };
};

describe("one round's Toxic Overflow spreads are one event", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: X and Y spreading together give Hemlock and Oleander +1 each`, () => {
            const m = measure(side, ['x', 'y'], 1);
            const r1 = m.rounds.get(1)!;
            // Instrument: both holders spread, each landing on its two neighbours.
            expect(r1.spreaders).toBe(2);
            expect(r1.spreadLanded).toBe(4);
            expect(r1.hemlockSpreadCharges).toBe(1);
            expect(r1.oleanderSpreadCharges).toBe(1);
        });

        it(`${side}-side: Hemlock still repairs 5% per enemy each spread landed on`, () => {
            const m = measure(side, ['x', 'y'], 1);
            expect(m.rounds.get(1)!.spreadLanded).toBe(4);
            expect(m.hemlockRepair).toBeCloseTo(HEMLOCK_HP * 0.05 * 4, 4);
        });

        it(`${side}-side: a spread in round 1 and another in round 2 give +1 each`, () => {
            const m = measure(side, ['x'], 2);
            const r1 = m.rounds.get(1)!;
            const r2 = m.rounds.get(2)!;
            // Instrument: X spreads alone in round 1; in round 2 X and its neighbours P and Q,
            // which took round 1's spread, all spread.
            expect(r1.spreaders).toBe(1);
            expect(r1.spreadLanded).toBe(2);
            expect(r2.spreaders).toBe(3);
            expect(r2.spreadLanded).toBeGreaterThan(0);
            expect(r1.hemlockSpreadCharges).toBe(1);
            expect(r1.oleanderSpreadCharges).toBe(1);
            expect(r2.hemlockSpreadCharges).toBe(1);
            expect(r2.oleanderSpreadCharges).toBe(1);
        });
    }
});
