import { describe, it, expect } from 'vitest';
import { calculateShipProbability, FactionEvent } from '../recruitmentCalculator';
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
});
