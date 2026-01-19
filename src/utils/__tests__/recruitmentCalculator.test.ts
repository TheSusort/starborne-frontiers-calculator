import { describe, it, expect } from 'vitest';
import {
    calculateShipProbability,
    FactionEvent,
    getAffinityWeight,
} from '../recruitmentCalculator';
import { Ship } from '../../types/ship';
import { FactionName } from '../../constants/factions';
import { ShipTypeName } from '../../constants/shipTypes';

// Mock ships for testing
const createMockShip = (
    name: string,
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
    faction: FactionName,
    affinity: 'chemical' | 'electric' | 'thermal' | 'antimatter' = 'chemical'
): Ship => ({
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    rarity,
    faction,
    type: 'ATTACKER' as ShipTypeName,
    affinity,
    baseStats: {
        hp: 1000,
        attack: 100,
        defence: 100,
        speed: 100,
        hacking: 100,
        security: 100,
        crit: 5,
        critDamage: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
});

describe('recruitmentCalculator', () => {
    describe('calculateShipProbability with faction events', () => {
        const mockShips: Ship[] = [
            // Tianchao legendary ships
            createMockShip('Tianchao Ship 1', 'legendary', 'TIANCHAO', 'chemical'),
            createMockShip('Tianchao Ship 2', 'legendary', 'TIANCHAO', 'electric'),
            // Other faction legendary ships
            createMockShip('Other Ship 1', 'legendary', 'BINDERBURG', 'chemical'),
            createMockShip('Other Ship 2', 'legendary', 'GELECEK', 'thermal'),
            createMockShip('Other Ship 3', 'legendary', 'MARAUDERS', 'antimatter'),
        ];

        it('should give faction ships 20x weight during faction event', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];
            const otherShip = mockShips[2];

            const tianchaoProbability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );
            const otherProbability = calculateShipProbability(
                otherShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            // Tianchao ship should have 20x the probability of other ships
            expect(tianchaoProbability / otherProbability).toBeCloseTo(20, 1);
        });

        it('should only affect specialist beacons', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];

            // Expert beacon should not be affected by faction event
            const withFactionEvent = calculateShipProbability(
                tianchaoShip,
                'expert',
                mockShips,
                [],
                factionEvent
            );
            const withoutFactionEvent = calculateShipProbability(
                tianchaoShip,
                'expert',
                mockShips,
                []
            );

            expect(withFactionEvent).toBe(withoutFactionEvent);
        });

        it('should ignore affinity during faction events', () => {
            // Create ships with different affinities in same faction
            const shipsWithAffinities: Ship[] = [
                createMockShip('Faction A1', 'legendary', 'TIANCHAO', 'chemical'),
                createMockShip('Faction A2', 'legendary', 'TIANCHAO', 'antimatter'),
                createMockShip('Other B1', 'legendary', 'BINDERBURG', 'chemical'),
            ];

            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };

            // Both Tianchao ships should have equal probability regardless of affinity
            const chemicalProb = calculateShipProbability(
                shipsWithAffinities[0],
                'specialist',
                shipsWithAffinities,
                [],
                factionEvent
            );
            const antimatterProb = calculateShipProbability(
                shipsWithAffinities[1],
                'specialist',
                shipsWithAffinities,
                [],
                factionEvent
            );

            expect(chemicalProb).toBeCloseTo(antimatterProb, 10);
        });

        it('should support custom multiplier', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO', multiplier: 10 };
            const tianchaoShip = mockShips[0];
            const otherShip = mockShips[2];

            const tianchaoProbability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );
            const otherProbability = calculateShipProbability(
                otherShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            // Should use custom 10x multiplier
            expect(tianchaoProbability / otherProbability).toBeCloseTo(10, 1);
        });

        it('should calculate correct pool weights', () => {
            // 2 Tianchao ships * 20 = 40 weight
            // 3 other ships * 1 = 3 weight
            // Total = 43 weight
            // Legendary rate for specialist = 1/66 ≈ 0.01515

            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];

            const probability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            const legendaryRate = 1 / 66;
            const expectedProbability = (legendaryRate * 20) / 43;

            expect(probability).toBeCloseTo(expectedProbability, 10);
        });
    });

    describe('calculateShipProbability with affinity weighted pools', () => {
        it('should give non-antimatter ships 10x weight vs antimatter', () => {
            // Create ships: 1 chemical, 1 antimatter
            const mixedShips: Ship[] = [
                createMockShip('Chemical Ship', 'legendary', 'BINDERBURG', 'chemical'),
                createMockShip('Antimatter Ship', 'legendary', 'MARAUDERS', 'antimatter'),
            ];

            const chemicalProb = calculateShipProbability(
                mixedShips[0],
                'specialist',
                mixedShips,
                []
            );
            const antimatterProb = calculateShipProbability(
                mixedShips[1],
                'specialist',
                mixedShips,
                []
            );

            // Chemical ship should have 10x probability of antimatter ship
            // Weight: chemical = 10, antimatter = 1, total = 11
            expect(chemicalProb / antimatterProb).toBeCloseTo(10, 1);
        });

        it('should weight all non-antimatter affinities equally', () => {
            // Create ships with different non-antimatter affinities
            const nonAntimatterShips: Ship[] = [
                createMockShip('Chemical Ship', 'legendary', 'BINDERBURG', 'chemical'),
                createMockShip('Electric Ship', 'legendary', 'GELECEK', 'electric'),
                createMockShip('Thermal Ship', 'legendary', 'TIANCHAO', 'thermal'),
            ];

            const chemicalProb = calculateShipProbability(
                nonAntimatterShips[0],
                'specialist',
                nonAntimatterShips,
                []
            );
            const electricProb = calculateShipProbability(
                nonAntimatterShips[1],
                'specialist',
                nonAntimatterShips,
                []
            );
            const thermalProb = calculateShipProbability(
                nonAntimatterShips[2],
                'specialist',
                nonAntimatterShips,
                []
            );

            // All non-antimatter ships should have equal probability
            expect(chemicalProb).toBeCloseTo(electricProb, 10);
            expect(electricProb).toBeCloseTo(thermalProb, 10);
        });

        it('should calculate correct pool weights for Discord user example', () => {
            // Discord user's math:
            // 5 Gelecek legendaries (non-antimatter) × 10 weight = 50
            // 46 other legendaries (assuming all non-antimatter for simplicity) × 10 = 460
            // But let's test a simpler case that matches their ratio logic

            // Simpler test: 5 faction ships (non-antimatter) + 46 other ships (mix)
            // Let's say 46 others = 40 non-antimatter + 6 antimatter
            // Weight: 5*10 + 40*10 + 6*1 = 50 + 400 + 6 = 456

            // For the actual Discord calculation (all non-antimatter):
            // 51 ships × 10 weight = 510 total
            // Each ship probability = (1/66) × (10/510)

            const ships: Ship[] = [];
            // 5 Gelecek ships
            for (let i = 0; i < 5; i++) {
                ships.push(createMockShip(`Gelecek ${i}`, 'legendary', 'GELECEK', 'chemical'));
            }
            // 46 other ships (all non-antimatter for this test)
            for (let i = 0; i < 46; i++) {
                ships.push(createMockShip(`Other ${i}`, 'legendary', 'BINDERBURG', 'thermal'));
            }

            const gelecekShip = ships[0];
            const probability = calculateShipProbability(gelecekShip, 'specialist', ships, []);

            // All 51 ships are non-antimatter with weight 10
            // Total weight = 51 × 10 = 510
            // P(specific ship) = (1/66) × (10/510)
            const legendaryRate = 1 / 66;
            const expectedProbability = (legendaryRate * 10) / 510;

            expect(probability).toBeCloseTo(expectedProbability, 10);
        });

        it('should calculate probability of ANY Gelecek ship correctly', () => {
            // More realistic: 5 Gelecek (non-AM) + 40 others (non-AM) + 6 others (antimatter)
            // Weight: 5*10 + 40*10 + 6*1 = 456
            // P(any Gelecek) = sum of all 5 Gelecek probs = 5 × (1/66) × (10/456)

            const ships: Ship[] = [];
            // 5 Gelecek ships (non-antimatter)
            for (let i = 0; i < 5; i++) {
                ships.push(createMockShip(`Gelecek ${i}`, 'legendary', 'GELECEK', 'chemical'));
            }
            // 40 other ships (non-antimatter)
            for (let i = 0; i < 40; i++) {
                ships.push(createMockShip(`Other ${i}`, 'legendary', 'BINDERBURG', 'thermal'));
            }
            // 6 antimatter ships
            for (let i = 0; i < 6; i++) {
                ships.push(
                    createMockShip(`Antimatter ${i}`, 'legendary', 'MARAUDERS', 'antimatter')
                );
            }

            // Sum probability of all Gelecek ships
            let totalGelecekProb = 0;
            for (let i = 0; i < 5; i++) {
                totalGelecekProb += calculateShipProbability(ships[i], 'specialist', ships, []);
            }

            // Total weight = 5*10 + 40*10 + 6*1 = 456
            // P(any Gelecek) = (1/66) × (5 × 10 / 456) = (1/66) × (50/456)
            const legendaryRate = 1 / 66;
            const expectedProbability = (legendaryRate * 50) / 456;

            expect(totalGelecekProb).toBeCloseTo(expectedProbability, 10);
        });

        it('should return correct affinity weights', () => {
            expect(getAffinityWeight('chemical')).toBe(10);
            expect(getAffinityWeight('electric')).toBe(10);
            expect(getAffinityWeight('thermal')).toBe(10);
            expect(getAffinityWeight('antimatter')).toBe(1);
        });
    });
});
