import { describe, it, expect } from 'vitest';
import { bossFootprint, bossShip, bossShipId, parseBossShipId } from '../bountyBosses';

describe('parseBossShipId', () => {
    it('reads a boss id back into bounty and level', () => {
        expect(parseBossShipId('boss:fenri:32')).toEqual({ id: 'fenri', level: 32 });
    });

    it('rejects unknown bosses, non-numeric levels and other id kinds', () => {
        expect(parseBossShipId('boss:nope:32')).toBeNull();
        expect(parseBossShipId('boss:fenri:x')).toBeNull();
        expect(parseBossShipId('template:abc:r0')).toBeNull();
        expect(parseBossShipId('owned-uuid')).toBeNull();
    });

    it('round-trips bossShipId', () => {
        expect(parseBossShipId(bossShipId('fenri', 32))).toEqual({ id: 'fenri', level: 32 });
    });
});

describe('bossShip', () => {
    it('is null for a level without stats', () => {
        expect(bossShip('fenri', 31)).toBeNull();
    });

    it('builds Fenri at level 32', () => {
        const ship = bossShip('fenri', 32)!;
        expect(ship.id).toBe('boss:fenri:32');
        expect(ship.baseStats.hp).toBe(327000);
        expect(ship.affinity).toBe('antimatter');
        expect(ship.type).toBe('ATTACKER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.activePattern).toBe('Pattern-Line-Range-2');
        expect(ship.firstPassiveSkillText).toContain('<unit-skill>Pressing Onslaught</unit-skill>');
    });
});

describe('bossFootprint', () => {
    it('returns the boss footprint', () => {
        expect(bossFootprint(bossShip('fenri', 32)!)).toEqual(['M1', 'M2']);
    });

    it('is undefined for a non-boss ship', () => {
        expect(bossFootprint({ ...bossShip('fenri', 32)!, id: 'owned-uuid' })).toBeUndefined();
    });
});
