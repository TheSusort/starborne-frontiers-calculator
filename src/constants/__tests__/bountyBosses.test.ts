import { describe, it, expect } from 'vitest';
import {
    BOUNTY_ADDS,
    BOUNTY_ENCOUNTERS,
    bossFootprint,
    bossShip,
    bossShipId,
    isBossShipId,
    npcShip,
    npcShipId,
    parseBossShipId,
    parseNpcShipId,
} from '../bountyBosses';

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

describe('Mamma Maglienza', () => {
    it('builds at level 32 with the measured stats', () => {
        const ship = bossShip('maglienza', 32)!;
        expect(ship.id).toBe('boss:maglienza:32');
        expect(ship.name).toBe('Mamma Maglienza');
        expect(ship.affinity).toBe('electric');
        expect(ship.type).toBe('DEBUFFER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 225450, attack: 21958, speed: 121 });
        expect(bossFootprint(ship)).toEqual(['T1', 'M2', 'M3', 'B1']);
    });
});

describe('npc ids', () => {
    it('round-trips npcShipId', () => {
        expect(npcShipId('capo', 124)).toBe('npc:capo:124');
        expect(parseNpcShipId(npcShipId('capo', 124))).toEqual({ id: 'capo', level: 124 });
    });

    it('rejects unknown adds, bad levels and other id kinds', () => {
        expect(parseNpcShipId('npc:nope:124')).toBeNull();
        expect(parseNpcShipId('npc:capo:x')).toBeNull();
        expect(parseNpcShipId('npc:capo:124:1')).toBeNull();
        expect(parseNpcShipId('boss:fenri:32')).toBeNull();
        expect(parseBossShipId('npc:capo:124')).toBeNull();
    });

    it('isBossShipId is true only for boss ids', () => {
        expect(isBossShipId('boss:fenri:32')).toBe(true);
        expect(isBossShipId('boss:nope:32')).toBe(false);
        expect(isBossShipId('npc:capo:124')).toBe(false);
        expect(isBossShipId('owned-uuid')).toBe(false);
    });
});

describe('npcShip', () => {
    it('is null for a level the add does not exist at', () => {
        expect(npcShip('capo', 60)).toBeNull();
    });

    it('builds a Capo', () => {
        const ship = npcShip('capo', 124)!;
        expect(ship.id).toBe('npc:capo:124');
        expect(ship.affinity).toBe('electric');
        expect(ship.type).toBe('DEFENDER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 60170, defence: 10943, speed: 83 });
        expect(ship.activeSkillText).toContain('of its Defense');
    });
});

describe('BOUNTY_ENCOUNTERS', () => {
    it('lists Fenri without adds and Mamma with three Capos', () => {
        const fenri = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'fenri' && e.level === 32)!;
        expect(fenri.adds).toEqual([]);
        const mamma = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'maglienza' && e.level === 32)!;
        expect(mamma.adds).toEqual([
            { addId: 'capo', position: 'T2' },
            { addId: 'capo', position: 'M4' },
            { addId: 'capo', position: 'B2' },
        ]);
    });

    it('never puts two units on one cell, and every unit resolves', () => {
        for (const encounter of BOUNTY_ENCOUNTERS) {
            const boss = bossShip(encounter.bountyId, encounter.level)!;
            expect(boss).not.toBeNull();
            const footprint = bossFootprint(boss)!;
            const cells = [...footprint, ...encounter.adds.map((a) => a.position)];
            expect(new Set(cells).size).toBe(cells.length);
            for (const add of encounter.adds) {
                const def = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId)!;
                expect(npcShip(def.id, def.level)).not.toBeNull();
            }
        }
    });
});
