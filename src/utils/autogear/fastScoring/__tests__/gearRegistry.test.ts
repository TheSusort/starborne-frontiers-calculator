import { describe, it, expect } from 'vitest';
import { buildGearRegistry, addPieceStatsInto } from '../gearRegistry';
import { createStatVector, STAT_INDEX, STAT_COUNT } from '../statVector';
import { generateTestInventory, TEST_BASE_STATS } from './fixtures/testInventory';

// For these unit tests percentRef = TEST_BASE_STATS is fine (no engineering).
// The real usage passes `statVectorToBaseStats(shipPrefix)` instead.
describe('buildGearRegistry', () => {
    it('assigns unique integer ids for every piece', () => {
        const inventory = generateTestInventory(1, 12);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS, 'test-ship-id');
        const ids = new Set<number>();
        for (const p of inventory) ids.add(reg.idOf.get(p.id)!);
        expect(ids.size).toBe(inventory.length);
    });

    it('allocates statBuffer of size N * STAT_COUNT', () => {
        const inventory = generateTestInventory(2, 7);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS, 'test-ship-id');
        expect(reg.statBuffer.length).toBe(7 * STAT_COUNT);
    });

    it('maps set bonuses to consecutive positive ids (0 reserved)', () => {
        const inventory = generateTestInventory(3, 8);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS, 'test-ship-id');
        for (const [name, id] of reg.setNameToId) {
            expect(id).toBeGreaterThan(0);
            expect(reg.setIdToName[id]).toBe(name);
        }
    });

    it('precomputes stat contribution: flat + percentage + substats', () => {
        const inventory = generateTestInventory(4, 3);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS, 'test-ship-id');
        for (let i = 0; i < inventory.length; i++) {
            const piece = inventory[i];
            const base = i * STAT_COUNT;
            // Recompute expected manually from the fixture's main+sub stats
            // Attack flat adds value directly; attack percentage adds baseStats.attack * v/100
            // Sub stats always contribute (hp flat, crit percent-only)
            let expectedAttack = 0;
            if (piece.mainStat?.name === 'attack') {
                if (piece.mainStat.type === 'flat') {
                    expectedAttack += piece.mainStat.value;
                } else {
                    expectedAttack += TEST_BASE_STATS.attack * (piece.mainStat.value / 100);
                }
            }
            expect(reg.statBuffer[base + STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
        }
    });
});

describe('addPieceStatsInto', () => {
    it('adds a piece vector into target component-wise', () => {
        const inventory = generateTestInventory(5, 2);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS, 'test-ship-id');
        const target = createStatVector();
        addPieceStatsInto(reg, 0, target);
        // Adding twice should be double the single contribution.
        const first = target[STAT_INDEX.attack];
        addPieceStatsInto(reg, 0, target);
        expect(target[STAT_INDEX.attack]).toBeCloseTo(first * 2, 9);
    });
});
