import { describe, it, expect } from 'vitest';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    ATTACKER_SLOT_OPTIONS,
} from '../dpsEnemyPlacement';

describe('dpsEnemyPlacement', () => {
    it('defaults both sides to the front column (column 4)', () => {
        // Column 4 is the FRONT of the board. A back-column default would silently change
        // targeting semantics for any pattern-bearing kit.
        expect(DEFAULT_ATTACKER_SLOT).toBe('M4');
        expect(DEFAULT_ENEMY_SLOT).toBe('M4');
    });

    it('offers every one of the 12 slots as an attacker option', () => {
        expect(ATTACKER_SLOT_OPTIONS).toHaveLength(12);
        expect(ATTACKER_SLOT_OPTIONS).toContain(DEFAULT_ATTACKER_SLOT);
        expect(new Set(ATTACKER_SLOT_OPTIONS).size).toBe(12);
    });
});
