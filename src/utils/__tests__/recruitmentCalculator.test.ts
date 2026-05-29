import { describe, it, expect } from 'vitest';
import { calculateShipProbability, getAffinityTickets } from '../recruitmentCalculator';
import { Ship, AffinityName } from '../../types/ship';
import { RarityName } from '../../constants/rarities';
import { FactionName } from '../../constants/factions';

let idCounter = 0;
const makeShip = (
    rarity: RarityName,
    affinity: AffinityName,
    faction: FactionName = 'XAOC',
    name?: string
): Ship =>
    ({
        id: `ship-${idCounter++}`,
        name: name ?? `${rarity}-${affinity}-${idCounter}`,
        rarity,
        affinity,
        faction,
        type: 'Attacker',
        baseStats: {},
        equipment: {},
        implants: {},
    }) as unknown as Ship;

describe('getAffinityTickets', () => {
    it('gives antimatter 1 ticket and non-antimatter 10 tickets', () => {
        expect(getAffinityTickets('antimatter')).toBe(1);
        expect(getAffinityTickets('thermal')).toBe(10);
        expect(getAffinityTickets('chemical')).toBe(10);
        expect(getAffinityTickets('electric')).toBe(10);
    });
});

describe('calculateShipProbability — ticket-based affinity weighting', () => {
    it('weights a non-antimatter ship 10x an antimatter ship of the same rarity', () => {
        // 2 antimatter (1 ticket each) + 3 thermal (10 tickets each) = 2 + 30 = 32 tickets
        const pool = [
            makeShip('legendary', 'antimatter'),
            makeShip('legendary', 'antimatter'),
            makeShip('legendary', 'thermal'),
            makeShip('legendary', 'thermal'),
            makeShip('legendary', 'thermal'),
        ];

        const antimatter = pool[0];
        const thermal = pool[2];

        // Elite beacon: legendary rate = 1.0
        const pAnti = calculateShipProbability(antimatter, 'elite', pool);
        const pThermal = calculateShipProbability(thermal, 'elite', pool);

        expect(pAnti).toBeCloseTo(1 / 32, 10);
        expect(pThermal).toBeCloseTo(10 / 32, 10);
        expect(pThermal / pAnti).toBeCloseTo(10, 10);
    });

    it('treats thermal, chemical and electric as one combined non-antimatter pool (equal per unit)', () => {
        const pool = [
            makeShip('legendary', 'antimatter'),
            makeShip('legendary', 'thermal'),
            makeShip('legendary', 'chemical'),
            makeShip('legendary', 'electric'),
        ];

        const pThermal = calculateShipProbability(pool[1], 'elite', pool);
        const pChemical = calculateShipProbability(pool[2], 'elite', pool);
        const pElectric = calculateShipProbability(pool[3], 'elite', pool);

        // Total tickets: 1 + 10 + 10 + 10 = 31
        expect(pThermal).toBeCloseTo(10 / 31, 10);
        expect(pChemical).toBeCloseTo(10 / 31, 10);
        expect(pElectric).toBeCloseTo(10 / 31, 10);
    });

    it('produces the director-confirmed category split for a realistic legendary pool (10 anti, 43 non-anti)', () => {
        const pool: Ship[] = [];
        for (let i = 0; i < 10; i++) pool.push(makeShip('legendary', 'antimatter'));
        for (let i = 0; i < 43; i++) pool.push(makeShip('legendary', 'thermal'));

        // Total tickets: 10*1 + 43*10 = 440
        const antimatterCategoryShare = pool
            .filter((s) => s.affinity === 'antimatter')
            .reduce((sum, s) => sum + calculateShipProbability(s, 'elite', pool), 0);

        // ~2.27%, NOT 10% — this is the model-B prediction
        expect(antimatterCategoryShare).toBeCloseTo(10 / 440, 10);
    });

    it('scales the per-ship probability by the rarity rate (specialist legendary = 1/66)', () => {
        const pool = [makeShip('legendary', 'antimatter'), makeShip('legendary', 'thermal')];
        // Total tickets: 1 + 10 = 11; specialist legendary rate = 1/66
        const pThermal = calculateShipProbability(pool[1], 'specialist', pool);
        expect(pThermal).toBeCloseTo((1 / 66) * (10 / 11), 10);
    });

    it('returns 0 when the beacon cannot produce that rarity', () => {
        const pool = [makeShip('legendary', 'thermal')];
        expect(calculateShipProbability(pool[0], 'public', pool)).toBe(0);
    });
});

describe('calculateShipProbability — faction events stack on affinity tickets', () => {
    const GELECEK: FactionName = 'GELECEK';
    const OTHER: FactionName = 'XAOC';

    it('multiplies a featured-faction ship by the event multiplier on top of affinity tickets', () => {
        const pool = [
            makeShip('legendary', 'antimatter', GELECEK, 'AntiGelecek'), // 1 * 10 = 10
            makeShip('legendary', 'thermal', GELECEK, 'ThermalGelecek'), // 10 * 10 = 100
            makeShip('legendary', 'thermal', OTHER, 'ThermalXaoc'), // 10 * 1 = 10
            makeShip('legendary', 'antimatter', OTHER, 'AntiXaoc'), // 1 * 1 = 1
        ];
        // Total tickets = 10 + 100 + 10 + 1 = 121
        const factionEvent = { faction: GELECEK, multiplier: 10 };

        const pThermalGelecek = calculateShipProbability(
            pool[1],
            'specialist',
            pool,
            [],
            factionEvent
        );
        const pAntiGelecek = calculateShipProbability(
            pool[0],
            'specialist',
            pool,
            [],
            factionEvent
        );
        const pThermalXaoc = calculateShipProbability(
            pool[2],
            'specialist',
            pool,
            [],
            factionEvent
        );

        const rate = 1 / 66;
        expect(pThermalGelecek).toBeCloseTo(rate * (100 / 121), 10);
        expect(pAntiGelecek).toBeCloseTo(rate * (10 / 121), 10);
        expect(pThermalXaoc).toBeCloseTo(rate * (10 / 121), 10);

        // antimatter-in-faction (10) ties with thermal-out-of-faction (10)
        expect(pAntiGelecek).toBeCloseTo(pThermalXaoc, 10);
    });

    it('supports a 20x multiplier', () => {
        const pool = [
            makeShip('legendary', 'thermal', GELECEK, 'ThermalGelecek'), // 10 * 20 = 200
            makeShip('legendary', 'thermal', OTHER, 'ThermalXaoc'), // 10 * 1 = 10
        ];
        // Total = 210
        const factionEvent = { faction: GELECEK, multiplier: 20 };
        const p = calculateShipProbability(pool[0], 'specialist', pool, [], factionEvent);
        expect(p).toBeCloseTo((1 / 66) * (200 / 210), 10);
    });

    it('defaults the multiplier to 20 when none is given', () => {
        const pool = [
            makeShip('legendary', 'thermal', GELECEK, 'ThermalGelecek'),
            makeShip('legendary', 'thermal', OTHER, 'ThermalXaoc'),
        ];
        const p = calculateShipProbability(pool[0], 'specialist', pool, [], {
            faction: GELECEK,
        });
        // weights 200 vs 10 → total 210
        expect(p).toBeCloseTo((1 / 66) * (200 / 210), 10);
    });

    it('ignores faction events on non-specialist beacons (falls back to pure affinity tickets)', () => {
        const pool = [
            makeShip('legendary', 'thermal', GELECEK, 'ThermalGelecek'),
            makeShip('legendary', 'antimatter', OTHER, 'AntiXaoc'),
        ];
        const factionEvent = { faction: GELECEK, multiplier: 10 };
        // Elite ignores faction event: tickets 10 vs 1 → total 11
        const p = calculateShipProbability(pool[0], 'elite', pool, [], factionEvent);
        expect(p).toBeCloseTo(10 / 11, 10);
    });
});
