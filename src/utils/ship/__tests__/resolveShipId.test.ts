import { describe, it, expect } from 'vitest';
import { resolveShipId, type ShipIdResolverDeps } from '../resolveShipId';
import { referenceShipId } from '../referenceShip';
import type { Ship } from '../../../types/ship';

const template = {
    id: 'tmpl-1',
    name: 'Test Unit',
    type: 'ATTACKER',
    faction: 'TERRAN',
    rarity: 'legendary',
    baseStats: { hp: 1000, attack: 100, defence: 50, speed: 100, crit: 10, critDamage: 50 },
    equipment: {},
    implants: {},
    refits: [],
    level: 60,
    rank: 0,
} as unknown as Ship;

const owned = { ...template, id: 'owned-uuid-1', name: 'Owned Copy' };

const deps: ShipIdResolverDeps = {
    getShipById: (id) => (id === owned.id ? owned : undefined),
    units: [template],
    getAscensionStats: () => null,
};

describe('resolveShipId', () => {
    it('resolves an owned ship id from the owned roster', () => {
        expect(resolveShipId('owned-uuid-1', deps)).toBe(owned);
    });

    it('rebuilds a reference id from the unit catalogue instead of the owned roster', () => {
        const id = referenceShipId(template, 'r0');
        const resolved = resolveShipId(id, deps);
        expect(resolved).not.toBeNull();
        expect(resolved?.id).toBe(id);
        expect(resolved?.name).toBe('Test Unit');
    });

    it('returns null for an unknown owned id', () => {
        expect(resolveShipId('missing-uuid', deps)).toBeNull();
    });

    it('returns null for a reference id whose template is not in the catalogue', () => {
        expect(resolveShipId('template:gone:r0', deps)).toBeNull();
    });
});
