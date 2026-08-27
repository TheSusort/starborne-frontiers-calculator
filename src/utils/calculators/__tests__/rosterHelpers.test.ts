import { describe, it, expect } from 'vitest';
import { defaultEnemyStats, firstFreeSlot, detectShipCharged } from '../rosterHelpers';
import { HEALING_SLOT_OPTIONS } from '../healingPlacement';
import type { Ship } from '../../../types/ship';

describe('rosterHelpers', () => {
    it('defaultEnemyStats never yields a 0 for a stat the practice target needs non-zero', () => {
        const stats = defaultEnemyStats(0);
        // healingDefaultEnemy.ts holds the reasoning: a 0 here silently zeroes every
        // basis:'damage-dealt' rider, or enters the enemy already destroyed.
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.defence).toBeGreaterThan(0);
        expect(stats.security).toBeGreaterThan(0);
        expect(stats.speed).toBeGreaterThan(0);
        expect(stats.attack).toBeGreaterThan(0);
        expect(stats.hacking).toBeGreaterThan(0);
    });

    it('firstFreeSlot returns the wanted cell when it is free', () => {
        expect(firstFreeSlot('M2', [])).toBe('M2');
        expect(firstFreeSlot('M2', ['M1', undefined])).toBe('M2');
    });

    it('firstFreeSlot falls to the first unoccupied cell when the wanted one is taken', () => {
        const result = firstFreeSlot('M2', ['M2']);
        expect(result).not.toBe('M2');
        expect(HEALING_SLOT_OPTIONS).toContain(result);
    });

    it('firstFreeSlot returns the wanted cell when the board is full', () => {
        expect(firstFreeSlot('M2', [...HEALING_SLOT_OPTIONS])).toBe('M2');
    });

    it('detectShipCharged reads every skill-text field, not just the active one', () => {
        const base = { id: 's', name: 'S', baseStats: {} } as unknown as Ship;
        expect(detectShipCharged(base)).toBe(false);
        expect(
            detectShipCharged({
                ...base,
                thirdPassiveSkillText: 'This Unit starts the battle fully charged.',
            })
        ).toBe(true);
    });
});
