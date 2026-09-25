import { describe, it, expect, vi } from 'vitest';
import { normaliseShipFields } from '../normaliseShipFields';
import type { Ship } from '../../../types/ship';

const baseShip = (overrides: Record<string, unknown> = {}) =>
    ({
        id: 'ship-1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN',
        type: 'ATTACKER',
        affinity: 'chemical',
        baseStats: { hp: 1000, attack: 100, defence: 50, speed: 100, crit: 10, critDamage: 50 },
        equipment: {},
        implants: {},
        refits: [],
        ...overrides,
    }) as unknown as Ship;

describe('normaliseShipFields (#568)', () => {
    it('lowercases a legacy mixed-case rarity', () => {
        const result = normaliseShipFields(baseShip({ rarity: 'Epic' }));
        expect(result.rarity).toBe('epic');
    });

    it('turns a null affinity into undefined rather than dropping the ship', () => {
        const result = normaliseShipFields(baseShip({ affinity: null }));
        expect(result.affinity).toBeUndefined();
        expect(result.id).toBe('ship-1');
    });

    it('falls back a retired/unknown ship type to ATTACKER and warns', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = normaliseShipFields(baseShip({ type: 'RETIRED_ROLE' }));

        expect(result.type).toBe('ATTACKER');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RETIRED_ROLE'));
        warn.mockRestore();
    });

    it('does not warn for a recognised type', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        normaliseShipFields(baseShip({ type: 'ATTACKER' }));

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('leaves an already-valid ship unchanged in value', () => {
        const ship = baseShip();
        const result = normaliseShipFields(ship);

        expect(result).toEqual(ship);
    });

    it('is idempotent: normalising twice equals normalising once', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ship = baseShip({ rarity: 'Epic', type: 'RETIRED_ROLE', affinity: null });

        const once = normaliseShipFields(ship);
        const twice = normaliseShipFields(once);

        expect(twice).toEqual(once);
        vi.restoreAllMocks();
    });

    it('does not touch faction', () => {
        const result = normaliseShipFields(baseShip({ faction: 'not-a-real-faction' }));
        expect(result.faction).toBe('not-a-real-faction');
    });
});
