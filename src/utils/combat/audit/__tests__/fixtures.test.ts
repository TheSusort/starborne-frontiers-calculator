import { describe, it, expect } from 'vitest';
import { canonicalPlacement } from '../fixtures';
import type { Ship } from '../../../../types/ship';

const makeShip = (): Ship =>
    ({
        id: 'test-ship',
        name: 'TestShip',
        type: 'ATTACKER',
        faction: 'TERRAN',
        affinity: 'chemical',
        rarity: 'legendary',
        baseStats: {
            attack: 1800,
            hp: 90000,
            defence: 3000,
            crit: 40,
            critDamage: 120,
            hacking: 80,
            security: 100,
            speed: 110,
        },
    }) as unknown as Ship;

describe('canonicalPlacement', () => {
    it('builds a placement at the ship base stats in the given slot', () => {
        const p = canonicalPlacement(makeShip(), 'T1');
        expect(p.position).toBe('T1');
        expect(p.ship.id).toBe('test-ship');
        expect(p.statOverrides?.attack).toBe(1800);
        expect(p.statOverrides?.hp).toBe(90000);
        expect(p.statOverrides?.speed).toBe(110);
    });
});
